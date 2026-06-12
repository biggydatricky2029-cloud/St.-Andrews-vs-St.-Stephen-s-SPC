// stamina-system.js — SYSTEM 4 piece: stamina drain, recovery, auto-sub,
// plus attribute-driven catch and tackle resolution wired into the
// existing throw/catch/tackle code paths.
//
// Stamina:
//   • Each play, every active player drains based on their stamina attribute.
//   • Inactive (subbed-out or hidden) players recover at recoverPerSec.
//   • At < subThreshold, auto-sub if a backup exists.
//   • Live multipliers: low stamina slows speed/accel/awareness.
//
// Catch resolution:
//   • Replaces the deterministic "if horiz < 1.5 then catch" branch in
//     logic-movement.updateBallPhysics with an attribute-driven roll using
//     catching / catchInTraffic / spectacularCatch.
//
// Tackle resolution:
//   • Hooks FB.attemptTackle: the tackler's tackle+hitPower vs the carrier's
//     breakTackle+strength decide who wins, before the existing fumble roll.
(function (FB) {
  'use strict';

  const SC = window.SYSTEMS_CONFIG;
  const S = SC.STAMINA;

  // -------------------------------------------------------------------------
  //  Per-play drain (called on snap)
  // -------------------------------------------------------------------------
  function drainOnSnap() {
    for (const team of ['home', 'away']) {
      for (const ent of (FB.activePlayers[team] || [])) {
        if (!ent.mesh.visible) continue;
        const drain = ent.staminaDrainPerPlay != null ? ent.staminaDrainPerPlay : 1.5;
        ent.stamina = Math.max(0, (ent.stamina != null ? ent.stamina : 100) - drain);
      }
    }
  }

  // -------------------------------------------------------------------------
  //  Per-frame recovery for benched players (anyone not currently visible).
  // -------------------------------------------------------------------------
  function recoverTick(dt) {
    const inc = S.recoverPerSec * dt;
    for (const team of ['home', 'away']) {
      for (const ent of (FB.activePlayers[team] || [])) {
        if (ent.mesh.visible) continue;
        ent.stamina = Math.min(100, (ent.stamina != null ? ent.stamina : 100) + inc);
      }
    }
  }

  /**
   * Apply live stamina penalty to a player's speed/accel for this frame.
   * Called from a steer hook so the existing movement code uses the
   * effective values without per-call branches.
   * @param {object} ent
   * @returns {{speedMul:number, accelMul:number}}
   */
  function liveMultiplier(ent) {
    const s = ent.stamina != null ? ent.stamina : 100;
    const fatigue = 1 - s / 100;  // 0 fresh, 1 gassed
    return {
      speedMul: 1 - S.speedPenalty * fatigue,
      accelMul: 1 - S.accelPenalty * fatigue,
      awarenessMul: 1 - S.awarenessPenalty * fatigue,
    };
  }

  // -------------------------------------------------------------------------
  //  Auto-sub: between plays, replace any visible player below the
  //  threshold with the freshest teammate at the same role.
  // -------------------------------------------------------------------------
  function autoSubBetweenPlays() {
    if (!FB.lineups) return;
    for (const team of ['home', 'away']) {
      const lineup = FB.lineups[team];
      if (!lineup) continue;
      for (const side of ['OFF', 'DEF', 'ST']) {
        const slots = lineup[side];
        if (!slots) continue;
        for (const slot of Object.keys(slots)) {
          const startNum = slots[slot];
          if (startNum == null) continue;
          const starter = FB.getEntByNumber(team, startNum);
          if (!starter || starter.stamina > S.subThreshold) continue;
          // Find a backup with same listed position group + freshest stamina.
          const backup = pickBackup(team, slot, startNum);
          if (!backup) continue;
          slots[slot] = backup.player.number;
          backup.role = starter.role;
        }
      }
    }
  }

  function pickBackup(team, slot, currentNum) {
    const teamData = FB.teams[team];
    if (!teamData) return null;
    const group = (FB.AttributeSystem && FB.AttributeSystem.getPositionGroup(slot)) || 'WR';
    const candidates = FB.activePlayers[team].filter((ent) => {
      if (!ent.player) return false;
      if (ent.player.number === currentNum) return false;
      if (ent.stamina <= S.subThreshold + 10) return false;
      const pg = FB.AttributeSystem ? FB.AttributeSystem.getPositionGroup(ent.player.position || '') : null;
      return pg === group;
    });
    candidates.sort((a, b) => b.stamina - a.stamina);
    return candidates[0] || null;
  }

  // -------------------------------------------------------------------------
  //  Catch resolution — replaces the unconditional catch in
  //  logic-movement.updateBallPhysics.
  // -------------------------------------------------------------------------
  function resolveCatch(rcv, ball, defenderNear) {
    const a = rcv.attr || {};
    const catching = a.catching != null ? a.catching : 60;
    // Aim error proxy: how far off-target the ball lands.
    const aimErr = FB.ballState.aimXZ
      ? Math.hypot(ball.x - FB.ballState.aimXZ.x, ball.z - FB.ballState.aimXZ.z)
      : 0;
    const clean = aimErr < 1.0;
    const baseP = FB.AttributeSystem.getAIParameter(
      catching,
      clean ? 'catch_clean_pct' : 'catch_poor_pct'
    );
    // Catch-in-traffic penalty: a defender within 2 yards slashes the rate.
    let pen = 1.0;
    if (defenderNear) {
      const cit = a.catchInTraffic != null ? a.catchInTraffic : Math.max(20, catching - 15);
      // Penalty interpolates 0.6 (low cit) → 0.95 (high cit).
      pen = 0.60 + ((cit - 50) / 49) * 0.35;
      pen = Math.max(0.4, Math.min(1.0, pen));
    }
    const finalP = Math.max(0.05, Math.min(0.99, baseP * pen));
    return Math.random() < finalP;
  }

  // -------------------------------------------------------------------------
  //  Tackle resolution — wraps FB.attemptTackle so the tackler can be
  //  bumped/escaped by a high-breakTackle ball carrier.
  // -------------------------------------------------------------------------
  function rollTackle(def, carrier) {
    const dA = def.attr || {};
    const cA = carrier.attr || {};
    const tacklePower = (dA.tackle || 60) + (dA.hitPower || 60);
    const escape = (cA.breakTackle || 50) + (cA.strength || 60) + Math.random() * 20;
    return tacklePower >= escape;
  }

  // -------------------------------------------------------------------------
  //  Wiring
  // -------------------------------------------------------------------------

  // 1) Drain on snap, recover during deadball.
  if (FB.snapBall && !FB.snapBall.__staminaWrap) {
    const orig = FB.snapBall;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { drainOnSnap(); } catch (_) {}
      return r;
    };
    wrapped.__staminaWrap = true;
    FB.snapBall = wrapped;
  }

  // Recovery on every frame in non-play phases.
  const _origUpdateRunOn = FB.updateRunOn;
  if (_origUpdateRunOn && !_origUpdateRunOn.__staminaWrap) {
    const wrapped = function (dt) {
      const r = _origUpdateRunOn.apply(this, arguments);
      if (FB.state.phase !== 'play') recoverTick(dt);
      return r;
    };
    wrapped.__staminaWrap = true;
    FB.updateRunOn = wrapped;
  }

  // 2) Live stamina penalty piggybacks on FB.steerToward — multiply the
  // effective speed by the fatigue factor before steering.
  if (FB.steerToward && !FB.steerToward.__staminaWrap) {
    const orig = FB.steerToward;
    const wrapped = function (ent, target, dt, speedFrac) {
      if (ent && ent.stamina != null && ent.stamina < 100) {
        const m = liveMultiplier(ent);
        // Scale the speed fraction directly so the existing math picks it up.
        return orig.call(this, ent, target, dt, (speedFrac || 0.9) * m.speedMul);
      }
      return orig.apply(this, arguments);
    };
    wrapped.__staminaWrap = true;
    FB.steerToward = wrapped;
  }

  // 3) Auto-sub between plays.
  if (FB.endPlay && !FB.endPlay.__staminaWrap) {
    const orig = FB.endPlay;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { autoSubBetweenPlays(); } catch (_) {}
      return r;
    };
    wrapped.__staminaWrap = true;
    FB.endPlay = wrapped;
  }

  // 4) Catch roll — patch the catch check in updateBallPhysics by
  // intercepting onPassCaught. The cleanest hook: wrap onPassCaught so
  // even if the ball hits the receiver, we may register an incomplete.
  if (FB.onPassCaught && !FB.onPassCaught.__staminaWrap) {
    const orig = FB.onPassCaught;
    const wrapped = function (rcv) {
      const ballPos = FB.ball ? FB.ball.position : null;
      let defenderNear = false;
      if (ballPos) {
        const offTeam = FB.state.possession;
        const defTeam = offTeam === 'home' ? 'away' : 'home';
        for (const d of FB.activePlayers[defTeam] || []) {
          if (!d.mesh.visible || d.isDown) continue;
          if (d.mesh.position.distanceTo(rcv.mesh.position) < 2.0) { defenderNear = true; break; }
        }
      }
      const caught = ballPos ? resolveCatch(rcv, ballPos, defenderNear) : true;
      if (!caught) {
        // Drop — ball goes incomplete. Replicate the incomplete path used
        // by FB.onBallLanded for passes.
        FB.ballState.inAir = false;
        FB.ballState.targetPlayer = null;
        FB.ballState.kind = null;
        FB.ballCarrier = null;
        FB.state.log.push('Dropped pass by #' + rcv.player.number);
        if (FB.endPlay) FB.endPlay({ reason: 'incomplete' });
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped.__staminaWrap = true;
    FB.onPassCaught = wrapped;
  }

  // 5) Tackle roll — wrap attemptTackle. If the tackler loses, the carrier
  // shrugs off and continues running (the existing juke system handles
  // the visual flourish via "stiffArm" if available).
  if (FB.attemptTackle && !FB.attemptTackle.__staminaWrap) {
    const orig = FB.attemptTackle;
    const wrapped = function (def, carrier, forceSuccess) {
      if (forceSuccess) return orig.apply(this, arguments);
      const win = rollTackle(def, carrier);
      if (!win) {
        // Carrier breaks the tackle — defender briefly stunned, ball carrier
        // gets a small forward burst.
        def.isDown = true;
        setTimeout(() => { if (def) def.isDown = false; }, 700);
        const dir = FB.forwardDir(carrier.team);
        carrier.vel.x += dir * 1.5;
        FB.state.log.push('#' + carrier.player.number + ' breaks the tackle!');
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped.__staminaWrap = true;
    FB.attemptTackle = wrapped;
  }

  FB.StaminaSystem = { drainOnSnap, recoverTick, liveMultiplier, autoSubBetweenPlays, resolveCatch, rollTackle };

})(window.FB);

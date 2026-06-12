// coverage-ai.js — SYSTEM 2: defensive coverage AI.
//
// Two cooperating pieces:
//   • CoverageAssignmentManager — pre-snap, reads the play's defensive
//     formation, resolves which DBs are in man/zone/bracket, and writes
//     refined ent.coverage entries (target receiver, leverage, zone polygon).
//   • Per-frame agents — updateManCoverage / updateZoneCoverage / ball-in-air
//     pursuit run BEFORE the existing FB.updateDefense so the lateral
//     overrides land first; existing pursuit/tackle code in logic-movement
//     handles the actual physics from there.
//
// Reaction delay, route prediction, and jam effectiveness all come from the
// CB's manCoverage/zoneCoverage/press attributes via AttributeSystem.
// Higher-rated DBs anticipate cuts earlier and recover faster.
(function (FB) {
  'use strict';

  const SC = window.SYSTEMS_CONFIG;
  const COV = SC.COVERAGE;
  const TMP = new THREE.Vector3();
  const TMP2 = new THREE.Vector3();

  // -------------------------------------------------------------------------
  //  Pre-snap assignment
  // -------------------------------------------------------------------------

  /**
   * Resolve every DB/safety/linebacker's coverage assignment for the upcoming
   * snap. Reads ent.assignment (set by playbook.applyDefensiveAssignments)
   * and refines it: man targets get a concrete receiver entity, zone targets
   * get a center+radius, bracket double-teams get a shared receiver pointer.
   *
   * Called after FB.spawnDefense and FB.spawnOffense have both placed
   * players for the play.
   *
   * @param {string} defTeam - 'home' | 'away'
   */
  function resolveAssignments(defTeam) {
    const offTeam = defTeam === 'home' ? 'away' : 'home';
    const off = FB.offenseOf(offTeam);
    const defenders = FB.activePlayers[defTeam].filter((e) => e.mesh.visible);

    // Receiver list, ranked by slot importance (WR1 > WR2 > WR3 > TE > RB).
    const RANK = { WR1: 1, WR2: 2, WR3: 3, TE: 4, RB: 5 };
    const eligible = off
      .filter((e) => RANK[e.role] != null)
      .sort((a, b) => (RANK[a.role] || 9) - (RANK[b.role] || 9));

    // Two-pass: man defenders pick from highest-ranked unclaimed receiver,
    // then zone defenders compute their owned area.
    const claimed = new Set();

    for (const d of defenders) {
      d.coverage = null;
      const a = d.assignment;
      if (!a) continue;

      if (a.type === 'man') {
        // Try the explicitly named target first, then fall back to the
        // best unclaimed eligible receiver near this defender's slot.
        let target = a.target ? off.find((e) => e.role === a.target) : null;
        if (!target || claimed.has(target)) {
          target = eligible.find((e) => !claimed.has(e)) || null;
        }
        if (target) {
          claimed.add(target);
          d.coverage = {
            kind: 'man',
            target,
            // Inside leverage by default — take away the slant.
            leverage: target.mesh.position.z > 0 ? -1 : 1,
            // Press if the assignment flagged it; otherwise off-coverage cushion.
            press: !!a.press,
            // Reaction window (seconds) — driven by coverage rating.
            reactionSec: rateBasedReaction(d, 'manCoverage'),
            jamMul: ratePressJam(d),
            // Pending-cut timer for the flip-hips delay.
            pendingCutT: 0,
            pendingCutDir: null,
          };
        }
      } else if (a.type === 'zone') {
        // Zone center is the assignment's (depth, lateral) translated to
        // world coordinates. Radius scales with depth: shallow zones are
        // tight, deep thirds/halves are broad.
        const losX = FB.losLine ? FB.losLine.position.x : 0;
        const dir = FB.forwardDir(offTeam);
        const ddir = -dir;
        const depth = typeof a.depth === 'number' ? a.depth : 6;
        const lateral = typeof a.lateral === 'number' ? a.lateral : d.mesh.position.z;
        d.coverage = {
          kind: 'zone',
          centerX: losX + depth * ddir,
          centerZ: lateral,
          radius: Math.max(7, Math.min(18, 6 + depth * 0.45)),
          reactionSec: rateBasedReaction(d, 'zoneCoverage'),
        };
      }
      // Rush / blitz / koCover are untouched and continue to flow through
      // the existing FB.updateDefense pursuit pipeline.
    }
  }

  // Resolve coverage rating → reaction seconds via AttributeSystem.
  function rateBasedReaction(d, ratingName) {
    const a = d.attr || {};
    const r = a[ratingName] != null ? a[ratingName] : (a.awareness != null ? a.awareness : 60);
    return FB.AttributeSystem.getAIParameter(r, 'reaction_sec');
  }
  function ratePressJam(d) {
    const a = d.attr || {};
    const r = a.press != null ? a.press : 50;
    return FB.AttributeSystem.getAIParameter(r, 'jam_speed_mul');
  }

  // -------------------------------------------------------------------------
  //  Per-frame coverage update
  // -------------------------------------------------------------------------

  /**
   * Per-frame coverage logic for all defenders that have a `coverage` entry.
   * Writes ent._covOverride = {x, z, urgency} which the existing pursuit
   * code in logic-movement consumes as the target before its own steering.
   * @param {number} dt - frame delta seconds.
   */
  function update(dt) {
    if (FB.state.phase !== 'play') return;
    const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
    const inAir = FB.ballState && FB.ballState.inAir && FB.ballState.kind === 'pass';

    for (const d of FB.activePlayers[defTeam] || []) {
      if (!d.mesh.visible || d.isDown) continue;
      const c = d.coverage;
      d._covOverride = null;
      if (!c) continue;

      if (inAir) {
        playTheBall(d, dt);
        continue;
      }
      if (c.kind === 'man') manCoverageStep(d, c, dt);
      else if (c.kind === 'zone') zoneCoverageStep(d, c, dt);
    }
  }

  // ---- Man coverage step --------------------------------------------------

  function manCoverageStep(d, c, dt) {
    const r = c.target;
    if (!r || !r.mesh.visible || r.isDown) return;

    // Project receiver position 'routePredictSec' seconds into the future.
    const lead = COV.routePredictSec;
    TMP.copy(r.mesh.position).addScaledVector(r.vel, lead);

    // Inside-leverage offset on the predicted aim point.
    const dir = FB.forwardDir(r.team);
    // Stay slightly between the QB and the receiver's path.
    const lateral = c.leverage * 0.6;
    TMP.x -= dir * 0.4; // crowd the route, half a step in front
    TMP.z += lateral;

    // Reaction delay: when receiver makes a sharp lateral move, the DB
    // can't immediately respond. We detect a "cut" as a big change in the
    // receiver's velocity direction frame-to-frame.
    const vMag = Math.hypot(r.vel.x, r.vel.z);
    if (vMag > 1.5) {
      const heading = Math.atan2(r.vel.z, r.vel.x);
      if (c._lastHeading != null) {
        let dh = Math.abs(heading - c._lastHeading);
        if (dh > Math.PI) dh = 2 * Math.PI - dh;
        if (dh > 0.55 && c.pendingCutT <= 0) {
          // Receiver just cut. DB is locked in their previous heading for
          // the reaction window before they can chase the new vector.
          c.pendingCutT = c.reactionSec;
          c.pendingCutDir = c._lastHeading;
        }
      }
      c._lastHeading = heading;
    }

    if (c.pendingCutT > 0) {
      c.pendingCutT -= dt;
      // While reacting, the DB keeps moving in the receiver's pre-cut
      // direction (this is exactly the moment a CB looks beat).
      const h = c.pendingCutDir != null ? c.pendingCutDir : 0;
      TMP.copy(d.mesh.position);
      TMP.x += Math.cos(h) * 4;
      TMP.z += Math.sin(h) * 4;
    }

    // Press jam: only effective in the first 0.5 seconds after snap, only
    // if pressed, and only when the DB is within 1.2 yards of the receiver.
    const sinceSnap = FB.snapStartT ? performance.now() / 1000 - FB.snapStartT : 999;
    if (c.press && sinceSnap < 0.5 && d.mesh.position.distanceTo(r.mesh.position) < 1.2) {
      r.vel.multiplyScalar(c.jamMul);
    }

    d._covOverride = { x: TMP.x, z: TMP.z, urgency: 1.05 };
  }

  // ---- Zone coverage step --------------------------------------------------

  function zoneCoverageStep(d, c, dt) {
    // Identify the most dangerous threat in the zone: the receiver closest
    // to the zone center who is also entering it (positive velocity toward
    // the center). If no threat, hold the zone center.
    const offTeam = FB.state.possession;
    let threat = null, bestScore = -Infinity;
    for (const r of FB.offenseOf(offTeam)) {
      if (!['WR1', 'WR2', 'WR3', 'TE', 'RB'].includes(r.role)) continue;
      const dx = r.mesh.position.x - c.centerX;
      const dz = r.mesh.position.z - c.centerZ;
      const inZone = Math.hypot(dx, dz) < c.radius;
      if (!inZone) continue;
      // Threat score: closer to center + heading toward me = higher.
      const closeness = c.radius - Math.hypot(dx, dz);
      const approach = -(r.vel.x * dx + r.vel.z * dz) / Math.max(0.5, Math.hypot(dx, dz));
      const score = closeness + approach;
      if (score > bestScore) { bestScore = score; threat = r; }
    }
    if (threat) {
      // Break on the threat — bias toward the receiver but stay anchored.
      TMP.copy(threat.mesh.position).addScaledVector(threat.vel, COV.routePredictSec * 0.6);
      d._covOverride = { x: TMP.x, z: TMP.z, urgency: 0.95 };
    } else {
      d._covOverride = { x: c.centerX, z: c.centerZ, urgency: 0.55 };
    }
  }

  // ---- Ball in air: every DB sprints to the catch point ------------------

  function playTheBall(d, dt) {
    if (!FB.ball || !FB.ballState.aimXZ) return;
    const ball = FB.ball.position;
    const aim = FB.ballState.aimXZ;
    // Time until ball arrives (rough): horiz distance / horiz speed.
    const horizSpeed = Math.max(1, Math.hypot(FB.ballState.vel.x, FB.ballState.vel.z));
    const dxAim = aim.x - ball.x, dzAim = aim.z - ball.z;
    const tToAim = Math.hypot(dxAim, dzAim) / horizSpeed;
    // Intercept point — where I can meet the ball trajectory.
    const meet = TMP2.set(aim.x, 0, aim.z);
    const dToMeet = d.mesh.position.distanceTo(meet);
    const myMaxSpeed = d.baseSpeed * 1.3;            // sprint
    const myT = dToMeet / Math.max(1, myMaxSpeed);
    const canBeatBall = myT <= tToAim + 0.15;

    d._covOverride = { x: meet.x, z: meet.z, urgency: canBeatBall ? 1.4 : 1.2 };

    // Interception roll: if defender is inside catch radius AND we're
    // close in time, take a swing at the ball. Probability is gated by
    // catching rating (or coverage rating for non-DBs).
    if (FB.ballState.inAir && !FB.ballState.intercepted) {
      const horiz = Math.hypot(ball.x - d.mesh.position.x, ball.z - d.mesh.position.z);
      const dy = Math.abs(ball.y - (d.mesh.position.y + 2.1));
      if (horiz < COV.interceptRadius && dy < 1.8) {
        const catchRating = (d.attr && d.attr.catching) || 60;
        const awareness = (d.attr && d.attr.awareness) || 60;
        const intP = FB.AttributeSystem.getAIParameter(catchRating, 'catch_clean_pct') * 0.55
                   + FB.AttributeSystem.getAIParameter(awareness, 'awareness_react') * 0.0; // shape
        if (Math.random() < intP * 0.4) {
          // Trigger the existing interception path in logic-movement.
          if (FB.checkInterception) {
            // Bias the random check by forcing the defender to be the
            // candidate this frame: set position briefly to overlap.
            FB.checkInterception();
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  //  Hooks: re-resolve assignments after the play has been finalized.
  // -------------------------------------------------------------------------
  if (FB.snapBall && !FB.snapBall.__covHook) {
    const orig = FB.snapBall;
    const wrapped = function () {
      const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
      try { resolveAssignments(defTeam); } catch (_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__covHook = true;
    FB.snapBall = wrapped;
  }

  // Per-frame entry. Must run BEFORE FB.updateDefense — wire it in logic-loop
  // by overriding FB.updateDefense to call us first.
  if (FB.updateDefense && !FB.updateDefense.__covWrap) {
    const orig = FB.updateDefense;
    const wrapped = function (dt) {
      update(dt);
      // Apply overrides as the steering target by temporarily redirecting
      // each defender's assignment target. We do this by stuffing the
      // override into ent.target — updateDefense's pursuit lines already
      // call steerToward(ent, target,...) for non-user defenders.
      return orig.apply(this, arguments);
    };
    wrapped.__covWrap = true;
    FB.updateDefense = wrapped;
  }

  // Patch FB.steerToward so it consults _covOverride when present. This is
  // how the override actually changes destinations without rewriting the
  // big switch in updateDefense.
  if (FB.steerToward && !FB.steerToward.__covWrap) {
    const orig = FB.steerToward;
    const wrapped = function (ent, target, dt, speedFrac) {
      if (ent && ent._covOverride) {
        const o = ent._covOverride;
        // Replace the target with the override; bump the speed fraction
        // by the urgency factor (clamped).
        const t = TMP.set(o.x, 0, o.z);
        const u = Math.max(0.4, Math.min(1.5, (speedFrac || 0.9) * o.urgency));
        return orig.call(this, ent, t, dt, u);
      }
      return orig.apply(this, arguments);
    };
    wrapped.__covWrap = true;
    FB.steerToward = wrapped;
  }

  // -------------------------------------------------------------------------
  //  QB CONTAIN / FREE RUSHER — extracted helper, runs every frame.
  // -------------------------------------------------------------------------
  function updateQBContain(dt) {
    if (FB.state.phase !== 'play') return;
    if (FB.state.playType !== 'pass') return;
    const carrier = FB.ballCarrier;
    if (!carrier || carrier.role !== 'QB') return;
    const offTeam = carrier.team;
    const defTeam = offTeam === 'home' ? 'away' : 'home';
    const dir = FB.forwardDir(offTeam);
    const losX = FB.losLine ? FB.losLine.position.x : 0;
    const depth = (carrier.mesh.position.x - losX) * dir;
    if (depth < SC.QB_CONTAIN.scrambleDepthYards) return;

    // Lead point: where the QB will be in pursuitLeadSec.
    const lead = SC.QB_CONTAIN.pursuitLeadSec;
    const aimX = carrier.mesh.position.x + carrier.vel.x * lead;
    const aimZ = carrier.mesh.position.z + carrier.vel.z * lead;

    let nearestLB = null, bestD = Infinity;
    for (const d of FB.activePlayers[defTeam] || []) {
      if (!d.mesh.visible || d.isDown) continue;
      if (!['MLB', 'WLB', 'SLB'].includes(d.role)) continue;
      const dd = d.mesh.position.distanceTo(carrier.mesh.position);
      if (dd < bestD) { bestD = dd; nearestLB = d; }
    }

    for (const d of FB.activePlayers[defTeam] || []) {
      if (!d.mesh.visible || d.isDown) continue;
      const isLB = ['MLB', 'WLB', 'SLB'].includes(d.role);
      const isDL = ['LE', 'RE', 'DT', 'NT'].includes(d.role);
      // 1) Nearest LB within the contain radius angles to cut off the QB.
      if (isLB && d === nearestLB && bestD < SC.QB_CONTAIN.containRadius) {
        const cutoff = SC.QB_CONTAIN.cutoffYards;
        d._covOverride = {
          x: aimX - dir * cutoff,
          z: aimZ + Math.sign(carrier.mesh.position.z - d.mesh.position.z) * cutoff * 0.4,
          urgency: 1.35,
        };
      } else if (isLB) {
        // 2) Other LBs sprint to the QB's predicted spot — pure pursuit.
        d._covOverride = { x: aimX, z: aimZ, urgency: 1.2 };
      } else if (isDL && (d.blockedTime || 0) < 0.1) {
        // 3) Any DL that has SHED its block becomes a FREE_RUSHER —
        // straight line to the QB at top speed.
        d._covOverride = { x: carrier.mesh.position.x, z: carrier.mesh.position.z, urgency: 1.5 };
      }
    }
  }

  // Wire QB contain into the defense update too (after coverage).
  if (FB.updateDefense && !FB.updateDefense.__qbContainWrap) {
    const orig2 = FB.updateDefense;
    const wrapped2 = function (dt) {
      const r = orig2.apply(this, arguments);
      try { updateQBContain(dt); } catch (_) {}
      return r;
    };
    wrapped2.__qbContainWrap = true;
    FB.updateDefense = wrapped2;
  }

  // -------------------------------------------------------------------------
  //  Public API
  // -------------------------------------------------------------------------
  FB.CoverageAI = {
    resolveAssignments,
    update,
    updateQBContain,
  };

})(window.FB);

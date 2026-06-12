// blocking-resolution.js — SYSTEM 4 piece: OL vs DL matchup resolution.
//
// The existing logic-movement.js has rough engagement code (OL pushes back
// on the closest DL, DL has a "blockedTime" budget). This module replaces
// the time-based shed with a true per-matchup roll using each pairing's
// passBlocking / runBlocking / strength on the OL side vs blockShedding /
// powerMove / strength on the DL side. Rolls fire every 0.4 s (configurable
// in systems-config.js) so frame outcomes feel like real engagements.
//
// Outputs are written back to the existing ent.blockedTime and ent.vel
// fields so the existing movement loop continues to drive physics — this
// module only changes *how long* a defender is engaged and *how big* the
// shed burst is.
(function (FB) {
  'use strict';

  const SC = window.SYSTEMS_CONFIG;
  const B = SC.BLOCKING;

  /**
   * Resolve a single blocker vs defender matchup. Each frame, the pair's
   * "engagementId" key on the defender is checked — if the last roll was
   * >= rerollEverySec ago, we run a new roll. Outcome:
   *   blockWins (true): defender stays engaged, velocity heavily damped.
   *   blockWins (false): defender executes a shed (small burst forward).
   *
   * @param {object} blocker  - OL entity (with .attr.passBlocking / strength).
   * @param {object} defender - DL/LB entity (with .attr.blockShedding / strength).
   * @param {string} playType - 'run' or 'pass' (changes which OL stat is used).
   * @param {number} nowSec   - performance.now() / 1000.
   * @returns {boolean} true if the blocker won the roll.
   */
  function resolveMatchup(blocker, defender, playType, nowSec) {
    const bAttr = blocker.attr || {};
    const dAttr = defender.attr || {};
    const bRating = playType === 'run'
      ? (bAttr.runBlocking || bAttr.passBlocking || 60)
      : (bAttr.passBlocking || 60);
    const dShed = dAttr.blockShedding || 60;
    const bStr = bAttr.strength || 60;
    const dStr = dAttr.strength || 60;

    // Combined matchup score: 60% role rating, 40% strength.
    const bScore = bRating * 0.6 + bStr * 0.4;
    const dScore = dShed * 0.6 + dStr * 0.4;

    // Probabilistic outcome with bounded noise so a 99 vs 50 isn't impossible.
    const margin = (bScore - dScore) / 99;
    const blockChance = 0.5 + margin * 0.5 + (Math.random() - 0.5) * B.rollNoise;
    const blockWins = blockChance >= 0.5;
    defender._blockMatch = {
      lastRollT: nowSec,
      blocker,
      blockWins,
      // How long this verdict holds before the next roll.
      ttl: B.rerollEverySec,
    };
    return blockWins;
  }

  /**
   * Per-frame entry. Walks every engaged DL/LB and either renews its block
   * status from the most recent verdict or rolls a new matchup.
   * Hooks into the existing updateDefense -> "if engaged with blocker"
   * code path by writing the answer to ent.blockedTime so logic-movement
   * continues to behave correctly.
   * @param {number} dt - frame delta seconds.
   */
  function update(dt) {
    if (FB.state.phase !== 'play') return;
    const offTeam = FB.state.possession;
    const defTeam = offTeam === 'home' ? 'away' : 'home';
    const playType = FB.state.playType || 'pass';
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const losX = FB.losLine ? FB.losLine.position.x : 0;
    const dir = FB.forwardDir(offTeam);

    // Only rushers / DL get the engagement treatment. LBs in coverage are
    // handled by the coverage system, not by blocking matchups.
    for (const def of FB.activePlayers[defTeam] || []) {
      if (!def.mesh.visible || def.isDown) continue;
      const role = def.role;
      const isRusher = ['LE', 'RE', 'DT', 'NT'].includes(role)
        || (def.assignment && (def.assignment.type === 'rush' || def.assignment.type === 'blitz'));
      if (!isRusher) continue;

      // Find the nearest unmatched offensive blocker within 2 yards.
      const block = nearestBlocker(def, offTeam);
      if (!block.blocker || block.dist > 2.2) {
        // Disengaged. Clear engagement state and let the existing pursuit
        // pipeline take over (untouched).
        def.blockedTime = Math.max(0, (def.blockedTime || 0) - dt * 2);
        def._blockMatch = null;
        continue;
      }

      // Past the LOS = swimmed through; engagement ended.
      const pastLOS = (def.mesh.position.x - losX) * dir > 0.6;
      if (pastLOS) {
        def._blockMatch = null;
        continue;
      }

      // Roll or re-use the existing verdict.
      const cur = def._blockMatch;
      const stale = !cur || (nowSec - cur.lastRollT) >= cur.ttl || cur.blocker !== block.blocker;
      const blockWins = stale
        ? resolveMatchup(block.blocker, def, playType, nowSec)
        : cur.blockWins;

      if (blockWins) {
        // Engaged: damp velocity and push back lightly. This mirrors the
        // existing behavior in logic-movement (engagedDamp ≈ 0.18).
        def.vel.multiplyScalar(B.engagedDamp);
        def.mesh.position.x -= dir * dt * 0.6;
        def.blockedTime = (def.blockedTime || 0) + dt;
      } else {
        // Shed: small celebratory burst toward the QB to break the engagement.
        def.vel.x += dir * dt * def.accel * B.shedBurst * 0.6;
        def.blockedTime = 0;
      }
    }
  }

  // Find the closest OL teammate to this defender.
  function nearestBlocker(def, offTeam) {
    const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
    let best = null, bd = Infinity;
    for (const o of (FB.activePlayers[offTeam] || [])) {
      if (!o.mesh || !o.mesh.visible || o.isDown) continue;
      if (!OL.includes(o.role)) continue;
      const d = o.mesh.position.distanceTo(def.mesh.position);
      if (d < bd) { bd = d; best = o; }
    }
    return { blocker: best, dist: bd };
  }

  // Hook into FB.updateDefense — run our resolver BEFORE the existing
  // pursuit logic so it can see the freshly-computed blockedTime.
  if (FB.updateDefense && !FB.updateDefense.__blockWrap) {
    const orig = FB.updateDefense;
    const wrapped = function (dt) {
      try { update(dt); } catch (_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__blockWrap = true;
    FB.updateDefense = wrapped;
  }

  FB.BlockingResolution = { resolveMatchup, update };

})(window.FB);

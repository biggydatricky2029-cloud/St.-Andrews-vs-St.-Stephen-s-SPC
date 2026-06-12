// attribute-system.js — SYSTEM 4: Overall → attribute → AI parameter.
//
// Three layered conversions:
//   1. getAttributeValue(overall, positionGroup, attr) — linearly interpolates
//      between the 50/70/85/99 breakpoints in systems-config.js.
//   2. getAIParameter(attrValue, paramType) — converts a raw attribute
//      (1..99) into a physics/AI parameter (m/s, seconds, success %, ...).
//   3. FB.attachAttributes(ent) — caches the resolved attribute bundle on a
//      player entity so per-frame code can read pre-computed numbers
//      instead of running the interpolation 22+ times per frame.
//
// This module also patches the engine's speed/accel lookup so existing
// movement code automatically uses the per-attribute values without any
// downstream changes: every call to `ent.baseSpeed` and `ent.accel` now
// reads the rating-derived value from this system.
(function (FB) {
  'use strict';

  const SC = window.SYSTEMS_CONFIG;
  const ATTR = SC.ATTRIBUTE_BREAKPOINTS;
  const POS_OF = SC.POSITION_GROUP_OF_SLOT;
  const KNOTS = [50, 70, 85, 99];

  /**
   * Linearly interpolates a single attribute from the breakpoint table for
   * a position group. Clamps below 50 to the 50-overall row, above 99 to
   * the 99 row.
   * @param {number} overall - Player overall rating (1..99).
   * @param {string} positionGroup - 'QB' | 'WR' | 'RB' | 'OL' | 'DL' | 'LB' | 'CB' | 'S'.
   * @param {string} attribute - Attribute name (e.g. 'speed', 'throwAccuracy').
   * @returns {number} Interpolated attribute value (rounded to 1 decimal).
   */
  function getAttributeValue(overall, positionGroup, attribute) {
    const table = ATTR[positionGroup];
    if (!table) return overall; // unknown position — fall back to overall as-is
    const o = Math.max(1, Math.min(99, overall || 60));
    // Find bracketing breakpoint pair.
    let lo = KNOTS[0], hi = KNOTS[KNOTS.length - 1];
    for (let i = 0; i < KNOTS.length - 1; i++) {
      if (o >= KNOTS[i] && o <= KNOTS[i + 1]) { lo = KNOTS[i]; hi = KNOTS[i + 1]; break; }
    }
    if (o <= KNOTS[0]) { lo = hi = KNOTS[0]; }
    if (o >= KNOTS[KNOTS.length - 1]) { lo = hi = KNOTS[KNOTS.length - 1]; }
    const loRow = table[lo], hiRow = table[hi];
    const a = (loRow && loRow[attribute] != null) ? loRow[attribute] : o;
    const b = (hiRow && hiRow[attribute] != null) ? hiRow[attribute] : o;
    const t = (hi === lo) ? 0 : (o - lo) / (hi - lo);
    return Math.round((a + (b - a) * t) * 10) / 10;
  }

  /**
   * Convert a raw 1..99 attribute value into a physics or probability
   * parameter the engine actually consumes (units/sec, seconds, [0,1]).
   * @param {number} v - Attribute value (1..99).
   * @param {string} paramType - One of:
   *   'speed_mps'        — top speed in scene units/sec
   *   'accel_t'          — seconds to reach full speed
   *   'agility_t'        — seconds to change direction (turn budget)
   *   'route_break_yds'  — route waypoint hit tolerance in yards
   *   'catch_clean_pct'  — catch probability on a well-thrown ball
   *   'catch_poor_pct'   — catch probability on a poorly-thrown ball
   *   'reaction_sec'     — DB reaction delay for cuts
   *   'jam_speed_mul'    — receiver speed multiplier under a successful jam
   *   'pass_acc_jitter'  — throw aim jitter (yards) at the target point
   *   'block_shed_pct'   — frame block-shed probability (already per-roll)
   *   'tackle_strength'  — combined tackle strength score (raw, used in rolls)
   *   'stamina_drain'    — per-play stamina drain (%) for this attr value
   *   'awareness_react'  — generic awareness-driven reaction time (sec)
   * @returns {number}
   */
  function getAIParameter(v, paramType) {
    const x = Math.max(1, Math.min(99, v || 60));
    const lerp = (a, b, t) => a + (b - a) * t;
    const norm99 = (x - 50) / 49;             // 0 at 50, 1 at 99
    switch (paramType) {
      case 'speed_mps':
        // Spec: 50→7.2, 70→8.8, 85→10.2, 99→11.5.
        if (x >= 85) return lerp(10.2, 11.5, (x - 85) / 14);
        if (x >= 70) return lerp(8.8, 10.2, (x - 70) / 15);
        if (x >= 50) return lerp(7.2, 8.8, (x - 50) / 20);
        return lerp(6.0, 7.2, Math.max(0, (x - 30) / 20));
      case 'accel_t':
        // Spec: 50→1.1s, 70→0.75s, 99→0.35s. Monotone decreasing.
        if (x >= 70) return lerp(0.75, 0.35, (x - 70) / 29);
        if (x >= 50) return lerp(1.10, 0.75, (x - 50) / 20);
        return lerp(1.40, 1.10, Math.max(0, (x - 30) / 20));
      case 'agility_t':
        // Spec: 50→0.6s, 70→0.35s, 99→0.1s. Direction-change budget.
        if (x >= 70) return lerp(0.35, 0.10, (x - 70) / 29);
        return lerp(0.60, 0.35, Math.max(0, (x - 50) / 20));
      case 'route_break_yds':
        // Spec: 50→2.5yd, 70→1.2yd, 99→0.1yd.
        if (x >= 70) return lerp(1.20, 0.10, (x - 70) / 29);
        return lerp(2.50, 1.20, Math.max(0, (x - 50) / 20));
      case 'catch_clean_pct':
        // Spec: 50→0.55, 70→0.78, 99→0.97.
        if (x >= 70) return lerp(0.78, 0.97, (x - 70) / 29);
        return lerp(0.55, 0.78, Math.max(0, (x - 50) / 20));
      case 'catch_poor_pct':
        if (x >= 70) return lerp(0.45, 0.75, (x - 70) / 29);
        return lerp(0.20, 0.45, Math.max(0, (x - 50) / 20));
      case 'reaction_sec':
        // Coverage reaction. 50→0.70, 99→0.15.
        return lerp(SC.COVERAGE.reactionSec.lo, SC.COVERAGE.reactionSec.hi, norm99);
      case 'jam_speed_mul':
        // Press jam effectiveness. 50→0.95, 99→0.75 (more slow-down).
        return lerp(SC.COVERAGE.jamSpeedMul.lo, SC.COVERAGE.jamSpeedMul.hi, norm99);
      case 'pass_acc_jitter':
        // Throw accuracy jitter in yards. 50→3.0yd, 99→0.25yd.
        return lerp(3.0, 0.25, norm99);
      case 'block_shed_pct':
        // Per-roll shed probability for the defender's blockShedding rating.
        // 50→0.18, 99→0.62. Compared against the OL win roll separately.
        return lerp(0.18, 0.62, norm99);
      case 'tackle_strength':
        return x; // raw — used in tackle vs break-tackle rolls
      case 'stamina_drain':
        // Per-play drain. 50→2.5%, 99→0.5%.
        return lerp(SC.STAMINA.drainPerPlay.lo, SC.STAMINA.drainPerPlay.hi, norm99);
      case 'awareness_react':
        // Generic awareness reaction window.
        return lerp(0.55, 0.12, norm99);
      default:
        return x;
    }
  }

  /**
   * Resolve every relevant attribute for a player entity and cache the
   * bundle on the entity. Re-runs `baseSpeed` / `accel` from the new
   * rating-driven values so all existing movement code picks them up.
   * @param {object} ent - Player entity (has .role, .player, .rating).
   */
  function attachAttributes(ent) {
    if (!ent || !ent.player) return;
    const role = ent.role || (ent.player && ent.player.position) || '';
    const group = POS_OF[role] || 'WR';
    const overall = ent.rating || ent.player.overall || 60;
    const table = ATTR[group];
    if (!table) { ent.attr = { overall, group }; return; }
    // Collect every attribute name appearing on any breakpoint row.
    const names = new Set();
    for (const k of Object.keys(table)) for (const a of Object.keys(table[k])) names.add(a);
    const bundle = { overall, group };
    for (const a of names) bundle[a] = getAttributeValue(overall, group, a);
    ent.attr = bundle;

    // Wire to engine-visible movement numbers. Existing code already reads
    // ent.baseSpeed / ent.accel each frame, so this single replacement
    // makes ratings flow through the movement loop with no other edits.
    if (bundle.speed != null) ent.baseSpeed = getAIParameter(bundle.speed, 'speed_mps');
    if (bundle.acceleration != null) {
      const t = getAIParameter(bundle.acceleration, 'accel_t');
      // accel = baseSpeed / time-to-full-speed.
      ent.accel = Math.max(2.0, ent.baseSpeed / Math.max(0.05, t));
    }
    // Initial stamina (full).
    ent.stamina = 100;
    // Per-play drain pre-resolved so the snap handler doesn't recompute.
    ent.staminaDrainPerPlay = bundle.stamina != null
      ? getAIParameter(bundle.stamina, 'stamina_drain')
      : SC.STAMINA.drainPerPlay.lo + (SC.STAMINA.drainPerPlay.hi - SC.STAMINA.drainPerPlay.lo) * 0.5;
  }

  /**
   * Re-resolve attributes for every player on both teams. Called after
   * buildTeamMeshes and after sub-ins so attribute bundles stay fresh.
   */
  function refreshAllPlayerAttributes() {
    for (const team of ['home', 'away']) {
      for (const ent of (FB.activePlayers[team] || [])) attachAttributes(ent);
    }
  }

  // Hook: whenever spawnOffense/spawnDefense places players (which sets
  // ent.role), re-attach attributes so they reflect the role just assigned.
  if (FB.placePlayer && !FB.placePlayer.__attrWrap) {
    const orig = FB.placePlayer;
    const wrapped = function (ent, x, z, role) {
      const result = orig.apply(this, arguments);
      attachAttributes(ent);
      return result;
    };
    wrapped.__attrWrap = true;
    FB.placePlayer = wrapped;
  }

  // Public API.
  FB.AttributeSystem = {
    getAttributeValue,
    getAIParameter,
    attachAttributes,
    refreshAllPlayerAttributes,
    getPositionGroup: (role) => POS_OF[role] || 'WR',
  };

})(window.FB);

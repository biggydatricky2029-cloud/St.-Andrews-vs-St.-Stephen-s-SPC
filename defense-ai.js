// defense-ai.js — defensive schemes + per-player assignment engine.
//
// Every defensive call gives each of the 11 defenders a job:
//   rush   — pass rush in a fixed lane (ends keep contain, tackles push the pocket)
//   blitz  — fire through an assigned gap, then hunt the QB
//   man    — cover one receiver (#1/#2 on a side, slot, TE or RB) with
//            inside / outside / trail leverage; optional press jam;
//            greenDog / blitzIfBlock: if the man stays in to block, blitz
//   zone   — drop to a landmark (deep third/half/quarter, deep middle, Tampa
//            seam, hook, hook-curl, curl-flat, flat, robber) and pattern-read
//            the receivers who enter it
//   match  — Cover 4 corner/safety and Palms corner/safety reads of #1/#2
// Run plays, scrambles, thrown balls and catches switch everyone to pursuit
// or to playing the ball. Pass protection is also assigned here: each
// blocker takes one rusher, so extra blitzers come through unblocked.
//
// Field frame used below: depth = yards past the line of scrimmage toward the
// defense's end zone; z = world lateral (negative = the offense's left side
// as drawn in the play diagrams, "L"; positive = "R").
(function (FB) {
  'use strict';

  const V = () => new THREE.Vector3();
  const TMP = new THREE.Vector3();
  const HALF_W = 26.65 - 1.5;
  const clampZ = (z) => Math.max(-HALF_W, Math.min(HALF_W, z));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const DL = ['LE', 'DT', 'NT', 'RE'];
  const LB = ['MLB', 'WLB', 'SLB'];
  const ELIG = ['WR1', 'WR2', 'WR3', 'TE'];
  const sgn = (side) => (side === 'L' ? -1 : 1);
  const other = (side) => (side === 'L' ? 'R' : 'L');
  const cbOf = (side) => (side === 'L' ? 'LCB' : 'RCB');

  // ---------------------------------------------------------------------------
  //  Scheme library. build(ctx) returns { ROLE: assignment }. ctx.S / ctx.W
  //  are the strong / weak sides ('L'|'R'), ctx.N is the slot (nickel) side.
  // ---------------------------------------------------------------------------
  const rush = (lane, extra) => Object.assign({ type: 'rush', lane }, extra || {});
  const blitz = (gap, extra) => Object.assign({ type: 'blitz', gap }, extra || {});
  const man = (who, tech, extra) => Object.assign({ type: 'man', who, tech: tech || 'inside' }, extra || {});
  const zone = (z, side, extra) => Object.assign({ type: 'zone', zone: z, side: side || 'M' }, extra || {});
  const match = (kind, side) => ({ type: 'match', kind, side });
  const fourRush = (heavy) => ({
    LE: rush(-4.5, { contain: true, heavy }), DT: rush(-1.5, { heavy }),
    NT: rush(1.5, { heavy }), RE: rush(4.5, { contain: true, heavy }),
  });

  const SCHEMES = [
    { id: 'cover0', name: 'Cover 0 (Pure Man / Blitz)', formation: '4-3', tags: ['pressure', 'man', 'run'],
      notes: 'All-out pressure. Corners lock up the outside receivers with inside technique and no help over the top. Mike carries the RB and green-dogs if he blocks; Will and Sam blitz; safeties take the TE and slot and blitz if their man stays in.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: man('RB', 'inside', { greenDog: true }),
        WLB: blitz(sgn(c.W) * 3),
        SLB: blitz(sgn(c.S) * 5),
        LCB: man('#1L', 'inside', { tight: true }), RCB: man('#1R', 'inside', { tight: true }),
        SS: man('TE', 'inside', { blitzIfBlock: true }),
        FS: man('slot', 'inside', { blitzIfBlock: true }),
      }) },
    { id: 'cover1', name: 'Cover 1 (Man Free)', formation: '4-3', tags: ['man'],
      notes: 'Man under with one deep safety. Corners use outside leverage to funnel receivers to the free safety in the deep middle. Will is the robber ("rat in the hole") reading the QB.',
      build: () => Object.assign(fourRush(false), {
        MLB: man('RB', 'inside'),
        WLB: zone('robber'),
        SLB: man('slot', 'inside'),
        LCB: man('#1L', 'outside'), RCB: man('#1R', 'outside'),
        SS: man('TE', 'inside'),
        FS: zone('deepMiddle'),
      }) },
    { id: 'cover1_mike_blitz', name: 'Cover 1 Mike Blitz', formation: '4-3', tags: ['pressure', 'man', 'run'],
      notes: 'Cover 1 with the Mike firing the A-gap. Will takes the RB and adds to the blitz if the back stays in.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: blitz(sgn(c.S) * 1),
        WLB: man('RB', 'inside', { greenDog: true }),
        SLB: man('slot', 'inside'),
        LCB: man('#1L', 'outside'), RCB: man('#1R', 'outside'),
        SS: man('TE', 'inside'),
        FS: zone('deepMiddle'),
      }) },
    { id: 'cover2', name: 'Cover 2 (Zone)', formation: '4-3', tags: ['pass'],
      notes: 'Corners jam and sit in the flats, safeties split deep halves, three linebackers wall off the hook and curl windows.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: zone('hook', 'M'),
        WLB: zone('hookCurl', c.W), SLB: zone('hookCurl', c.S),
        LCB: zone('flat', 'L', { press: true }), RCB: zone('flat', 'R', { press: true }),
        FS: zone('deepHalf', c.W), SS: zone('deepHalf', c.S),
      }) },
    { id: 'cover3', name: 'Cover 3 (Deep Thirds)', formation: '4-3', tags: ['pass', 'run'],
      notes: 'Corners bail to the deep outside thirds, the free safety takes the deep middle third. Inside backers drop to hook-curl, Sam and the strong safety carry seams then cover the curl-flat.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: zone('hook', c.S), WLB: zone('hook', c.W),
        SLB: zone('curlFlat', c.S), SS: zone('curlFlat', c.W),
        LCB: zone('deepThird', 'L'), RCB: zone('deepThird', 'R'),
        FS: zone('deepThird', 'M'),
      }) },
    { id: 'cover4', name: 'Cover 4 (Quarters)', formation: '4-3', tags: ['pass'],
      notes: 'Four deep quarters. Corners carry #1 man-to-man if he goes vertical past 10 yards; safeties read #2 — match him deep, or help the corner / fill the run if he breaks short. Apex backers take curl-flat, Mike the hook.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: zone('hook', 'M'),
        WLB: zone('curlFlat', c.W), SLB: zone('curlFlat', c.S),
        LCB: match('qCorner', 'L'), RCB: match('qCorner', 'R'),
        FS: match('qSafety', c.W), SS: match('qSafety', c.S),
      }) },
    { id: 'cover2_man', name: 'Cover 5 (2-Man)', formation: '4-3', tags: ['man', 'pass'],
      notes: 'Man underneath with two deep halves. Corners trail from underneath and inside, forcing routes deep into the safety help. Mike takes the RB, Will the TE, Sam the slot.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: man('RB', 'inside'),
        WLB: man('TE', 'inside', { spyIfNone: true }),
        SLB: man('slot', 'inside'),
        LCB: man('#1L', 'trail', { press: true }), RCB: man('#1R', 'trail', { press: true }),
        FS: zone('deepHalf', c.W), SS: zone('deepHalf', c.S),
      }) },
    { id: 'tampa2', name: 'Tampa 2', formation: '4-3', tags: ['pass'],
      notes: 'Heavy four-man pressure. The Mike opens and runs the deep middle seam as a third deep defender; Will and Sam squeeze the hook-curl windows; corners jam and sit in the flats; safeties split wide halves.',
      build: (c) => Object.assign(fourRush(true), {
        MLB: zone('deepSeam', 'M'),
        WLB: zone('hookCurl', c.W), SLB: zone('hookCurl', c.S),
        LCB: zone('flat', 'L', { press: true }), RCB: zone('flat', 'R', { press: true }),
        FS: zone('deepHalf', c.W, { wide: true }), SS: zone('deepHalf', c.S, { wide: true }),
      }) },
    { id: 'cover6', name: 'Cover 6 (Quarter-Quarter-Half)', formation: '4-3', tags: ['pass'],
      notes: 'Quarters to the strength of the formation, Cover 2 to the other side. Quarters side: corner deep outside quarter, safety deep inside quarter, backer curl-flat. Cover 2 side: corner jams and sits in the flat, safety takes the deep half, backer hook-curl. Mike holds the middle hook.',
      build: (c) => {
        const Q = c.S, H = c.W;
        const a = Object.assign(fourRush(false), {
          MLB: zone('hook', 'M'),
          SLB: zone('curlFlat', Q),
          WLB: zone('hookCurl', H),
        });
        a[cbOf(Q)] = zone('deepQuarterO', Q);
        a[cbOf(H)] = zone('flat', H, { press: true });
        a.SS = zone('deepQuarterI', Q);
        a.FS = zone('deepHalf', H);
        return a;
      } },
    { id: 'palms', name: 'Palms / Robber (Trap)', formation: '4-3', tags: ['pass'],
      notes: 'Two-high match zone. Corners and safeties read #2: if #2 breaks to the flat the corner traps it and the safety goes over the top of #1; if #2 goes vertical the safety locks on #2 and the corner plays #1 man. Backers take the inside hooks and match a flaring RB; Sam is the rat in the middle.',
      build: (c) => Object.assign(fourRush(false), {
        MLB: zone('hook', c.S, { rbMatch: true }), WLB: zone('hook', c.W, { rbMatch: true }),
        SLB: zone('robber'),
        LCB: match('palmsCorner', 'L'), RCB: match('palmsCorner', 'R'),
        FS: match('palmsSafety', c.W), SS: match('palmsSafety', c.S),
      }) },
    { id: 'zone_blitz', name: 'Zone Blitz (Fire Zone)', formation: '4-3', tags: ['pressure', 'pass', 'run'],
      notes: 'Disguised pressure: three linemen rush, the right end drops into the curl-flat, Will and Sam blitz their gaps. Behind it: 3-deep (corners + free safety) and 3-under (end, Mike, strong safety).',
      build: (c) => ({
        LE: rush(-4.5, { contain: true }), DT: rush(-1.5), NT: rush(1.5),
        RE: zone('curlFlat', 'R', { dropper: true }),
        WLB: blitz(sgn(c.W) * 3), SLB: blitz(sgn(c.S) * 5),
        MLB: zone('hook', 'M'),
        SS: zone('curlFlat', 'L'),
        LCB: zone('deepThird', 'L'), RCB: zone('deepThird', 'R'),
        FS: zone('deepThird', 'M'),
      }) },
    { id: 'nickel425_cover1', name: '4-2-5 Nickel — Cover 1', formation: 'nickel', tags: ['man', 'pass'],
      notes: 'Nickel personnel: tackles clog the A gaps, ends set the edge. Star/nickel (Sam) mans the slot, strong safety in the box takes the TE, Mike the RB, Will robs the middle, free safety deep.',
      build: () => ({
        LE: rush(-5, { contain: true }), DT: rush(-1), NT: rush(1), RE: rush(5, { contain: true }),
        MLB: man('RB', 'inside'), WLB: zone('robber'),
        SLB: man('slot', 'inside', { nickel: true }),
        LCB: man('#1L', 'outside'), RCB: man('#1R', 'outside'),
        SS: man('TE', 'inside'), FS: zone('deepMiddle'),
      }) },
    { id: 'nickel425_cover3', name: '4-2-5 Nickel — Cover 3', formation: 'nickel', tags: ['pass', 'run'],
      notes: 'Nickel personnel in thirds: corners and free safety deep, star/nickel takes the curl-flat on the slot side, strong safety the curl-flat on the TE side, Mike and Will in the hooks.',
      build: (c) => ({
        LE: rush(-5, { contain: true }), DT: rush(-1), NT: rush(1), RE: rush(5, { contain: true }),
        MLB: zone('hook', other(c.N)), WLB: zone('hook', c.N),
        SLB: zone('curlFlat', c.N, { nickel: true }), SS: zone('curlFlat', other(c.N)),
        LCB: zone('deepThird', 'L'), RCB: zone('deepThird', 'R'), FS: zone('deepThird', 'M'),
      }) },
    { id: 'nickel425_cover4', name: '4-2-5 Nickel — Cover 4', formation: 'nickel', tags: ['pass'],
      notes: 'Nickel personnel in quarters: corners and safeties play the Cover 4 reads, star/nickel takes the slot-side curl-flat, Will the other curl-flat, Mike the hook.',
      build: (c) => ({
        LE: rush(-5, { contain: true }), DT: rush(-1), NT: rush(1), RE: rush(5, { contain: true }),
        MLB: zone('hook', 'M'),
        SLB: zone('curlFlat', c.N, { nickel: true }), WLB: zone('curlFlat', other(c.N)),
        LCB: match('qCorner', 'L'), RCB: match('qCorner', 'R'),
        FS: match('qSafety', c.W), SS: match('qSafety', c.S),
      }) },
  ];

  // ---------------------------------------------------------------------------
  //  Formation reading
  // ---------------------------------------------------------------------------
  function readOffense(offTeam) {
    const off = FB.offenseOf(offTeam).filter((e) => e.mesh.visible);
    const qb = off.find((e) => e.role === 'QB');
    const ballZ = qb ? qb.mesh.position.z : 0;
    const elig = off.filter((e) => ELIG.includes(e.role));
    const L = elig.filter((e) => e.mesh.position.z < ballZ).sort((a, b) => a.mesh.position.z - b.mesh.position.z);
    const R = elig.filter((e) => e.mesh.position.z >= ballZ).sort((a, b) => b.mesh.position.z - a.mesh.position.z);
    const te = off.find((e) => e.role === 'TE') || null;
    const teSide = te ? (te.mesh.position.z < ballZ ? 'L' : 'R') : null;
    let S = L.length > R.length ? 'L' : R.length > L.length ? 'R' : (teSide || 'R');
    const W = other(S);
    // Slot = an inside (#2/#3) receiver who is not the TE; nickel aligns there.
    const inside = [...L.slice(1), ...R.slice(1)].filter((e) => e.role !== 'TE');
    const slot = inside[0] || null;
    const N = slot ? (slot.mesh.position.z < ballZ ? 'L' : 'R') : W;
    return {
      ballZ, qb, S, W, N, te, slot,
      rb: off.find((e) => e.role === 'RB') || null,
      byKey: { '#1L': L[0] || null, '#2L': L[1] || null, '#3L': L[2] || null,
               '#1R': R[0] || null, '#2R': R[1] || null, '#3R': R[2] || null },
    };
  }

  function resolveWho(ctx, who) {
    if (who === 'RB') return ctx.rb;
    if (who === 'TE') return ctx.te || ctx.byKey['#2' + ctx.S] || null;
    if (who === 'slot') return ctx.slot || ctx.byKey['#2' + ctx.W] || null;
    return ctx.byKey[who] || null;
  }

  // Zone landmarks: depth, lateral center, half-width, deep?
  function landmark(a, ctx) {
    const s = a.side === 'M' ? 0 : sgn(a.side);
    const bz = ctx.ballZ;
    switch (a.zone) {
      case 'deepThird':    return s === 0 ? { d: 18, z: bz * 0.4, w: 9, deep: true } : { d: 17, z: s * 17.5, w: 9, deep: true };
      case 'deepHalf':     return { d: 18, z: s * (a.wide ? 14.5 : 12), w: 13.3, deep: true };
      case 'deepQuarterO': return { d: 16, z: s * 19, w: 6.7, deep: true };
      case 'deepQuarterI': return { d: 16, z: s * 7, w: 6.7, deep: true };
      case 'deepMiddle':   return { d: 17, z: bz * 0.4, w: 11, deep: true };
      case 'deepSeam':     return { d: 15, z: bz, w: 5.5, deep: true };
      case 'hook':         return { d: 10, z: bz + s * 5, w: 5 };
      case 'hookCurl':     return { d: 10, z: bz + s * 9, w: 6 };
      case 'curlFlat':     return { d: 8, z: s * 15, w: 7.5 };
      case 'flat':         return { d: 4.5, z: s * 19.5, w: 6 };
      case 'robber':       return { d: 9, z: bz, w: 7, robber: true };
      default:             return { d: 8, z: bz, w: 6 };
    }
  }

  // ---------------------------------------------------------------------------
  //  Pre-snap alignment (absolute world positions)
  // ---------------------------------------------------------------------------
  function alignmentFor(role, a, ctx, P) {
    const bz = ctx.ballZ;
    const inside = (r) => Math.sign(bz - r.mesh.position.z) || 1;
    if (a.type === 'rush') return P(1, bz + a.lane);
    if (a.type === 'blitz') {
      if (DL.includes(role)) return P(1, bz + a.gap);
      if (role === 'FS' || role === 'SS') return P(7, bz + a.gap * 1.6);
      return P(4, bz + a.gap * 1.3);
    }
    if (a.type === 'man') {
      const r = resolveWho(ctx, a.who);
      if (!r) return P(6, bz);
      const rz = r.mesh.position.z;
      if (a.who === 'RB') return P(5, rz + (bz - rz) * 0.3);
      const isCB = role === 'LCB' || role === 'RCB';
      const lev = a.tech === 'outside' ? -inside(r) : inside(r);
      const depth = a.press ? 1.5 : a.tight ? 2.5 : isCB ? 5 : (a.nickel ? 4 : 5);
      return P(depth, rz + lev * 1.0);
    }
    if (a.type === 'match') {
      const r1 = ctx.byKey['#1' + a.side], r2 = ctx.byKey['#2' + a.side];
      const s = sgn(a.side);
      if (a.kind === 'qCorner' || a.kind === 'palmsCorner') return P(7, r1 ? r1.mesh.position.z - s * 1 : s * 18);
      const z = r2 ? (r2.mesh.position.z + bz) / 2 : s * 8;
      return P(a.kind === 'qSafety' ? 10 : 9, z);
    }
    // zone
    const L = landmark(a, ctx);
    if (DL.includes(role)) return P(1, role === 'LE' ? bz - 4.5 : role === 'RE' ? bz + 4.5 : bz + (role === 'DT' ? -1.5 : 1.5));
    const s = a.side === 'M' ? 0 : sgn(a.side);
    switch (a.zone) {
      case 'flat': {
        const r1 = ctx.byKey['#1' + a.side];
        return P(a.press ? 1.5 : 5, r1 ? r1.mesh.position.z + s * 1 : L.z);
      }
      case 'deepThird':
        if (s !== 0) { const r1 = ctx.byKey['#1' + a.side]; return P(7, r1 ? r1.mesh.position.z - s * 1 : L.z); }
        return P(12, L.z);
      case 'deepQuarterO': { const r1 = ctx.byKey['#1' + a.side]; return P(7, r1 ? r1.mesh.position.z - s * 1 : L.z); }
      case 'deepHalf': return P(12, s * (a.wide ? 12 : 10));
      case 'deepQuarterI': return P(10, s * 8);
      case 'deepMiddle': return P(12, L.z);
      case 'deepSeam': return P(5, bz);
      case 'curlFlat': {
        // Apex: halfway between #2 and the end man on the line.
        const r2 = ctx.byKey['#2' + a.side] || ctx.byKey['#1' + a.side];
        const emol = bz + s * 5;
        return P(a.nickel ? 4 : 5, r2 ? (r2.mesh.position.z + emol) / 2 : bz + s * 9);
      }
      case 'hookCurl': return P(5, bz + s * 5);
      case 'hook': return P(5, bz + s * 3);
      case 'robber': return P(5, bz);
      default: return P(6, L.z);
    }
  }

  // ---------------------------------------------------------------------------
  //  Hooks into play setup: build assignments + align before the snap.
  // ---------------------------------------------------------------------------
  const origSpawnDefense = FB.spawnDefense;
  FB.spawnDefense = function (teamKey, losX) {
    const play = FB.selectedPlay && FB.selectedPlay.defense;
    if (!play || !play.build) return origSpawnDefense.apply(this, arguments);
    const offTeam = teamKey === 'home' ? 'away' : 'home';
    const ctx = readOffense(offTeam);
    const odir = FB.forwardDir(offTeam);
    const P = (depth, z) => ({ x: losX + depth * odir, z: clampZ(z) });
    // Fresh assignment objects every snap (logic-play copies them per role).
    play.assignments = play.build(ctx);
    for (const role of Object.keys(play.assignments)) play.assignments[role].scheme = true;
    for (const role of [...DL, ...LB, 'LCB', 'RCB', 'FS', 'SS']) {
      const ent = FB.getStarter(teamKey, role);
      if (!ent) continue;
      const a = play.assignments[role] || rush(0);
      const spot = alignmentFor(role, a, ctx, P);
      FB.placePlayer(ent, spot.x, spot.z, role);
    }
  };

  // At the snap, lock in receiver identities and reset per-defender state.
  let snapCtx = null;
  const origSnap = FB.snapBall;
  FB.snapBall = function () {
    const wasPresnap = FB.state.phase === 'presnap';
    const r = origSnap.apply(this, arguments);
    if (wasPresnap && FB.state.phase === 'play') {
      const offTeam = FB.state.possession;
      const defTeam = offTeam === 'home' ? 'away' : 'home';
      snapCtx = readOffense(offTeam);
      snapCtx.t0 = now();
      snapCtx.offTeam = offTeam;
      snapCtx.losX = FB.losLine ? FB.losLine.position.x : 0;
      snapCtx.dir = FB.forwardDir(offTeam);
      for (const e of FB.activePlayers[defTeam]) e._d = {};
      for (const e of FB.activePlayers[offTeam]) {
        e._smV = null;
        // Offensive players with no route (or a route that never leaves the
        // backfield) stay in to block.
        const rt = e.route;
        e._stayIn = ['RB', 'TE'].includes(e.role) && (!rt || !rt.length
          || rt.every((w) => (w.x - snapCtx.losX) * snapCtx.dir <= 0.5));
      }
    }
    return r;
  };

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }

  // ---------------------------------------------------------------------------
  //  Per-frame helpers
  // ---------------------------------------------------------------------------
  function depthOf(pos) { return (pos.x - snapCtx.losX) * snapCtx.dir; }
  function P(depth, z) { return TMP.set(snapCtx.losX + depth * snapCtx.dir, 0, clampZ(z)).clone(); }

  // Smoothed receiver velocity — the defender's "read" lags real cuts by a
  // rating-driven reaction time (better cover men react faster).
  function seenVel(d, r, dt) {
    const key = '_seen_' + r.role;
    const k = d._d[key] || (d._d[key] = r.vel.clone());
    const cov = (d.attr && (d.attr.manCoverage || d.attr.awareness)) || 60;
    const rate = 3 + (cov / 99) * 7; // 3..10 per second
    k.lerp(r.vel, Math.min(1, dt * rate));
    return k;
  }

  function manTarget(d, r, a, dt) {
    const v = seenVel(d, r, dt);
    const rp = r.mesh.position;
    const insideSign = Math.sign(snapCtx.ballZ - rp.z) || 1;
    let lat = 0, cushion = 1.0;
    if (a.tech === 'inside') lat = insideSign * 0.9;
    else if (a.tech === 'outside') lat = -insideSign * 0.9;
    else if (a.tech === 'trail') { lat = insideSign * 0.7; cushion = -0.9; }
    if (a.who === 'RB') cushion = 0.6;
    const depth = depthOf(rp) + cushion;
    const p = P(depth, rp.z + lat);
    p.x += v.x * 0.3; p.z += v.z * 0.3;
    const dist = d.mesh.position.distanceTo(rp);
    // Press jam: slows the receiver's release for the first half second.
    const t = now() - snapCtx.t0;
    if (a.press && t < 0.7 && dist < 1.6) r.vel.multiplyScalar(Math.max(0.4, 1 - dt * 3));
    return { p, speed: dist > 3 ? 1.1 : 1.0 };
  }

  function receiversOf() {
    return FB.offenseOf(snapCtx.offTeam).filter((e) => e.mesh.visible && !e.isDown
      && ['WR1', 'WR2', 'WR3', 'TE', 'RB'].includes(e.role) && !e._stayIn);
  }

  function deepZoneTarget(d, L) {
    const lo = L.z - L.w - 2, hi = L.z + L.w + 2;
    let threat = null, best = -Infinity;
    for (const r of receiversOf()) {
      const rz = r.mesh.position.z;
      if (rz < lo || rz > hi) continue;
      const dep = depthOf(r.mesh.position) + Math.max(0, r.vel.x * snapCtx.dir) * 0.5;
      if (dep < 6) continue;
      if (dep > best) { best = dep; threat = r; }
    }
    if (threat) {
      const rp = threat.mesh.position;
      // Stay deeper than the deepest man in my zone, shade toward him.
      const td = Math.max(L.d * 0.85, depthOf(rp) + 3.5);
      const tz = clamp(rp.z + threat.vel.z * 0.3, L.z - L.w, L.z + L.w);
      return { p: P(td, L.z + (tz - L.z) * 0.8), speed: 1.0 };
    }
    // No threat yet: get to the landmark and lean toward the QB's side.
    const qz = snapCtx.qb ? snapCtx.qb.mesh.position.z : snapCtx.ballZ;
    return { p: P(L.d, L.z + (qz - L.z) * 0.12), speed: 0.95 };
  }

  function underZoneTarget(d, L, a) {
    const t = now() - snapCtx.t0;
    const qb = FB.ballCarrier && FB.ballCarrier.role === 'QB' ? FB.ballCarrier : snapCtx.qb;
    const qz = qb ? qb.mesh.position.z : snapCtx.ballZ;
    const lo = L.z - L.w - 3, hi = L.z + L.w + 3;
    let threat = null, best = Infinity;
    for (const r of receiversOf()) {
      const rp = r.mesh.position;
      if (rp.z < lo || rp.z > hi) continue;
      const dep = depthOf(rp);
      if (dep < -1 || dep > L.d + 7) continue;
      // Carry verticals early (curl-flat / hook-curl take the seam first).
      const vertical = r.vel.x * snapCtx.dir > 2 && dep > L.d - 2;
      const score = Math.hypot(rp.z - L.z, dep - L.d) - (vertical && t < 2 && a.zone !== 'flat' ? 4 : 0);
      if (score < best) { best = score; threat = r; }
    }
    // Palms backers: match the RB if he flares to my side.
    if (a.rbMatch && snapCtx.rb && !snapCtx.rb._stayIn) {
      const rbz = snapCtx.rb.mesh.position.z;
      const mySide = Math.sign(L.z - snapCtx.ballZ) || 1;
      if ((rbz - snapCtx.ballZ) * mySide > 3 && t > 0.4) return manTarget(d, snapCtx.rb, { who: 'RB', tech: 'inside' }, 0.016);
    }
    if (threat) {
      const rp = threat.mesh.position;
      const maxD = a.zone === 'flat' ? L.d + 3 : L.d + 3.5;
      const td = clamp(depthOf(rp) + 0.5, 1, maxD);
      // Sit inside the throwing lane: between the QB and the receiver.
      const tz = clamp(rp.z + (qz - rp.z) * 0.15 + threat.vel.z * 0.25, L.z - L.w - 2, L.z + L.w + 2);
      return { p: P(td, tz), speed: 1.0 };
    }
    if (L.robber) return { p: P(L.d, qz), speed: 0.9 };
    return { p: P(L.d, L.z + (qz - L.z) * 0.2), speed: 0.95 };
  }

  function rushTarget(d, a) {
    const qb = FB.ballCarrier && FB.ballCarrier.role === 'QB' ? FB.ballCarrier : snapCtx.qb;
    if (!qb) return null;
    const qp = qb.mesh.position;
    const dist = d.mesh.position.distanceTo(qp);
    let z = qp.z + a.lane * clamp(dist / 7, 0.2, 1);
    // Contain: the end never lets the QB escape outside him.
    if (a.contain) {
      const out = Math.sign(a.lane);
      if ((qp.z - d.mesh.position.z) * out > -1) z = qp.z + out * 1.5;
    }
    return { p: TMP.set(qp.x, 0, z).clone(), speed: a.heavy ? 1.08 : 1.0, rusher: true };
  }

  function blitzTarget(d, a) {
    const qb = FB.ballCarrier && FB.ballCarrier.role === 'QB' ? FB.ballCarrier : snapCtx.qb;
    const gapPt = P(-0.8, snapCtx.ballZ + a.gap);
    if (!d._d.throughGap && d.mesh.position.distanceTo(gapPt) > 1.3 && depthOf(d.mesh.position) > -0.5) {
      return { p: gapPt, speed: 1.08, rusher: true };
    }
    d._d.throughGap = true;
    return qb ? { p: qb.mesh.position.clone(), speed: 1.08, rusher: true } : null;
  }

  // Cover 4 / Palms reads. Decisions lock once made so players don't flip.
  function matchTarget(d, a, dt) {
    const t = now() - snapCtx.t0;
    const r1 = snapCtx.byKey['#1' + a.side], r2 = snapCtx.byKey['#2' + a.side];
    const s = sgn(a.side);
    const vert = (r) => r && depthOf(r.mesh.position) > 7 && r.vel.x * snapCtx.dir > 1.2;
    const toFlat = (r) => r && depthOf(r.mesh.position) < 6 && r.vel.z * s > 1.6;
    const st = d._d;
    if (a.kind === 'qCorner') {
      if (!st.read && r1 && depthOf(r1.mesh.position) > 9 && r1.vel.x * snapCtx.dir > 1) st.read = 'man1';
      if (st.read === 'man1') return manTarget(d, r1, { tech: 'inside', who: '#1' }, dt);
      return deepZoneTarget(d, landmark({ zone: 'deepQuarterO', side: a.side }, snapCtx));
    }
    if (a.kind === 'qSafety') {
      if (!st.read && t > 0.7) st.read = vert(r2) ? 'man2' : (r2 ? 'help1' : 'help1');
      if (st.read === 'man2') return manTarget(d, r2, { tech: 'inside', who: '#2' }, dt);
      if (st.read === 'help1' && r1) {
        const rp = r1.mesh.position;
        return { p: P(Math.max(depthOf(rp) + 4, 12), rp.z + (s * 7 - rp.z) * 0.4), speed: 1.0 };
      }
      return { p: P(11, s * 7), speed: 0.8 };
    }
    if (a.kind === 'palmsCorner') {
      if (!st.read && t > 0.5) st.read = toFlat(r2) ? 'trap2' : 'man1';
      if (st.read === 'trap2' && r2) return manTarget(d, r2, { tech: 'outside', who: '#2' }, dt);
      if (st.read === 'man1' && r1) return manTarget(d, r1, { tech: 'inside', who: '#1' }, dt);
      return { p: P(7.5, r1 ? r1.mesh.position.z - s : s * 18), speed: 0.7 };
    }
    if (a.kind === 'palmsSafety') {
      if (!st.read && t > 0.5) st.read = toFlat(r2) ? 'over1' : 'man2';
      if (st.read === 'over1' && r1) {
        const rp = r1.mesh.position;
        return { p: P(Math.max(depthOf(rp) + 3, 10), rp.z), speed: 1.05 };
      }
      if (st.read === 'man2' && r2) return manTarget(d, r2, { tech: 'inside', who: '#2' }, dt);
      return { p: P(9.5, r2 ? r2.mesh.position.z : s * 8), speed: 0.7 };
    }
    return null;
  }

  // Behavior for one defender on a scrimmage pass/run play (no override).
  function assignmentTarget(d, dt) {
    const a = d.assignment;
    const t = now() - snapCtx.t0;
    if (a.type === 'rush') { d._beh = 'rush'; return rushTarget(d, a); }
    if (a.type === 'blitz') { d._beh = 'blitz'; return blitzTarget(d, a); }
    if (a.type === 'man') {
      const r = resolveWho(snapCtx, a.who);
      if (!r || (a.spyIfNone && r._stayIn)) {
        d._beh = 'cover';
        return underZoneTarget(d, landmark({ zone: 'robber' }, snapCtx), { zone: 'robber' });
      }
      // Green dog / blitz-if-block: my man stayed in to protect.
      if ((a.greenDog || a.blitzIfBlock) && t > 0.8 && (r._stayIn || (depthOf(r.mesh.position) < 0.3 && r.vel.x * snapCtx.dir < 0.8))) {
        d._beh = 'blitz';
        if (!d._d.dog) d._d.dog = { gap: clamp(r.mesh.position.z - snapCtx.ballZ, -5, 5) };
        return blitzTarget(d, d._d.dog);
      }
      d._beh = 'cover';
      return manTarget(d, r, a, dt);
    }
    if (a.type === 'match') { d._beh = 'cover'; return matchTarget(d, a, dt); }
    if (a.type === 'zone') {
      d._beh = 'cover';
      const L = landmark(a, snapCtx);
      return L.deep ? deepZoneTarget(d, L) : underZoneTarget(d, L, a);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  //  Pass protection: one blocker per rusher. Extra rushers come free.
  // ---------------------------------------------------------------------------
  const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
  function assignPassPro() {
    const offTeam = snapCtx.offTeam;
    const defTeam = offTeam === 'home' ? 'away' : 'home';
    const prot = FB.offenseOf(offTeam).filter((e) => e.mesh.visible && !e.isDown && (OL.includes(e.role) || e._stayIn));
    const rushers = FB.activePlayers[defTeam].filter((d) => d.mesh.visible && !d.isDown && (d._beh === 'rush' || d._beh === 'blitz'));
    for (const p of prot) {
      const t = p._ppTarget;
      if (t && (!rushers.includes(t) || p.mesh.position.distanceTo(t.mesh.position) > 4.5)) p._ppTarget = null;
    }
    const taken = new Set(prot.map((p) => p._ppTarget).filter(Boolean));
    const pairs = [];
    for (const p of prot) {
      if (p._ppTarget) continue;
      for (const d of rushers) {
        if (taken.has(d)) continue;
        // A rusher who just beat his man can't be re-picked up right away.
        if (d._shedUntil && now() < d._shedUntil) continue;
        // Linemen block the man in front of them; backs pick up blitzers.
        pairs.push({ p, d, dist: p.mesh.position.distanceTo(d.mesh.position) + (p._stayIn && d._beh === 'rush' ? 3 : 0) });
      }
    }
    pairs.sort((x, y) => x.dist - y.dist);
    for (const { p, d, dist } of pairs) {
      if (p._ppTarget || taken.has(d) || dist > 9) continue;
      p._ppTarget = d; taken.add(d);
    }
    for (const d of rushers) d._ppBlocker = null;
    for (const p of prot) if (p._ppTarget) p._ppTarget._ppBlocker = p;
  }
  FB.passProActive = function () {
    return !!(snapCtx && FB.state.phase === 'play' && FB.state.playType === 'pass'
      && FB.ballCarrier && FB.ballCarrier.role === 'QB' && FB.ballState.carried);
  };

  // ---------------------------------------------------------------------------
  //  updateDefense replacement for scrimmage plays with a scheme call
  // ---------------------------------------------------------------------------
  const legacyUpdateDefense = FB.updateDefense;
  FB.updateDefense = function (dt) {
    const pos = FB.state.possession;
    const defTeam = pos === 'home' ? 'away' : 'home';
    const defenders = FB.defendersOf(pos);
    const schemeOn = FB.state.phase === 'play' && !FB.specialMode && snapCtx && snapCtx.offTeam === pos
      && defenders.some((e) => e.assignment && e.assignment.scheme);
    if (!schemeOn) {
      for (const e of FB.activePlayers.home.concat(FB.activePlayers.away)) { e._ppTarget = null; e._ppBlocker = null; e._beh = null; }
      return legacyUpdateDefense.apply(this, arguments);
    }

    const reaction = FB.diffMult[FB.state.difficulty] || 1;
    const cfg = FB.getDiffCfg ? FB.getDiffCfg() : null;
    const sinceSnap = now() - snapCtx.t0;
    const carrier = FB.ballState.carried ? FB.ballCarrier : null;
    const userCtrl = defTeam === FB.userTeam ? FB.userDefender : null;
    const inAir = FB.ballState.inAir && FB.ballState.kind === 'pass';
    // Run / scramble / completed pass → everybody runs to the ball.
    const runOn = !!carrier && (carrier.role !== 'QB' || depthOf(carrier.mesh.position) > 0.5);

    if (FB.passProActive()) assignPassPro();

    for (const ent of defenders) {
      if (ent.isDown) continue;

      if (ent === userCtrl) { userMove(ent, dt); tackleCheck(ent, carrier); continue; }

      // Snap reaction delay by position group (difficulty-tuned).
      if (cfg) {
        let roleDelay = 0;
        if (DL.includes(ent.role)) roleDelay = cfg.dLineReactionDelay * 0.6;
        else if (LB.includes(ent.role)) roleDelay = cfg.lbReactionDelay * 0.6;
        else if (ent.role === 'LCB' || ent.role === 'RCB') roleDelay = cfg.dbReactionDelay * 0.5;
        else roleDelay = cfg.safetyReactionDelay * 0.5;
        if (sinceSnap < roleDelay) { ent.vel.multiplyScalar(Math.max(0, 1 - dt * 8)); continue; }
      }

      let goal = null;
      const a = ent.assignment || {};
      if (runOn) {
        goal = pursuitTarget(ent, carrier, a, sinceSnap);
      } else if (inAir) {
        goal = playBallTarget(ent, dt) || assignmentTarget(ent, dt);
      } else {
        goal = assignmentTarget(ent, dt);
      }
      if (!goal) goal = { p: (FB.ball ? FB.ball.position.clone() : ent.mesh.position.clone()), speed: 0.8 };
      goal.p.y = 0;

      let roleMul = 1;
      if (cfg) {
        if (ent.role === 'LCB' || ent.role === 'RCB' || ent.role === 'FS' || ent.role === 'SS') roleMul = cfg.dbManTrackingSpeed;
        else if (LB.includes(ent.role)) roleMul = cfg.lbPursuitSpeed;
        else if (DL.includes(ent.role)) roleMul = cfg.dLinePressureSpeed;
      }
      // Rushers engaged by their assigned blocker are slowed by blocking-resolution.
      FB.steerToward(ent, goal.p, dt, clamp(goal.speed * reaction * 0.95 * (0.55 + 0.45 * roleMul), 0.4, 1.2));
      tackleCheck(ent, carrier);
    }
  };

  function pursuitTarget(ent, carrier, a, sinceSnap) {
    const cp = carrier.mesh.position;
    const dist = ent.mesh.position.distanceTo(cp);
    const cDepth = depthOf(cp);
    const deepGuy = (a.type === 'zone' && landmark(a, snapCtx).deep) || ent.role === 'FS'
      || ((ent.role === 'LCB' || ent.role === 'RCB') && a.type !== 'zone');
    // Deep defenders don't bite until the ball crosses the line (play-action).
    if (deepGuy && cDepth < 0.5 && dist > 10 && carrier.role !== 'QB') {
      const fallback = assignmentTarget(ent, 0.016);
      if (fallback) return fallback;
    }
    const sp = (ent.baseSpeed || 7) * 1.05;
    const lead = clamp(dist / sp, 0, 1.1);
    return { p: new THREE.Vector3(cp.x + carrier.vel.x * lead, 0, cp.z + carrier.vel.z * lead), speed: 1.08 };
  }

  // Ball in the air: anyone who can get there breaks on the throw.
  function playBallTarget(ent, dt) {
    const aim = FB.ballState.aimXZ;
    if (!aim || !FB.ball) return null;
    const a = ent.assignment || {};
    if (a.type === 'rush' || ent._beh === 'rush' || ent._beh === 'blitz') {
      return { p: new THREE.Vector3(aim.x, 0, aim.z), speed: 0.7 };
    }
    const ball = FB.ball.position;
    const hs = Math.max(1, Math.hypot(FB.ballState.vel.x, FB.ballState.vel.z));
    const tBall = Math.hypot(aim.x - ball.x, aim.z - ball.z) / hs;
    const dAim = Math.hypot(aim.x - ent.mesh.position.x, aim.z - ent.mesh.position.z);
    const tMe = dAim / Math.max(1, (ent.baseSpeed || 7) * 1.1);
    if (tMe < tBall + 0.9) return { p: new THREE.Vector3(aim.x, 0, aim.z), speed: 1.15 };
    return null;
  }

  function userMove(ent, dt) {
    let dx = FB.input.joyY * -1, dz = FB.input.joyX;
    if (ent.team === 'away') dx = -dx;
    const mag = Math.hypot(dx, dz);
    const sp = ent.baseSpeed * (FB.input.sprint && ent.stamina > 0 ? 1.3 : 1.0) * 0.9;
    if (mag > 0.05) {
      const nx = dx / mag, nz = dz / mag;
      ent.vel.x += (nx * sp - ent.vel.x) * Math.min(1, dt * ent.accel / sp);
      ent.vel.z += (nz * sp - ent.vel.z) * Math.min(1, dt * ent.accel / sp);
      ent.mesh.rotation.y = Math.atan2(nx, nz);
    } else ent.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
    if (FB.input.sprint && ent.stamina > 0) ent.stamina = Math.max(0, ent.stamina - dt * 18);
    else ent.stamina = Math.min(100, ent.stamina + dt * 10);
    ent.mesh.position.addScaledVector(ent.vel, dt);
    ent.mesh.position.x = clamp(ent.mesh.position.x, -FB.const.FIELD_LEN / 2, FB.const.FIELD_LEN / 2);
    ent.mesh.position.z = clamp(ent.mesh.position.z, -FB.const.FIELD_WID / 2, FB.const.FIELD_WID / 2);
  }

  function tackleCheck(ent, carrier) {
    if (!carrier || carrier.isDown) return;
    if (ent.mesh.position.distanceTo(carrier.mesh.position) < 1.4) FB.attemptTackle && FB.attemptTackle(ent, carrier);
  }

  // Publish the calls to the playbook (play picker + AI selection).
  FB.PLAYBOOK = FB.PLAYBOOK || { offense: [], defense: [] };
  FB.PLAYBOOK.defense = SCHEMES;
  // Pre-build a diagram-friendly assignment set for the default formation so
  // the play picker can draw each call before any snap happens.
  for (const sc of SCHEMES) {
    const ctx = { S: 'R', W: 'L', N: 'L', ballZ: 0 };
    sc.assignments = sc.build(ctx);
    sc.diagram = true;
  }
  // Legacy-diagram helper: depth/lateral for a scheme assignment.
  FB.schemeDiagramPoint = function (a) {
    const ctx = { S: 'R', W: 'L', N: 'L', ballZ: 0 };
    if (a.type === 'zone') { const L = landmark(a, ctx); return { depth: L.d, lateral: L.z }; }
    if (a.type === 'match') {
      const s = sgn(a.side);
      return a.kind.endsWith('Corner') ? { depth: 14, lateral: s * 19 } : { depth: 13, lateral: s * 8 };
    }
    return null;
  };
  FB.schemeManTarget = function (who) {
    return { '#1L': 'WR1', '#2L': 'WR3', '#1R': 'WR2', '#2R': 'TE', slot: 'WR3', TE: 'TE', RB: 'RB' }[who] || who;
  };

  FB.DefenseAI = { SCHEMES, readOffense, landmark, assignPassPro };
  FB.CoverageAI = FB.DefenseAI; // older test harness checks this name
})(window.FB);

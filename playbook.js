// playbook.js — simple offensive + defensive plays.
// Routes are relative to LOS: dx yards downfield, dz lateral (negative = left sideline in possession's frame).
// The movement layer flips dx sign based on possession direction.

(function (FB) {
  'use strict';

  // --- Route helpers ---
  const R = {
    slant:      [{dx: 2, dz: 0}, {dx: 7, dz: -4}],
    slantRight: [{dx: 2, dz: 0}, {dx: 7, dz: 4}],
    curl10:     [{dx: 10, dz: 0}, {dx: 8, dz: 0}],
    curl12:     [{dx: 12, dz: 0}, {dx: 10, dz: 0}],
    comeback:   [{dx: 14, dz: 0}, {dx: 11, dz: -3}],
    quickOut:   [{dx: 5, dz: 0}, {dx: 5, dz: -6}],
    quickOutR:  [{dx: 5, dz: 0}, {dx: 5, dz: 6}],
    post:       [{dx: 10, dz: 0}, {dx: 22, dz: -8}],
    corner:     [{dx: 10, dz: 0}, {dx: 20, dz: 9}],
    go:         [{dx: 30, dz: 0}],
    drag:       [{dx: 3, dz: 0}, {dx: 6, dz: 12}],
    dragL:      [{dx: 3, dz: 0}, {dx: 6, dz: -12}],
    flat:       [{dx: 0, dz: 0}, {dx: 3, dz: 8}],
    flatL:      [{dx: 0, dz: 0}, {dx: 3, dz: -8}],
    screen:     [{dx: -3, dz: 5}, {dx: 2, dz: 8}],
    block:      [{dx: -1, dz: 0}],
    wheel:      [{dx: 0, dz: 8}, {dx: 12, dz: 12}],
    stick:      [{dx: 6, dz: 0}, {dx: 6, dz: 5}],
  };

  FB.PLAYBOOK = {
    offense: [
      { id: 'inside_zone', name: 'Inside Zone', type: 'run', ballTo: 'RB',
        routes: { RB: [{dx: 6, dz: 0.5}, {dx: 12, dz: 0}] },
        notes: 'Straight-ahead run between the tackles.' },
      { id: 'power_left', name: 'Power Left', type: 'run', ballTo: 'RB',
        routes: { RB: [{dx: 4, dz: -3}, {dx: 12, dz: -5}] },
        notes: 'Run behind the left guard.' },
      { id: 'power_right', name: 'Power Right', type: 'run', ballTo: 'RB',
        routes: { RB: [{dx: 4, dz: 3}, {dx: 12, dz: 5}] },
        notes: 'Run behind the right guard.' },
      { id: 'sweep_left', name: 'Sweep Left', type: 'run', ballTo: 'RB',
        routes: { RB: [{dx: 2, dz: -10}, {dx: 10, dz: -14}] },
        notes: 'Fast outside run to the left.' },
      { id: 'sweep_right', name: 'Sweep Right', type: 'run', ballTo: 'RB',
        routes: { RB: [{dx: 2, dz: 10}, {dx: 10, dz: 14}] },
        notes: 'Fast outside run to the right.' },
      { id: 'qb_sneak', name: 'QB Sneak', type: 'run', ballTo: 'QB',
        routes: { }, notes: 'Short yardage — QB dives forward.' },
      { id: 'hb_draw', name: 'HB Draw', type: 'run', ballTo: 'RB',
        routes: { RB: [{dx: -2, dz: 0}, {dx: 10, dz: 0}] },
        notes: 'Delayed run, fakes a pass.' },
      { id: 'iris', name: 'Inside Zone (Right)', type: 'run', ballTo: 'RB', gap: 'inside-right',
        routes: { RB: [{dx: 3, dz: 1.5}, {dx: 8, dz: 2.5}, {dx: 14, dz: 3}] },
        notes: 'Inside zone to the right — read the center/right guard double team.' },
      { id: 'illinois', name: 'Inside Zone (Left)', type: 'run', ballTo: 'RB', gap: 'inside-left',
        routes: { RB: [{dx: 3, dz: -1.5}, {dx: 8, dz: -2.5}, {dx: 14, dz: -3}] },
        notes: 'Inside zone to the left — read the center/left guard double team.' },
      { id: 'omar', name: 'Outside Zone (Right)', type: 'run', ballTo: 'RB', gap: 'outside-right',
        routes: { RB: [{dx: 1, dz: 4}, {dx: 5, dz: 9}, {dx: 12, dz: 12}] },
        notes: 'Outside zone to the right — bounce it wide if the edge seals.' },
      { id: 'oklahoma', name: 'Outside Zone (Left)', type: 'run', ballTo: 'RB', gap: 'outside-left',
        routes: { RB: [{dx: 1, dz: -4}, {dx: 5, dz: -9}, {dx: 12, dz: -12}] },
        notes: 'Outside zone to the left — bounce it wide if the edge seals.' },
      { id: 'quick_slants', name: 'Quick Slants', type: 'pass',
        routes: { WR1: R.slant, WR2: R.slantRight, WR3: R.slant, TE: R.stick, RB: R.flatL },
        notes: 'Fast 3-step drop, slants underneath.' },
      { id: 'four_verts', name: 'Four Verticals', type: 'pass',
        routes: { WR1: R.go, WR2: R.go, WR3: R.go, TE: R.go, RB: R.block },
        notes: 'Stretch the defense vertically.' },
      { id: 'curls', name: 'Curl Routes', type: 'pass',
        routes: { WR1: R.curl10, WR2: R.curl12, WR3: R.curl10, TE: R.stick, RB: R.flat },
        notes: 'Receivers hook back at 10–12 yards.' },
      { id: 'smash', name: 'Smash Concept', type: 'pass',
        routes: { WR1: R.corner, WR2: R.quickOut, WR3: R.curl10, TE: R.drag, RB: R.block },
        notes: 'Hi-lo combo — corner/flat.' },
      { id: 'post_corner', name: 'Post–Corner', type: 'pass',
        routes: { WR1: R.post, WR2: R.corner, WR3: R.comeback, TE: R.stick, RB: R.flat },
        notes: 'Deep shot with safety manipulation.' },
      { id: 'flood_right', name: 'Flood Right', type: 'pass',
        routes: { WR1: R.dragL, WR2: R.corner, WR3: R.flat, TE: R.stick, RB: R.wheel },
        notes: 'Three receivers to the right at varied depth.' },
      { id: 'hb_screen', name: 'HB Screen', type: 'pass',
        routes: { WR1: R.go, WR2: R.go, WR3: R.block, TE: R.block, RB: R.screen },
        notes: 'Pass to the RB behind the line.' },
      { id: 'play_action_deep', name: 'Play-Action Deep', type: 'play-action',
        routes: { WR1: R.post, WR2: R.go, WR3: R.comeback, TE: R.drag, RB: R.flat },
        notes: 'Fake the run, throw deep.' },
      { id: 'bootleg_right', name: 'Bootleg Right', type: 'pass',
        routes: { WR1: R.dragL, WR2: R.flat, WR3: R.comeback, TE: R.corner, RB: R.block },
        notes: 'QB rolls right, throws on the move.' },
    ],
    defense: [
      { id: 'base_cover2', name: '4-3 Cover 2', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'zone', depth: 8, lateral: 0 },
          WLB: { type: 'zone', depth: 4, lateral: -10 },
          SLB: { type: 'zone', depth: 4, lateral: 10 },
          LCB: { type: 'zone', depth: 4, lateral: -18 },
          RCB: { type: 'zone', depth: 4, lateral: 18 },
          FS: { type: 'zone', depth: 16, lateral: -10 },
          SS: { type: 'zone', depth: 16, lateral: 10 },
        }, notes: 'Safeties split halves deep. Good against deep passes.' },
      { id: 'base_cover3', name: '4-3 Cover 3', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'zone', depth: 7, lateral: 0 },
          WLB: { type: 'zone', depth: 4, lateral: -12 },
          SLB: { type: 'zone', depth: 4, lateral: 12 },
          LCB: { type: 'zone', depth: 14, lateral: -18 },
          RCB: { type: 'zone', depth: 14, lateral: 18 },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'zone', depth: 8, lateral: 6 },
        }, notes: 'Three deep, four underneath.' },
      { id: 'cover1_man', name: 'Cover 1 Man', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'man', target: 'RB' },
          WLB: { type: 'man', target: 'TE' },
          SLB: { type: 'zone', depth: 4, lateral: 8 },
          LCB: { type: 'man', target: 'WR1' },
          RCB: { type: 'man', target: 'WR2' },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'man', target: 'WR3' },
        }, notes: 'Man-to-man with a single deep safety.' },
      { id: 'cover0_blitz', name: 'Cover 0 Blitz', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'blitz' }, WLB: { type: 'blitz' }, SLB: { type: 'blitz' },
          LCB: { type: 'man', target: 'WR1' },
          RCB: { type: 'man', target: 'WR2' },
          FS: { type: 'man', target: 'WR3' },
          SS: { type: 'man', target: 'TE' },
        }, notes: 'All-out pressure, no safety help.' },
      { id: 'nickel_cover2', name: 'Nickel Cover 2', formation: 'nickel',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'zone', depth: 8, lateral: 0 },
          WLB: { type: 'zone', depth: 5, lateral: -8 },
          SLB: { type: 'man', target: 'WR3' },
          LCB: { type: 'zone', depth: 5, lateral: -18 },
          RCB: { type: 'zone', depth: 5, lateral: 18 },
          FS: { type: 'zone', depth: 16, lateral: -10 },
          SS: { type: 'zone', depth: 16, lateral: 10 },
        }, notes: 'Five DBs on passing downs.' },
      { id: 'mlb_blitz', name: 'MLB Blitz', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'blitz' },
          WLB: { type: 'zone', depth: 5, lateral: -8 },
          SLB: { type: 'zone', depth: 5, lateral: 8 },
          LCB: { type: 'man', target: 'WR1' },
          RCB: { type: 'man', target: 'WR2' },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'man', target: 'TE' },
        }, notes: 'Mike blitz up the A-gap.' },
      { id: 'olb_blitz_weak', name: 'OLB Blitz Weak', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          WLB: { type: 'blitz' },
          MLB: { type: 'zone', depth: 6, lateral: 0 },
          SLB: { type: 'zone', depth: 5, lateral: 8 },
          LCB: { type: 'zone', depth: 6, lateral: -18 },
          RCB: { type: 'zone', depth: 6, lateral: 18 },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'zone', depth: 10, lateral: 6 },
        }, notes: 'Weak-side pressure.' },
      { id: 'olb_blitz_strong', name: 'OLB Blitz Strong', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          SLB: { type: 'blitz' },
          MLB: { type: 'zone', depth: 6, lateral: 0 },
          WLB: { type: 'zone', depth: 5, lateral: -8 },
          LCB: { type: 'zone', depth: 6, lateral: -18 },
          RCB: { type: 'zone', depth: 6, lateral: 18 },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'zone', depth: 10, lateral: 6 },
        }, notes: 'Strong-side pressure.' },
      { id: 'safety_blitz', name: 'Safety Blitz', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          SS: { type: 'blitz' },
          MLB: { type: 'zone', depth: 6, lateral: 0 },
          WLB: { type: 'zone', depth: 5, lateral: -8 },
          SLB: { type: 'zone', depth: 5, lateral: 8 },
          LCB: { type: 'man', target: 'WR1' },
          RCB: { type: 'man', target: 'WR2' },
          FS: { type: 'zone', depth: 18, lateral: 0 },
        }, notes: 'Strong safety comes on the blitz.' },
      { id: 'cover4', name: 'Cover 4 Quarters', formation: '4-3',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'zone', depth: 6, lateral: 0 },
          WLB: { type: 'zone', depth: 4, lateral: -10 },
          SLB: { type: 'zone', depth: 4, lateral: 10 },
          LCB: { type: 'zone', depth: 14, lateral: -18 },
          RCB: { type: 'zone', depth: 14, lateral: 18 },
          FS: { type: 'zone', depth: 16, lateral: -6 },
          SS: { type: 'zone', depth: 16, lateral: 6 },
        }, notes: 'Four deep — no long touchdowns.' },
      { id: 'prevent', name: 'Prevent Defense', formation: 'dime',
        assignments: {
          LE: { type: 'rush' }, RE: { type: 'rush' },
          DT: { type: 'zone', depth: 5, lateral: -3 }, NT: { type: 'zone', depth: 5, lateral: 3 },
          MLB: { type: 'zone', depth: 10, lateral: 0 },
          WLB: { type: 'zone', depth: 10, lateral: -10 },
          SLB: { type: 'zone', depth: 10, lateral: 10 },
          LCB: { type: 'zone', depth: 22, lateral: -18 },
          RCB: { type: 'zone', depth: 22, lateral: 18 },
          FS: { type: 'zone', depth: 25, lateral: -8 },
          SS: { type: 'zone', depth: 25, lateral: 8 },
        }, notes: 'Keep everything in front — end-of-half.' },
      { id: 'goal_line', name: 'Goal Line', formation: 'goal-line',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'rush' },
          WLB: { type: 'zone', depth: 2, lateral: -6 },
          SLB: { type: 'zone', depth: 2, lateral: 6 },
          LCB: { type: 'man', target: 'WR1' },
          RCB: { type: 'man', target: 'WR2' },
          FS: { type: 'zone', depth: 4, lateral: 0 },
          SS: { type: 'man', target: 'TE' },
        }, notes: 'Stack the box near the goal line.' },
      { id: 'zone_blitz', name: 'Zone Blitz', formation: '4-3',
        assignments: {
          LE: { type: 'zone', depth: 4, lateral: -8 },
          DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'blitz' },
          WLB: { type: 'zone', depth: 6, lateral: -8 },
          SLB: { type: 'zone', depth: 6, lateral: 8 },
          LCB: { type: 'zone', depth: 12, lateral: -18 },
          RCB: { type: 'zone', depth: 12, lateral: 18 },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'zone', depth: 10, lateral: 6 },
        }, notes: 'Drop a lineman, blitz a linebacker.' },
      { id: 'dime_man', name: 'Dime Coverage', formation: 'dime',
        assignments: {
          LE: { type: 'rush' }, DT: { type: 'rush' }, NT: { type: 'rush' }, RE: { type: 'rush' },
          MLB: { type: 'man', target: 'RB' },
          WLB: { type: 'man', target: 'TE' },
          SLB: { type: 'zone', depth: 6, lateral: 8 },
          LCB: { type: 'man', target: 'WR1' },
          RCB: { type: 'man', target: 'WR2' },
          FS: { type: 'zone', depth: 18, lateral: 0 },
          SS: { type: 'man', target: 'WR3' },
        }, notes: 'Six DBs — obvious passing downs.' },
    ],
  };

  // Pick a random AI play of the given side (for the non-user team).
  FB.pickAIPlay = function (side) {
    return FB.pickAIPlayAdaptive ? FB.pickAIPlayAdaptive(side) : FB.PLAYBOOK[side][0];
  };

  // Adaptive picker that reads FB.state.userTendencies to counter the human.
  // Defense against a pass-heavy user tilts toward zone/dime/prevent; against run, toward base/goal-line/blitz.
  // Offense against a user who blitzes a lot tilts toward screens/quick passes; against zone, toward verticals.
  FB.pickAIPlayAdaptive = function (side) {
    const list = FB.PLAYBOOK[side];
    const t = (FB.state && FB.state.userTendencies) || { run: 0, pass: 0, left: 0, right: 0, blitz: 0, zone: 0 };
    const totalOff = Math.max(1, (t.run || 0) + (t.pass || 0));
    const runBias = (t.run || 0) / totalOff;   // 0..1
    const passBias = (t.pass || 0) / totalOff; // 0..1
    const leftBias = ((t.left || 0) - (t.right || 0)) / Math.max(1, (t.left || 0) + (t.right || 0));
    const blitzBias = ((t.blitz || 0) - (t.zone || 0)) / Math.max(1, (t.blitz || 0) + (t.zone || 0));

    const scored = list.map((p) => {
      let s = Math.random() * 0.6; // base randomness
      if (side === 'defense') {
        const isRunStopper = /goal|blitz/i.test(p.name) || /mlb_blitz|safety_blitz|goal_line/.test(p.id);
        const isPassDef = /nickel|dime|cover2|cover3|cover4|prevent|zone_blitz/i.test(p.id);
        if (isRunStopper) s += runBias * 1.6;
        if (isPassDef) s += passBias * 1.6;
        // If user favored a side on runs, prefer blitzes to that side.
        if (/strong/i.test(p.id) && leftBias < -0.2) s += 0.5;
        if (/weak/i.test(p.id) && leftBias > 0.2) s += 0.5;
      } else {
        const deep = /four_verts|post_corner|play_action_deep/.test(p.id);
        const quick = /slants|screen|curls|bootleg/.test(p.id);
        const run = p.type === 'run';
        if (blitzBias > 0.2) s += quick ? 0.9 : (deep ? 0.4 : 0);
        if (blitzBias < -0.2) s += deep ? 0.7 : 0;
        if (blitzBias < 0) s += run ? 0.4 : 0; // if user sits back, AI runs
      }
      return { p, s };
    });
    scored.sort((a, b) => b.s - a.s);
    // Top-3 weighted pick for variety.
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(Math.random() * top.length)].p;
  };

  // Call when the user confirms a play so the AI can learn.
  FB.recordUserPlay = function (side, play) {
    if (!FB.state) return;
    const t = FB.state.userTendencies = FB.state.userTendencies
      || { run: 0, pass: 0, left: 0, right: 0, blitz: 0, zone: 0, recentPlays: [] };
    if (side === 'offense') {
      if (play.type === 'run') t.run++;
      else t.pass++;
      if (/left|weak/i.test(play.id) || play.gap === 'inside-left' || play.gap === 'outside-left') t.left++;
      if (/right|strong/i.test(play.id) || play.gap === 'inside-right' || play.gap === 'outside-right') t.right++;
    } else {
      if (/blitz|cover0|cover1|goal/i.test(play.id)) t.blitz++;
      else t.zone++;
    }
    t.recentPlays.push(play.id);
    if (t.recentPlays.length > 8) t.recentPlays.shift();
  };

  // Resolve a slot's relative point on the field.
  FB.zoneTargetFor = function (assignment, losX, dir, fieldWidSign) {
    const dx = assignment.depth * dir;
    const dz = assignment.lateral * (fieldWidSign || 1);
    return new THREE.Vector3(losX + dx, 0, dz);
  };

  // Expand a route (dx/dz waypoints) into absolute field waypoints for an entity.
  FB.expandRoute = function (waypoints, startPos, dir) {
    if (!waypoints || !waypoints.length) return [];
    return waypoints.map(w => new THREE.Vector3(startPos.x + w.dx * dir, 0, startPos.z + w.dz));
  };

})(window.FB);

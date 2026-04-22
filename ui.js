// ui.js — pre-game screen, pause/subs/rosters menu, game-over, share, bootstrap.
(function (FB) {
  'use strict';

  async function loadRosters() {
    const res = await fetch('roster.json');
    const data = await res.json();
    FB.teams.home = data.highlanders;
    FB.teams.away = data.spartans;
    Ratings.rateTeam(FB.teams.home);
    Ratings.rateTeam(FB.teams.away);
    FB.lineups.home = deepClone(FB.teams.home.lineup);
    FB.lineups.away = deepClone(FB.teams.away.lineup);
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function renderPreGame() {
    renderTeamCard('pgHome', FB.teams.home);
    renderTeamCard('pgAway', FB.teams.away);
    const notes = document.getElementById('pgNotes');
    const list = [];
    for (const t of [FB.teams.home, FB.teams.away]) {
      if (t._dataNotes) for (const n of t._dataNotes) list.push('• [' + t.shortName + '] ' + n);
    }
    notes.innerHTML = '<h3>Data assumptions (transparent flagging)</h3>' + list.map(x => '<div>' + escapeHtml(x) + '</div>').join('');
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function renderTeamCard(elId, team) {
    const el = document.getElementById(elId);
    const ln = team.lineup;
    const groups = [
      { title: 'Offense', slots: Ratings.OFFENSE_SLOTS.map(s => s.slot), side: 'OFF' },
      { title: 'Defense', slots: Ratings.DEFENSE_SLOTS.map(s => s.slot), side: 'DEF' },
      { title: 'Special Teams', slots: Ratings.ST_SLOTS.map(s => s.slot), side: 'ST' },
    ];
    let html = '<h2 style="color:' + team.primaryColor + '">' + escapeHtml(team.teamName) + '</h2>';
    html += '<div class="pg-meta">GP: ' + team.gamesPlayed + ' • ' + team.players.length + ' players</div>';
    for (const g of groups) {
      html += '<div class="pg-group-title">' + g.title + '</div>';
      for (const slot of g.slots) {
        const num = ln[g.side][slot];
        const pl = team.players.find(p => p.number === num);
        if (!pl) { html += '<div class="pg-row"><span class="pg-slot">' + slot + '</span><span>— no eligible —</span></div>'; continue; }
        const badges = [];
        if (pl.isTwoWay) badges.push('<span class="badge twoway">TWO-WAY</span>');
        if (pl.isPlaceholder) badges.push('<span class="badge unrated">UNRATED</span>');
        if (pl.isSmallSample) badges.push('<span class="badge sample">SAMPLE</span>');
        html += '<div class="pg-row"><div class="pg-left"><span class="pg-slot">' + slot + '</span>'
          + '<span class="pg-num">#' + pl.number + '</span>'
          + '<span class="pg-name">' + escapeHtml(pl.name) + '</span>'
          + badges.join('') + '</div>'
          + '<span class="pg-ovr">' + pl.overall + '</span></div>';
      }
    }
    el.innerHTML = html;
  }

  // ---- Pause menu ----
  FB.openPause = function () {
    const modal = document.getElementById('pauseMenu');
    modal.classList.remove('hidden');
    FB.state.phase = 'paused';
    renderSubsView('home');
    renderRosterView();
  };
  function closePause() {
    document.getElementById('pauseMenu').classList.add('hidden');
    // Resume whatever phase was active before pause (best-effort)
    FB.state.phase = FB.ballState && FB.ballState.inAir ? 'play' : 'presnap';
  }

  function wireTabs() {
    const tabs = document.querySelectorAll('.tabs .tab');
    tabs.forEach((t) => {
      t.addEventListener('click', () => {
        tabs.forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        for (const id of ['tabMain','tabSubs','tabRoster']) document.getElementById(id).classList.add('hidden');
        document.getElementById('tab' + cap(t.dataset.tab)).classList.remove('hidden');
      });
    });
    document.querySelectorAll('.sub-team-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.sub-team-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        renderSubsView(b.dataset.team);
      });
    });
    document.getElementById('pmResume').addEventListener('click', closePause);
    document.getElementById('pmRestart').addEventListener('click', () => location.reload());
  }
  function cap(s) { return s[0].toUpperCase() + s.slice(1); }

  function renderSubsView(teamKey) {
    const team = FB.teams[teamKey];
    const lineup = FB.lineups[teamKey];
    const list = document.getElementById('subList');
    list.innerHTML = '';
    const groups = [
      { side: 'OFF', slots: Ratings.OFFENSE_SLOTS.map(x => x.slot), title: 'Offense' },
      { side: 'DEF', slots: Ratings.DEFENSE_SLOTS.map(x => x.slot), title: 'Defense' },
      { side: 'ST',  slots: Ratings.ST_SLOTS.map(x => x.slot), title: 'Special Teams' },
    ];
    for (const g of groups) {
      const hdr = document.createElement('div');
      hdr.className = 'pg-group-title'; hdr.textContent = g.title;
      list.appendChild(hdr);
      for (const slot of g.slots) {
        const card = document.createElement('div');
        card.className = 'sub-slot';
        const cur = lineup[g.side][slot];
        const curP = team.players.find(p => p.number === cur);
        const curOvrHtml = curP ? '<span class="sub-ovr">OVR ' + curP.overall + '</span>' : '';
        const curNameHtml = curP ? '#' + curP.number + ' ' + escapeHtml(curP.name) : '—';
        card.innerHTML = '<div class="sub-slot-hdr">'
          + '<span class="slot-name">' + slot + '</span>'
          + '<span class="sub-current">' + curNameHtml + ' ' + curOvrHtml + '</span>'
          + '</div>';
        const cands = document.createElement('div');
        cands.className = 'sub-candidates';
        const slotInfo = [].concat(Ratings.OFFENSE_SLOTS, Ratings.DEFENSE_SLOTS, Ratings.ST_SLOTS).find(x => x.slot === slot);
        const eligiblePos = slotInfo && slotInfo.pos ? slotInfo.pos : null;
        // Only players who actually play this position can be subbed in.
        // Returner slots (eligiblePos=null) accept any skill-capable player.
        const eligiblePlayers = team.players.filter(p =>
          eligiblePos ? p.positions.some(pp => eligiblePos.includes(pp)) : true
        );
        const sorted = eligiblePlayers.sort((a, b) => (b.overall || 0) - (a.overall || 0));
        const curQuarter = (FB.state && FB.state.quarter) || 1;
        for (const p of sorted) {
          const btn = document.createElement('button');
          const locked = Array.isArray(p._quarterRestrict) && p._quarterRestrict.length > 0;
          const lockedNow = locked && !p._quarterRestrict.includes(curQuarter);
          btn.className = 'sub-cand' + (p.number === cur ? ' active' : '') + (lockedNow ? ' locked' : '');
          const last = p.name.split(' ').slice(-1)[0];
          const lockTag = lockedNow ? ' <span class="sc-lock">Q' + p._quarterRestrict.join('/Q') + '</span>' : '';
          // Flag slots elsewhere on this side where the player is already a starter.
          let dupSlot = null;
          for (const otherSlot of Object.keys(lineup[g.side])) {
            if (otherSlot !== slot && lineup[g.side][otherSlot] === p.number) { dupSlot = otherSlot; break; }
          }
          const dupTag = dupSlot ? ' <span class="sc-lock">in ' + dupSlot + '</span>' : '';
          btn.innerHTML = '<span class="sc-num">#' + p.number + '</span>'
            + '<span class="sc-name">' + escapeHtml(last) + lockTag + dupTag + '</span>'
            + '<span class="sc-ovr">OVR ' + p.overall + '</span>';
          const displayName = p.displayName || p.name;
          btn.title = displayName + ' — positions: ' + p.positions.join('/') + ' — OVR ' + p.overall
            + (locked ? ' — available only in Q' + p._quarterRestrict.join('/Q') : '')
            + (dupSlot ? ' — currently starting at ' + dupSlot + '; subbing in will swap' : '');
          if (lockedNow) {
            btn.disabled = true;
          } else {
            btn.addEventListener('click', () => {
              // A player can't start at two positions on the same side at once —
              // if they're already in another slot here, swap with the current starter.
              const prevInThisSlot = lineup[g.side][slot];
              if (dupSlot) lineup[g.side][dupSlot] = prevInThisSlot != null ? prevInThisSlot : null;
              lineup[g.side][slot] = p.number;
              renderSubsView(teamKey);
            });
          }
          cands.appendChild(btn);
        }
        card.appendChild(cands);
        list.appendChild(card);
      }
    }
    const note = document.createElement('div');
    note.className = 'pg-sub';
    note.style.marginTop = '8px';
    note.textContent = 'Only players who play the slot position are shown. Multi-position players can fill any of their positions, but never two slots at once on the same side — reselecting swaps them. Greyed-out players are quarter-locked.';
    list.appendChild(note);
  }

  function renderRosterView() {
    const el = document.getElementById('rosterView');
    let html = '';
    for (const key of ['home','away']) {
      const t = FB.teams[key];
      html += '<h3>' + escapeHtml(t.teamName) + '</h3>';
      const rows = [...t.players].sort((a, b) => (b.overall || 0) - (a.overall || 0));
      for (const p of rows) {
        const displayName = p.displayName || p.name;
        const lockTag = Array.isArray(p._quarterRestrict) && p._quarterRestrict.length > 0
          ? ' <span class="pg-lock">Q' + p._quarterRestrict.join('/Q') + '</span>' : '';
        html += '<div class="pg-row"><div class="pg-left"><span class="pg-num">#' + p.number + '</span>'
          + '<span class="pg-name">' + escapeHtml(displayName) + lockTag + '</span>'
          + '<span class="pg-slot">' + p.positions.join('/') + '</span></div>'
          + '<span class="pg-ovr">' + (p.overall || '—') + '</span></div>';
      }
    }
    el.innerHTML = html;
  }

  // ---- Game over ----
  FB.gameOverScreen = function () {
    FB.state.phase = 'gameover';
    const s = FB.state;
    const winner = s.score.home === s.score.away ? 'TIE'
      : s.score.home > s.score.away ? FB.teams.home.shortName + ' WIN' : FB.teams.away.shortName + ' WIN';
    document.getElementById('goTitle').textContent = 'FINAL — ' + winner;
    const topHome = topPerformer('home');
    const topAway = topPerformer('away');
    document.getElementById('goBody').innerHTML =
      '<div style="font-size:22px;font-weight:800;text-align:center;margin-bottom:10px">'
        + FB.teams.home.shortName + ' ' + s.score.home + '  —  ' + s.score.away + ' ' + FB.teams.away.shortName
      + '</div>'
      + '<div style="font-size:13px;opacity:0.8">Top (A): ' + topHome + '</div>'
      + '<div style="font-size:13px;opacity:0.8">Top (S): ' + topAway + '</div>'
      + '<div style="font-size:11px;opacity:0.55;margin-top:10px">Data notes were shown on the pre-game screen. Stats above reflect in-game play only.</div>';
    document.getElementById('gameOver').classList.remove('hidden');
  };

  function topPerformer(teamKey) {
    const stats = FB.state.gameStats[teamKey];
    let best = null, val = -1;
    for (const num of Object.keys(stats)) {
      const v = (stats[num].rushingYards || 0) + (stats[num].receivingYards || 0) * 0.9;
      if (v > val) { val = v; best = num; }
    }
    if (!best) return '—';
    const p = FB.teams[teamKey].players.find(x => x.number === +best);
    const st = stats[best];
    const parts = [];
    if (st.rushingYards) parts.push(st.rushingYards + ' rush yds');
    if (st.receivingYards) parts.push(st.receivingYards + ' rec yds');
    if (st.tackles) parts.push(st.tackles + ' tkl');
    return p ? '#' + p.number + ' ' + p.name + ' — ' + parts.join(', ') : '—';
  }

  function shareResult() {
    const s = FB.state;
    const text = FB.teams.home.shortName + ' vs ' + FB.teams.away.shortName + ' — Final: '
      + s.score.home + '-' + s.score.away + '. Top: ' + topPerformer(s.score.home >= s.score.away ? 'home' : 'away');
    const url = location.href;
    if (navigator.share) {
      navigator.share({ title: 'Highlanders vs Spartans', text, url }).catch(() => fallback());
    } else fallback();
    function fallback() {
      const sms = 'sms:?&body=' + encodeURIComponent(text + ' ' + url);
      location.href = sms;
    }
  }

  // ---- Team pick ----
  function wireTeamPick() {
    const btns = document.querySelectorAll('.team-pick-btn');
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      FB.userTeam = b.dataset.team;
    }));
    FB.userTeam = 'home';
  }

  // ---- Play picker ----
  FB.selectedPlay = { offense: null, defense: null };
  let ppSide = 'offense';
  let ppCallback = null;
  const PP_HAND_SIZE = 3;
  // Current "hand" of 3 random plays offered to the user per side.
  let ppHand = { offense: [], defense: [] };

  function pickRandomHand(side) {
    const list = (FB.PLAYBOOK && FB.PLAYBOOK[side]) || [];
    if (!list.length) return [];
    const pool = list.slice();
    const hand = [];
    const n = Math.min(PP_HAND_SIZE, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      hand.push(pool.splice(idx, 1)[0]);
    }
    return hand;
  }

  function wirePlayPicker() {
    const tabs = document.querySelectorAll('.pp-tab');
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      ppSide = t.dataset.pp;
      if (!ppHand[ppSide] || !ppHand[ppSide].length) ppHand[ppSide] = pickRandomHand(ppSide);
      if (!FB.selectedPlay[ppSide] || !ppHand[ppSide].includes(FB.selectedPlay[ppSide])) {
        FB.selectedPlay[ppSide] = ppHand[ppSide][0] || null;
      }
      renderPlayList();
    }));
    document.getElementById('ppConfirm').addEventListener('click', () => {
      const modal = document.getElementById('playPicker');
      modal.classList.add('hidden');
      const picked = FB.selectedPlay[ppSide];
      if (picked && FB.recordUserPlay) FB.recordUserPlay(ppSide, picked);
      if (ppCallback) { const cb = ppCallback; ppCallback = null; cb(); }
    });
    document.getElementById('ppShuffle').addEventListener('click', () => {
      ppHand[ppSide] = pickRandomHand(ppSide);
      FB.selectedPlay[ppSide] = ppHand[ppSide][0] || FB.selectedPlay[ppSide];
      renderPlayList();
    });
  }

  function userIsOffense() {
    return FB.state.possession === FB.userTeam;
  }

  function ensurePlaybook() {
    // If playbook.js never loaded (cache, network), synthesize a minimal
    // 6-play book so the picker is always usable and the game can proceed.
    if (FB.PLAYBOOK && FB.PLAYBOOK.offense && FB.PLAYBOOK.offense.length
        && FB.PLAYBOOK.defense && FB.PLAYBOOK.defense.length) return;
    FB.flashWarn && FB.flashWarn('Using stub playbook (playbook.js did not load)');
    const R = (dx, dz) => [{ dx: 2, dz: 0 }, { dx: dx, dz: dz }];
    const offStub = [
      { id: 'stub_slant',   name: 'Slant Right',    type: 'pass', formation: 'spread',
        routes: { WR1: R(8, -5), WR2: R(8, 5), TE: R(6, 2), RB: R(3, -3) },
        notes: 'Quick slant.' },
      { id: 'stub_go',      name: 'Four Verticals', type: 'pass', formation: 'spread',
        routes: { WR1: R(20, -6), WR2: R(20, 6), TE: R(15, 2), RB: R(4, -2) },
        notes: 'Send them deep.' },
      { id: 'stub_screen',  name: 'Screen Left',    type: 'pass', formation: 'spread',
        routes: { WR1: R(2, -6), WR2: R(2, 6), TE: R(4, 0), RB: R(1, -4) },
        notes: 'RB screen.' },
      { id: 'stub_dive',    name: 'Dive Up Middle', type: 'run',  formation: 'iform',
        routes: { RB: R(6, 0) }, notes: 'Power run.' },
      { id: 'stub_sweep',   name: 'Outside Sweep',  type: 'run',  formation: 'iform',
        routes: { RB: R(5, 8) }, notes: 'Pitch and run.' },
      { id: 'stub_draw',    name: 'QB Draw',        type: 'run',  formation: 'shotgun',
        routes: { RB: R(4, 1) }, notes: 'Late handoff draw.' },
    ];
    const defStub = [
      { id: 'stub_cover2', name: 'Cover 2 Zone',  formation: '4-3',
        assignments: { LE:{type:'rush'}, DT:{type:'rush'}, NT:{type:'rush'}, RE:{type:'rush'},
          MLB:{type:'zone',depth:6,lateral:0}, WLB:{type:'zone',depth:6,lateral:-5}, SLB:{type:'zone',depth:6,lateral:5},
          LCB:{type:'zone',depth:6,lateral:-12}, RCB:{type:'zone',depth:6,lateral:12},
          FS:{type:'zone',depth:14,lateral:-6}, SS:{type:'zone',depth:14,lateral:6} },
        notes: 'Soft zone.' },
      { id: 'stub_blitz',  name: 'MLB Blitz',     formation: '4-3',
        assignments: { LE:{type:'rush'}, DT:{type:'rush'}, NT:{type:'rush'}, RE:{type:'rush'},
          MLB:{type:'rush'}, WLB:{type:'zone',depth:6,lateral:-5}, SLB:{type:'zone',depth:6,lateral:5},
          LCB:{type:'man',target:'WR1'}, RCB:{type:'man',target:'WR2'},
          FS:{type:'zone',depth:14,lateral:0}, SS:{type:'man',target:'TE'} },
        notes: 'Send the mike.' },
      { id: 'stub_man',    name: 'Man Press',     formation: '4-3',
        assignments: { LE:{type:'rush'}, DT:{type:'rush'}, NT:{type:'rush'}, RE:{type:'rush'},
          MLB:{type:'man',target:'RB'}, WLB:{type:'man',target:'TE'}, SLB:{type:'zone',depth:6,lateral:4},
          LCB:{type:'man',target:'WR1'}, RCB:{type:'man',target:'WR2'},
          FS:{type:'zone',depth:12,lateral:0}, SS:{type:'man',target:'WR3'} },
        notes: 'Tight man coverage.' },
      { id: 'stub_nickel', name: 'Nickel Zone',   formation: 'nickel',
        assignments: { LE:{type:'rush'}, DT:{type:'rush'}, NT:{type:'rush'}, RE:{type:'rush'},
          MLB:{type:'zone',depth:5,lateral:0}, WLB:{type:'zone',depth:5,lateral:-6}, SLB:{type:'zone',depth:5,lateral:6},
          LCB:{type:'zone',depth:7,lateral:-12}, RCB:{type:'zone',depth:7,lateral:12},
          FS:{type:'zone',depth:13,lateral:-5}, SS:{type:'zone',depth:13,lateral:5} },
        notes: 'Nickel zone.' },
      { id: 'stub_goal',   name: 'Goal Line',     formation: 'goal-line',
        assignments: { LE:{type:'rush'}, DT:{type:'rush'}, NT:{type:'rush'}, RE:{type:'rush'},
          MLB:{type:'rush'}, WLB:{type:'rush'}, SLB:{type:'rush'},
          LCB:{type:'man',target:'WR1'}, RCB:{type:'man',target:'WR2'},
          FS:{type:'zone',depth:6,lateral:0}, SS:{type:'rush'} },
        notes: 'Stop the run.' },
      { id: 'stub_prevent',name: 'Prevent',       formation: 'dime',
        assignments: { LE:{type:'rush'}, DT:{type:'rush'}, NT:{type:'zone',depth:8,lateral:0}, RE:{type:'rush'},
          MLB:{type:'zone',depth:10,lateral:0}, WLB:{type:'zone',depth:10,lateral:-8}, SLB:{type:'zone',depth:10,lateral:8},
          LCB:{type:'zone',depth:14,lateral:-14}, RCB:{type:'zone',depth:14,lateral:14},
          FS:{type:'zone',depth:20,lateral:-7}, SS:{type:'zone',depth:20,lateral:7} },
        notes: 'Deep soft zone.' },
    ];
    FB.PLAYBOOK = FB.PLAYBOOK || {};
    FB.PLAYBOOK.offense = FB.PLAYBOOK.offense && FB.PLAYBOOK.offense.length ? FB.PLAYBOOK.offense : offStub;
    FB.PLAYBOOK.defense = FB.PLAYBOOK.defense && FB.PLAYBOOK.defense.length ? FB.PLAYBOOK.defense : defStub;
    if (typeof FB.pickAIPlay !== 'function') {
      FB.pickAIPlay = (side) => {
        const l = FB.PLAYBOOK[side] || [];
        return l[Math.floor(Math.random() * l.length)] || l[0] || null;
      };
    }
    if (typeof FB.expandRoute !== 'function') {
      FB.expandRoute = (waypoints, startPos, dir) => {
        if (!waypoints || !waypoints.length) return [];
        return waypoints.map(w => new THREE.Vector3(startPos.x + w.dx * dir, 0, startPos.z + w.dz));
      };
    }
  }

  FB.openPlayPicker = function (side, cb) {
    // Surface the picker modal first so a render error below can't hide it.
    const modal = document.getElementById('playPicker');
    if (modal) modal.classList.remove('hidden');
    ppSide = side || (userIsOffense() ? 'offense' : 'defense');
    ppCallback = cb || null;
    try {
      ensurePlaybook();
      const titleEl = document.getElementById('playPickerTitle');
      if (titleEl) titleEl.textContent = ppSide === 'offense' ? 'PICK AN OFFENSIVE PLAY' : 'PICK A DEFENSIVE PLAY';
      // Only the user's side of the ball is pickable — hide the opposite tab.
      document.querySelectorAll('.pp-tab').forEach(t => {
        const isUsersSide = t.dataset.pp === ppSide;
        t.classList.toggle('active', isUsersSide);
        t.style.display = isUsersSide ? '' : 'none';
      });
      // Fresh hand of 3 random plays every time the picker opens.
      ppHand[ppSide] = pickRandomHand(ppSide);
      FB.selectedPlay[ppSide] = ppHand[ppSide][0] || FB.PLAYBOOK[ppSide][0];
      renderPlayList();
    } catch (e) {
      FB.flashWarn && FB.flashWarn('Picker err: ' + (e && e.message ? e.message : e));
      // Emergency fallback: a minimal list of play names so the user can still confirm.
      try {
        const list = document.getElementById('playList');
        if (list && FB.PLAYBOOK && FB.PLAYBOOK[ppSide]) {
          list.innerHTML = '';
          const plays = FB.PLAYBOOK[ppSide].slice(0, 3);
          for (const p of plays) {
            const card = document.createElement('div');
            card.className = 'play-card' + (FB.selectedPlay[ppSide] && FB.selectedPlay[ppSide].id === p.id ? ' active' : '');
            card.innerHTML = '<div class="play-card-title">' + escapeHtml(p.name.toUpperCase()) + '</div>';
            card.addEventListener('click', () => { FB.selectedPlay[ppSide] = p; });
            list.appendChild(card);
          }
        }
      } catch (_) {}
    }
  };

  function renderPlayList() {
    const list = document.getElementById('playList');
    if (!list) return;
    list.innerHTML = '';
    const hand = (ppHand[ppSide] && ppHand[ppSide].length)
      ? ppHand[ppSide]
      : (FB.PLAYBOOK && FB.PLAYBOOK[ppSide] ? FB.PLAYBOOK[ppSide].slice(0, PP_HAND_SIZE) : []);
    ppHand[ppSide] = hand;
    for (const p of hand) {
      const card = document.createElement('div');
      card.className = 'play-card' + (FB.selectedPlay[ppSide] && FB.selectedPlay[ppSide].id === p.id ? ' active' : '');
      let diagram = '';
      try { diagram = buildPlayDiagramSVG(p, ppSide); }
      catch (e) {
        FB.flashWarn && FB.flashWarn('Diagram err: ' + (e && e.message ? e.message : e));
        diagram = '<div class="play-card-diagram-fallback">' + escapeHtml(p.notes || '') + '</div>';
      }
      card.innerHTML =
        '<div class="play-card-title">' + escapeHtml(p.name.toUpperCase()) + '</div>'
        + '<div class="play-card-diagram-wrap">' + diagram + '</div>';
      card.addEventListener('click', () => {
        FB.selectedPlay[ppSide] = p;
        renderPlayList();
      });
      list.appendChild(card);
    }
  }

  // Madden-style top-down play diagram: green field, LOS, player icons, and
  // colored route arrows (or defensive assignment arrows).
  const DIAG_W = 320, DIAG_H = 200;
  const CX = DIAG_W / 2;      // center x (middle of hash)
  const LOS_Y = 155;          // LOS baseline
  const SCALE_X = 5;          // px per lateral yard
  const SCALE_Y = 3.8;        // px per downfield yard
  const ROUTE_COLORS = { WR1: '#ff3838', WR2: '#ffd400', WR3: '#4cc9f0', TE: '#b8ff3d', RB: '#ff9a1f' };
  const WR_LETTER = { WR1: 'X', WR2: 'Z', WR3: 'H', TE: 'Y', RB: 'RB', QB: 'QB' };

  function fieldToSvg(spotX, spotZ) {
    // spotX is yard offset from LOS toward downfield (+); spotZ is lateral.
    return { x: CX + spotZ * SCALE_X, y: LOS_Y - spotX * SCALE_Y };
  }

  const ARROW_COLORS = [
    { id: 'red', fill: '#ff3838' }, { id: 'yellow', fill: '#ffd400' },
    { id: 'blue', fill: '#4cc9f0' }, { id: 'green', fill: '#b8ff3d' },
    { id: 'orange', fill: '#ff9a1f' }, { id: 'white', fill: '#ffffff' },
    { id: 'rush', fill: '#ff8a4c' },
  ];
  function colorToMarkerId(color) {
    switch (color) {
      case '#ff3838': return 'red';
      case '#ffd400': return 'yellow';
      case '#4cc9f0': return 'blue';
      case '#b8ff3d': return 'green';
      case '#ff9a1f': return 'orange';
      case '#ff8a4c': return 'rush';
      default: return 'white';
    }
  }

  function buildPlayDiagramSVG(play, side) {
    let body = '';
    body += '<defs>'
      + '<linearGradient id="pdFld" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#1f7236"/>'
      + '<stop offset="1" stop-color="#0a3517"/>'
      + '</linearGradient>';
    for (const c of ARROW_COLORS) {
      body += '<marker id="pd_' + c.id + '" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">'
        + '<path d="M0,0 L10,5 L0,10 z" fill="' + c.fill + '"/>'
        + '</marker>';
    }
    body += '</defs>';
    body += '<rect x="0" y="0" width="' + DIAG_W + '" height="' + DIAG_H + '" fill="url(#pdFld)"/>';
    // Yard lines (horizontal stripes, ~every 5 yards downfield)
    for (let yd = -5; yd <= 30; yd += 5) {
      const y = LOS_Y - yd * SCALE_Y;
      if (y < 0 || y > DIAG_H) continue;
      const op = yd === 0 ? 0.95 : 0.3;
      const w = yd === 0 ? 1.5 : 0.7;
      body += '<line x1="0" y1="' + y + '" x2="' + DIAG_W + '" y2="' + y + '" stroke="#ffffff" stroke-opacity="' + op + '" stroke-width="' + w + '"/>';
    }
    // Hash ticks along the midfield (vertical accents)
    for (const hx of [-6, 6]) {
      for (let yd = -5; yd <= 30; yd += 1) {
        const y = LOS_Y - yd * SCALE_Y;
        if (y < 0 || y > DIAG_H) continue;
        const x = CX + hx * SCALE_X;
        body += '<line x1="' + (x - 1) + '" y1="' + y + '" x2="' + (x + 1) + '" y2="' + y + '" stroke="#ffffff" stroke-opacity="0.5" stroke-width="0.5"/>';
      }
    }

    if (side === 'offense' || play.routes || play.ballTo) {
      body += drawOffense(play);
    } else {
      body += drawDefense(play);
    }
    return '<svg class="play-card-diagram" viewBox="0 0 ' + DIAG_W + ' ' + DIAG_H + '" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
  }

  // Mirror of FB.offenseFormation but in diagram-space.
  function formationSpots() {
    return [
      { slot: 'LT', dx: -0.3, dz: -4 },
      { slot: 'LG', dx: -0.3, dz: -2 },
      { slot: 'C',  dx: -0.3, dz:  0 },
      { slot: 'RG', dx: -0.3, dz:  2 },
      { slot: 'RT', dx: -0.3, dz:  4 },
      { slot: 'QB', dx: -5,   dz:  0 },
      { slot: 'RB', dx: -5,   dz: -2.5 },
      { slot: 'TE', dx: -0.3, dz:  6 },
      { slot: 'WR1',dx: -0.3, dz: -18 },
      { slot: 'WR2',dx: -0.3, dz:  18 },
      { slot: 'WR3',dx: -2,   dz: -12 },
    ];
  }

  function drawOffense(play) {
    let out = '';
    const spots = formationSpots();
    const routes = play.routes || {};
    const isRun = play.type === 'run';
    // O-line and any skill position without a route gets a small "BLK" tick
    // on run plays so the diagram still shows everyone's job.
    if (isRun) {
      for (const sp of spots) {
        if (routes[sp.slot] && routes[sp.slot].length) continue;
        if (sp.slot === 'QB' && play.ballTo === 'QB') continue;
        const p = fieldToSvg(sp.dx, sp.dz);
        // Short forward stem indicating a block / run-blocking engage.
        const end = fieldToSvg(sp.dx + 1.2, sp.dz);
        out += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + end.x + '" y2="' + end.y + '" stroke="#e0e6ef" stroke-opacity="0.55" stroke-width="1.4" stroke-linecap="round"/>';
      }
    }
    // Draw routes (ball carrier's route gets heavier stroke for runs).
    for (const sp of spots) {
      const rt = routes[sp.slot];
      if (!rt || !rt.length) continue;
      const isCarrier = isRun && (play.ballTo ? sp.slot === play.ballTo : sp.slot === 'RB');
      const color = isCarrier ? '#ff9a1f' : (ROUTE_COLORS[sp.slot] || '#ffffff');
      const width = isCarrier ? 3.6 : 2.6;
      const start = fieldToSvg(sp.dx, sp.dz);
      let pts = start.x + ',' + start.y;
      for (const w of rt) {
        const p = fieldToSvg(sp.dx + w.dx, sp.dz + w.dz);
        pts += ' ' + p.x + ',' + p.y;
      }
      out += '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#pd_' + colorToMarkerId(color) + ')"/>';
    }
    // Ball-to arrow for runs without a route (like QB sneak).
    if (isRun && play.ballTo === 'QB' && !routes['QB']) {
      const start = fieldToSvg(-5, 0);
      const end = fieldToSvg(2, 0);
      out += '<line x1="' + start.x + '" y1="' + start.y + '" x2="' + end.x + '" y2="' + end.y + '" stroke="#ff9a1f" stroke-width="3.6" stroke-linecap="round" marker-end="url(#pd_orange)"/>';
    }
    // Handoff tick from QB to ball carrier for run plays.
    if (isRun && play.ballTo && play.ballTo !== 'QB') {
      const qbSp = spots.find(s => s.slot === 'QB');
      const bcSp = spots.find(s => s.slot === play.ballTo) || spots.find(s => s.slot === 'RB');
      if (qbSp && bcSp) {
        const a = fieldToSvg(qbSp.dx, qbSp.dz);
        const b = fieldToSvg(bcSp.dx, bcSp.dz);
        out += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#ffd400" stroke-width="1.6" stroke-dasharray="3 3" stroke-linecap="round"/>';
      }
    }
    // Draw player chips on top.
    for (const sp of spots) {
      const p = fieldToSvg(sp.dx, sp.dz);
      if (['LT','LG','C','RG','RT'].includes(sp.slot)) {
        // O-line: white square
        out += '<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="8" height="8" fill="#f0f0f0" stroke="#222" stroke-width="0.8"/>';
      } else {
        // Skill: black circle with letter
        const letter = WR_LETTER[sp.slot] || sp.slot;
        out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="6.5" fill="#111" stroke="#fff" stroke-width="0.8"/>';
        out += '<text x="' + p.x + '" y="' + (p.y + 2.6) + '" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="' + (letter.length > 1 ? 5.5 : 7.5) + '" font-weight="700" fill="#ffffff">' + letter + '</text>';
      }
    }
    return out;
  }

  function drawDefense(play) {
    // Defense layout: 4 DL at +1yd, 3 LB at +5yd, 2 CB wide at +2yd, 2 S deep at +12yd.
    const spots = [
      { slot: 'LE', dx: 1, dz: -5 }, { slot: 'DT', dx: 1, dz: -1.5 },
      { slot: 'NT', dx: 1, dz:  1.5 },{ slot: 'RE', dx: 1, dz: 5 },
      { slot: 'WLB',dx: 5, dz: -7 }, { slot: 'MLB', dx: 5, dz: 0 },
      { slot: 'SLB',dx: 5, dz:  7 },
      { slot: 'LCB',dx: 3, dz: -18 },{ slot: 'RCB', dx: 3, dz: 18 },
      { slot: 'FS', dx: 13, dz: -6 },{ slot: 'SS',  dx: 13, dz: 8 },
    ];
    const assign = play.assignments || {};
    // O-line reference (dim white squares) to orient the defensive diagram.
    const oline = [{ dz: -4 }, { dz: -2 }, { dz: 0 }, { dz: 2 }, { dz: 4 }];
    let out = '';
    for (const o of oline) {
      const p = fieldToSvg(-0.3, o.dz);
      out += '<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="8" height="8" fill="#f0f0f0" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.4" stroke-width="0.6"/>';
    }
    // QB reference.
    const qb = fieldToSvg(-5, 0);
    out += '<circle cx="' + qb.x + '" cy="' + qb.y + '" r="5" fill="#ffffff" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.4"/>';

    // Draw assignment indicators first (behind chips).
    for (const sp of spots) {
      const a = assign[sp.slot];
      if (!a) continue;
      const p = fieldToSvg(sp.dx, sp.dz);
      if (a.type === 'rush' || a.type === 'blitz') {
        const color = a.type === 'blitz' ? '#ff3838' : '#ff8a4c';
        const mk = a.type === 'blitz' ? 'red' : 'rush';
        const tgt = fieldToSvg(-4, sp.dz * 0.3);
        out += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + tgt.x + '" y2="' + tgt.y + '" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" marker-end="url(#pd_' + mk + ')"/>';
      } else if (a.type === 'zone') {
        const zx = CX + (a.lateral || 0) * SCALE_X;
        const zy = LOS_Y - (a.depth || 0) * SCALE_Y;
        out += '<circle cx="' + zx + '" cy="' + zy + '" r="10" fill="none" stroke="#4cc9f0" stroke-width="1.8" stroke-dasharray="3,2"/>';
        out += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + zx + '" y2="' + zy + '" stroke="#4cc9f0" stroke-width="1.4" stroke-opacity="0.7" stroke-dasharray="2,2"/>';
      } else if (a.type === 'man') {
        // Approximate man-target position from the formation.
        const targetsZ = { WR1: -18, WR2: 18, WR3: -12, TE: 6, RB: -2.5 };
        const tz = targetsZ[a.target] != null ? targetsZ[a.target] : 0;
        const tdx = a.target === 'RB' ? -5 : -0.3;
        const tgt = fieldToSvg(tdx, tz);
        out += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + tgt.x + '" y2="' + tgt.y + '" stroke="#b8ff3d" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#pd_green)"/>';
      }
    }
    // Defender chips: red circles with role letter.
    for (const sp of spots) {
      const p = fieldToSvg(sp.dx, sp.dz);
      out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="6.5" fill="#b22222" stroke="#ffffff" stroke-width="0.8"/>';
      out += '<text x="' + p.x + '" y="' + (p.y + 2.2) + '" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="5" font-weight="700" fill="#ffffff">' + sp.slot + '</text>';
    }
    return out;
  }

  // ---- Bootstrap ----
  const BUILD_TAG = 'BUILD-20260422a';
  function paintVersionTag() {
    try {
      const host = document.body;
      if (!host) return;
      const tag = document.createElement('div');
      tag.textContent = BUILD_TAG;
      tag.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;background:rgba(0,0,0,0.7);color:#4cc9f0;font:10px/1.2 monospace;padding:3px 6px;border-radius:4px;pointer-events:none;';
      host.appendChild(tag);
    } catch (_) {}
  }

  async function start() {
    paintVersionTag();
    // Install playbook stub immediately so nothing downstream crashes on it.
    try { ensurePlaybook(); } catch (_) {}
    try { await loadRosters(); }
    catch (e) { alert('Failed to load roster.json: ' + e.message); return; }
    renderPreGame();
    wireTeamPick();
    wirePlayPicker();
    document.getElementById('pgStart').addEventListener('click', startGame);
    wireTabs();
    document.getElementById('goShare').addEventListener('click', shareResult);
    document.getElementById('goRestart').addEventListener('click', () => location.reload());
    document.getElementById('logoHome').textContent = FB.teams.home.initial;
    document.getElementById('logoAway').textContent = FB.teams.away.initial;
  }

  function startGame() {
    FB.state.quarterLen = parseInt(document.getElementById('pgQuarterLen').value, 10) || 150;
    FB.state.clockSeconds = FB.state.quarterLen;
    FB.state.difficulty = document.getElementById('pgDifficulty').value || 'varsity';
    document.getElementById('preGame').classList.add('hidden');
    document.getElementById('gameHost').classList.remove('hidden');
    FB.initThree();
    FB.buildTeamMeshes('home');
    FB.buildTeamMeshes('away');
    FB.createBall();
    FB.initJoystick();
    FB.initButtons();
    // User's team receives the opening kickoff (they get to be on offense first).
    const other = FB.userTeam === 'home' ? 'away' : 'home';
    FB.state.possession = other;                // kicking team has possession at setup
    FB.state.homeRecv = FB.userTeam === 'home';
    FB.state.ballOn = 35; FB.state.los = 35; FB.state.down = 1; FB.state.distance = 10;
    FB.setupPlay('kickoff');
    FB.startLoop();
  }

  window.addEventListener('DOMContentLoaded', start);
})(window.FB);

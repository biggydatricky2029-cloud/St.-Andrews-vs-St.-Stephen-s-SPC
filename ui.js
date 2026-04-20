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

  function wirePlayPicker() {
    const tabs = document.querySelectorAll('.pp-tab');
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      ppSide = t.dataset.pp;
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
      const list = FB.PLAYBOOK[ppSide];
      FB.selectedPlay[ppSide] = list[Math.floor(Math.random() * list.length)];
      renderPlayList();
    });
    const btnHuddle = document.getElementById('btnHuddle');
    if (btnHuddle) btnHuddle.addEventListener('click', () => openPlayPicker(userIsOffense() ? 'offense' : 'defense', null));
  }

  function userIsOffense() {
    return FB.state.possession === FB.userTeam;
  }

  FB.openPlayPicker = function (side, cb) {
    ppSide = side || (userIsOffense() ? 'offense' : 'defense');
    ppCallback = cb || null;
    document.getElementById('playPickerTitle').textContent = side === 'offense' ? 'PICK AN OFFENSIVE PLAY' : 'PICK A DEFENSIVE PLAY';
    // Sync tabs
    document.querySelectorAll('.pp-tab').forEach(t => t.classList.toggle('active', t.dataset.pp === ppSide));
    if (!FB.selectedPlay[ppSide]) FB.selectedPlay[ppSide] = FB.PLAYBOOK[ppSide][0];
    renderPlayList();
    document.getElementById('playPicker').classList.remove('hidden');
  };

  function renderPlayList() {
    const list = document.getElementById('playList');
    list.innerHTML = '';
    const plays = FB.PLAYBOOK[ppSide];
    for (const p of plays) {
      const card = document.createElement('div');
      card.className = 'play-card' + (FB.selectedPlay[ppSide] && FB.selectedPlay[ppSide].id === p.id ? ' active' : '');
      card.innerHTML = '<div class="play-card-name">' + escapeHtml(p.name) + '</div>'
        + '<div class="play-card-type">' + (p.type || p.formation || '') + '</div>'
        + '<div class="play-card-notes">' + escapeHtml(p.notes || '') + '</div>';
      card.addEventListener('click', () => {
        FB.selectedPlay[ppSide] = p;
        renderPlayList();
      });
      list.appendChild(card);
    }
  }

  // ---- Bootstrap ----
  async function start() {
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

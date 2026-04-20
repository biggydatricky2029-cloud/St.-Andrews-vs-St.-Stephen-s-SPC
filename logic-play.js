// logic-play.js — setup, snap, handoff, pass, juke, tackle, endPlay.
(function (FB) {
  'use strict';

  // Initialize a new play at current line of scrimmage.
  FB.setupPlay = function (playType) {
    const s = FB.state;
    s.phase = 'presnap';
    s.playType = playType || 'pass';
    FB.hideAllPlayers();
    const losX = FB.ballXFromYard(s.ballOn, s.possession);
    FB.losLine.position.x = losX;
    const fdYard = Math.min(100, s.ballOn + s.distance);
    FB.firstDownLine.position.x = FB.ballXFromYard(fdYard, s.possession);

    if (playType === 'kickoff') {
      setupKickoff();
    } else if (playType === 'punt') {
      setupPunt();
    } else if (playType === 'fg' || playType === 'xp') {
      setupFG(playType === 'xp');
    } else {
      // Pick plays: user picks one side, AI picks the other.
      const userOff = s.possession === FB.userTeam;
      if (userOff) {
        FB.selectedPlay.defense = FB.pickAIPlay('defense');
        FB.openPlayPicker('offense', () => finalizePlaySetup(losX));
        return; // finalize when user confirms
      } else {
        FB.selectedPlay.offense = FB.pickAIPlay('offense');
        FB.openPlayPicker('defense', () => finalizePlaySetup(losX));
        return;
      }
    }
    FB.updateButtonStates && FB.updateButtonStates();
    FB.updateHUD && FB.updateHUD();
  };

  function finalizePlaySetup(losX) {
    const s = FB.state;
    const defTeam = s.possession === 'home' ? 'away' : 'home';
    // Adapt playType to chosen offensive play.
    const off = FB.selectedPlay.offense || FB.PLAYBOOK.offense[0];
    s.playType = off.type === 'run' ? 'run' : 'pass';
    FB.spawnOffense(s.possession, losX);
    FB.spawnDefense(defTeam, losX);
    FB.attachBallTo(FB.qb);
    FB.ball.position.copy(FB.qb.mesh.position).add(new THREE.Vector3(0, 2.2, 0.3));

    // Expand routes onto each offense entity (relative to snap position).
    applyOffensiveRoutes(off);
    // Store defense assignments (slot -> assignment).
    const def = FB.selectedPlay.defense || FB.PLAYBOOK.defense[0];
    applyDefensiveAssignments(def);

    if (defTeam === FB.userTeam) {
      FB.userDefender = FB.getStarter(defTeam, 'MLB') || FB.defendersOf(s.possession)[0] || null;
      // AI offense snaps itself shortly after.
      setTimeout(() => { if (FB.state.phase === 'presnap') FB.snapBall(); }, 1400);
    } else {
      FB.userDefender = null;
    }

    FB.updateButtonStates && FB.updateButtonStates();
    FB.updateHUD && FB.updateHUD();
  }

  function applyOffensiveRoutes(off) {
    const dir = FB.forwardDir(FB.state.possession);
    for (const e of FB.offenseOf(FB.state.possession)) {
      const rt = off.routes && off.routes[e.role];
      if (rt && rt.length) {
        e.route = FB.expandRoute(rt, e.mesh.position, dir);
        e.routeIdx = 0;
      } else {
        e.route = null;
      }
    }
  }
  function applyDefensiveAssignments(def) {
    const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
    for (const e of FB.activePlayers[defTeam]) {
      if (!e.mesh.visible) continue;
      e.assignment = (def.assignments && def.assignments[e.role]) || { type: 'rush' };
    }
  }

  FB.snapBall = function () {
    const s = FB.state;
    if (s.phase !== 'presnap') return;
    s.phase = 'play';
    FB.playTicker = 0;
    for (const e of FB.offenseOf(s.possession)) e.target.set(0, 0, 0);
    if (s.playType === 'run') {
      setTimeout(() => FB.handoffToRB(), 80);
    } else if (s.possession !== FB.userTeam) {
      // AI QB: throw after 1.6–2.4s to the most open receiver.
      const delay = 1600 + Math.random() * 800;
      setTimeout(() => aiThrow(), delay);
    }
    FB.updateButtonStates && FB.updateButtonStates();
  };

  function aiThrow() {
    if (FB.state.phase !== 'play' || FB.ballCarrier !== FB.qb) return;
    const rcvs = FB.visibleReceivers(FB.state.possession);
    if (!rcvs.length) return;
    // Score by separation from nearest defender (simple AI reads).
    const opp = FB.state.possession === 'home' ? 'away' : 'home';
    let best = rcvs[0], bestSep = -1;
    for (const r of rcvs) {
      const near = FB.nearestDefender(r.mesh.position, FB.state.possession);
      const sep = near.dist || 0;
      if (sep > bestSep) { bestSep = sep; best = r; }
    }
    FB.throwPass(best);
  }

  FB.handoffToRB = function () {
    const s = FB.state;
    const rb = FB.getStarter(s.possession, 'RB');
    if (rb) FB.attachBallTo(rb);
  };

  // QB throws to chosen receiver (lead pass).
  FB.throwPass = function (receiver) {
    if (!receiver || !FB.qb || FB.ballCarrier !== FB.qb) return;
    const dir = FB.forwardDir(FB.state.possession);
    const from = FB.ball.position.clone();
    const lead = receiver.vel.clone().multiplyScalar(0.6);
    const tgt = receiver.mesh.position.clone().add(lead).add(new THREE.Vector3(0, 2, 0));
    const dist = from.distanceTo(tgt);
    const flight = Math.max(0.6, dist / 22);
    FB.ballState.carried = false;
    FB.ballState.inAir = true;
    FB.ballState.airTime = 0;
    FB.ballState.kind = 'pass';
    FB.ballState.targetPlayer = receiver;
    FB.ballCarrier = null;
    FB.ballState.vel.set((tgt.x - from.x) / flight, (tgt.y - from.y) / flight + 0.5 * 9.8 * flight, (tgt.z - from.z) / flight);
    FB.state.log.push('Pass thrown to #' + receiver.player.number);
  };

  // Receiver-picker UI
  FB.showReceiverPicker = function () {
    const picker = document.getElementById('receiverPicker');
    picker.innerHTML = '';
    const rcvs = FB.visibleReceivers(FB.state.possession).slice(0, 3);
    if (rcvs.length === 0) { picker.classList.add('hidden'); return; }
    for (const r of rcvs) {
      const btn = document.createElement('button');
      btn.className = 'rcv-btn';
      btn.textContent = '#' + r.player.number + ' ' + r.role;
      btn.addEventListener('click', () => { FB.throwPass(r); picker.classList.add('hidden'); });
      picker.appendChild(btn);
    }
    picker.classList.remove('hidden');
    setTimeout(() => picker.classList.add('hidden'), 3500);
  };

  FB.onPassCaught = function (rcv) {
    FB.attachBallTo(rcv);
    FB.state.log.push('Caught by #' + rcv.player.number);
  };

  // Juke — attempt to break the nearest defender's tackle.
  FB.tryJuke = function () {
    const bc = FB.ballCarrier;
    if (!bc || bc.jukeCooldown > 0 || bc.stamina < 15) return;
    const near = FB.nearestDefender(bc.mesh.position, bc.team);
    if (!near.def || near.dist > 3) return;
    const ratingGap = (bc.rating - near.def.rating) / 100;
    const chance = Math.max(0.15, Math.min(0.85, 0.3 + ratingGap + (Math.random() - 0.5) * 0.1));
    bc.stamina = Math.max(0, bc.stamina - 15);
    bc.jukeCooldown = 2.5;
    if (Math.random() < chance) {
      // Defender "misses": push defender sideways and briefly knock them down.
      near.def.isDown = true;
      near.def.mesh.rotation.x = -Math.PI / 4;
      setTimeout(() => { if (near.def) { near.def.isDown = false; near.def.mesh.rotation.x = 0; } }, 900);
      // Lateral boost for carrier
      const lat = new THREE.Vector3(0, 0, near.def.mesh.position.z > bc.mesh.position.z ? -2 : 2);
      bc.mesh.position.add(lat);
      FB.state.log.push('#' + bc.player.number + ' breaks the tackle!');
      FB.playCam.shake = 0.25;
    } else {
      FB.attemptTackle(near.def, bc, true);
    }
  };

  FB.attemptTackle = function (def, carrier, forceSuccess) {
    if (!carrier || carrier.isDown) return;
    carrier.isDown = true;
    FB.playCam.shake = 0.4;
    FB.state.log.push('Tackle by #' + def.player.number);
    recordStat(carrier.team === 'home' ? 'home' : 'away', def.player.number, 'tackles', 1, def.team);
    setTimeout(() => FB.endPlay({ reason: 'tackle' }), 150);
  };

  // Track in-game stats.
  function recordStat(whichTeamKey, num, key, val, defTeamKey) {
    const tk = defTeamKey || whichTeamKey;
    const s = FB.state.gameStats[tk];
    if (!s[num]) s[num] = {};
    s[num][key] = (s[num][key] || 0) + val;
  }
  FB.recordStat = recordStat;

  // End play and spot the ball.
  FB.endPlay = function (opts) {
    const s = FB.state;
    if (s.phase === 'deadball' || s.phase === 'gameover') return;
    s.phase = 'deadball';
    let gain = 0;
    let newBallOn = s.ballOn;

    if (FB.ballCarrier) {
      const yardNow = FB.yardFromBallX(FB.ballCarrier.mesh.position.x, s.possession);
      gain = Math.round(yardNow - s.los);
      newBallOn = Math.max(1, Math.min(99, Math.round(yardNow)));
      recordRushReceiveStats(FB.ballCarrier, gain);
      if (yardNow >= 100) {
        FB.scoreTouchdown();
        return;
      }
    } else {
      // Incomplete pass
      gain = 0; newBallOn = s.ballOn;
      FB.state.log.push('Incomplete.');
    }

    s.ballOn = newBallOn;
    FB.advanceDown(gain);
  };

  function recordRushReceiveStats(bc, gain) {
    const s = FB.state;
    const team = s.possession;
    if (bc.role === 'QB') {
      FB.recordStat(team, bc.player.number, 'rushingYards', gain);
      FB.recordStat(team, bc.player.number, 'carries', 1);
    } else if (['WR1','WR2','WR3','TE'].includes(bc.role)) {
      FB.recordStat(team, bc.player.number, 'receivingYards', gain);
      FB.recordStat(team, bc.player.number, 'receptions', 1);
    } else if (bc.role === 'RB') {
      FB.recordStat(team, bc.player.number, 'rushingYards', gain);
      FB.recordStat(team, bc.player.number, 'carries', 1);
    }
  }

  // Stubs forwarded from controls.js / buttons.
  FB.onJuke = () => FB.tryJuke();
  FB.onDive = () => { if (FB.ballCarrier) { FB.ballCarrier.isDown = true; FB.endPlay({ reason: 'dive' }); } };

  // Set up placeholders for special teams (implemented in logic-special.js).
  function setupKickoff() { FB.setupKickoff && FB.setupKickoff(); }
  function setupPunt() { FB.setupPunt && FB.setupPunt(); }
  function setupFG(isXP) { FB.setupFG && FB.setupFG(isXP); }

})(window.FB);

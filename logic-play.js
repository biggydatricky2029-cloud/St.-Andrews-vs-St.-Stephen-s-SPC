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
      const pickAI = (side) => {
        try { if (typeof FB.pickAIPlay === 'function') return FB.pickAIPlay(side); }
        catch (_) {}
        const list = (FB.PLAYBOOK && FB.PLAYBOOK[side]) || [];
        return list[Math.floor(Math.random() * list.length)] || list[0] || null;
      };
      const openPicker = (side) => {
        if (typeof FB.openPlayPicker === 'function') {
          FB.openPlayPicker(side, () => finalizePlaySetup(losX));
        } else {
          // No picker available — use current selections and spawn.
          finalizePlaySetup(losX);
        }
      };
      try {
        if (userOff) {
          FB.selectedPlay.defense = pickAI('defense') || FB.selectedPlay.defense || (FB.PLAYBOOK && FB.PLAYBOOK.defense && FB.PLAYBOOK.defense[0]);
          openPicker('offense');
        } else {
          FB.selectedPlay.offense = pickAI('offense') || FB.selectedPlay.offense || (FB.PLAYBOOK && FB.PLAYBOOK.offense && FB.PLAYBOOK.offense[0]);
          openPicker('defense');
        }
      } catch (e) {
        FB.flashWarn && FB.flashWarn('setupPlay err: ' + (e && e.message ? e.message : e));
        // Last-resort: skip the picker and spawn with defaults so the game keeps going.
        if (!FB.selectedPlay.offense) FB.selectedPlay.offense = FB.PLAYBOOK && FB.PLAYBOOK.offense && FB.PLAYBOOK.offense[0];
        if (!FB.selectedPlay.defense) FB.selectedPlay.defense = FB.PLAYBOOK && FB.PLAYBOOK.defense && FB.PLAYBOOK.defense[0];
        finalizePlaySetup(losX);
      }
      return; // finalize when user confirms (or via fallback above)
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
    if (!FB.qb) {
      FB.flashWarn && FB.flashWarn('No QB found for ' + s.possession);
      return;
    }
    FB.attachBallTo(FB.qb);
    FB.ball.position.copy(FB.qb.mesh.position).add(new THREE.Vector3(0, FB.qb.carryY || 2.2, 0.3));

    // Expand routes onto each offense entity (relative to snap position).
    applyOffensiveRoutes(off);
    // Store defense assignments (slot -> assignment).
    const def = FB.selectedPlay.defense || FB.PLAYBOOK.defense[0];
    applyDefensiveAssignments(def);

    // Run the 11v11 onto the field from their sidelines before allowing the snap.
    FB.startRunOn && FB.startRunOn(s.possession, defTeam, () => {
      if (defTeam === FB.userTeam) {
        FB.userDefender = FB.getStarter(defTeam, 'MLB') || FB.defendersOf(s.possession)[0] || null;
        // AI offense snaps itself shortly after run-on finishes.
        setTimeout(() => { if (FB.state.phase === 'presnap') FB.snapBall(); }, 900);
      } else {
        FB.userDefender = null;
      }
      FB.updateButtonStates && FB.updateButtonStates();
      FB.updateHUD && FB.updateHUD();
    });

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
      e.blockedTime = 0;
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
    } else if (s.playType === 'pass') {
      // User is on offense for a pass play — show numbered receiver chips.
      FB.showReceiverChips && FB.showReceiverChips();
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

  // QB throws to chosen receiver.
  // passType: 'lob' (default) = slower, higher arc; 'bullet' = fast, flatter.
  // The ball is aimed at the receiver's hands (chest height) at the receiver's
  // predicted position when the ball arrives, so the catch just works.
  FB.throwPass = function (receiver, passType) {
    if (!receiver || !FB.qb || FB.ballCarrier !== FB.qb) return;
    const type = passType === 'bullet' ? 'bullet' : 'lob';
    const speed = type === 'bullet' ? 36 : 22;    // horizontal m/s
    const catchY = 2.1;                           // receiver's hand height
    const from = FB.ball.position.clone();

    // Iterate a few times to converge on a lead that matches the ball's
    // actual flight time at current horizontal speed.
    let tgt = receiver.mesh.position.clone().add(new THREE.Vector3(0, catchY, 0));
    for (let i = 0; i < 3; i++) {
      const dxy = Math.hypot(tgt.x - from.x, tgt.z - from.z);
      const flightGuess = Math.max(0.25, dxy / speed);
      tgt.copy(receiver.mesh.position)
         .add(receiver.vel.clone().multiplyScalar(flightGuess))
         .add(new THREE.Vector3(0, catchY, 0));
    }
    const dxy = Math.hypot(tgt.x - from.x, tgt.z - from.z);
    const flight = Math.max(0.25, dxy / speed);

    FB.ballState.carried = false;
    FB.ballState.inAir = true;
    FB.ballState.airTime = 0;
    FB.ballState.kind = 'pass';
    FB.ballState.targetPlayer = receiver;
    FB.ballState.aimXZ = { x: tgt.x, z: tgt.z };
    FB.ballCarrier = null;
    // Vertical solve: y(t) = from.y + vy*t - 0.5*g*t^2; want y(flight)=tgt.y
    const g = 9.8;
    FB.ballState.vel.set(
      (tgt.x - from.x) / flight,
      (tgt.y - from.y) / flight + 0.5 * g * flight,
      (tgt.z - from.z) / flight
    );
    FB.state.log.push((type === 'bullet' ? 'Bullet' : 'Lob') + ' pass to #' + receiver.player.number);
    FB.clearReceiverChips && FB.clearReceiverChips();
  };

  // ---- Receiver chips (world-anchored circles above eligible receivers) ----
  // Tap = lob; hold (>=250ms) = bullet.
  let chipContainer = null;
  let chips = []; // { el, receiver }
  const HOLD_MS = 250;

  function ensureChipContainer() {
    if (chipContainer && chipContainer.isConnected) return chipContainer;
    chipContainer = document.getElementById('rcvChips');
    if (!chipContainer) {
      chipContainer = document.createElement('div');
      chipContainer.id = 'rcvChips';
      chipContainer.className = 'rcv-chips';
      const host = document.getElementById('gameHost') || document.body;
      host.appendChild(chipContainer);
    }
    return chipContainer;
  }

  FB.showReceiverChips = function () {
    FB.clearReceiverChips();
    const container = ensureChipContainer();
    const rcvs = FB.visibleReceivers(FB.state.possession);
    for (const r of rcvs) {
      const el = document.createElement('div');
      el.className = 'rcv-chip';
      el.textContent = '#' + r.player.number;

      let holdTimer = null;
      let holding = false;
      let engaged = false;

      const onDown = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (FB.state.phase !== 'play' || FB.ballCarrier !== FB.qb) return;
        engaged = true;
        holding = false;
        el.classList.add('pressed');
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          if (engaged) { holding = true; el.classList.add('hold'); }
        }, HOLD_MS);
      };
      const onUp = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!engaged) return;
        engaged = false;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        el.classList.remove('pressed');
        el.classList.remove('hold');
        if (FB.state.phase !== 'play' || FB.ballCarrier !== FB.qb) return;
        FB.throwPass(r, holding ? 'bullet' : 'lob');
        holding = false;
      };
      const onCancel = () => {
        engaged = false;
        holding = false;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        el.classList.remove('pressed');
        el.classList.remove('hold');
      };

      el.addEventListener('touchstart', onDown, { passive: false });
      el.addEventListener('touchend', onUp, { passive: false });
      el.addEventListener('touchcancel', onCancel, { passive: false });
      el.addEventListener('mousedown', onDown);
      el.addEventListener('mouseup', onUp);
      el.addEventListener('mouseleave', onCancel);

      container.appendChild(el);
      chips.push({ el, receiver: r });
    }
  };

  FB.clearReceiverChips = function () {
    chips = [];
    if (chipContainer) chipContainer.innerHTML = '';
  };

  FB.updateReceiverChips = function () {
    if (!chips.length || !FB.camera) return;
    const s = FB.state;
    const active = s.phase === 'play' && FB.ballCarrier === FB.qb && s.possession === FB.userTeam;
    if (!active) { FB.clearReceiverChips(); return; }
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    for (const c of chips) {
      const r = c.receiver;
      if (!r || !r.mesh || !r.mesh.visible || r.isDown) { c.el.style.display = 'none'; continue; }
      v.set(r.mesh.position.x, (r.mesh.position.y || 0) + 3.4, r.mesh.position.z);
      v.project(FB.camera);
      if (v.z < -1 || v.z > 1) { c.el.style.display = 'none'; continue; }
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (1 - (v.y * 0.5 + 0.5)) * h;
      c.el.style.display = '';
      c.el.style.left = sx + 'px';
      c.el.style.top = sy + 'px';
    }
  };

  // Legacy: PASS button falls through to the chip system.
  FB.showReceiverPicker = function () {
    if (FB.state.phase !== 'play' || FB.ballCarrier !== FB.qb) return;
    if (!chips.length) FB.showReceiverChips();
  };

  FB.onPassCaught = function (rcv) {
    FB.attachBallTo(rcv);
    FB.state.log.push('Caught by #' + rcv.player.number);
    FB.clearReceiverChips && FB.clearReceiverChips();
  };

  // Four-move juke system — AI picks the best move given the defender's
  // position and the carrier/defender size matchup:
  //   spinRight / spinLeft — pivot away from the defender
  //   truck                — lower shoulder, run through
  //   stiffArm             — extend arm into the defender's helmet
  FB.tryJuke = function () {
    const bc = FB.ballCarrier;
    if (!bc || bc.jukeCooldown > 0 || bc.stamina < 15) return;
    const near = FB.nearestDefender(bc.mesh.position, bc.team);
    if (!near.def || near.dist > 3.2) return;

    const dir = FB.forwardDir(bc.team);
    const relZ = near.def.mesh.position.z - bc.mesh.position.z;
    const relX = (near.def.mesh.position.x - bc.mesh.position.x) * dir; // +ve = defender is in front
    const weightAdv = (bc.weightLb || 200) - (near.def.weightLb || 200);
    const ratingGap = (bc.rating - near.def.rating) / 100;

    // Pick best move based on geometry + size matchup.
    let move;
    if (Math.abs(relZ) < 1.2 && relX > 0 && weightAdv > 10) {
      move = 'truck';
    } else if (Math.abs(relZ) < 1.8 && relX > -0.5) {
      move = 'stiffArm';
    } else if (relZ < 0) {
      move = 'spinRight'; // defender to the left — spin right to escape
    } else {
      move = 'spinLeft';
    }

    // Move-specific success bias.
    const moveBonus = move === 'truck' ? Math.max(0, weightAdv) / 120
                    : move === 'stiffArm' ? 0.15
                    : 0.2; // spins are reliable when the space is there
    const chance = Math.max(0.2, Math.min(0.92, 0.35 + ratingGap + moveBonus + (Math.random() - 0.5) * 0.1));

    bc.stamina = Math.max(0, bc.stamina - 14);
    bc.jukeCooldown = 2.2;

    const success = Math.random() < chance;
    startJukeAnim(bc, near.def, move, success);

    if (success) {
      // Lateral/forward kick depends on the move.
      const latSign = relZ > 0 ? -1 : 1;
      if (move === 'spinRight') bc.mesh.position.add(new THREE.Vector3(0, 0, 1.6));
      else if (move === 'spinLeft') bc.mesh.position.add(new THREE.Vector3(0, 0, -1.6));
      else if (move === 'truck') bc.mesh.position.add(new THREE.Vector3(dir * 1.4, 0, 0));
      else bc.mesh.position.add(new THREE.Vector3(0, 0, latSign * 1.3));

      // Defender reacts.
      near.def.isDown = true;
      const fall = move === 'truck' ? Math.PI / 3 : (move === 'stiffArm' ? Math.PI / 6 : Math.PI / 4);
      near.def.mesh.rotation.x = -fall;
      setTimeout(() => { if (near.def) { near.def.isDown = false; near.def.mesh.rotation.x = 0; } },
                 move === 'truck' ? 1100 : 900);

      const label = move === 'spinRight' ? 'spin right'
                  : move === 'spinLeft' ? 'spin left'
                  : move === 'truck' ? 'trucks the defender'
                  : 'stiff arms #' + near.def.player.number;
      FB.state.log.push('#' + bc.player.number + ' ' + label + '!');
      FB.playCam.shake = move === 'truck' ? 0.35 : 0.25;
    } else {
      FB.attemptTackle(near.def, bc, true);
    }
  };

  // Juke animation state: advanced per-frame by FB.updateJukeAnim(dt).
  function startJukeAnim(bc, def, move, success) {
    const baseYaw = bc.mesh.rotation.y;
    bc.jukeAnim = {
      move: move,
      success: !!success,
      t: 0,
      dur: move === 'truck' ? 0.35 : (move === 'stiffArm' ? 0.4 : 0.55),
      yaw0: baseYaw,
      def: def,
    };
  }

  FB.updateJukeAnim = function (dt) {
    const bc = FB.ballCarrier;
    if (!bc || !bc.jukeAnim) return;
    const ja = bc.jukeAnim;
    ja.t += dt;
    const p = Math.min(1, ja.t / ja.dur);

    if (ja.move === 'spinRight') {
      bc.mesh.rotation.y = ja.yaw0 + Math.PI * 2 * p;
    } else if (ja.move === 'spinLeft') {
      bc.mesh.rotation.y = ja.yaw0 - Math.PI * 2 * p;
    } else if (ja.move === 'truck') {
      // Forward lean peaks mid-animation.
      const lean = Math.sin(p * Math.PI) * 0.4;
      bc.mesh.rotation.x = -lean; // shoulder dips into the tackler
    } else if (ja.move === 'stiffArm') {
      // Brief lateral twist as the arm extends.
      const twist = Math.sin(p * Math.PI) * 0.2;
      bc.mesh.rotation.z = twist;
    }

    if (p >= 1) {
      // Snap back to clean orientation — final yaw stays on the forward run axis.
      bc.mesh.rotation.x = 0;
      bc.mesh.rotation.z = 0;
      bc.mesh.rotation.y = ja.yaw0;
      bc.jukeAnim = null;
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

  // End play and spot the ball. A referee then walks the ball to the nearest
  // hash mark (only clamped when tackled beyond a hash) before the next play.
  FB.endPlay = function (opts) {
    const s = FB.state;
    if (s.phase === 'deadball' || s.phase === 'gameover') return;
    s.phase = 'deadball';
    FB.clearReceiverChips && FB.clearReceiverChips();
    let gain = 0;
    let newBallOn = s.ballOn;
    let endZ = 0;
    let incomplete = false;

    if (FB.ballCarrier) {
      const yardNow = FB.yardFromBallX(FB.ballCarrier.mesh.position.x, s.possession);
      gain = Math.round(yardNow - s.los);
      newBallOn = Math.max(1, Math.min(99, Math.round(yardNow)));
      endZ = FB.ballCarrier.mesh.position.z;
      recordRushReceiveStats(FB.ballCarrier, gain);
      if (yardNow >= 100) {
        FB.scoreTouchdown();
        return;
      }
    } else {
      incomplete = true;
      gain = 0; newBallOn = s.ballOn;
      endZ = FB.ball ? FB.ball.position.z : 0;
      FB.state.log.push('Incomplete.');
    }

    s.ballOn = newBallOn;
    // On an incomplete pass, the ref returns the ball to where the play
    // started — keep the pre-snap lateral spot instead of re-hashing.
    if (!incomplete) {
      s.spotZ = FB.computeSpotZ ? FB.computeSpotZ(endZ) : 0;
    }

    const losX = FB.ballXFromYard(s.ballOn, s.possession);
    const fromPos = FB.ball
      ? { x: FB.ball.position.x, z: FB.ball.position.z }
      : { x: losX, z: endZ };
    const toPos = { x: losX, z: s.spotZ };

    const afterRef = () => {
      try {
        if (FB.specialMode === 'kickoff') {
          FB.specialMode = null;
          s.los = s.ballOn; s.down = 1; s.distance = 10;
          FB.state.log.push('Return spotted at ' + s.ballOn);
          FB.setupPlay('pass');
          return;
        }
        FB.advanceDown(gain);
      } catch (err) {
        FB.flashWarn && FB.flashWarn('afterRef err: ' + (err && err.message ? err.message : err));
        // Keep the game moving — force the next snap even if something broke above.
        setTimeout(() => { try { FB.setupPlay && FB.setupPlay('pass'); } catch (_) {} }, 400);
      }
    };

    if (FB.startRefSpot) FB.startRefSpot(fromPos, toPos, afterRef);
    else setTimeout(afterRef, 700);
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

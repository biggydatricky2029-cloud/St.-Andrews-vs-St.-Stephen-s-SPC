// logic-special.js — kickoffs, punts, field goals, XP, kick meter.
(function (FB) {
  'use strict';

  FB.specialMode = null;       // 'kickoff'|'punt'|'fg'|'xp'|null
  FB.kickMeterFrom = null;     // ent
  FB.kickTargetAngle = 0;

  FB.setupKickoff = function () {
    const s = FB.state;
    s.phase = 'kick';
    FB.specialMode = 'kickoff';
    s.ballOn = 35; // kicking from own 35
    const kickingTeam = s.possession;
    const recTeam = kickingTeam === 'home' ? 'away' : 'home';
    const dir = FB.forwardDir(kickingTeam);
    const losX = FB.ballXFromYard(35, kickingTeam);
    FB.hideAllPlayers();

    // --- 11 kicking-team players spread evenly across the field on the 35. ---
    // Evenly spaced Z positions from -26 to +26 (field width ~53.3).
    const lineZs = [-26, -20.8, -15.6, -10.4, -5.2, 0, 5.2, 10.4, 15.6, 20.8, 26];
    const kicker = FB.getStarter(kickingTeam, 'K');
    if (kicker) { FB.placePlayer(kicker, losX, 0, 'K'); kicker._koLaneZ = 0; }
    FB.kickMeterFrom = kicker;
    if (kicker) {
      FB.attachBallTo(kicker);
      FB.ball.position.copy(kicker.mesh.position).add(new THREE.Vector3(0, 0.5, 0));
    }
    // The other 10 coverage players take the remaining evenly-spaced Z slots.
    // Use defensive starters so they automatically count as "defenders" when
    // possession flips to the receiving team.
    const coverZs = lineZs.filter(z => z !== 0);
    const coverRoles = FB.DEF_SLOTS.slice(0, 10);
    for (let i = 0; i < coverRoles.length; i++) {
      const ent = FB.getStarter(kickingTeam, coverRoles[i]);
      if (!ent || ent === kicker) continue;
      FB.placePlayer(ent, losX, coverZs[i], coverRoles[i]);
      // Remember the lane this coverage player started in so outside defenders
      // hold their width until they're close enough to converge on the returner.
      ent._koLaneZ = coverZs[i];
    }

    // --- Returner at own 15 (deep). ---
    const returner = FB.getStarter(recTeam, 'KR1');
    if (returner) FB.placePlayer(returner, FB.ballXFromYard(15, recTeam), 0, 'KR1');

    // --- 10 return blockers in a staggered wedge at receiving team's 35. ---
    const blockerX = FB.ballXFromYard(35, recTeam);
    const blockerZs = [-22, -17, -12, -7, -3, 3, 7, 12, 17, 22];
    const blockerRoles = FB.OFF_SLOTS;
    let bi = 0;
    for (const role of blockerRoles) {
      if (bi >= blockerZs.length) break;
      const ent = FB.getStarter(recTeam, role);
      if (!ent || ent === returner) continue;
      FB.placePlayer(ent, blockerX, blockerZs[bi++], role);
    }

    FB.updateButtonStates && FB.updateButtonStates();
    maybeAutoKick();
  };

  FB.setupPunt = function () {
    const s = FB.state;
    s.phase = 'kick';
    FB.specialMode = 'punt';
    const losX = FB.ballXFromYard(s.ballOn, s.possession);
    FB.hideAllPlayers();
    const p = FB.getStarter(s.possession, 'P');
    if (p) FB.placePlayer(p, losX - FB.forwardDir(s.possession) * 14, 0, 'P');
    FB.kickMeterFrom = p;
    FB.attachBallTo(p);
    const recTeam = s.possession === 'home' ? 'away' : 'home';
    const pr = FB.getStarter(recTeam, 'PR');
    const recYd = Math.max(5, 100 - s.ballOn - 40);
    if (pr) FB.placePlayer(pr, FB.ballXFromYard(recYd, recTeam), 0, 'PR');
    FB.updateButtonStates && FB.updateButtonStates();
    maybeAutoKick();
  };

  FB.setupFG = function (isXP) {
    const s = FB.state;
    s.phase = 'kick';
    FB.specialMode = isXP ? 'xp' : 'fg';
    const spotYd = isXP ? 98 : s.ballOn; // XP from opponent 2
    const losX = FB.ballXFromYard(spotYd, s.possession);
    FB.hideAllPlayers();
    const k = FB.getStarter(s.possession, 'K');
    if (k) FB.placePlayer(k, losX - FB.forwardDir(s.possession) * 7, 0, 'K');
    FB.kickMeterFrom = k;
    FB.attachBallTo(k);
    FB.ball.position.copy(k.mesh.position).add(new THREE.Vector3(0, 0.5, 0));
    FB.updateButtonStates && FB.updateButtonStates();
    maybeAutoKick();
  };

  // Auto-release the power meter when the AI is the kicking team.
  function maybeAutoKick() {
    if (FB.state.possession === FB.userTeam) return;
    // Kickoffs: moderate power so the ball doesn't sail past the field.
    const power = FB.specialMode === 'kickoff'
      ? 50 + Math.random() * 18
      : 55 + Math.random() * 22;
    setTimeout(() => FB.onKickRelease(power), 900);
  }

  // Called on POWER button release.
  FB.onKickRelease = function (powerPct) {
    if (!FB.kickMeterFrom) return;
    const power = Math.max(0.2, Math.min(1, powerPct / 100));
    const dir = FB.forwardDir(FB.state.possession);
    const aimZ = FB.input.joyX * 8;    // steer with joystick
    const kickerRating = FB.kickMeterFrom.rating || 60;
    // Tuned so kickoffs land around the opposing 20-40 instead of past the end zone.
    const base = FB.specialMode === 'kickoff' ? 20 : FB.specialMode === 'punt' ? 17 : 21;
    const maxV = base * (0.78 + kickerRating / 220);
    const v = maxV * power;
    const windZ = (FB.state.quarter === 2 || FB.state.quarter === 4) ? (Math.random() - 0.5) * 1.5 : 0;
    FB.ballCarrier = null;
    FB.ballState.carried = false;
    FB.ballState.inAir = true;
    FB.ballState.airTime = 0;
    FB.ballState.kind = FB.specialMode;
    FB.ballState.targetPlayer = null;
    FB.ballState.vel.set(dir * v, v * 0.7, aimZ * power + windZ);
    FB.state.log.push(FB.specialMode.toUpperCase() + ' kicked at ' + Math.round(powerPct) + '%');

    if (FB.specialMode === 'fg' || FB.specialMode === 'xp') {
      setTimeout(() => resolveFG(powerPct, kickerRating), 1600);
    }
  };

  function resolveFG(powerPct, rating) {
    const s = FB.state;
    const distYd = FB.specialMode === 'xp' ? 20 : Math.max(17, 117 - s.ballOn);
    // Success model: FG% baseline from rating + distance adjustment.
    let chance = 0.5 + (rating - 60) * 0.012 - Math.max(0, distYd - 25) * 0.02 + (powerPct - 60) * 0.004;
    chance = Math.max(0.1, Math.min(0.97, chance));
    const good = Math.random() < chance;
    if (good) {
      if (FB.specialMode === 'xp') FB.state.score[s.possession] += 1;
      else FB.state.score[s.possession] += 3;
      FB.state.log.push((FB.specialMode === 'xp' ? 'XP' : 'FG') + ' GOOD');
      FB.recordStat(s.possession, FB.kickMeterFrom.player.number,
        FB.specialMode === 'xp' ? 'xpMade' : 'fieldGoalsMade', 1);
    } else {
      FB.state.log.push((FB.specialMode === 'xp' ? 'XP' : 'FG') + ' MISSED');
    }
    const wasXP = FB.specialMode === 'xp';
    FB.recordStat(s.possession, FB.kickMeterFrom.player.number,
      wasXP ? 'xpAttempted' : 'fieldGoalsAttempted', 1);
    FB.specialMode = null;
    FB.ballState.inAir = false;
    if (good || wasXP) FB.kickoffAfterScore();
    else FB.turnoverOnDowns();
  }

  // Called while the ball is in the air on a kickoff — sprints coverage down
  // the field so they close on the returner quickly. Outside lanes stay wide
  // until they're close to the landing spot so the returner gets surrounded
  // rather than chased single-file.
  FB.updateKickoffCoverage = function (dt) {
    if (FB.specialMode !== 'kickoff') return;
    const s = FB.state;
    if (s.phase !== 'kick') return;
    const kickingTeam = s.possession;
    const ballPos = FB.ball ? FB.ball.position : null;
    const dir = FB.forwardDir(kickingTeam);
    for (const e of FB.activePlayers[kickingTeam]) {
      if (!e.mesh.visible || e === FB.kickMeterFrom) continue;
      if (!FB.DEF_SLOTS.includes(e.role)) continue;
      const laneZ = (typeof e._koLaneZ === 'number') ? e._koLaneZ : e.mesh.position.z;
      let tgt;
      if (ballPos) {
        const dxToBall = Math.abs(ballPos.x - e.mesh.position.x);
        // Stay in-lane while still far downfield (>25yd); start pinching inward
        // as we close on the landing spot (0yd = fully on the ball).
        const laneHold = Math.max(0, Math.min(1, (dxToBall - 6) / 20));
        const zTarget = ballPos.z * (1 - laneHold) + laneZ * laneHold;
        tgt = new THREE.Vector3(ballPos.x - dir * 2, 0, zTarget);
      } else {
        tgt = new THREE.Vector3(e.mesh.position.x + dir * 30, 0, laneZ);
      }
      FB.steerToward(e, tgt, dt, 1.10);
    }
    // Blockers drift upfield to meet coverage.
    const recTeam = kickingTeam === 'home' ? 'away' : 'home';
    const blockDir = FB.forwardDir(recTeam);
    for (const e of FB.activePlayers[recTeam]) {
      if (!e.mesh.visible) continue;
      if (e.role === 'KR1') continue;
      const tgt = new THREE.Vector3(e.mesh.position.x + blockDir * 10, 0, e.mesh.position.z);
      FB.steerToward(e, tgt, dt, 0.75);
    }
  };

  FB.onBallLanded = function () {
    if (FB.specialMode === 'kickoff') { handleKickoffCatch(); return; }
    if (FB.specialMode === 'punt') {
      const s = FB.state;
      const recTeam = s.possession === 'home' ? 'away' : 'home';
      const yd = FB.yardFromBallX(FB.ball.position.x, recTeam);
      s.possession = recTeam;
      s.ballOn = Math.max(5, Math.min(95, Math.round(yd)));
      s.down = 1; s.distance = 10; s.los = s.ballOn;
      FB.specialMode = null;
      FB.state.log.push('Ball spotted at ' + s.ballOn);
      setTimeout(() => FB.setupPlay('pass'), 700);
    }
  };

  function handleKickoffCatch() {
    const s = FB.state;
    const kickingTeam = s.possession;
    const recTeam = kickingTeam === 'home' ? 'away' : 'home';

    // Find the receiving-team player nearest to where the ball lands — they
    // field the kick and become the returner.
    let catcher = null, bestD = Infinity;
    for (const e of FB.activePlayers[recTeam]) {
      if (!e.mesh.visible || e.isDown) continue;
      const d = e.mesh.position.distanceTo(FB.ball.position);
      if (d < bestD) { bestD = d; catcher = e; }
    }
    if (!catcher) {
      // No receiver in range — spot the ball for a normal down.
      const yd = FB.yardFromBallX(FB.ball.position.x, recTeam);
      s.possession = recTeam;
      s.ballOn = Math.max(5, Math.min(95, Math.round(yd)));
      s.down = 1; s.distance = 10; s.los = s.ballOn;
      FB.specialMode = null;
      setTimeout(() => FB.setupPlay('pass'), 600);
      return;
    }

    // Snap the catcher onto the ball's landing spot for a clean visible catch.
    catcher.mesh.position.x = FB.ball.position.x;
    catcher.mesh.position.z = FB.ball.position.z;
    catcher.vel.set(0, 0, 0);
    catcher.mesh.rotation.y = FB.forwardDir(recTeam) === 1 ? -Math.PI / 2 : Math.PI / 2;

    // Flip possession; returner now has the ball live.
    s.possession = recTeam;
    const catchYd = FB.yardFromBallX(catcher.mesh.position.x, recTeam);
    s.los = Math.max(1, Math.min(99, Math.round(catchYd)));
    s.ballOn = s.los;
    s.down = 1; s.distance = 10;
    s.phase = 'play';
    s.playType = 'kickoffReturn';

    FB.attachBallTo(catcher);
    FB.ballState.inAir = false;
    FB.state.log.push('Kickoff fielded by #' + catcher.player.number);

    // Coverage swarms the returner. Outside lanes keep their width so the
    // pursuit surrounds rather than stacks; inside lanes converge directly.
    for (const e of FB.activePlayers[kickingTeam]) {
      if (!e.mesh.visible) continue;
      const laneZ = (typeof e._koLaneZ === 'number') ? e._koLaneZ : e.mesh.position.z;
      e.assignment = { type: 'koCover', laneZ: laneZ };
    }
    // Kicker comes straight at the ball (no lane bias — he's the trail man).
    if (FB.kickMeterFrom) FB.kickMeterFrom.assignment = { type: 'rush' };

    // If the defense is the user's team, hand them the closest chaser.
    if (FB.userTeam === kickingTeam) {
      const defs = FB.defendersOf(s.possession);
      FB.userDefender = defs.length ? defs[0] : null;
    } else {
      FB.userDefender = null;
    }
    FB.updateButtonStates && FB.updateButtonStates();
  }

  FB.kickoffAfterScore = function () {
    // After any score, the scoring team kicks off to the other team.
    const s = FB.state;
    s.possession = s.possession; // scoring team still possesses for kickoff setup
    s.down = 1; s.distance = 10; s.ballOn = 35; s.los = 35;
    setTimeout(() => FB.setupPlay('kickoff'), 900);
  };

  FB.turnoverOnDowns = function () {
    const s = FB.state;
    s.possession = s.possession === 'home' ? 'away' : 'home';
    s.ballOn = Math.max(1, 100 - s.ballOn);
    s.down = 1; s.distance = 10; s.los = s.ballOn;
    setTimeout(() => FB.setupPlay('pass'), 700);
  };

  // Kick meter tick — grows while held.
  FB.tickKickMeter = function (dt) {
    if (FB.input.powerHolding) {
      FB.input.power = Math.min(100, FB.input.power + dt * 90);
      const pw = document.getElementById('btnPower');
      if (pw) pw.textContent = 'POWER ' + Math.round(FB.input.power) + '%';
    } else {
      const pw = document.getElementById('btnPower');
      if (pw) pw.textContent = 'POWER';
    }
  };

})(window.FB);

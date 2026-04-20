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
    const losX = FB.ballXFromYard(s.ballOn, s.possession);
    FB.hideAllPlayers();
    const kicker = FB.getStarter(s.possession, 'K');
    if (kicker) FB.placePlayer(kicker, losX, 0, 'K');
    FB.kickMeterFrom = kicker;
    FB.attachBallTo(kicker);
    FB.ball.position.copy(kicker.mesh.position).add(new THREE.Vector3(0, 0.5, 0));
    const recTeam = s.possession === 'home' ? 'away' : 'home';
    const kr1 = FB.getStarter(recTeam, 'KR1');
    if (kr1) FB.placePlayer(kr1, FB.ballXFromYard(20, recTeam), 0, 'KR1');
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
    const power = 60 + Math.random() * 25;
    setTimeout(() => FB.onKickRelease(power), 900);
  }

  // Called on POWER button release.
  FB.onKickRelease = function (powerPct) {
    if (!FB.kickMeterFrom) return;
    const power = Math.max(0.2, Math.min(1, powerPct / 100));
    const dir = FB.forwardDir(FB.state.possession);
    const aimZ = FB.input.joyX * 8;    // steer with joystick
    const kickerRating = FB.kickMeterFrom.rating || 60;
    const base = FB.specialMode === 'kickoff' ? 32 : FB.specialMode === 'punt' ? 24 : 28;
    const maxV = base * (0.7 + kickerRating / 150);
    const v = maxV * power;
    const windZ = (FB.state.quarter === 2 || FB.state.quarter === 4) ? (Math.random() - 0.5) * 1.5 : 0;
    FB.ballCarrier = null;
    FB.ballState.carried = false;
    FB.ballState.inAir = true;
    FB.ballState.airTime = 0;
    FB.ballState.kind = FB.specialMode;
    FB.ballState.targetPlayer = null;
    FB.ballState.vel.set(dir * v, v * 0.8, aimZ * power + windZ);
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

  FB.onBallLanded = function () {
    if (FB.specialMode === 'kickoff' || FB.specialMode === 'punt') {
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

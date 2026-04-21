// logic-loop.js — main step/render, input consumption, cooldowns.
(function (FB) {
  'use strict';

  let last = 0;

  FB.startLoop = function () {
    last = performance.now();
    requestAnimationFrame(tick);
  };

  function tick(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    step(dt);
    if (FB.renderer && FB.scene && FB.camera) FB.renderer.render(FB.scene, FB.camera);
    requestAnimationFrame(tick);
  }

  function step(dt) {
    const s = FB.state;
    FB.tickKickMeter && FB.tickKickMeter(dt);

    // Consume discrete inputs
    if (FB.input.snapPressed) {
      FB.input.snapPressed = false;
      if (s.phase === 'presnap') FB.snapBall();
    }
    if (FB.input.handoffPressed) {
      FB.input.handoffPressed = false;
      if (s.phase === 'presnap') { s.playType = 'run'; }
    }
    if (FB.input.passPressed) {
      FB.input.passPressed = false;
      if (s.phase === 'play' && FB.ballCarrier === FB.qb) FB.showReceiverPicker();
    }
    if (FB.input.juke) {
      FB.input.juke = 0;
      if (s.phase === 'play') FB.tryJuke();
    }
    if (FB.input.dive) {
      FB.input.dive = false;
      if (s.phase === 'play') FB.onDive();
    }

    // Cooldown
    if (FB.ballCarrier && FB.ballCarrier.jukeCooldown > 0) {
      FB.ballCarrier.jukeCooldown = Math.max(0, FB.ballCarrier.jukeCooldown - dt);
    }

    if (s.phase === 'play' || s.phase === 'kick') {
      FB.updateBallCarrier && FB.updateBallCarrier(dt);
      FB.updateOffenseOthers && FB.updateOffenseOthers(dt);
      FB.updateDefense && FB.updateDefense(dt);
      FB.updateKickoffCoverage && FB.updateKickoffCoverage(dt);
      FB.updateJukeAnim && FB.updateJukeAnim(dt);
      FB.updateBallPhysics && FB.updateBallPhysics(dt);
    }
    FB.updatePlayerRigs && FB.updatePlayerRigs(dt);
    FB.updateRefAnim && FB.updateRefAnim(dt);

    FB.updateCamera && FB.updateCamera(dt);
    FB.tickClock && FB.tickClock(dt);
    FB.updateHUD && FB.updateHUD();
    FB.updateButtonStates && FB.updateButtonStates();
  }

})(window.FB);

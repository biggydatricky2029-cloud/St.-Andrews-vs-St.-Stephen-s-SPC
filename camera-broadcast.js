// camera-broadcast.js — PHASE 8: broadcast camera system.
//
// Loads after logic-movement.js and overrides FB.updateCamera. The camera
// stays BEHIND the controlled player (the joystick mapping and receiver
// picking depend on the action framing toward the user's offensive
// direction — a true sideline main camera would invert the controls), but
// everything around that framing is broadcast-grade:
//
//   • telephoto lens: 38–52° FOV with auto-zoom driven by how spread out
//     the play is (tight on a dive, wide on a bomb)
//   • smooth tracking lerp instead of hard locking
//   • continuous low-amplitude multi-sine "handheld" wobble (perlin-style),
//     on top of the existing impact shake (FB.playCam.shake)
//   • TD replay: a dramatic low-angle orbit around the scorer for ~3s,
//     hooked on FB.scoreTouchdown
//   • keeps the Phase-3 camera fill light riding with the lens so faces
//     never fall into silhouette
(function (FB) {
  'use strict';

  const GC = () => window.GRAPHICS_CONFIG.camera;

  let shakeT = Math.random() * 100;
  let curFov = 0;

  // Smooth pseudo-perlin from layered sines — cheap, continuous, no popping.
  function wobble(t, seed) {
    return (Math.sin(t * 1.7 + seed) * 0.55 +
            Math.sin(t * 2.9 + seed * 2.1) * 0.3 +
            Math.sin(t * 5.3 + seed * 0.7) * 0.15);
  }

  // How spread out is the play? Bounding radius of every visible player
  // around the focus point, capped so blowout returns don't fisheye.
  function playSpread(focus) {
    let r = 8;
    for (const team of ['home', 'away']) {
      for (const e of FB.activePlayers[team]) {
        if (!e.mesh.visible) continue;
        const d = e.mesh.position.distanceTo(focus);
        if (d > r) r = d;
      }
    }
    return Math.min(34, r);
  }

  FB.updateCamera = function (dt) {
    const cam = FB.camera;
    const cfg = GC();
    if (!curFov) curFov = cfg.fovBase;
    shakeT += dt;

    // ---- TD replay mode: low-angle tracking orbit around the scorer ----
    const rp = FB._replayCam;
    if (rp) {
      rp.t += dt;
      if (rp.t >= cfg.replaySeconds || !rp.ent || !rp.ent.mesh.visible) {
        FB._replayCam = null;
      } else {
        const p = rp.ent.mesh.position;
        const ang = rp.angle0 + rp.t * 0.55;
        cam.position.set(p.x + Math.cos(ang) * 7.5, 1.6, p.z + Math.sin(ang) * 7.5);
        cam.lookAt(p.x, p.y + 1.4, p.z);
        if (curFov !== 40) { curFov = 40; cam.fov = 40; cam.updateProjectionMatrix(); }
        syncFillLight(cam, p);
        return;
      }
    }

    // ---- main follow framing (control-compatible) ----
    let focus;
    const userEnt = FB.userControlled && FB.userControlled();
    if (userEnt && userEnt.mesh.visible) focus = userEnt.mesh.position;
    else if (FB.ballCarrier && FB.ballCarrier.mesh.visible) focus = FB.ballCarrier.mesh.position;
    else if (FB.ball) focus = FB.ball.position;
    else return;

    // Always frame toward the user team's offensive direction so "up" on
    // the joystick = forward.
    const dir = FB.forwardDir(FB.userTeam || FB.state.possession);
    const desired = new THREE.Vector3(
      focus.x - dir * cfg.followDistance,
      cfg.followHeight,
      focus.z
    );
    cam.position.lerp(desired, Math.min(1, cfg.lerp));
    const look = focus.clone().add(new THREE.Vector3(dir * 6, 1, 0));
    cam.lookAt(look);

    // ---- telephoto auto-zoom ----
    const spread = playSpread(focus);
    const targetFov = cfg.fovMin + (cfg.fovMax - cfg.fovMin) *
      Math.max(0, Math.min(1, (spread - 8) / 24));
    curFov += (targetFov - curFov) * Math.min(1, dt * 1.8);
    if (Math.abs(cam.fov - curFov) > 0.02) {
      cam.fov = curFov;
      cam.updateProjectionMatrix();
    }

    // ---- handheld wobble + impact shake ----
    const amp = cfg.shakeAmplitude;
    cam.position.x += wobble(shakeT, 1.3) * amp;
    cam.position.y += wobble(shakeT, 4.7) * amp;
    cam.position.z += wobble(shakeT, 8.2) * amp * 0.6;
    if (FB.playCam.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * FB.playCam.shake;
      cam.position.y += (Math.random() - 0.5) * FB.playCam.shake;
      FB.playCam.shake = Math.max(0, FB.playCam.shake - dt * 2);
    }

    syncFillLight(cam, focus);
  };

  function syncFillLight(cam, focus) {
    const fill = FB.fillLight;
    if (!fill) return;
    fill.position.copy(cam.position);
    fill.target.position.set(focus.x, focus.y || 0, focus.z);
    fill.target.updateMatrixWorld();
  }

  // TD replay trigger.
  if (FB.scoreTouchdown && !FB.scoreTouchdown.__replayWrapped) {
    const orig = FB.scoreTouchdown;
    const wrapped = function () {
      if (FB.ballCarrier && FB.ballCarrier.mesh.visible) {
        FB._replayCam = { t: 0, ent: FB.ballCarrier, angle0: Math.random() * Math.PI * 2 };
      }
      return orig.apply(this, arguments);
    };
    wrapped.__replayWrapped = true;
    FB.scoreTouchdown = wrapped;
  }

})(window.FB);

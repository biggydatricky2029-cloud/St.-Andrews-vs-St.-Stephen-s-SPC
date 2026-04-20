// logic-movement.js — per-frame movement for ball carrier, defenders, receivers, ball.
(function (FB) {
  'use strict';

  const TMP = new THREE.Vector3();

  // Clamp position to field (with some overflow into end zones).
  function clampField(v) {
    const { FIELD_LEN, FIELD_WID } = FB.const;
    v.x = Math.max(-FIELD_LEN / 2 + 0.5, Math.min(FIELD_LEN / 2 - 0.5, v.x));
    v.z = Math.max(-FIELD_WID / 2 + 0.5, Math.min(FIELD_WID / 2 - 0.5, v.z));
  }

  // Update ball-carrier steered by joystick (or AI).
  FB.updateBallCarrier = function (dt) {
    const bc = FB.ballCarrier;
    if (!bc || bc.isDown || !FB.ballState.carried) return;

    const dir = FB.forwardDir(bc.team);
    let dx, dz;
    if (bc.team === FB.state.possession && FB.state.phase === 'play') {
      // Human controlled (joystick Y is up/down in screen → forward if negative on home side).
      dx = FB.input.joyY * -1;   // up = forward on home side
      dz = FB.input.joyX;
      // Remap so "up" always means forward for the possession team.
      if (bc.team === 'away') { dx = -dx; }
    } else {
      // Simple AI ball carrier: run forward, avoid nearest defender.
      const forward = new THREE.Vector3(dir, 0, 0);
      const near = FB.nearestDefender(bc.mesh.position, bc.team);
      if (near.def && near.dist < 6) {
        const away = bc.mesh.position.clone().sub(near.def.mesh.position).setY(0).normalize();
        forward.addScaledVector(away, 1.2).normalize();
      }
      dx = forward.x; dz = forward.z;
    }

    const mag = Math.hypot(dx, dz);
    const targetSpeed = bc.baseSpeed * (FB.input.sprint && bc.stamina > 0 ? 1.35 : 1.0);
    if (mag > 0.05) {
      const nx = dx / mag, nz = dz / mag;
      bc.vel.x += (nx * targetSpeed - bc.vel.x) * Math.min(1, dt * bc.accel / targetSpeed);
      bc.vel.z += (nz * targetSpeed - bc.vel.z) * Math.min(1, dt * bc.accel / targetSpeed);
      bc.mesh.rotation.y = Math.atan2(nx, nz);
    } else {
      bc.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
    }
    if (FB.input.sprint && bc.stamina > 0) bc.stamina = Math.max(0, bc.stamina - dt * 18);
    else bc.stamina = Math.min(100, bc.stamina + dt * 10);

    bc.mesh.position.addScaledVector(bc.vel, dt);
    clampField(bc.mesh.position);

    // Sidelines = out of bounds, ends play if carrier steps past.
    const { FIELD_WID } = FB.const;
    if (Math.abs(bc.mesh.position.z) >= FIELD_WID / 2 - 0.6) {
      if (FB.endPlay) FB.endPlay({ reason: 'oob' });
    }

    // Ball follows carrier.
    FB.ball.position.copy(bc.mesh.position).add(new THREE.Vector3(0, 2.2, 0.3));
  };

  // Non-ball-carrier offense: receivers run routes, blockers engage.
  FB.updateOffenseOthers = function (dt) {
    const pos = FB.state.possession;
    if (FB.state.phase !== 'play') return;
    const dir = FB.forwardDir(pos);
    for (const ent of FB.offenseOf(pos)) {
      if (ent === FB.ballCarrier) continue;
      if (ent.isDown) continue;
      if (['WR1','WR2','WR3','TE','RB'].includes(ent.role)) {
        // Simple route: run forward and slightly outside, 18 yds then sit.
        const depth = 18;
        const origin = ent.target.length() > 0 ? ent.target :
          (ent.target.copy(ent.mesh.position), ent.target);
        const goal = origin.clone().add(new THREE.Vector3(dir * depth, 0, ent.role === 'WR3' ? -3 : 3));
        steerToward(ent, goal, dt, 0.85);
      } else {
        // Linemen push into nearest defender's line.
        const nearest = FB.nearestDefender(ent.mesh.position, pos);
        if (nearest.def && nearest.dist < 4) {
          steerToward(ent, nearest.def.mesh.position, dt, 0.55);
        }
      }
    }
  };

  // Defense AI: pursue ball carrier / cover receivers.
  FB.updateDefense = function (dt) {
    const pos = FB.state.possession;
    if (FB.state.phase !== 'play') return;
    const defTeam = pos === 'home' ? 'away' : 'home';
    const reaction = FB.diffMult[FB.state.difficulty] || 1;
    const carrier = FB.ballCarrier;
    for (const ent of FB.defendersOf(pos)) {
      if (ent.isDown) continue;
      // Pursuit: simple intercept.
      let target;
      if (carrier && FB.ballState.carried) {
        const lead = carrier.vel.clone().multiplyScalar(0.35);
        target = carrier.mesh.position.clone().add(lead);
      } else if (FB.ballState.inAir && FB.ballState.targetPlayer) {
        target = FB.ballState.targetPlayer.mesh.position.clone();
      } else {
        target = new THREE.Vector3(0, 0, ent.mesh.position.z);
      }
      steerToward(ent, target, dt, reaction);

      // Tackle check
      if (carrier && FB.ballState.carried && !carrier.isDown) {
        const d = ent.mesh.position.distanceTo(carrier.mesh.position);
        if (d < 1.4) {
          if (FB.attemptTackle) FB.attemptTackle(ent, carrier);
        }
      }
    }
  };

  function steerToward(ent, target, dt, speedFrac) {
    TMP.copy(target).sub(ent.mesh.position); TMP.y = 0;
    const d = TMP.length();
    if (d < 0.1) { ent.vel.multiplyScalar(0.85); return; }
    TMP.divideScalar(d);
    const sp = ent.baseSpeed * (speedFrac || 0.9);
    ent.vel.x += (TMP.x * sp - ent.vel.x) * Math.min(1, dt * ent.accel / sp);
    ent.vel.z += (TMP.z * sp - ent.vel.z) * Math.min(1, dt * ent.accel / sp);
    ent.mesh.rotation.y = Math.atan2(TMP.x, TMP.z);
    ent.mesh.position.addScaledVector(ent.vel, dt);
    clampField(ent.mesh.position);
  }
  FB.steerToward = steerToward;

  // Ball physics (when in air from pass, punt, kick).
  FB.updateBallPhysics = function (dt) {
    if (!FB.ballState.inAir) return;
    FB.ballState.airTime += dt;
    FB.ballState.vel.y -= 9.8 * dt;
    FB.ball.position.addScaledVector(FB.ballState.vel, dt);
    FB.ball.rotation.x += 8 * dt; FB.ball.rotation.z += 4 * dt;

    if (FB.ball.position.y <= 0.3) {
      FB.ball.position.y = 0.3;
      FB.ballState.inAir = false;
      if (FB.onBallLanded) FB.onBallLanded();
    }
    // Catch check if a receiver is the target
    if (FB.ballState.targetPlayer && FB.ballState.kind === 'pass') {
      const tp = FB.ballState.targetPlayer;
      if (FB.ball.position.distanceTo(tp.mesh.position) < 1.2) {
        FB.ballState.inAir = false;
        FB.attachBallTo(tp);
        if (FB.onPassCaught) FB.onPassCaught(tp);
      }
    }
  };

  // Camera behind the ball carrier, with lerp + shake.
  FB.updateCamera = function (dt) {
    const cam = FB.camera;
    let focus;
    if (FB.ballCarrier && FB.ballCarrier.mesh.visible) focus = FB.ballCarrier.mesh.position;
    else if (FB.ball) focus = FB.ball.position;
    else return;

    const pos = FB.state.possession;
    const dir = FB.forwardDir(pos);
    const desired = new THREE.Vector3(focus.x - dir * 12, 8, focus.z);
    cam.position.lerp(desired, Math.min(1, 0.12));
    const look = focus.clone().add(new THREE.Vector3(dir * 6, 1, 0));
    cam.lookAt(look);

    if (FB.playCam.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * FB.playCam.shake;
      cam.position.y += (Math.random() - 0.5) * FB.playCam.shake;
      FB.playCam.shake = Math.max(0, FB.playCam.shake - dt * 2);
    }
  };

})(window.FB);

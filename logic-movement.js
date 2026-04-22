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

  // Returns the entity the user is currently controlling (offense carrier, or defender on D).
  FB.userControlled = function () {
    if (FB.state.possession === FB.userTeam) return FB.ballCarrier;
    return FB.userDefender;
  };

  // Update ball-carrier steered by joystick (or AI).
  FB.updateBallCarrier = function (dt) {
    const bc = FB.ballCarrier;
    if (!bc || bc.isDown || !FB.ballState.carried) return;

    // Before the snap/kick the carrier stays put — just glue the ball to them.
    if (FB.state.phase !== 'play') {
      FB.ball.position.copy(bc.mesh.position).add(new THREE.Vector3(0, bc.carryY || 2.2, 0.3));
      return;
    }

    // Safety watchdog: if a play (especially a kickoff return) drags on past
    // 14 seconds without a tackle/TD/OOB, force it to end so the next play
    // can be called. Prevents the returner from running forever if coverage
    // somehow fails to close.
    FB.playTicker = (FB.playTicker || 0) + dt;
    if (FB.playTicker > 14 && FB.endPlay) {
      FB.endPlay({ reason: 'timeout' });
      return;
    }

    const dir = FB.forwardDir(bc.team);
    let dx, dz;
    // Human controls the carrier only when the user's team has possession.
    if (bc.team === FB.state.possession && bc.team === FB.userTeam && FB.state.phase === 'play') {
      dx = FB.input.joyY * -1;
      dz = FB.input.joyX;
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
    FB.ball.position.copy(bc.mesh.position).add(new THREE.Vector3(0, bc.carryY || 2.2, 0.3));
  };

  const OL_SLOTS = ['LT','LG','C','RG','RT'];

  // Non-ball-carrier offense: receivers run routes, blockers engage.
  FB.updateOffenseOthers = function (dt) {
    const pos = FB.state.possession;
    if (FB.state.phase !== 'play') return;
    const dir = FB.forwardDir(pos);
    const losX = FB.losLine ? FB.losLine.position.x : 0;
    for (const ent of FB.offenseOf(pos)) {
      if (ent === FB.ballCarrier) continue;
      if (ent.isDown) continue;
      if (['WR1','WR2','WR3','TE','RB'].includes(ent.role) && ent.route) {
        const wp = ent.route[ent.routeIdx] || ent.route[ent.route.length - 1];
        if (wp && ent.mesh.position.distanceTo(wp) < 1.2 && ent.routeIdx < ent.route.length - 1) {
          ent.routeIdx += 1;
        }
        if (wp) steerToward(ent, wp, dt, 0.88);
      } else if (OL_SLOTS.includes(ent.role)) {
        // Offensive line: actively seek out the nearest unblocked rusher and
        // wall them off, positioning between the rusher and the QB.
        const nearest = FB.nearestDefender(ent.mesh.position, pos);
        if (nearest.def && nearest.dist < 7) {
          const d = nearest.def.mesh.position;
          const intercept = new THREE.Vector3(d.x - dir * 0.6, 0, d.z);
          steerToward(ent, intercept, dt, 0.82);
          // Lock onto the rusher once close so they stick with the block.
          if (nearest.dist < 1.6) ent.blockTarget = nearest.def;
        } else {
          // No one to block — drift back to protect the pocket.
          const pocket = new THREE.Vector3(losX - dir * 1.2, 0, ent.mesh.position.z);
          steerToward(ent, pocket, dt, 0.45);
        }
      } else {
        const nearest = FB.nearestDefender(ent.mesh.position, pos);
        if (nearest.def && nearest.dist < 4) {
          steerToward(ent, nearest.def.mesh.position, dt, 0.55);
        }
      }
    }
  };

  // Defense AI: honor play assignment (rush / zone / man / blitz), else pursue.
  FB.updateDefense = function (dt) {
    const pos = FB.state.possession;
    if (FB.state.phase !== 'play') return;
    const reaction = FB.diffMult[FB.state.difficulty] || 1;
    const carrier = FB.ballCarrier;
    const defTeam = pos === 'home' ? 'away' : 'home';
    const losX = FB.losLine ? FB.losLine.position.x : 0;
    const dir = FB.forwardDir(pos);
    const userCtrl = defTeam === FB.userTeam ? FB.userDefender : null;

    for (const ent of FB.defendersOf(pos)) {
      if (ent.isDown) continue;

      // User-controlled defender: joystick input.
      if (ent === userCtrl && FB.state.phase === 'play') {
        let dx = FB.input.joyY * -1, dz = FB.input.joyX;
        if (ent.team === 'away') dx = -dx;
        const mag = Math.hypot(dx, dz);
        const sp = ent.baseSpeed * (FB.input.sprint && ent.stamina > 0 ? 1.3 : 1.0);
        if (mag > 0.05) {
          const nx = dx / mag, nz = dz / mag;
          ent.vel.x += (nx * sp - ent.vel.x) * Math.min(1, dt * ent.accel / sp);
          ent.vel.z += (nz * sp - ent.vel.z) * Math.min(1, dt * ent.accel / sp);
          ent.mesh.rotation.y = Math.atan2(nx, nz);
        } else ent.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
        if (FB.input.sprint && ent.stamina > 0) ent.stamina = Math.max(0, ent.stamina - dt * 18);
        else ent.stamina = Math.min(100, ent.stamina + dt * 10);
        ent.mesh.position.addScaledVector(ent.vel, dt);
        clampField(ent.mesh.position);
      } else {
        // AI behavior driven by assignment, with read-and-react to run/pass.
        let target = null;
        const a = ent.assignment;
        const carrierPast = carrier && FB.ballState.carried
          && (carrier.mesh.position.x - losX) * dir > 0.5;
        const isRunPlay = FB.state.playType === 'run' || carrierPast;
        if (!a || a.type === 'rush' || a.type === 'blitz') {
          target = carrier && FB.ballState.carried ? carrier.mesh.position.clone()
                 : FB.ball ? FB.ball.position.clone() : new THREE.Vector3(losX, 0, ent.mesh.position.z);
        } else if (a.type === 'koCover') {
          // Kickoff pursuit: hold outside lane Z while far from the carrier,
          // then pinch in as we close so the returner gets surrounded — and
          // go hard-pursuit inside 14yd so the tackle actually happens.
          const car = carrier && FB.ballState.carried ? carrier.mesh.position : (FB.ball ? FB.ball.position : null);
          if (car) {
            const toCar = Math.hypot(car.x - ent.mesh.position.x, car.z - ent.mesh.position.z);
            if (toCar < 14) {
              // Close enough — beeline the carrier, no lane hold.
              target = new THREE.Vector3(car.x, 0, car.z);
            } else {
              // Still deep: hold outside lane, pinch in as we approach.
              const laneHold = Math.max(0, Math.min(1, (toCar - 14) / 18));
              target = new THREE.Vector3(car.x, 0, car.z * (1 - laneHold) + a.laneZ * laneHold);
            }
          } else {
            target = new THREE.Vector3(ent.mesh.position.x + dir * 10, 0, a.laneZ);
          }
        } else if (a.type === 'zone') {
          const zx = losX + (a.depth || 0) * dir;
          const zz = a.lateral || 0;
          target = new THREE.Vector3(zx, 0, zz);
          const ballPos = FB.ball ? FB.ball.position : null;
          // Defenders read the run: LBs/SS crash the carrier hard.
          const isBacker = ent.role === 'MLB' || ent.role === 'WLB' || ent.role === 'SLB' || ent.role === 'SS';
          const runTrigger = isRunPlay && isBacker ? 16 : 8;
          if (ballPos && Math.hypot(ballPos.x - zx, ballPos.z - zz) < runTrigger) {
            target = carrier && FB.ballState.carried ? carrier.mesh.position.clone() : ballPos.clone();
          }
        } else if (a.type === 'man') {
          const mark = FB.offenseOf(pos).find(e => e.role === a.target);
          if (mark) target = mark.mesh.position.clone().add(new THREE.Vector3(dir * -1, 0, 0));
          if (carrier && FB.ballState.carried && carrier === mark) target = carrier.mesh.position.clone();
          if (!target) target = new THREE.Vector3(losX, 0, ent.mesh.position.z);
          // On a run, man defenders near the LOS also collapse on the carrier.
          if (isRunPlay && carrier && FB.ballState.carried) {
            const depth = (ent.mesh.position.x - losX) * dir;
            if (depth < 6) target = carrier.mesh.position.clone();
          }
        }
        // Kickoff coverage sprints so the returner gets swarmed within seconds.
        const koChase = FB.specialMode === 'kickoff' ? 1.45 : 1;
        steerToward(ent, target, dt, reaction * 0.95 * koChase);

        // OL engagement: if a blocker is walling this defender off before
        // they've sneaked past the LOS, drag their velocity heavily. They
        // stay stuck until they accumulate enough engage-time to shed the
        // block. High-rated OL hold longer than the DL's shed budget.
        const isRusher = !a || a.type === 'rush' || a.type === 'blitz';
        const pastLOS = (ent.mesh.position.x - losX) * dir > 0.6;
        if (isRusher && !pastLOS && FB.specialMode !== 'kickoff') {
          const block = nearestBlocker(ent, pos);
          if (block.blocker && block.dist < 1.9) {
            const olR = block.blocker.rating || 70;
            const dlR = ent.rating || 70;
            // Base hold ~2.2s, swung ±1s by the OL/DL rating gap.
            const holdSec = Math.max(1.2, Math.min(3.2, 2.2 + (olR - dlR) / 45));
            ent.blockedTime = (ent.blockedTime || 0) + dt;
            if (ent.blockedTime < holdSec) {
              // Engaged — heavy damp and a small push back.
              ent.vel.multiplyScalar(0.18);
              ent.mesh.position.x -= dir * dt * 0.6;
            } else {
              // Shed: small celebratory burst forward toward the QB.
              ent.vel.x += dir * 1.2 * dt * ent.accel;
            }
          } else {
            ent.blockedTime = Math.max(0, (ent.blockedTime || 0) - dt * 2);
          }
        }
      }

      // Tackle check (any defender near the ball carrier). Wider reach on
      // kickoff returns so the coverage team can bring the returner down.
      if (carrier && FB.ballState.carried && !carrier.isDown) {
        const d = ent.mesh.position.distanceTo(carrier.mesh.position);
        const tackleR = FB.specialMode === 'kickoff' ? 1.9 : 1.4;
        if (d < tackleR) { FB.attemptTackle && FB.attemptTackle(ent, carrier); }
      }
    }
  };

  function nearestBlocker(def, offTeam) {
    let best = null, bd = Infinity;
    const list = FB.activePlayers && FB.activePlayers[offTeam] || [];
    for (const o of list) {
      if (!o.mesh || !o.mesh.visible || o.isDown) continue;
      if (!OL_SLOTS.includes(o.role)) continue;
      const d = o.mesh.position.distanceTo(def.mesh.position);
      if (d < bd) { bd = d; best = o; }
    }
    return { blocker: best, dist: bd };
  }

  FB.switchDefender = function () {
    const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
    if (defTeam !== FB.userTeam) return;
    const carrier = FB.ballCarrier;
    if (!carrier) { FB.userDefender = FB.defendersOf(FB.state.possession)[0] || null; return; }
    let best = null, bd = Infinity;
    for (const d of FB.defendersOf(FB.state.possession)) {
      if (d === FB.userDefender) continue;
      const dist = d.mesh.position.distanceTo(carrier.mesh.position);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (best) FB.userDefender = best;
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

    // Clamp ball inside the field so kicks that sail long still land in-bounds.
    const halfLen = FB.const.FIELD_LEN / 2;
    const halfWid = FB.const.FIELD_WID / 2;
    if (FB.ball.position.x > halfLen) { FB.ball.position.x = halfLen - 0.5; FB.ball.position.y = 0.3; FB.ballState.inAir = false; if (FB.onBallLanded) FB.onBallLanded(); return; }
    if (FB.ball.position.x < -halfLen) { FB.ball.position.x = -halfLen + 0.5; FB.ball.position.y = 0.3; FB.ballState.inAir = false; if (FB.onBallLanded) FB.onBallLanded(); return; }
    if (Math.abs(FB.ball.position.z) > halfWid) { FB.ball.position.z = Math.sign(FB.ball.position.z) * (halfWid - 0.3); FB.ball.position.y = 0.3; FB.ballState.inAir = false; if (FB.onBallLanded) FB.onBallLanded(); return; }
    if (FB.ball.position.y <= 0.3) {
      FB.ball.position.y = 0.3;
      FB.ballState.inAir = false;
      if (FB.onBallLanded) FB.onBallLanded();
    }
    // Catch check: the ball is caught when it enters the receiver's catch
    // pocket — close in the horizontal plane and near hand/chest height.
    if (FB.ballState.targetPlayer && FB.ballState.kind === 'pass') {
      const tp = FB.ballState.targetPlayer;
      if (tp.mesh && tp.mesh.visible && !tp.isDown) {
        const dx = FB.ball.position.x - tp.mesh.position.x;
        const dz = FB.ball.position.z - tp.mesh.position.z;
        const dy = FB.ball.position.y - ((tp.mesh.position.y || 0) + 2.1);
        const horiz = Math.hypot(dx, dz);
        if (horiz < 1.5 && Math.abs(dy) < 1.4) {
          FB.ballState.inAir = false;
          FB.attachBallTo(tp);
          if (FB.onPassCaught) FB.onPassCaught(tp);
        }
      }
    }
  };

  // Camera behind whichever player the user is controlling (or ball carrier on AI possession).
  FB.updateCamera = function (dt) {
    const cam = FB.camera;
    let focus;
    const userEnt = FB.userControlled && FB.userControlled();
    if (userEnt && userEnt.mesh.visible) focus = userEnt.mesh.position;
    else if (FB.ballCarrier && FB.ballCarrier.mesh.visible) focus = FB.ballCarrier.mesh.position;
    else if (FB.ball) focus = FB.ball.position;
    else return;

    // Always frame toward the user team's offensive direction so "up" on the joystick = forward.
    const dir = FB.forwardDir(FB.userTeam || FB.state.possession);
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

  // Per-frame joint animation: legs and arms swing with an opposite-side
  // gait (right arm forward = left leg forward); knees flex during back-
  // swing so the knee bulges in the direction of motion; elbows are held
  // at ~90° with the elbow joint pointing opposite the motion direction.
  FB.updatePlayerRigs = function (dt) {
    for (const team of ['home', 'away']) {
      for (const ent of FB.activePlayers[team]) {
        const rig = ent.rig;
        if (!rig || !ent.mesh.visible) continue;
        if (ent.isDown) {
          // Collapse to neutral while tackled/flat.
          rig.hipL.rotation.x *= 0.7; rig.hipR.rotation.x *= 0.7;
          rig.kneeL.rotation.x *= 0.7; rig.kneeR.rotation.x *= 0.7;
          rig.shoulderL.rotation.x *= 0.7; rig.shoulderR.rotation.x *= 0.7;
          continue;
        }
        const speed = Math.hypot(ent.vel.x, ent.vel.z);
        const rate = 4 + speed * 1.1; // radians per second of phase advance
        ent.gaitPhase = (ent.gaitPhase || 0) + dt * rate;
        // Swing amplitude scales with speed (but fades near stationary).
        const swingAmp = Math.min(0.9, 0.08 + speed * 0.07);
        const s = Math.sin(ent.gaitPhase);
        // Hips: right leg forward when sin > 0 means foot goes back (hip +x),
        // so flip sign so sin>0 → right leg forward.
        const hipR = -s * swingAmp;
        const hipL = s * swingAmp;
        rig.hipR.rotation.x = hipR;
        rig.hipL.rotation.x = hipL;
        // Shoulders opposite the same-side leg (right arm with left leg).
        rig.shoulderR.rotation.x = -hipR; // opposite right leg
        rig.shoulderL.rotation.x = -hipL;
        // Knee bend: bend when leg is on its back-swing (hip positive X).
        const bendAmp = Math.min(1.1, 0.2 + speed * 0.09);
        rig.kneeR.rotation.x = -Math.max(0, rig.hipR.rotation.x) * bendAmp * 1.6
                               - Math.max(0, -rig.hipR.rotation.x) * bendAmp * 0.6;
        rig.kneeL.rotation.x = -Math.max(0, rig.hipL.rotation.x) * bendAmp * 1.6
                               - Math.max(0, -rig.hipL.rotation.x) * bendAmp * 0.6;
        // Elbows stay at ~90° but add a tiny drive with the gait so they
        // pump naturally. (Base -PI/2 set at construction.)
        rig.elbowR.rotation.x = -Math.PI / 2 - Math.max(0, -hipR) * 0.25;
        rig.elbowL.rotation.x = -Math.PI / 2 - Math.max(0, -hipL) * 0.25;
      }
    }
  };

})(window.FB);

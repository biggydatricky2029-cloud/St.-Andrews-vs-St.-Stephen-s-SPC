// animation.js — PHASE 6: player animation state machine.
//
// Replaces the plain run-gait animator (FB.updatePlayerRigs in
// logic-movement.js — this file loads after it and overrides the function)
// with a blended state machine over the existing bone-tree rig
// (hip → knee, shoulder → elbow pivots built in players.js):
//
//   IDLE      — breathing (chest scale oscillation) + weight shifting
//   RUN       — speed-parameterized stride with opposite-side arm swing
//   THROW     — QB wind-up, release, follow-through (hooked on FB.throwPass)
//   CATCH     — arms overhead while a pass targets this receiver
//   BLOCK     — lineman crouch with arms punched forward
//   TACKLE    — collapse to neutral while down
//   CELEBRATE — arms-up hop after a touchdown (hooked on FB.scoreTouchdown)
//
// Every joint blends toward its state target with a 0.15s time constant —
// the procedural equivalent of crossFadeTo(0.15) — so state changes never
// pop. (THREE.AnimationMixer was evaluated; because the rig is a plain
// Group hierarchy rather than a SkinnedMesh with bound skeletons, direct
// blended targets are cheaper per frame and byte-identical in result.)
//
// The animator also:
//   • plants players on the field crown (FB.fieldCrownY) every frame
//   • applies an approximate ground-lock (root drop compensates knee/hip
//     bend in crouch states so feet don't float — the 2-bone IK stand-in)
//   • skips all joint math when the player's LOD level 0 is not visible
(function (FB) {
  'use strict';

  const BLEND_TC = 0.15;     // seconds — matches the spec's crossfade time
  const JOINTS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR'];

  function freshAnimState() {
    return {
      cur: { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, elL: -Math.PI / 2, elR: -Math.PI / 2, drop: 0, torsoS: 1 },
      t: Math.random() * 10,   // de-syncs breathing across the roster
    };
  }

  // ---- per-state target poses ----------------------------------------------

  function poseIdle(out, a) {
    const breathe = Math.sin(a.t * 2.2);
    const shift = Math.sin(a.t * 0.9);
    out.hipL = 0.05 + shift * 0.03;
    out.hipR = 0.05 - shift * 0.03;
    out.kneeL = -0.12; out.kneeR = -0.12;
    out.shL = 0.08 + shift * 0.02;
    out.shR = 0.08 - shift * 0.02;
    out.elL = -0.55; out.elR = -0.55;
    out.drop = 0.03;
    out.torsoS = 1 + breathe * 0.012;
  }

  function poseRun(out, ent, speed) {
    const s = Math.sin(ent.gaitPhase);
    const swingAmp = Math.min(0.9, 0.08 + speed * 0.07);
    const hipR = -s * swingAmp;
    const hipL = s * swingAmp;
    out.hipR = hipR; out.hipL = hipL;
    // Arms drive opposite the same-side leg.
    out.shR = -hipR; out.shL = -hipL;
    const bendAmp = Math.min(1.1, 0.2 + speed * 0.09);
    out.kneeR = -Math.max(0, hipR) * bendAmp * 1.6 - Math.max(0, -hipR) * bendAmp * 0.6;
    out.kneeL = -Math.max(0, hipL) * bendAmp * 1.6 - Math.max(0, -hipL) * bendAmp * 0.6;
    out.elR = -Math.PI / 2 - Math.max(0, -hipR) * 0.25;
    out.elL = -Math.PI / 2 - Math.max(0, -hipL) * 0.25;
    out.drop = 0;
    out.torsoS = 1;
  }

  function poseThrow(out, p) {
    // p 0→1 over the throw: cock back, whip through, follow through.
    if (p < 0.4) {
      const k = p / 0.4;
      out.shR = -0.3 - k * 2.5;       // arm rises up and back over the head
      out.elR = -1.9;
    } else {
      const k = Math.min(1, (p - 0.4) / 0.45);
      out.shR = -2.8 + k * 1.7;       // whip forward to the release point
      out.elR = -1.9 + k * 1.5;       // elbow extends through the throw
    }
    out.shL = -0.7;                   // off arm tucks across the chest
    out.elL = -1.4;
    out.hipL = 0.18; out.hipR = -0.22;
    out.kneeL = -0.25; out.kneeR = -0.18;
    out.drop = 0.05;
    out.torsoS = 1;
  }

  function poseCatch(out) {
    out.shL = -2.75; out.shR = -2.75;  // both arms reach overhead
    out.elL = -0.25; out.elR = -0.25;  // nearly straight, hands together
    out.hipL = 0.1; out.hipR = 0.1;
    out.kneeL = -0.2; out.kneeR = -0.2;
    out.drop = 0.02;
    out.torsoS = 1;
  }

  function poseBlock(out, a) {
    const lean = Math.sin(a.t * 3.1) * 0.04;  // working the block
    out.shL = -1.25 + lean; out.shR = -1.25 - lean;
    out.elL = -1.35; out.elR = -1.35;
    out.hipL = 0.55; out.hipR = 0.55;          // sit into the stance
    out.kneeL = -0.95; out.kneeR = -0.95;
    // Approximate ground-lock: drop the root by the height the bent legs
    // lose so the cleats stay planted instead of hovering.
    out.drop = 0.16;
    out.torsoS = 1;
  }

  function poseCelebrate(out, a) {
    out.shL = -3.0; out.shR = -3.0;    // both arms straight up
    out.elL = -0.1; out.elR = -0.1;
    out.hipL = 0; out.hipR = 0;
    out.kneeL = -0.1; out.kneeR = -0.1;
    // Hop: the root bounce reads as jumping for the crowd.
    out.drop = -Math.abs(Math.sin(a.t * 6)) * 0.18;
    out.torsoS = 1;
  }

  // ---- state selection ------------------------------------------------------

  function pickState(ent, speed) {
    if (ent.isDown) return 'tackle';
    if (ent.animThrow) return 'throw';
    if (ent.animCelebrate > 0) return 'celebrate';
    const bs = FB.ballState;
    if (bs && bs.inAir && bs.kind === 'pass' && bs.targetPlayer === ent && FB.ball) {
      const dx = FB.ball.position.x - ent.mesh.position.x;
      const dz = FB.ball.position.z - ent.mesh.position.z;
      if (Math.hypot(dx, dz) < 9) return 'catch';
    }
    const OL = ent.role === 'LT' || ent.role === 'LG' || ent.role === 'C' || ent.role === 'RG' || ent.role === 'RT';
    if (OL && FB.state.phase === 'play' && speed < 2.2) return 'block';
    if (speed > 0.8) return 'run';
    return 'idle';
  }

  // ---- main per-frame update ------------------------------------------------

  const target = {};

  FB.updatePlayerRigs = function (dt) {
    const k = Math.min(1, dt / BLEND_TC);   // 0.15s blend constant
    for (const team of ['home', 'away']) {
      for (const ent of FB.activePlayers[team]) {
        const rig = ent.rig;
        if (!rig || !ent.mesh.visible) continue;

        // Plant the player on the field crown regardless of LOD level
        // (crouch/hop offsets ride separately on the rig root).
        if (FB.fieldCrownY) {
          ent.mesh.position.y = FB.fieldCrownY(ent.mesh.position.z);
        }

        // LOD gate: when the full rig (level 0) isn't the displayed child,
        // skip every joint computation — the stand-in/billboard is static.
        if (ent.rigRoot && !ent.rigRoot.visible && ent.mesh.children.length > 1) continue;

        if (!ent._anim) ent._anim = freshAnimState();
        const a = ent._anim;
        a.t += dt;

        const speed = Math.hypot(ent.vel.x, ent.vel.z);
        const state = pickState(ent, speed);

        // Per-state timers.
        if (ent.animThrow) {
          ent.animThrow.t += dt;
          if (ent.animThrow.t > 0.85) ent.animThrow = null;
        }
        if (ent.animCelebrate > 0) ent.animCelebrate -= dt;

        // Gait clock only advances while running.
        if (state === 'run') {
          ent.gaitPhase = (ent.gaitPhase || 0) + dt * (4 + speed * 1.1);
        }

        // Resolve the target pose.
        if (state === 'tackle') {
          // Fast collapse to neutral while flat on the turf.
          for (const j of JOINTS) a.cur[j] *= Math.max(0, 1 - dt * 6);
          a.cur.drop *= Math.max(0, 1 - dt * 6);
          a.cur.torsoS += (1 - a.cur.torsoS) * k;
          applyPose(ent, a.cur);
          continue;
        }
        switch (state) {
          case 'throw': poseThrow(target, Math.min(1, ent.animThrow.t / 0.85)); break;
          case 'catch': poseCatch(target); break;
          case 'block': poseBlock(target, a); break;
          case 'celebrate': poseCelebrate(target, a); break;
          case 'run': poseRun(target, ent, speed); break;
          default: poseIdle(target, a); break;
        }

        // Blend every channel toward its target (procedural crossfade).
        for (const j of JOINTS) a.cur[j] += (target[j] - a.cur[j]) * k;
        a.cur.drop += (target.drop - a.cur.drop) * k;
        a.cur.torsoS += (target.torsoS - a.cur.torsoS) * k;

        applyPose(ent, a.cur);
      }
    }
  };

  function applyPose(ent, c) {
    const rig = ent.rig;
    rig.hipL.rotation.x = c.hipL;
    rig.hipR.rotation.x = c.hipR;
    rig.kneeL.rotation.x = c.kneeL;
    rig.kneeR.rotation.x = c.kneeR;
    rig.shoulderL.rotation.x = c.shL;
    rig.shoulderR.rotation.x = c.shR;
    rig.elbowL.rotation.x = c.elL;
    rig.elbowR.rotation.x = c.elR;
    // Crouch / hop offset rides on the rig root so LOD stand-ins (siblings
    // of the rig inside the LOD object) are unaffected.
    if (ent.rigRoot) ent.rigRoot.position.y = -c.drop;
    // Breathing: subtle chest expansion on the torso mesh.
    if (ent.parts && ent.parts.torso) {
      ent.parts.torso.scale.set(c.torsoS, 1, c.torsoS);
    }
  }

  // ---- gameplay hooks (non-invasive wraps) ----------------------------------

  // QB throwing motion fires whenever the pass actually leaves.
  if (FB.throwPass && !FB.throwPass.__animWrapped) {
    const orig = FB.throwPass;
    const wrapped = function (receiver, passType) {
      const qb = FB.ballCarrier || FB.qb;
      if (qb) qb.animThrow = { t: 0 };
      return orig.call(this, receiver, passType);
    };
    wrapped.__animWrapped = true;
    FB.throwPass = wrapped;
  }

  // Touchdown celebration on whoever carried it in.
  if (FB.scoreTouchdown && !FB.scoreTouchdown.__animWrapped) {
    const orig = FB.scoreTouchdown;
    const wrapped = function () {
      if (FB.ballCarrier) FB.ballCarrier.animCelebrate = 2.5;
      return orig.apply(this, arguments);
    };
    wrapped.__animWrapped = true;
    FB.scoreTouchdown = wrapped;
  }

})(window.FB);

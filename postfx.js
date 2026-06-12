// postfx.js — PHASE 4: broadcast post-processing pipeline.
//
// Pass order (HIGH tier):
//   SSAOPass (scene render + ambient occlusion)
//   UnrealBloomPass        — only the brightest highlights bloom
//   BokehPass              — optional broadcast depth-of-field (config toggle)
//   ChromaticAberrationPass— 1-2px RGB separation at screen edges only
//   ColorGradingPass       — contrast/saturation boost, warm-shadow/cool-
//                            highlight grade, 25% edge vignette
//   GammaCorrectionShader  — linear -> sRGB (composer works in linear space)
//   FXAAPass               — always last, mobile-safe anti-aliasing
//
// Tier mapping:
//   LOW    — render + gamma + FXAA only
//   MEDIUM — + bloom + color grading/vignette
//   HIGH   — + SSAO + chromatic aberration (+ DOF if enabled in config)
//
// AUTO quality: the first seconds of play are benchmarked; if the average
// frame time exceeds GRAPHICS_CONFIG.quality.downgradeMs the tier drops one
// step (rebuilding this chain and shedding a shadow map) and re-measures.
(function (FB) {
  'use strict';

  const GC = () => window.GRAPHICS_CONFIG;

  // ---- Custom ShaderPass definitions -------------------------------------

  // Minimal chromatic aberration: RGB channels sampled with small opposing
  // offsets that scale with distance from screen center, so the center of
  // the action stays clean and only the frame edges get the lens fringe.
  const ChromaticAberrationShader = {
    uniforms: {
      tDiffuse: { value: null },
      uOffset: { value: 0.0008 },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform float uOffset;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 fromCenter = vUv - 0.5;',
      // Fringe confined to the outer frame so the thin white field lines in
      // the play area never split into rainbows.
      '  float edge = smoothstep(0.34, 0.78, length(fromCenter));',
      '  vec2 off = normalize(fromCenter + 1e-6) * uOffset * edge;',
      '  float r = texture2D(tDiffuse, vUv + off).r;',
      '  vec4 g = texture2D(tDiffuse, vUv);',
      '  float b = texture2D(tDiffuse, vUv - off).b;',
      '  gl_FragColor = vec4(r, g.g, b, g.a);',
      '}',
    ].join('\n'),
  };

  // Cinematic grade: contrast and saturation boosts, a warm-shadows /
  // cool-highlights split tone, and a smooth 25% vignette.
  const ColorGradingShader = {
    uniforms: {
      tDiffuse: { value: null },
      uContrast: { value: 1.08 },
      uSaturation: { value: 1.12 },
      uWarmCool: { value: 0.06 },
      uVignette: { value: 0.25 },
      uVigInner: { value: 0.42 },
      uVigOuter: { value: 0.98 },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform float uContrast;',
      'uniform float uSaturation;',
      'uniform float uWarmCool;',
      'uniform float uVignette;',
      'uniform float uVigInner;',
      'uniform float uVigOuter;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec4 c = texture2D(tDiffuse, vUv);',
      '  // Contrast around mid-gray.',
      '  c.rgb = (c.rgb - 0.5) * uContrast + 0.5;',
      '  // Saturation via luma mix.',
      '  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));',
      '  c.rgb = mix(vec3(luma), c.rgb, uSaturation);',
      '  // Split tone: warm the shadows, cool the highlights (LUT-style 3x3 tint).',
      '  vec3 warm = vec3(1.0 + uWarmCool, 1.0 + uWarmCool * 0.35, 1.0 - uWarmCool * 0.6);',
      '  vec3 cool = vec3(1.0 - uWarmCool * 0.6, 1.0 + uWarmCool * 0.1, 1.0 + uWarmCool);',
      '  c.rgb *= mix(warm, cool, smoothstep(0.2, 0.8, luma));',
      '  // Vignette: darken edges with smooth falloff.',
      '  float d = distance(vUv, vec2(0.5));',
      '  float v = smoothstep(uVigInner, uVigOuter, d);',
      '  c.rgb *= mix(1.0, 1.0 - uVignette, v);',
      '  gl_FragColor = clamp(c, 0.0, 1.0);',
      '}',
    ].join('\n'),
  };

  let fxaaPass = null;
  let ssaoPass = null;
  let bokehPass = null;

  FB.buildComposer = function () {
    try {
      if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.ShaderPass) {
        FB.composer = null;
        return;
      }
      const tier = GC().tier();
      const cfg = GC().postfx;
      const w = window.innerWidth, h = window.innerHeight;
      const composer = new THREE.EffectComposer(FB.renderer);
      composer.setSize(w, h);
      fxaaPass = ssaoPass = bokehPass = null;

      // Scene render: SSAOPass renders the scene itself, so it REPLACES the
      // plain RenderPass when active.
      if (tier === 'HIGH' && THREE.SSAOPass) {
        ssaoPass = new THREE.SSAOPass(FB.scene, FB.camera, w, h);
        ssaoPass.kernelRadius = cfg.ssao.kernelRadius;
        ssaoPass.minDistance = cfg.ssao.minDistance;
        ssaoPass.maxDistance = cfg.ssao.maxDistance;
        composer.addPass(ssaoPass);
      } else {
        composer.addPass(new THREE.RenderPass(FB.scene, FB.camera));
      }

      if (tier !== 'LOW' && THREE.UnrealBloomPass) {
        composer.addPass(new THREE.UnrealBloomPass(
          new THREE.Vector2(w, h),
          cfg.bloom.strength, cfg.bloom.radius, cfg.bloom.threshold
        ));
      }

      if (tier === 'HIGH' && cfg.depthOfField.enabled && THREE.BokehPass) {
        bokehPass = new THREE.BokehPass(FB.scene, FB.camera, {
          focus: 20,
          aperture: cfg.depthOfField.aperture,
          maxblur: cfg.depthOfField.maxblur,
          width: w, height: h,
        });
        composer.addPass(bokehPass);
      }

      if (tier === 'HIGH') {
        const ca = new THREE.ShaderPass(ChromaticAberrationShader);
        ca.uniforms.uOffset.value = cfg.chromaticAberration.offset;
        composer.addPass(ca);
      }

      if (tier !== 'LOW') {
        const grade = new THREE.ShaderPass(ColorGradingShader);
        grade.uniforms.uContrast.value = cfg.colorGrade.contrast;
        grade.uniforms.uSaturation.value = cfg.colorGrade.saturation;
        grade.uniforms.uWarmCool.value = cfg.colorGrade.warmCool;
        grade.uniforms.uVignette.value = cfg.vignette.strength;
        grade.uniforms.uVigInner.value = cfg.vignette.inner;
        grade.uniforms.uVigOuter.value = cfg.vignette.outer;
        composer.addPass(grade);
      }

      // Linear -> sRGB, then FXAA on the final display-referred image.
      if (THREE.GammaCorrectionShader) {
        composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
      }
      if (THREE.FXAAShader) {
        fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
        setFXAAResolution(w, h);
        composer.addPass(fxaaPass);
      }

      FB.composer = composer;
    } catch (e) {
      // Never let post-processing errors take the game down — logic-loop
      // falls back to plain renderer.render when FB.composer is null.
      FB.composer = null;
    }
  };

  function setFXAAResolution(w, h) {
    if (!fxaaPass) return;
    const pr = FB.renderer ? FB.renderer.getPixelRatio() : 1;
    fxaaPass.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  window.addEventListener('resize', () => {
    if (!FB.composer) return;
    const w = window.innerWidth, h = window.innerHeight;
    setFXAAResolution(w, h);
    if (ssaoPass && ssaoPass.setSize) ssaoPass.setSize(w, h);
  });

  // ---- AUTO quality benchmark + per-frame render entry point -------------

  let benchFrameCount = 0;
  let benchAccumMs = 0;
  let benchSamples = 0;
  let benchDrops = 0;
  let benchDone = false;

  function tierBelow(t) {
    return t === 'HIGH' ? 'MEDIUM' : t === 'MEDIUM' ? 'LOW' : null;
  }

  function applyDowngrade() {
    const q = GC().quality;
    const next = tierBelow(GC().tier());
    if (!next) { benchDone = true; return; }
    q.current = next;
    // Shed shadow cost along with the post chain: one caster on MEDIUM/LOW.
    if (FB.stadiumSpots) {
      let casters = 0;
      for (const s of FB.stadiumSpots) {
        if (s.castShadow && ++casters > 1) s.castShadow = false;
      }
    }
    if (next === 'LOW' && FB.renderer) {
      FB.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      FB.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    FB.buildComposer();
    // Re-measure once after each drop, max two drops total.
    benchAccumMs = 0; benchSamples = 0;
    benchDrops += 1;
    if (benchDrops >= 2) benchDone = true;
  }

  function benchmarkTick(dt) {
    if (benchDone || GC().quality.mode !== 'AUTO') return;
    benchFrameCount += 1;
    const q = GC().quality;
    if (benchFrameCount <= q.benchWarmupFrames) return;
    benchAccumMs += dt * 1000;
    benchSamples += 1;
    if (benchSamples >= q.benchFrames) {
      const avg = benchAccumMs / benchSamples;
      if (avg > q.downgradeMs) applyDowngrade();
      else benchDone = true;
    }
  }

  // Called once per frame from logic-loop in place of a raw render call.
  FB.renderFrame = function (dt) {
    benchmarkTick(dt);

    // Grass wind clock (Phase 2 vertex sway).
    if (FB.turfUniforms) FB.turfUniforms.uTime.value += dt;

    // Broadcast DOF keeps focus on the ball/line of scrimmage.
    if (bokehPass && FB.ball && FB.camera) {
      bokehPass.uniforms.focus.value = FB.camera.position.distanceTo(FB.ball.position);
    }

    if (FB.composer) {
      FB.composer.render();
    } else if (FB.renderer && FB.scene && FB.camera) {
      FB.renderer.render(FB.scene, FB.camera);
    }
  };

})(window.FB = window.FB || {});

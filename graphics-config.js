// graphics-config.js — single source of truth for every tunable graphics
// parameter in the broadcast-visuals upgrade. Loaded BEFORE scene.js so the
// scene, player factory, post-processing chain, and camera can all read it.
//
// Quality tiers:
//   LOW    — FXAA only, 1 shadow map, reduced tessellation
//   MEDIUM — FXAA + bloom + color grading + vignette, 1 shadow map
//   HIGH   — everything (SSAO, chromatic aberration, 2 shadow maps, max tess)
// quality.mode 'AUTO' starts from a device guess and the renderer benchmarks
// itself during the first seconds of play, downgrading if frame times slip.
(function () {
  'use strict';

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(
    (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  );

  window.GRAPHICS_CONFIG = {
    quality: {
      mode: 'AUTO',                       // 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH'
      current: isMobile ? 'MEDIUM' : 'HIGH', // starting guess, AUTO may lower it
      // Auto-benchmark: average frame ms measured over benchFrames frames
      // (after a warmup) — above downgradeMs drops one tier.
      benchWarmupFrames: 90,
      benchFrames: 60,
      downgradeMs: 26,
    },

    renderer: {
      maxPixelRatio: 2,
      exposure: 1.06,                     // ACES filmic exposure
      clearColor: 0x05080f,               // night sky behind everything
    },

    // ---- Phase 3: broadcast stadium light rig ----
    lights: {
      poleHeight: 48,                     // visible poles + actual light sources
      cornerXZ: [
        { x: -78, z: -44 }, { x: 78, z: -44 },
        { x: -78, z: 44 },  { x: 78, z: 44 },
      ],
      spot: {
        color: 0xfff5e6,                  // warm metal-halide white
        intensity: 1.3,                   // ×4 overlapping spots under ACES
        angle: 0.62,                      // wide enough to cover the field from a corner
        penumbra: 0.3,
        shadowMapSize: { HIGH: 2048, MEDIUM: 1536, LOW: 1024 },
        shadowCasters: { HIGH: 2, MEDIUM: 1, LOW: 1 },
        shadowNear: 25, shadowFar: 210, shadowBias: -0.0004, shadowNormalBias: 0.03,
      },
      hemisphere: { sky: 0x1a1a3e, ground: 0x3d6b33, intensity: 0.4 },
      ambient: { color: 0x102030, intensity: 0.12 },
      fill: { color: 0xdfe8ff, intensity: 0.3 },  // follows the camera, no shadows
      lensflare: { enabled: true, size: 110 },
      lightShafts: { enabled: true, opacity: 0.045, color: 0xfff3d6 },
    },

    // ---- Phase 2: photoreal field ----
    field: {
      stripeDark: '#3d6b33',
      stripeLight: '#4f8f43',
      dirtColor: '#6b4226',
      crownHeight: 0.10,                  // NFL crown: center higher than sidelines
      wetness: 0.0,                       // 0 dry .. 1 post-rain (lowers roughness)
      baseRoughness: 0.93,
      windAmplitude: 0.002,               // vertex-shader micro sway
      windFrequency: 1.6,
      paintWear: 0.22,                    // 0 crisp .. 1 heavily worn line paint
    },

    // ---- Phase 1: player materials (MeshPhysicalMaterial params) ----
    player: {
      jersey:   { roughness: 0.88, metalness: 0.0 },
      helmet:   { roughness: 0.12, metalness: 0.08, clearcoat: 1.0, clearcoatRoughness: 0.1 },
      facemask: { roughness: 0.35, metalness: 0.95, color: 0x52525a },
      visor:    { transmission: 0.6, roughness: 0.05, metalness: 0.0, color: 0x1a1a2e, opacity: 0.55 },
      skin:     { roughness: 0.72, metalness: 0.0 },
      glove:    { roughness: 0.55, metalness: 0.0, color: 0x16161a },
      cleatSole:  { roughness: 0.6, metalness: 0.1, color: 0x0c0c0c },
      cleatUpper: { roughness: 0.8, metalness: 0.0, color: 0x111114 },
      pants:    { roughness: 0.82, metalness: 0.0 },
      skinTones: ['#f5c5a3', '#c68642', '#8d5524', '#4a2912'],
      // Tessellation per tier: lathe radial segments / sphere segments.
      tessellation: {
        HIGH:   { lathe: 22, sphereW: 24, sphereH: 18 },
        MEDIUM: { lathe: 16, sphereW: 18, sphereH: 14 },
        LOW:    { lathe: 10, sphereW: 12, sphereH: 9 },
      },
    },

    // ---- Phase 7: LOD distances (units from camera) ----
    // The follow camera trails ~19 units behind the action, so everyone in
    // the core of a play stays on the full rig; the stand-in only takes
    // over for players on the far side of long fields (kickoffs, bombs).
    lod: {
      full: 0,         // articulated PBR rig
      simple: 55,      // static low-poly stand-in
      billboard: 120,  // camera-facing sprite
    },

    // ---- Phase 4: post-processing ----
    postfx: {
      ssao: { kernelRadius: 4, minDistance: 0.005, maxDistance: 0.1 },
      bloom: { threshold: 0.82, strength: 0.18, radius: 0.35 },
      depthOfField: { enabled: false, aperture: 0.00003, maxblur: 0.003 }, // toggle
      chromaticAberration: { offset: 0.0005 },
      colorGrade: { contrast: 1.08, saturation: 1.12, warmCool: 0.06 },
      vignette: { strength: 0.25, inner: 0.42, outer: 0.98 },
    },

    // ---- Phase 8: broadcast camera ----
    camera: {
      followDistance: 17, followHeight: 8.5,
      lerp: 0.09,                         // smooth tracking factor
      fovBase: 45, fovMin: 38, fovMax: 52,// telephoto with auto-zoom
      shakeAmplitude: 0.03,               // handheld broadcast wobble
      replaySeconds: 2.6,                 // low-angle TD replay duration
    },

    // ---- Phase 5: environment / atmosphere ----
    environment: {
      iblEnabled: true,                   // PMREM capture of the stadium for PBR
      sky: { top: 0x060a18, bottom: 0x152540 },
      fog: { color: 0x0c1220, near: 120, far: 340 },
      stars: 700,
    },
  };

  // Resolve the active tier, honoring a manual override.
  window.GRAPHICS_CONFIG.tier = function () {
    const q = window.GRAPHICS_CONFIG.quality;
    return q.mode === 'AUTO' ? q.current : q.mode;
  };
})();

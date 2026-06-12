// scene.js — Three.js scene setup, field, stadium, camera, state.
// Original assets. No licensed material.
window.FB = window.FB || {};

(function (FB) {
  'use strict';

  FB.const = { FIELD_LEN: 120, FIELD_WID: 53.3, EZ: 10, HASH_Z: 6 };

  FB.state = {
    phase: 'pregame',
    playType: null,
    down: 1, distance: 10, los: 25, ballOn: 25,
    possession: 'home',
    homeRecv: false,
    score: { home: 0, away: 0 },
    quarter: 1,
    quarterLen: 150,
    clockSeconds: 150,
    playClock: 25,
    timeouts: { home: 3, away: 3 },
    twoMinuteWarned: { half1: false, half2: false },
    difficulty: 'varsity',
    userTendencies: { run: 0, pass: 0, left: 0, right: 0, recentPlays: [] },
    gameStats: { home: {}, away: {} },
    log: [],
    spotZ: 0,
    twoPointAttempt: false,
  };
  FB.diffMult = { freshman: 0.86, jv: 1.05, varsity: 1.27, allspc: 1.45, easy: 0.88, normal: 1.10, hard: 1.27 };
  FB.diffLabels = { freshman: 'FRESHMAN', jv: 'JV', varsity: 'VARSITY', allspc: 'ALL SPC' };

  // Per-tier AI tuning — reaction delays (seconds), pursuit speed multipliers,
  // and turnover roll chances. Snap reaction is gated by FB.snapStartT (set in
  // FB.snapBall). Lower delay = quicker react. Higher pursuit = closer cover.
  FB.diffConfig = {
    freshman: {
      dLineReactionDelay: 0.60, dLinePressureSpeed: 0.85, dLineShedBlock: 0.10,
      dbReactionDelay: 0.50, dbManTrackingSpeed: 0.80, dbCoverageRadius: 7.0,
      dbJumpRouteChance: 0.000,
      lbReactionDelay: 0.55, lbPursuitSpeed: 0.80,
      safetyReactionDelay: 0.45,
      fumbleChanceOnHit: 0.01, fumbleChanceOnSack: 0.02, interceptionChance: 0.000,
      cpuQBDecisionDelay: 0.90, cpuRouteSharpness: 0.40,
    },
    jv: {
      dLineReactionDelay: 0.45, dLinePressureSpeed: 0.92, dLineShedBlock: 0.18,
      dbReactionDelay: 0.35, dbManTrackingSpeed: 0.90, dbCoverageRadius: 5.5,
      dbJumpRouteChance: 0.003,
      lbReactionDelay: 0.40, lbPursuitSpeed: 0.92,
      safetyReactionDelay: 0.32,
      fumbleChanceOnHit: 0.02, fumbleChanceOnSack: 0.04, interceptionChance: 0.006,
      cpuQBDecisionDelay: 0.65, cpuRouteSharpness: 0.60,
    },
    varsity: {
      dLineReactionDelay: 0.28, dLinePressureSpeed: 0.98, dLineShedBlock: 0.28,
      dbReactionDelay: 0.20, dbManTrackingSpeed: 1.00, dbCoverageRadius: 3.5,
      dbJumpRouteChance: 0.008,
      lbReactionDelay: 0.25, lbPursuitSpeed: 1.00,
      safetyReactionDelay: 0.19,
      fumbleChanceOnHit: 0.03, fumbleChanceOnSack: 0.06, interceptionChance: 0.013,
      cpuQBDecisionDelay: 0.42, cpuRouteSharpness: 0.80,
    },
    allspc: {
      dLineReactionDelay: 0.14, dLinePressureSpeed: 1.04, dLineShedBlock: 0.40,
      dbReactionDelay: 0.10, dbManTrackingSpeed: 1.10, dbCoverageRadius: 2.0,
      dbJumpRouteChance: 0.018,
      lbReactionDelay: 0.13, lbPursuitSpeed: 1.08,
      safetyReactionDelay: 0.10,
      fumbleChanceOnHit: 0.05, fumbleChanceOnSack: 0.10, interceptionChance: 0.022,
      cpuQBDecisionDelay: 0.24, cpuRouteSharpness: 0.95,
    },
  };
  FB.getDiffCfg = function () {
    return FB.diffConfig[FB.state.difficulty] || FB.diffConfig.varsity;
  };
  FB.teams = { home: null, away: null };
  FB.lineups = { home: null, away: null };

  // ---- yard/X math ----
  // Field: X axis -60..60 (120 yards incl. end zones). Home end zone: X -60..-50. Away: 50..60.
  // ballOn is 0..100 relative to possession: 0 = own goal line, 100 = opp goal line.
  FB.ballXFromYard = function (yard, possession) {
    if (possession === 'home') return -50 + yard;
    return 50 - yard;
  };
  FB.yardFromBallX = function (x, possession) {
    return possession === 'home' ? x + 50 : 50 - x;
  };
  FB.forwardDir = function (possession) { return possession === 'home' ? 1 : -1; };

  // Clamp a lateral Z to the hash marks — tackled outside a hash spots on it.
  FB.computeSpotZ = function (endZ) {
    const H = FB.const.HASH_Z;
    if (endZ > H) return H;
    if (endZ < -H) return -H;
    return endZ;
  };

  // ---- Three.js ----
  FB.initThree = function () {
    const GC = window.GRAPHICS_CONFIG;
    const canvas = document.getElementById('gl');
    // AA off: FXAA in the post chain handles edges far cheaper than MSAA on
    // mobile GPUs (see postfx.js).
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, GC.renderer.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Broadcast-style color pipeline: sRGB output + ACES filmic tonemap.
    // (r128 uses outputEncoding/sRGBEncoding — equivalent to outputColorSpace in newer releases.)
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = GC.renderer.exposure;
    renderer.setClearColor(GC.renderer.clearColor, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(GC.environment.fog.color, GC.environment.fog.near, GC.environment.fog.far);
    const camera = new THREE.PerspectiveCamera(GC.camera.fovBase, window.innerWidth / window.innerHeight, 0.5, 500);
    camera.position.set(-70, 18, 0); camera.lookAt(0, 2, 0);

    FB.scene = scene; FB.camera = camera; FB.renderer = renderer;
    FB.clock = new THREE.Clock();
    FB.playCam = { shake: 0 };

    buildBroadcastLightRig();
    createSky();
    createField();
    createStadium();
    buildEnvironmentIBL();

    // ---- Post-processing chain (postfx.js) ----
    if (FB.buildComposer) FB.buildComposer();

    window.addEventListener('resize', FB.onResize);
    window.addEventListener('orientationchange', FB.onResize);
  };

  // ============================================================
  //  PHASE 3 — Broadcast stadium light rig
  //  4 warm corner SpotLights (sources sit exactly on the visible
  //  pole clusters), a night-sky hemisphere for bounce, a faint
  //  ambient floor so shadows never crush to black, and one
  //  shadowless fill that follows the camera (kept aimed by
  //  camera-broadcast.js) so player faces always read on screen.
  //  Shadow-casting spot count is quality-tiered: every extra
  //  caster is a full scene depth render per frame.
  // ============================================================
  function buildBroadcastLightRig() {
    const GC = window.GRAPHICS_CONFIG;
    const L = GC.lights;
    const tier = GC.tier();
    const shadowCasters = L.spot.shadowCasters[tier] || 1;
    const mapSize = L.spot.shadowMapSize[tier] || 1024;

    FB.stadiumSpots = [];
    L.cornerXZ.forEach((c, i) => {
      const spot = new THREE.SpotLight(L.spot.color, L.spot.intensity);
      spot.position.set(c.x, L.poleHeight, c.z);
      spot.angle = L.spot.angle;
      spot.penumbra = L.spot.penumbra;
      spot.decay = 0;               // stadium floods: no distance falloff
      spot.target.position.set(c.x * 0.15, 0, c.z * 0.15); // aim past center for even coverage
      FB.scene.add(spot.target);
      // Opposite corners cast shadows first so the two shadow directions
      // cross — the classic multi-shadow stadium look.
      if ((i === 0 || i === 3) && FB.stadiumSpots.filter(s => s.castShadow).length < shadowCasters) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(mapSize, mapSize);
        spot.shadow.camera.near = L.spot.shadowNear;
        spot.shadow.camera.far = L.spot.shadowFar;
        spot.shadow.bias = L.spot.shadowBias;
        spot.shadow.normalBias = L.spot.shadowNormalBias;
      }
      FB.scene.add(spot);
      FB.stadiumSpots.push(spot);
    });

    const hemi = new THREE.HemisphereLight(L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity);
    FB.scene.add(hemi);

    const ambient = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
    FB.scene.add(ambient);

    // Camera-following fill — position is synced every frame by the
    // broadcast camera so front-facing geometry is never silhouetted.
    const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
    fill.castShadow = false;
    FB.scene.add(fill);
    FB.scene.add(fill.target);
    FB.fillLight = fill;
  }

  // ============================================================
  //  PHASE 5 — Image-based lighting
  //  A synthetic night-stadium cubemap (dark sky above, warm
  //  floodlit horizon band, green turf bounce below) becomes
  //  scene.environment, giving helmets/visors believable
  //  reflections on every PBR material.
  //
  //  NOTE: a live PMREMGenerator.fromScene capture was tried first
  //  and produced NaN samples on some GPU stacks (verified under
  //  SwiftShader), which blackens every MeshStandard/Physical
  //  material in r128. The procedural cubemap is built on plain
  //  canvases — no render targets — so it cannot fail that way.
  // ============================================================
  function buildEnvironmentIBL() {
    const GC = window.GRAPHICS_CONFIG;
    if (!GC.environment.iblEnabled) return;
    try {
      const size = 32;
      const face = (paint) => {
        const c = document.createElement('canvas'); c.width = c.height = size;
        paint(c.getContext('2d'));
        return c;
      };
      const skyTop = '#0a1228';
      const horizonWarm = '#6a5a3a';   // floodlight glow ring
      const grass = '#1d3a1f';
      const sideFace = () => face((ctx) => {
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, skyTop);
        g.addColorStop(0.55, '#2a2c3a');
        g.addColorStop(0.72, horizonWarm);
        g.addColorStop(0.8, '#3a4030');
        g.addColorStop(1, grass);
        ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
      });
      // Order: +x, -x, +y (sky), -y (turf), +z, -z.
      const cube = new THREE.CubeTexture([
        sideFace(), sideFace(),
        face((ctx) => { ctx.fillStyle = skyTop; ctx.fillRect(0, 0, size, size); }),
        face((ctx) => { ctx.fillStyle = grass; ctx.fillRect(0, 0, size, size); }),
        sideFace(), sideFace(),
      ]);
      cube.needsUpdate = true;
      cube.encoding = THREE.sRGBEncoding;
      FB.scene.environment = cube;
    } catch (e) {
      // IBL is purely cosmetic — never let it break startup.
    }
  }

  FB.onResize = function () {
    FB.renderer.setSize(window.innerWidth, window.innerHeight);
    FB.camera.aspect = window.innerWidth / window.innerHeight;
    FB.camera.updateProjectionMatrix();
    if (FB.composer) FB.composer.setSize(window.innerWidth, window.innerHeight);
  };

  // Night-game sky: the renderer clear color IS the sky (deep navy-black),
  // dressed with a sparse star field. A geometric sky dome was tried in two
  // implementations (gradient ShaderMaterial, vertex-colored basic) and
  // both read several stops too bright on real pipelines, washing out the
  // night-game contrast that sells the broadcast look — the flat clear
  // color + stars is darker, cheaper, and looks correct.
  function createSky() {
    const GC = window.GRAPHICS_CONFIG;

    // Stars: one Points cloud on the upper dome, additive so they twinkle
    // through the bloom pass without costing draw calls.
    const n = GC.environment.stars;
    const starPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.15 + Math.random() * 0.8); // keep above horizon
      const r = 290;
      starPos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcdd8ff, size: 1.1, sizeAttenuation: false,
      transparent: true, opacity: 0.7, fog: false, depthWrite: false,
    }));
    FB.scene.add(stars);
  }

  // ============================================================
  //  PHASE 2 — Photoreal turf
  //  Baked full-field albedo (mow stripes, dirt wear, blade noise),
  //  a dual-scale procedural normal map (large undulation + blade
  //  micro-detail blended in one bake), a noise roughness map so
  //  patches catch the floods unevenly, a wetness control, a field
  //  crown, and a vertex-shader wind micro-sway injected via
  //  onBeforeCompile (see createField).
  // ============================================================

  // NFL crown: the field is highest at its center line and falls off
  // parabolically toward the sidelines. Everything that needs to sit on the
  // grass (players, ref, markings) queries this.
  FB.fieldCrownY = function (z) {
    const half = FB.const.FIELD_WID / 2;
    const crown = window.GRAPHICS_CONFIG.field.crownHeight;
    const t = Math.min(1, Math.abs(z) / half);
    return crown * (1 - t * t);
  };

  // Full-field albedo at 2048×1024. Mowing stripes alternate the two spec
  // greens every 5 yards; dirt is blended in along the hash rows, between
  // the tackles, and at the end-zone fringes where cleats chew the grass.
  function mowedTurfTexture() {
    const { FIELD_LEN, FIELD_WID, EZ, HASH_Z } = FB.const;
    const GC = window.GRAPHICS_CONFIG.field;
    const w = 2048, h = 1024;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    // Mowing stripes every 5 yards across the full field length.
    const numStripes = FIELD_LEN / 5;           // 24
    const stripeW = w / numStripes;
    for (let i = 0; i < numStripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? GC.stripeLight : GC.stripeDark;
      ctx.fillRect(i * stripeW, 0, stripeW + 1, h);
    }

    // Dirt wear: hash rows, the high-traffic middle, and a fringe just
    // outside each goal line where every series stacks bodies.
    const yAt = (z) => ((z + FIELD_WID / 2) / FIELD_WID) * h;
    const ezPx = (EZ / FIELD_LEN) * w;
    ctx.globalAlpha = 1;
    const dirtBand = (zCenter, zHalf, alpha) => {
      const grad = ctx.createLinearGradient(0, yAt(zCenter - zHalf), 0, yAt(zCenter + zHalf));
      grad.addColorStop(0, 'rgba(107,66,38,0)');
      grad.addColorStop(0.5, 'rgba(107,66,38,' + alpha + ')');
      grad.addColorStop(1, 'rgba(107,66,38,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(ezPx, yAt(zCenter - zHalf), w - 2 * ezPx, (2 * zHalf / FIELD_WID) * h);
    };
    dirtBand(HASH_Z, 1.6, 0.22);
    dirtBand(-HASH_Z, 1.6, 0.22);
    dirtBand(0, 2.4, 0.30);
    // Goal-line wear patches.
    for (const gx of [ezPx, w - ezPx]) {
      const grad = ctx.createLinearGradient(gx - 40, 0, gx + 40, 0);
      grad.addColorStop(0, 'rgba(107,66,38,0)');
      grad.addColorStop(0.5, 'rgba(107,66,38,0.20)');
      grad.addColorStop(1, 'rgba(107,66,38,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gx - 40, h * 0.18, 80, h * 0.64);
    }

    // Compacted center-field shadow near the 50.
    const cx = w / 2, cy = h / 2;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.28);
    rg.addColorStop(0, 'rgba(60,40,22,0.12)');
    rg.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);

    // High-density grass-blade noise (alternating bright/dark single pixels).
    for (let n = 0; n < 140000; n++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      if (Math.random() < 0.55) {
        ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.14) + ')';
      } else {
        ctx.fillStyle = 'rgba(225,245,195,' + (Math.random() * 0.10) + ')';
      }
      ctx.fillRect(x, y, 1, 1);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    return tex;
  }

  // Tiling dual-scale grass normal map. Two Perlin-style smoothed noise
  // fields are sampled at different frequencies and blended in one bake —
  // the coarse layer reads as turf undulation, the fine layer as individual
  // blade micro-detail — which matches a two-sample shader blend without
  // any custom fragment code.
  function turfNormalMap() {
    const size = 256;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const noise = () => {
      const a = new Float32Array(size * size);
      for (let i = 0; i < a.length; i++) a[i] = Math.random();
      return a;
    };
    // Wrapping 3×3 box blur — repeated passes turn white noise into
    // smooth Perlin-like undulation.
    const blur = (src, passes) => {
      let cur = src;
      for (let p = 0; p < passes; p++) {
        const out = new Float32Array(cur.length);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const xx = (x + dx + size) % size;
                const yy = (y + dy + size) % size;
                s += cur[yy * size + xx];
              }
            }
            out[y * size + x] = s / 9;
          }
        }
        cur = out;
      }
      return cur;
    };
    const coarse = blur(noise(), 6);   // large-scale surface variation
    const fine = blur(noise(), 1);     // per-blade micro detail
    const height = new Float32Array(size * size);
    for (let i = 0; i < height.length; i++) {
      height[i] = coarse[i] * 0.65 + fine[i] * 0.35;
    }
    // Gradient → tangent-space normal.
    const img = ctx.createImageData(size, size);
    const strength = 5.0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xl = (x - 1 + size) % size, xr = (x + 1) % size;
        const yt = (y - 1 + size) % size, yb = (y + 1) % size;
        const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
        const dy = (height[yb * size + x] - height[yt * size + x]) * strength;
        const nx = -dx, ny = -dy, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        const i = (y * size + x) * 4;
        img.data[i + 0] = Math.floor((nx / len * 0.5 + 0.5) * 255);
        img.data[i + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);
        img.data[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // ~40 × 18 tiles across the 120×53.3yd field keeps each tile ≈3 yd square.
    tex.repeat.set(40, 18);
    tex.anisotropy = 8;
    return tex;
  }

  // Tiling roughness variation: smoothed noise remapped to green-channel
  // gray so patches of grass catch the floods at different intensities.
  function turfRoughnessMap() {
    const size = 128;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const a = new Float32Array(size * size);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            s += a[(((y + dy + size) % size) * size) + ((x + dx + size) % size)];
          }
        }
        // 0.78..1.0 multiplier band — never glossy, never flat.
        const v = Math.floor((0.78 + (s / 25) * 0.22) * 255);
        const i = (y * size + x) * 4;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(24, 11);
    return tex;
  }

  // Worn-paint alpha mask for the white field markings — real painted turf
  // is never a perfectly crisp vector line.
  function paintWearAlpha() {
    const size = 128;
    const wear = window.GRAPHICS_CONFIG.field.paintWear;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    for (let n = 0; n < 2600 * wear; n++) {
      const g = Math.floor(140 + Math.random() * 90);
      ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function endZoneTexture(label, primary, secondary) {
    // Canvas is tall (V axis is the long dimension) because once the
    // texture wraps a flat PlaneGeometry(EZ, FIELD_WID), the canvas's V
    // axis maps to the 53.3-unit sideline-to-sideline direction. Drawing
    // the text rotated -90deg in this tall canvas puts the reading
    // direction along V, so the end zone label reads horizontally across
    // the field instead of vertically into it.
    const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = primary; ctx.fillRect(0, 0, c.width, c.height);
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 10, c.width / 2, c.height / 2, c.height / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = secondary;
    ctx.font = 'bold 160px system-ui, -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label.toUpperCase(), 0, 0);
    ctx.restore();
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  function yardNumberTexture(n) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 150px system-ui, -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), c.width / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c);
    t.transparent = true;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  // Bend a flat (rotation.x = -PI/2) plane geometry so it drapes over the
  // field crown. With that rotation, local +Z is world up and world Z equals
  // (mesh z - local Y), so every vertex gets localZ = crown(worldZ) + lift.
  function drapeOnCrown(geo, meshZ, lift) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const worldZ = meshZ - p.getY(i);
      p.setZ(i, FB.fieldCrownY(worldZ) + lift);
    }
    geo.computeVertexNormals();
    return geo;
  }

  function createField() {
    const { FIELD_LEN, FIELD_WID, EZ } = FB.const;
    const GC = window.GRAPHICS_CONFIG.field;
    const group = new THREE.Group();
    FB.scene.add(group);
    FB.fieldGroup = group;

    // Crowned turf with wetness-aware roughness. The wind micro-sway is
    // injected into the standard material's vertex shader so all lighting
    // and shadow code stays stock.
    const wetness = GC.wetness;
    const turfMat = new THREE.MeshStandardMaterial({
      map: mowedTurfTexture(),
      normalMap: turfNormalMap(),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: turfRoughnessMap(),
      roughness: GC.baseRoughness * (1 - 0.45 * wetness),
      metalness: 0.0,
      envMapIntensity: 0.35 + wetness * 0.9,
    });
    FB.turfUniforms = { uTime: { value: 0 } };
    turfMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = FB.turfUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          // Local +Z is world up on this plane: imperceptible sine sway that
          // keeps the grass from reading as a dead-still photograph.
          'transformed.z += sin(position.x * ' + GC.windFrequency.toFixed(2) +
          ' + position.y * 0.9 + uTime * 1.7) * ' + GC.windAmplitude.toFixed(4) + ';');
    };
    const turfGeo = new THREE.PlaneGeometry(FIELD_LEN, FIELD_WID, 2, 48);
    drapeOnCrown(turfGeo, 0, 0);
    const turf = new THREE.Mesh(turfGeo, turfMat);
    turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true; group.add(turf);

    // Runtime wetness control (e.g. FB.setFieldWetness(0.7) for a rain look).
    FB.setFieldWetness = function (v) {
      const w = Math.max(0, Math.min(1, v));
      turfMat.roughness = GC.baseRoughness * (1 - 0.45 * w);
      turfMat.envMapIntensity = 0.35 + w * 0.9;
      turfMat.needsUpdate = true;
    };

    const homeEZGeo = drapeOnCrown(new THREE.PlaneGeometry(EZ, FIELD_WID, 1, 24), 0, 0.012);
    const homeEZ = new THREE.Mesh(homeEZGeo,
      new THREE.MeshStandardMaterial({
        map: endZoneTexture('HIGHLANDERS', '#0a2463', '#ffffff'),
        roughness: 0.9, metalness: 0.0,
        polygonOffset: true, polygonOffsetFactor: -1,
      }));
    homeEZ.rotation.x = -Math.PI / 2; homeEZ.position.set(-55, 0, 0);
    homeEZ.receiveShadow = true; group.add(homeEZ);
    const awayEZ = new THREE.Mesh(homeEZGeo.clone(),
      new THREE.MeshStandardMaterial({
        map: endZoneTexture('SPARTANS', '#b22222', '#ffd700'),
        roughness: 0.9, metalness: 0.0,
        polygonOffset: true, polygonOffsetFactor: -1,
      }));
    awayEZ.rotation.x = -Math.PI / 2; awayEZ.position.set(55, 0, 0);
    awayEZ.receiveShadow = true; group.add(awayEZ);

    // White markings — unlit, not tonemapped (so they stay TV-white under
    // ACES), with a worn-paint alpha mask so the lines read as real painted
    // turf instead of vector graphics.
    const wearTex = paintWearAlpha();
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false,
      alphaMap: wearTex, transparent: true,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const lineGeo = drapeOnCrown(new THREE.PlaneGeometry(0.25, FIELD_WID, 1, 24), 0, 0.022);
    for (let yd = -50; yd <= 50; yd += 5) {
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2; line.position.set(yd, 0, 0); group.add(line);
    }
    for (let yd = -40; yd <= 40; yd += 10) {
      const n = 50 - Math.abs(yd);
      for (const zSide of [-18, 18]) {
        const tex = yardNumberTexture(n);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(5, 5),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 }));
        pl.rotation.x = -Math.PI / 2;
        // Numbers on the +z sideline must flip so they read right-side-up to
        // that sideline's viewer.
        if (zSide > 0) pl.rotation.z = Math.PI;
        pl.position.set(yd, FB.fieldCrownY(zSide) + 0.03, zSide); group.add(pl);
      }
    }
    const hashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, alphaMap: wearTex, transparent: true,
    });
    for (let yd = -49; yd <= 49; yd++) {
      for (const z of [-6, 6]) {
        const h = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), hashMat);
        h.rotation.x = -Math.PI / 2; h.position.set(yd, FB.fieldCrownY(z) + 0.025, z); group.add(h);
      }
    }
    const sidelineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, alphaMap: wearTex, transparent: true,
    });
    for (const z of [-FIELD_WID / 2, FIELD_WID / 2]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_LEN, 0.3), sidelineMat);
      s.rotation.x = -Math.PI / 2; s.position.set(0, 0.02, z); group.add(s);
    }
    for (const side of [-55, 55]) {
      // Goalposts — metallic gold so they catch the sun.
      const postMat = new THREE.MeshStandardMaterial({ color: 0xffc72c, roughness: 0.32, metalness: 0.75 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4, 8), postMat);
      base.position.set(side > 0 ? side + 5 : side - 5, 2, 0); group.add(base);
      const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.17, 8), postMat);
      cross.rotation.x = Math.PI / 2; cross.position.set(base.position.x, 4, 0); group.add(cross);
      for (const zp of [-3.08, 3.08]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 10, 8), postMat);
        up.position.set(base.position.x, 9, zp); group.add(up);
      }
    }

    // Broadcast overlay lines: pure color, not tonemapped, so they read
    // through the ACES pipeline the way they do on TV. Pre-draped on the
    // crown — the crown only varies across the width, so the bent geometry
    // stays valid as these lines slide along X.
    FB.firstDownLine = new THREE.Mesh(
      drapeOnCrown(new THREE.PlaneGeometry(0.4, FIELD_WID, 1, 24), 0, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.75, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -4 }));
    FB.firstDownLine.rotation.x = -Math.PI / 2; FB.firstDownLine.position.y = 0; group.add(FB.firstDownLine);

    FB.losLine = new THREE.Mesh(
      drapeOnCrown(new THREE.PlaneGeometry(0.35, FIELD_WID, 1, 24), 0, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.7, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -4 }));
    FB.losLine.rotation.x = -Math.PI / 2; FB.losLine.position.y = 0; group.add(FB.losLine);

    createReferee();
  }

  // Zebra-striped referee who carries the ball between plays.
  function zebraStripeTex() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#111111';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 8, 0, 4, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }
  function createReferee() {
    const ref = new THREE.Group();
    const stripeTex = zebraStripeTex();
    stripeTex.encoding = THREE.sRGBEncoding;
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.5, 1.2, 12),
      new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.85 })
    );
    torso.position.y = 1.6; torso.castShadow = true; ref.add(torso);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xf4c89b, roughness: 0.7 })
    );
    head.position.y = 2.45; ref.add(head);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })
    );
    cap.position.y = 2.72; ref.add(cap);
    const pants = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.35, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })
    );
    pants.position.y = 0.6; pants.castShadow = true; ref.add(pants);
    ref.visible = false;
    FB.scene.add(ref);
    FB.referee = ref;
  }

  // Referee three-phase spot: (1) walk to spot carrying the ball,
  // (2) place the ball on the ground, (3) step aside off the hash — then fire
  // `cb` so the play picker opens and eventually the 22 players spawn.
  FB.startRefSpot = function (from, to, cb) {
    if (!FB.referee) { if (cb) cb(); return; }
    FB.referee.visible = true;
    FB.referee.position.set(from.x, 0, from.z);
    FB.ballState.carried = false;
    FB.ballState.inAir = false;
    FB.ballCarrier = null;
    FB.ball.position.set(from.x, 2.1, from.z + 0.35);
    // Pick a step-aside direction: perpendicular to the walk, away from center.
    const walkDx = to.x - from.x, walkDz = to.z - from.z;
    const walkLen = Math.hypot(walkDx, walkDz) || 1;
    const perpX = -walkDz / walkLen, perpZ = walkDx / walkLen;
    const awaySign = to.z > 0 ? 1 : -1;
    const stepZ = to.z + awaySign * 3.5;
    const stepX = to.x + perpX * 0.6;
    FB.refState = {
      phase: 'walk', t: 0,
      fx: from.x, fz: from.z, tx: to.x, tz: to.z,
      sx: stepX, sz: stepZ,
      durWalk: 0.9, durPlace: 0.35, durStep: 0.7,
      cb,
      fired: false,
    };
    // Hard fallback: even if the animation path somehow stalls, fire the
    // callback so the game never freezes waiting on the referee.
    const stateRef = FB.refState;
    setTimeout(() => {
      if (stateRef && !stateRef.fired) {
        stateRef.fired = true;
        FB.referee.visible = false;
        if (FB.refState === stateRef) FB.refState = null;
        if (cb) { try { cb(); } catch (e) { FB.flashWarn && FB.flashWarn('Ref fallback err: ' + (e && e.message ? e.message : e)); } }
      }
    }, 2500);
  };

  FB.updateRefAnim = function (dt) {
    const r = FB.refState;
    if (!r) return;
    r.t += dt;
    if (r.phase === 'walk') {
      const p = Math.min(1, r.t / r.durWalk);
      const x = r.fx + (r.tx - r.fx) * p;
      const z = r.fz + (r.tz - r.fz) * p;
      FB.referee.position.set(x, FB.fieldCrownY(z), z);
      const dx = r.tx - r.fx, dz = r.tz - r.fz;
      if (dx * dx + dz * dz > 0.0001) FB.referee.rotation.y = Math.atan2(dx, dz);
      FB.ball.position.set(x, 2.1, z + 0.35);
      if (p >= 1) { r.phase = 'place'; r.t = 0; }
    } else if (r.phase === 'place') {
      // Ref bends slightly and the ball drops to the ground on the spot.
      const p = Math.min(1, r.t / r.durPlace);
      const ballY = 2.1 + (0.35 - 2.1) * p;
      FB.ball.position.set(r.tx, ballY, r.tz);
      FB.referee.position.set(r.tx, FB.fieldCrownY(r.tz), r.tz);
      // Simulate a small bow by scaling the referee vertically.
      FB.referee.scale.y = 1 - 0.15 * Math.sin(Math.PI * p);
      if (p >= 1) {
        FB.referee.scale.y = 1;
        FB.ball.position.set(r.tx, 0.35, r.tz);
        r.phase = 'step'; r.t = 0;
      }
    } else if (r.phase === 'step') {
      // Ref walks aside so the field is clear for the offense/defense spawn.
      const p = Math.min(1, r.t / r.durStep);
      const x = r.tx + (r.sx - r.tx) * p;
      const z = r.tz + (r.sz - r.tz) * p;
      FB.referee.position.set(x, FB.fieldCrownY(z), z);
      const dx = r.sx - r.tx, dz = r.sz - r.tz;
      if (dx * dx + dz * dz > 0.0001) FB.referee.rotation.y = Math.atan2(dx, dz);
      if (p >= 1 && !r.fired) {
        r.fired = true;
        FB.referee.visible = false;
        const cb = r.cb;
        FB.refState = null;
        if (cb) {
          try { cb(); }
          catch (err) {
            FB.flashWarn && FB.flashWarn('Ref cb err: ' + (err && err.message ? err.message : err));
            // Don't leave the game frozen — hide players and offer a fallback play picker.
            setTimeout(() => {
              try { FB.hideAllPlayers && FB.hideAllPlayers(); FB.setupPlay && FB.setupPlay('pass'); }
              catch (_) {}
            }, 400);
          }
        }
      }
    }
  };

  function createStadium() {
    const g = new THREE.Group(); FB.scene.add(g);
    FB.stadiumGroup = g;
    buildStands(g);
    buildCrowd(g);
    buildJumbotron(g);
    buildLightPoles(g);
    buildStadiumSignage(g);
  }

  // ---- Stands (tiered bleachers) ----
  function buildStands(g) {
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x262c38, roughness: 0.92, metalness: 0.02 });
    const treadMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.95, metalness: 0.02 });

    // Sideline stands — long. Z ranges beyond each sideline.
    for (const zSign of [-1, 1]) {
      const tiers = 10;
      for (let t = 0; t < tiers; t++) {
        const y = 0.7 + t * 1.3;
        const z = zSign * (28 + t * 1.6);
        // Riser (vertical face under the row above)
        const riser = new THREE.Mesh(new THREE.BoxGeometry(154, 1.3, 0.8), riserMat);
        riser.position.set(0, y, z - zSign * 0.45);
        riser.castShadow = true; riser.receiveShadow = true;
        g.add(riser);
        // Tread (horizontal step that seats sit on)
        const tread = new THREE.Mesh(new THREE.BoxGeometry(154, 0.25, 1.6), treadMat);
        tread.position.set(0, y + 0.65, z - zSign * 1.2);
        tread.receiveShadow = true;
        g.add(tread);
      }
    }

    // End-zone stands — shorter, rotated perpendicular.
    for (const xSign of [-1, 1]) {
      const tiers = 8;
      for (let t = 0; t < tiers; t++) {
        const y = 0.7 + t * 1.3;
        const x = xSign * (64 + t * 1.6);
        const riser = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 88), riserMat);
        riser.position.set(x - xSign * 0.45, y, 0);
        riser.castShadow = true; riser.receiveShadow = true;
        g.add(riser);
        const tread = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 88), treadMat);
        tread.position.set(x - xSign * 1.2, y + 0.65, 0);
        tread.receiveShadow = true;
        g.add(tread);
      }
    }

    // Outer wall so you don't see sky through the stadium from the ground.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.95 });
    const longWall = new THREE.BoxGeometry(170, 16, 1);
    const shortWall = new THREE.BoxGeometry(1, 16, 100);
    for (const zSign of [-1, 1]) {
      const w = new THREE.Mesh(longWall, wallMat);
      w.position.set(0, 8, zSign * 46);
      g.add(w);
    }
    for (const xSign of [-1, 1]) {
      const w = new THREE.Mesh(shortWall, wallMat);
      w.position.set(xSign * 80, 8, 0);
      g.add(w);
    }
  }

  // ---- Crowd (single InstancedMesh, ~3.5k people) ----
  function buildCrowd(g) {
    // A blocky "person" geometry centered on the feet: body + sphere head.
    // We bake them into ONE geometry by merging vertex arrays manually —
    // r128 core doesn't ship BufferGeometryUtils, so we build it by hand.
    const personGeo = makePersonGeometry();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.95, metalness: 0.0,
      vertexColors: false,           // color comes from instanceColor
    });

    // Collect seat positions across every tier.
    const seats = []; // { x, y, z, home:boolean }
    const pushRow = (xs, xe, z, y, home) => {
      const count = Math.floor((xe - xs) / 0.62);
      for (let i = 0; i < count; i++) {
        seats.push({
          x: xs + (i + 0.5) * (xe - xs) / count + (Math.random() - 0.5) * 0.15,
          y: y + (Math.random() - 0.5) * 0.05,
          z: z + (Math.random() - 0.5) * 0.2,
          home,
        });
      }
    };
    // Sideline seat rows (home side = -z, away side = +z)
    for (const zSign of [-1, 1]) {
      const tiers = 10;
      for (let t = 0; t < tiers; t++) {
        const y = 0.95 + t * 1.3;
        const z = zSign * (28.8 + t * 1.6);
        pushRow(-72, 72, z, y, zSign < 0);
      }
    }
    // End-zone seat rows — alternate coloring for visual variety.
    for (const xSign of [-1, 1]) {
      const tiers = 8;
      for (let t = 0; t < tiers; t++) {
        const y = 0.95 + t * 1.3;
        const x = xSign * (64.8 + t * 1.6);
        const count = Math.floor(82 / 0.62);
        for (let i = 0; i < count; i++) {
          seats.push({
            x: x + (Math.random() - 0.5) * 0.18,
            y: y + (Math.random() - 0.5) * 0.05,
            z: -41 + (i + 0.5) * 82 / count + (Math.random() - 0.5) * 0.15,
            // End zone crowd: mixed, slight home lean if on home side
            home: xSign < 0,
          });
        }
      }
    }

    const total = seats.length;
    const crowd = new THREE.InstancedMesh(personGeo, mat, total);
    crowd.castShadow = false; crowd.receiveShadow = false;
    crowd.frustumCulled = false; // bowl is wide; keep it drawing

    const HOME_COLOR = new THREE.Color(0x0a2463);  // Highlanders navy
    const AWAY_COLOR = new THREE.Color(0xb22222);  // Spartans crimson
    const NEUTRAL = [
      0xf0b400, 0xffffff, 0x333333, 0x8a6d3b, 0xcccccc,
      0x2e7d57, 0x7a3a3a, 0x444c5c, 0xddb15a,
    ].map(c => new THREE.Color(c));

    const m = new THREE.Matrix4();
    const rot = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const tmpColor = new THREE.Color();
    const basePos = new Float32Array(total * 3);
    const phases = new Float32Array(total);

    for (let i = 0; i < total; i++) {
      const p = seats[i];
      basePos[i * 3 + 0] = p.x;
      basePos[i * 3 + 1] = p.y;
      basePos[i * 3 + 2] = p.z;
      phases[i] = Math.random() * Math.PI * 2;

      // Small random scale and heading so the crowd isn't uniform.
      rot.set(0, (Math.random() - 0.5) * 0.7, 0);
      quat.setFromEuler(rot);
      const s = 0.92 + Math.random() * 0.22;
      scl.set(s, s, s);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), quat, scl);
      crowd.setMatrixAt(i, m);

      // Team-weighted color: home seats favor navy; away favor crimson; end
      // zones mix evenly. ~15% get a "neutral" fan color.
      const homeLean = p.home ? 0.68 : 0.28;
      const r = Math.random();
      if (r < homeLean) tmpColor.copy(HOME_COLOR);
      else if (r < homeLean + 0.22) tmpColor.copy(AWAY_COLOR);
      else tmpColor.copy(NEUTRAL[Math.floor(Math.random() * NEUTRAL.length)]);
      // Slight per-instance brightness jitter so the crowd doesn't flat-tone.
      const j = 0.82 + Math.random() * 0.36;
      tmpColor.multiplyScalar(j);
      crowd.setColorAt(i, tmpColor);
    }
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;

    g.add(crowd);
    FB.crowd = {
      mesh: crowd,
      basePos,
      phases,
      count: total,
      _m: new THREE.Matrix4(),
      _q: new THREE.Quaternion(),
      _s: new THREE.Vector3(1, 1, 1),
      _v: new THREE.Vector3(),
    };
  }

  function makePersonGeometry() {
    // Body box + head sphere, translated into position. Merge by concat.
    const body = new THREE.BoxGeometry(0.5, 1.0, 0.38);
    body.translate(0, 0.5, 0);
    const head = new THREE.SphereGeometry(0.22, 8, 6);
    head.translate(0, 1.22, 0);

    // Manual merge of two buffer geometries (r128 core lacks utils).
    const bPos = body.attributes.position.array;
    const bNorm = body.attributes.normal.array;
    const hPos = head.attributes.position.array;
    const hNorm = head.attributes.normal.array;
    const positions = new Float32Array(bPos.length + hPos.length);
    positions.set(bPos, 0); positions.set(hPos, bPos.length);
    const normals = new Float32Array(bNorm.length + hNorm.length);
    normals.set(bNorm, 0); normals.set(hNorm, bNorm.length);

    let indices;
    if (body.index && head.index) {
      const bIdx = body.index.array, hIdx = head.index.array;
      const offset = bPos.length / 3;
      indices = new (hIdx.constructor)(bIdx.length + hIdx.length);
      indices.set(bIdx, 0);
      for (let i = 0; i < hIdx.length; i++) indices[bIdx.length + i] = hIdx[i] + offset;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1));
    body.dispose(); head.dispose();
    return geo;
  }

  // Per-frame breathing animation: wavy Y-bob on every seated fan. Called
  // from the main tick in logic-loop.js.
  FB.updateCrowd = function (time) {
    const C = FB.crowd;
    if (!C) return;
    const m = C._m, q = C._q, s = C._s, v = C._v;
    const base = C.basePos, phases = C.phases, amp = 0.09;
    q.identity();
    for (let i = 0; i < C.count; i++) {
      const bx = base[i * 3 + 0];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      const off = Math.sin(time * 1.35 + phases[i]) * amp;
      v.set(bx, by + off, bz);
      m.compose(v, q, s);
      C.mesh.setMatrixAt(i, m);
    }
    C.mesh.instanceMatrix.needsUpdate = true;
  };

  // ---- Jumbotron at the far end zone ----
  function buildJumbotron(g) {
    const jumboCanvas = document.createElement('canvas');
    jumboCanvas.width = 1024; jumboCanvas.height = 512;
    const jctx = jumboCanvas.getContext('2d');
    jctx.fillStyle = '#0a1829'; jctx.fillRect(0, 0, 1024, 512);
    // Border
    jctx.strokeStyle = '#ffcc00'; jctx.lineWidth = 10;
    jctx.strokeRect(10, 10, 1004, 492);
    // Team line
    jctx.fillStyle = '#4cc9f0';
    jctx.font = 'bold 110px system-ui, sans-serif';
    jctx.textAlign = 'center';
    jctx.fillText('HIGHLANDERS', 512, 170);
    jctx.fillStyle = '#ffffff';
    jctx.font = 'bold 70px system-ui, sans-serif';
    jctx.fillText('vs', 512, 270);
    jctx.fillStyle = '#ff4d4d';
    jctx.font = 'bold 110px system-ui, sans-serif';
    jctx.fillText('SPARTANS', 512, 400);
    const jumboTex = new THREE.CanvasTexture(jumboCanvas);
    jumboTex.encoding = THREE.sRGBEncoding;
    jumboTex.anisotropy = 8;

    const screenMat = new THREE.MeshStandardMaterial({
      map: jumboTex,
      emissive: 0xffffff,
      emissiveMap: jumboTex,
      emissiveIntensity: 0.85,   // bright but readable — 1.1 clipped to white under bloom
      roughness: 0.35, metalness: 0.1,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.55, metalness: 0.35 });

    // Mount it above the far (away) end zone so it's visible from the default
    // camera side.
    const JX = 82, JY = 28, JZ = 0;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 18, 48), screenMat);
    screen.position.set(JX, JY, JZ);
    // Screen normal faces -X toward the field center.
    g.add(screen);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 22, 54), frameMat);
    frame.position.set(JX + 0.25, JY, JZ);
    g.add(frame);
    // Two support columns down to the stand
    for (const zOff of [-18, 18]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(1, JY, 1), frameMat);
      col.position.set(JX + 0.5, JY / 2, zOff);
      col.castShadow = true;
      g.add(col);
    }
  }

  // ---- 4 stadium light poles at the corners with emissive bulbs ----
  // The visible bulb clusters sit exactly where the Phase-3 SpotLight
  // sources are, so the lens flares, light shafts, and actual illumination
  // all agree on where the light comes from.
  function buildLightPoles(g) {
    const GC = window.GRAPHICS_CONFIG.lights;
    const H = GC.poleHeight;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.6, metalness: 0.5 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xfff2cc,
      emissiveIntensity: 2.6,
      roughness: 0.2,
    });
    const flareTextures = GC.lensflare.enabled ? makeFlareTextures() : null;
    for (const c of GC.cornerXZ) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, H, 8), poleMat);
      pole.position.set(c.x, H / 2, c.z);
      pole.castShadow = true;
      g.add(pole);
      // Cross arm for the bulb cluster
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.5, 0.5), poleMat);
      arm.position.set(c.x + Math.sign(-c.x) * 1.5, H + 0.2, c.z + Math.sign(-c.z) * 1.5);
      g.add(arm);
      // 4x3 lamp grid — bright enough to clip into the bloom threshold.
      const cluster = new THREE.Group();
      cluster.position.set(c.x + Math.sign(-c.x) * 2.5, H + 0.2, c.z + Math.sign(-c.z) * 2.5);
      for (let i = 0; i < 12; i++) {
        const bx = ((i % 4) - 1.5) * 0.85;
        const by = (Math.floor(i / 4) - 1) * 0.75;
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.22), bulbMat);
        bulb.position.set(bx, by, 0);
        cluster.add(bulb);
      }
      cluster.lookAt(0, 8, 0);
      g.add(cluster);

      // Broadcast-lens flare anchored on the cluster (Phase 5).
      if (flareTextures && THREE.Lensflare && THREE.LensflareElement) {
        const flare = new THREE.Lensflare();
        flare.addElement(new THREE.LensflareElement(flareTextures.core, GC.lensflare.size, 0, new THREE.Color(0xfff2cc)));
        flare.addElement(new THREE.LensflareElement(flareTextures.ghost, 28, 0.45));
        flare.addElement(new THREE.LensflareElement(flareTextures.ghost, 16, 0.8));
        cluster.add(flare);
      }

      // Volumetric-style light shaft: a SHORT additive cone hanging off the
      // lamp head, faded along its length by a gradient texture — a cheap
      // god-ray stand-in. Kept deliberately small: a full light-to-field
      // cone puts the gameplay camera inside it and the additive veil
      // washes out the whole frame.
      if (GC.lightShafts.enabled) {
        const target = new THREE.Vector3(c.x * 0.15, 0, c.z * 0.15);
        const src = new THREE.Vector3(c.x, H, c.z);
        const dir = target.clone().sub(src).normalize();
        const len = 26, baseR = 6.5;
        const shaft = new THREE.Mesh(
          new THREE.ConeGeometry(baseR, len, 10, 1, true),
          new THREE.MeshBasicMaterial({
            color: GC.lightShafts.color,
            transparent: true,
            opacity: GC.lightShafts.opacity,
            alphaMap: shaftGradientTex(),
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.FrontSide,
            fog: false,
          })
        );
        // Cone apex points +Y by default; flip so the apex sits at the lamp
        // and the (faded-out) base hangs toward the field.
        shaft.position.copy(src.clone().addScaledVector(dir, len / 2));
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
        g.add(shaft);
      }
    }
  }

  // Vertical alpha gradient for the light shafts: bright at the lamp (cone
  // apex = +V on the cone's side UVs), fading to nothing toward the base.
  let _shaftTex = null;
  function shaftGradientTex() {
    if (_shaftTex) return _shaftTex;
    const c = document.createElement('canvas'); c.width = 8; c.height = 64;
    const ctx = c.getContext('2d');
    // CanvasTexture flips Y: canvas row 0 lands at v=1, which is the cone
    // APEX (the lamp) — keep that end bright and fade toward the base.
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');     // apex at the lamp
    grad.addColorStop(1, 'rgba(255,255,255,0)');     // base hanging in the air
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 8, 64);
    _shaftTex = new THREE.CanvasTexture(c);
    return _shaftTex;
  }

  // Soft radial-gradient flare sprites baked on canvas — no asset downloads.
  function makeFlareTextures() {
    const make = (size, stops) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [t, col] of stops) grad.addColorStop(t, col);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(c);
      return tex;
    };
    return {
      core: make(128, [
        [0, 'rgba(255,248,225,1)'],
        [0.25, 'rgba(255,236,180,0.55)'],
        [0.6, 'rgba(255,220,150,0.12)'],
        [1, 'rgba(255,220,150,0)'],
      ]),
      ghost: make(64, [
        [0, 'rgba(190,215,255,0.45)'],
        [0.5, 'rgba(190,215,255,0.12)'],
        [1, 'rgba(190,215,255,0)'],
      ]),
    };
  }

  // ---- Rear-wall "BECK STADIUM" signage (kept from the old scene) ----
  function buildStadiumSignage(g) {
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024; signCanvas.height = 192;
    const sctx = signCanvas.getContext('2d');
    sctx.fillStyle = '#0b1a33'; sctx.fillRect(0, 0, 1024, 192);
    sctx.strokeStyle = '#ffd700'; sctx.lineWidth = 8;
    sctx.strokeRect(8, 8, 1008, 176);
    sctx.fillStyle = '#ffd700';
    sctx.font = 'bold 110px system-ui, sans-serif';
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    sctx.fillText('BECK STADIUM', 512, 96);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.encoding = THREE.sRGBEncoding;
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const signGeo = new THREE.PlaneGeometry(54, 10);
    const s1 = new THREE.Mesh(signGeo, signMat);
    s1.position.set(0, 14.5, -45.5); g.add(s1);
    const s2 = new THREE.Mesh(signGeo, signMat);
    s2.position.set(0, 14.5, 45.5); s2.rotation.y = Math.PI; g.add(s2);
  }
})(window.FB);

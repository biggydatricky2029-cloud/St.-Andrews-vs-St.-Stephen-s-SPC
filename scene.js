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
      fumbleChanceOnHit: 0.03, fumbleChanceOnSack: 0.06, interceptionChance: 0.000,
      cpuQBDecisionDelay: 0.90,
    },
    jv: {
      dLineReactionDelay: 0.45, dLinePressureSpeed: 0.92, dLineShedBlock: 0.18,
      dbReactionDelay: 0.35, dbManTrackingSpeed: 0.90, dbCoverageRadius: 5.5,
      dbJumpRouteChance: 0.003,
      lbReactionDelay: 0.40, lbPursuitSpeed: 0.92,
      safetyReactionDelay: 0.32,
      fumbleChanceOnHit: 0.055, fumbleChanceOnSack: 0.10, interceptionChance: 0.006,
      cpuQBDecisionDelay: 0.65,
    },
    varsity: {
      dLineReactionDelay: 0.28, dLinePressureSpeed: 0.98, dLineShedBlock: 0.28,
      dbReactionDelay: 0.20, dbManTrackingSpeed: 1.00, dbCoverageRadius: 3.5,
      dbJumpRouteChance: 0.008,
      lbReactionDelay: 0.25, lbPursuitSpeed: 1.00,
      safetyReactionDelay: 0.19,
      fumbleChanceOnHit: 0.09, fumbleChanceOnSack: 0.16, interceptionChance: 0.013,
      cpuQBDecisionDelay: 0.42,
    },
    allspc: {
      dLineReactionDelay: 0.14, dLinePressureSpeed: 1.04, dLineShedBlock: 0.40,
      dbReactionDelay: 0.10, dbManTrackingSpeed: 1.10, dbCoverageRadius: 2.0,
      dbJumpRouteChance: 0.018,
      lbReactionDelay: 0.13, lbPursuitSpeed: 1.08,
      safetyReactionDelay: 0.10,
      fumbleChanceOnHit: 0.13, fumbleChanceOnSack: 0.22, interceptionChance: 0.022,
      cpuQBDecisionDelay: 0.24,
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
    const canvas = document.getElementById('gl');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Broadcast-style color pipeline: sRGB output + ACES filmic tonemap.
    // (r128 uses outputEncoding/sRGBEncoding — equivalent to outputColorSpace in newer releases.)
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x0a1020, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x7fa7cf, 110, 320);
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 500);
    camera.position.set(-70, 18, 0); camera.lookAt(0, 2, 0);

    const hemi = new THREE.HemisphereLight(0xcde4ff, 0x30502e, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d4, 1.25);
    sun.position.set(-60, 90, 40); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;  sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 1;  sun.shadow.camera.far = 220;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    FB.scene = scene; FB.camera = camera; FB.renderer = renderer;
    FB.clock = new THREE.Clock();
    FB.playCam = { shake: 0 };

    createSky();
    createField();
    createStadium();

    // ---- Post-processing (Pass 5): bloom + vignette ----
    buildComposer();

    window.addEventListener('resize', FB.onResize);
    window.addEventListener('orientationchange', FB.onResize);
  };

  FB.onResize = function () {
    FB.renderer.setSize(window.innerWidth, window.innerHeight);
    FB.camera.aspect = window.innerWidth / window.innerHeight;
    FB.camera.updateProjectionMatrix();
    if (FB.composer) FB.composer.setSize(window.innerWidth, window.innerHeight);
  };

  // Build EffectComposer if the post-processing modules loaded. Any missing
  // class falls through to the plain renderer.render path in logic-loop.js.
  function buildComposer() {
    try {
      if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.ShaderPass ||
          !THREE.UnrealBloomPass) {
        return;
      }
      const composer = new THREE.EffectComposer(FB.renderer);
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new THREE.RenderPass(FB.scene, FB.camera));

      // Subtle bloom so stadium lights, jumbotron, and white lines pop.
      const bloom = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.30,   // strength
        0.40,   // radius
        0.90    // threshold (only very bright pixels bloom)
      );
      composer.addPass(bloom);

      // Mild broadcast-style vignette.
      const vignetteShader = {
        uniforms: {
          tDiffuse: { value: null },
          vignetteStrength: { value: 0.28 },
          vignetteInner:    { value: 0.45 },
          vignetteOuter:    { value: 0.95 },
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
          'uniform float vignetteStrength;',
          'uniform float vignetteInner;',
          'uniform float vignetteOuter;',
          'varying vec2 vUv;',
          'void main() {',
          '  vec4 c = texture2D(tDiffuse, vUv);',
          '  float d = distance(vUv, vec2(0.5));',
          '  float v = smoothstep(vignetteInner, vignetteOuter, d);',
          '  c.rgb *= mix(1.0, 1.0 - vignetteStrength, v);',
          '  gl_FragColor = c;',
          '}',
        ].join('\n'),
      };
      composer.addPass(new THREE.ShaderPass(vignetteShader));

      // Final sRGB gamma correction — EffectComposer works in linear space;
      // without this pass the final image reads washed under ACES.
      if (THREE.GammaCorrectionShader) {
        const gamma = new THREE.ShaderPass(THREE.GammaCorrectionShader);
        composer.addPass(gamma);
      }

      FB.composer = composer;
    } catch (e) {
      // Never let post-processing errors take the game down.
      FB.composer = null;
    }
  }

  function createSky() {
    const geom = new THREE.SphereGeometry(300, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { topColor: { value: new THREE.Color(0x1a3e75) }, bottomColor: { value: new THREE.Color(0xa9d0ee) } },
      vertexShader: 'varying vec3 vW; void main(){ vW=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 vW; uniform vec3 topColor; uniform vec3 bottomColor; void main(){ float t=max(vW.y,0.); gl_FragColor=vec4(mix(bottomColor,topColor,pow(t,0.6)),1.); }'
    });
    FB.scene.add(new THREE.Mesh(geom, mat));
  }

  // ---- Turf (PBR): baked albedo + tiling grass-blade normal map ----

  // Full-field albedo at ~2048×1024. Mowing stripes at 5-yard bands, darker
  // wear along the hash rows and between the tackles, plus per-pixel noise
  // so the ground reads as grass rather than a flat plane.
  function mowedTurfTexture() {
    const { FIELD_LEN, FIELD_WID, EZ, HASH_Z } = FB.const;
    const w = 2048, h = 1024;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    // Base turf — vertical gradient to break up the flat look.
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#2e6d38');
    base.addColorStop(0.5, '#2b6a35');
    base.addColorStop(1, '#286131');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Mowing stripes every 5 yards across the full field length.
    const numStripes = FIELD_LEN / 5;           // 24
    const stripeW = w / numStripes;
    for (let i = 0; i < numStripes; i++) {
      ctx.fillStyle = i % 2 === 0
        ? 'rgba(255,255,255,0.055)'             // lighter band
        : 'rgba(0,0,0,0.12)';                   // darker band
      ctx.fillRect(i * stripeW, 0, stripeW + 1, h);
    }

    // Worn paths along each hash row (between-the-tackles traffic).
    const yAt = (z) => ((z + FIELD_WID / 2) / FIELD_WID) * h;
    const ezPx = (EZ / FIELD_LEN) * w;
    const wearBand = (zCenter, zHalf, alpha) => {
      ctx.fillStyle = 'rgba(20,40,22,' + alpha + ')';
      ctx.fillRect(ezPx, yAt(zCenter - zHalf), w - 2 * ezPx, (2 * zHalf / FIELD_WID) * h);
    };
    wearBand(HASH_Z, 1.3, 0.16);
    wearBand(-HASH_Z, 1.3, 0.16);
    wearBand(0, 2.1, 0.09);

    // Darker "logo" shadow near the 50 (fakes compacted center field).
    const cx = w / 2, cy = h / 2;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.28);
    rg.addColorStop(0, 'rgba(0,0,0,0.10)');
    rg.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);

    // High-density grass-blade noise (alternating bright/dark single pixels).
    for (let n = 0; n < 140000; n++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      if (Math.random() < 0.55) {
        ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.14) + ')';
      } else {
        ctx.fillStyle = 'rgba(220,240,190,' + (Math.random() * 0.10) + ')';
      }
      ctx.fillRect(x, y, 1, 1);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    return tex;
  }

  // Tiling grass-blade normal map derived from a smoothed noise heightfield.
  function turfNormalMap() {
    const size = 256;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    // Step 1: random height
    const heightA = new Float32Array(size * size);
    for (let i = 0; i < heightA.length; i++) heightA[i] = Math.random();
    // Step 2: two passes of 3x3 box blur (wrapping) so the gradient isn't
    // per-pixel noise.
    const blur = (src) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let s = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = (x + dx + size) % size;
              const yy = (y + dy + size) % size;
              s += src[yy * size + xx];
            }
          }
          out[y * size + x] = s / 9;
        }
      }
      return out;
    };
    const height = blur(blur(heightA));
    // Step 3: Sobel-ish gradient → normal.
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

  function endZoneTexture(label, primary, secondary) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = primary; ctx.fillRect(0, 0, c.width, c.height);
    // Subtle inner glow so the end zone doesn't read as a flat poster color.
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 10, c.width / 2, c.height / 2, c.width / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = secondary;
    ctx.font = 'bold 160px system-ui, -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label.toUpperCase(), c.width / 2, c.height / 2);
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

  function createField() {
    const { FIELD_LEN, FIELD_WID, EZ } = FB.const;
    const group = new THREE.Group();
    FB.scene.add(group);
    FB.fieldGroup = group;

    const turf = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_LEN, FIELD_WID, 1, 1),
      new THREE.MeshStandardMaterial({
        map: mowedTurfTexture(),
        normalMap: turfNormalMap(),
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.95,
        metalness: 0.0,
      })
    );
    turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true; group.add(turf);

    const homeEZ = new THREE.Mesh(new THREE.PlaneGeometry(EZ, FIELD_WID),
      new THREE.MeshStandardMaterial({
        map: endZoneTexture('HIGHLANDERS', '#0a2463', '#ffffff'),
        roughness: 0.9, metalness: 0.0,
        polygonOffset: true, polygonOffsetFactor: -1,
      }));
    homeEZ.rotation.x = -Math.PI / 2; homeEZ.position.set(-55, 0.01, 0);
    homeEZ.receiveShadow = true; group.add(homeEZ);
    const awayEZ = new THREE.Mesh(new THREE.PlaneGeometry(EZ, FIELD_WID),
      new THREE.MeshStandardMaterial({
        map: endZoneTexture('SPARTANS', '#b22222', '#ffd700'),
        roughness: 0.9, metalness: 0.0,
        polygonOffset: true, polygonOffsetFactor: -1,
      }));
    awayEZ.rotation.x = -Math.PI / 2; awayEZ.position.set(55, 0.01, 0);
    awayEZ.receiveShadow = true; group.add(awayEZ);

    // Yard lines — kept as unlit MeshBasic but explicitly not tonemapped so
    // they stay pure white under ACES filmic tonemap.
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    for (let yd = -50; yd <= 50; yd += 5) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, FIELD_WID), lineMat);
      line.rotation.x = -Math.PI / 2; line.position.set(yd, 0.02, 0); group.add(line);
    }
    for (let yd = -40; yd <= 40; yd += 10) {
      const n = 50 - Math.abs(yd);
      for (const zSide of [-18, 18]) {
        const tex = yardNumberTexture(n);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(5, 5),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -3 }));
        pl.rotation.x = -Math.PI / 2;
        // Numbers on the +z sideline must flip so they read right-side-up to
        // that sideline's viewer.
        if (zSide > 0) pl.rotation.z = Math.PI;
        pl.position.set(yd, 0.03, zSide); group.add(pl);
      }
    }
    const hashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (let yd = -49; yd <= 49; yd++) {
      for (const z of [-6, 6]) {
        const h = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), hashMat);
        h.rotation.x = -Math.PI / 2; h.position.set(yd, 0.025, z); group.add(h);
      }
    }
    const sidelineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
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
    // through the ACES pipeline the way they do on TV.
    FB.firstDownLine = new THREE.Mesh(new THREE.PlaneGeometry(0.4, FIELD_WID),
      new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.75, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -4 }));
    FB.firstDownLine.rotation.x = -Math.PI / 2; FB.firstDownLine.position.y = 0.04; group.add(FB.firstDownLine);

    FB.losLine = new THREE.Mesh(new THREE.PlaneGeometry(0.35, FIELD_WID),
      new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.7, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -4 }));
    FB.losLine.rotation.x = -Math.PI / 2; FB.losLine.position.y = 0.04; group.add(FB.losLine);

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
      FB.referee.position.set(x, 0, z);
      const dx = r.tx - r.fx, dz = r.tz - r.fz;
      if (dx * dx + dz * dz > 0.0001) FB.referee.rotation.y = Math.atan2(dx, dz);
      FB.ball.position.set(x, 2.1, z + 0.35);
      if (p >= 1) { r.phase = 'place'; r.t = 0; }
    } else if (r.phase === 'place') {
      // Ref bends slightly and the ball drops to the ground on the spot.
      const p = Math.min(1, r.t / r.durPlace);
      const ballY = 2.1 + (0.35 - 2.1) * p;
      FB.ball.position.set(r.tx, ballY, r.tz);
      FB.referee.position.set(r.tx, 0, r.tz);
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
      FB.referee.position.set(x, 0, z);
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
      emissiveIntensity: 1.1,
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
  function buildLightPoles(g) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.6, metalness: 0.5 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xfff2cc,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    const corners = [
      { x: -78, z: -44 }, { x:  78, z: -44 },
      { x: -78, z:  44 }, { x:  78, z:  44 },
    ];
    for (const c of corners) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 32, 8), poleMat);
      pole.position.set(c.x, 16, c.z);
      pole.castShadow = true;
      g.add(pole);
      // Cross arm for the bulb cluster
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.5, 0.5), poleMat);
      arm.position.set(c.x + Math.sign(-c.x) * 1.5, 32.2, c.z + Math.sign(-c.z) * 1.5);
      g.add(arm);
      // 3x3 lamp grid
      const cluster = new THREE.Group();
      cluster.position.set(c.x + Math.sign(-c.x) * 2.5, 32.2, c.z + Math.sign(-c.z) * 2.5);
      for (let i = 0; i < 9; i++) {
        const bx = ((i % 3) - 1) * 0.85;
        const by = (Math.floor(i / 3) - 1) * 0.75;
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.22), bulbMat);
        bulb.position.set(bx, by, 0);
        cluster.add(bulb);
      }
      cluster.lookAt(0, 8, 0);
      g.add(cluster);
    }
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

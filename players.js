// players.js — player meshes, formations, ball, spawn logic.
(function (FB) {
  'use strict';

  FB.activePlayers = { home: [], away: [] };
  FB.ballCarrier = null;
  FB.qb = null;
  FB.selectedDefender = null;
  FB.ball = null;
  FB.ballState = { carried: true, vel: new THREE.Vector3(), inAir: false, targetPlayer: null, kind: 'run', airTime: 0 };

  // ============================================================
  //  Muscle-aware limb geometry
  //  ----------------------------------------------------------
  //  Each player's listed weight (110–250 lb on this roster) drives
  //  a muscleFactor in [0.75, 1.5] applied ONLY to limb radii.
  //  Bone lengths, joint positions, and rig hierarchy are unchanged.
  //  Unique geometries are bucketed to the nearest 0.05 of muscleFactor
  //  and shared across players, so we end up with ≈10 lathes total
  //  rather than 22 players × 5 limbs.
  // ============================================================
  const MUSCLE_MIN_W = 110;
  const MUSCLE_MAX_W = 250;

  function computeMuscleFactor(player) {
    const w = (player && player.weight && player.weight > 0) ? player.weight : null;
    if (w == null) return 1.0;
    const t = Math.max(0, Math.min(1, (w - MUSCLE_MIN_W) / (MUSCLE_MAX_W - MUSCLE_MIN_W)));
    return 0.75 + t * 0.75;
  }

  // Silhouettes are (radius, y) at muscleFactor=1.0. The y range matches each
  // limb segment's existing local extents so the new lathe drops into the
  // same Mesh.position the cylinder used.
  //
  // - Upper arm sleeve (jersey): top→hem, length 0.27 → y ∈ [-0.135, +0.135]
  // - Bicep (skin):              length 0.36 → y ∈ [-0.18,  +0.18]
  //   Bicep peak at ~60% down the FULL upper arm (= top quarter of bicep mesh)
  // - Forearm (skin):            length 0.55 → y ∈ [-0.275, +0.275]
  //   Wider mass near the elbow, taper to wrist
  // - Thigh (pants):             length 0.84 → y ∈ [-0.42,  +0.42]
  //   Quad bulge ~35% down from hip
  // - Calf (skin):               length 0.46 → y ∈ [-0.23,  +0.23]
  //   Gastrocnemius bulge ~30% down from knee
  const LIMB_PROFILES = {
    sleeve: [
      [0.001, +0.135],
      [0.158, +0.130],
      [0.152, +0.060],
      [0.148, -0.020],
      [0.144, -0.090],
      [0.142, -0.135],
    ],
    bicep: [
      [0.142, +0.180],   // matches sleeve hem
      [0.156, +0.110],   // bicep peak (~60% down upper arm)
      [0.144, +0.040],
      [0.128, -0.030],
      [0.114, -0.100],
      [0.108, -0.140],   // wider lower bicep so it tapers into the elbow
      [0.090, -0.165],   // rounded dome — replaces the elbow sphere cover
      [0.060, -0.176],
      [0.001, -0.180],
    ],
    forearm: [
      [0.001, +0.275],
      [0.060, +0.270],   // rounded dome at the elbow side (no sphere needed)
      [0.110, +0.262],
      [0.138, +0.250],   // brachioradialis bulge starts
      [0.142, +0.190],   // brachioradialis bulge peak
      [0.130, +0.100],
      [0.114, +0.020],
      [0.098, -0.080],
      [0.086, -0.180],
      [0.078, -0.260],
      [0.001, -0.275],   // wrist
    ],
    thigh: [
      [0.001, +0.420],
      [0.210, +0.405],   // hip
      [0.235, +0.310],
      [0.262, +0.165],   // quad/hamstring peak (~35% down from hip)
      [0.246, +0.020],
      [0.218, -0.140],
      [0.196, -0.290],
      [0.184, -0.390],   // wider just above the knee
      [0.158, -0.408],   // rounded knee cap (replaces sphere)
      [0.108, -0.416],
      [0.001, -0.420],
    ],
    calf: [
      [0.001, +0.230],
      [0.082, +0.225],   // rounded dome at the knee side
      [0.140, +0.218],
      [0.176, +0.205],   // upper gastroc
      [0.206, +0.090],   // gastrocnemius peak (~30% down from knee)
      [0.182, +0.000],
      [0.156, -0.090],
      [0.136, -0.180],
      [0.124, -0.230],   // ankle side
      [0.001, -0.230],
    ],
  };

  const _limbGeoCache = new Map();
  function _muscleBucket(mf) { return Math.round(mf / 0.05) * 0.05; }

  // Tessellation follows the active quality tier (graphics-config.js):
  // HIGH pushes the lathes/spheres toward a smooth broadcast-closeup
  // silhouette, LOW keeps old-phone GPUs at 60fps.
  function tess() {
    const GC = window.GRAPHICS_CONFIG;
    return GC.player.tessellation[GC.tier()] || GC.player.tessellation.MEDIUM;
  }

  function getLimbGeometry(kind, muscleFactor) {
    const bucket = _muscleBucket(muscleFactor);
    const segs = tess().lathe;
    const key = kind + ':' + bucket.toFixed(2) + ':' + segs;
    let geo = _limbGeoCache.get(key);
    if (geo) return geo;
    const profile = LIMB_PROFILES[kind];
    const pts = new Array(profile.length);
    for (let i = 0; i < profile.length; i++) {
      pts[i] = new THREE.Vector2(profile[i][0] * bucket, profile[i][1]);
    }
    geo = new THREE.LatheGeometry(pts, segs);
    geo.computeVertexNormals();
    _limbGeoCache.set(key, geo);
    return geo;
  }

  // ============================================================
  //  PHASE 1 — Uniform system + PBR material library
  //  ----------------------------------------------------------
  //  FB.UniformSystem turns (team colors, skin tone, number,
  //  name, position, home/away variant) into the full set of
  //  MeshPhysicalMaterial instances for one player. Procedural
  //  detail maps (jersey weave, glove grip) are generated once
  //  on a canvas and shared across all 44+ players.
  // ============================================================

  let _wovenTex = null;
  // Knit-fabric normal map: a sin×sin weave lattice plus thread noise,
  // converted from a heightfield to tangent-space normals.
  function wovenJerseyNormal() {
    if (_wovenTex) return _wovenTex;
    const size = 64;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const weave = Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2);
        height[y * size + x] = 0.5 + weave * 0.32 + (Math.random() - 0.5) * 0.18;
      }
    }
    const img = ctx.createImageData(size, size);
    const strength = 2.2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xl = (x - 1 + size) % size, xr = (x + 1) % size;
        const yt = (y - 1 + size) % size, yb = (y + 1) % size;
        const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
        const dy = (height[yb * size + x] - height[yt * size + x]) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        img.data[i] = Math.floor((-dx / len * 0.5 + 0.5) * 255);
        img.data[i + 1] = Math.floor((-dy / len * 0.5 + 0.5) * 255);
        img.data[i + 2] = Math.floor((1 / len * 0.5 + 0.5) * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    _wovenTex = new THREE.CanvasTexture(c);
    _wovenTex.wrapS = _wovenTex.wrapT = THREE.RepeatWrapping;
    _wovenTex.repeat.set(7, 7);
    return _wovenTex;
  }

  let _gripTex = null;
  // Tacky glove-grip normal: dense random micro-bumps.
  function gloveGripNormal() {
    if (_gripTex) return _gripTex;
    const size = 32;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const nx = (Math.random() - 0.5) * 0.8;
      const ny = (Math.random() - 0.5) * 0.8;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      img.data[i * 4] = Math.floor((nx / len * 0.5 + 0.5) * 255);
      img.data[i * 4 + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);
      img.data[i * 4 + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _gripTex = new THREE.CanvasTexture(c);
    _gripTex.wrapS = _gripTex.wrapT = THREE.RepeatWrapping;
    _gripTex.repeat.set(3, 3);
    return _gripTex;
  }

  // Deterministic skin tone per player so a roster renders identically
  // every game (4 presets from graphics-config.js).
  function skinToneFor(player) {
    const tones = window.GRAPHICS_CONFIG.player.skinTones;
    let h = 0;
    const s = String(player.name || '') + String(player.number || 0);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return tones[Math.abs(h) % tones.length];
  }

  FB.UniformSystem = class {
    /**
     * @param {object} opts
     *   primaryColor / secondaryColor — team hex strings
     *   skinTone      — hex string from the preset table
     *   jerseyNumber  — printed front and back
     *   lastName      — nameplate above the back number
     *   playerPosition— roster slot (QB/WR/... — visor offered to skill spots)
     *   variant       — 'home' (colored) | 'away' (white shell w/ team numbers)
     */
    constructor(opts) {
      const P = window.GRAPHICS_CONFIG.player;
      const primary = new THREE.Color(opts.primaryColor);
      const secondary = new THREE.Color(opts.secondaryColor);
      const jerseyColor = opts.variant === 'away' ? new THREE.Color(0xf2f2f2) : primary;
      const numberBg = '#' + jerseyColor.getHexString();
      const numberFg = opts.variant === 'away' ? opts.primaryColor : opts.secondaryColor;
      this.primary = primary;
      this.secondary = secondary;
      this.skinTone = new THREE.Color(opts.skinTone);

      const weave = wovenJerseyNormal();
      const weaveScale = new THREE.Vector2(0.4, 0.4);
      const fx = P.effects[window.GRAPHICS_CONFIG.tier()] || P.effects.MEDIUM;

      this.jersey = new THREE.MeshPhysicalMaterial({
        color: jerseyColor, roughness: P.jersey.roughness, metalness: P.jersey.metalness,
        normalMap: weave, normalScale: weaveScale,
      });
      this.jerseyFront = new THREE.MeshPhysicalMaterial({
        map: jerseyFrontTexture(opts.jerseyNumber, numberBg, numberFg),
        roughness: P.jersey.roughness, metalness: P.jersey.metalness,
        normalMap: weave, normalScale: weaveScale,
      });
      this.jerseyBack = new THREE.MeshPhysicalMaterial({
        map: jerseyBackTexture(opts.jerseyNumber, opts.lastName, numberBg, numberFg),
        roughness: P.jersey.roughness, metalness: P.jersey.metalness,
        normalMap: weave, normalScale: weaveScale,
      });
      this.jerseyFront.map.encoding = THREE.sRGBEncoding;
      this.jerseyBack.map.encoding = THREE.sRGBEncoding;

      this.pants = new THREE.MeshPhysicalMaterial({
        color: secondary, roughness: P.pants.roughness, metalness: P.pants.metalness,
        normalMap: weave, normalScale: new THREE.Vector2(0.25, 0.25),
      });
      this.pantStripe = new THREE.MeshPhysicalMaterial({
        color: secondary.clone().lerp(new THREE.Color(0xffffff), 0.7),
        roughness: P.pants.roughness, metalness: 0.0,
      });

      // Hard shiny painted polycarbonate. Clearcoat costs ~2ms across 44
      // helmets on mobile GPUs; MEDIUM/LOW drop it and lean on the env-map
      // reflection instead, which reads almost identical at gameplay
      // distance because the helmet is small on screen.
      this.helmet = new THREE.MeshPhysicalMaterial({
        color: primary,
        roughness: P.helmet.roughness, metalness: P.helmet.metalness,
        clearcoat: fx.clearcoat ? P.helmet.clearcoat : 0,
        clearcoatRoughness: P.helmet.clearcoatRoughness,
        envMapIntensity: 1.1,
      });
      this.facemask = new THREE.MeshPhysicalMaterial({
        color: P.facemask.color, roughness: P.facemask.roughness, metalness: P.facemask.metalness,
      });
      // Visor: HIGH gets the real transmission-refracted tint;
      // MEDIUM/LOW use a plain transparent dark plastic, which costs nothing
      // extra. Transmission > 0 makes r128 do a full extra scene render
      // every frame (the opaque-pass texture for refraction), so this is
      // the single biggest mobile perf win.
      if (fx.transmission) {
        this.visor = new THREE.MeshPhysicalMaterial({
          color: P.visor.color,
          roughness: P.visor.roughness, metalness: P.visor.metalness,
          transmission: P.visor.transmission,
          transparent: true, opacity: P.visor.opacity,
          side: THREE.DoubleSide,
          envMapIntensity: 1.4,
        });
      } else {
        this.visor = new THREE.MeshStandardMaterial({
          color: P.visor.color,
          roughness: P.visor.roughness + 0.05, metalness: 0.4,
          transparent: true, opacity: P.visor.opacity,
          side: THREE.DoubleSide,
          envMapIntensity: 1.4,
        });
      }

      // Skin with a faint warm sheen as an SSS stand-in (r128's
      // MeshPhysicalMaterial sheen is a color slot).
      this.skin = new THREE.MeshPhysicalMaterial({
        color: this.skinTone, roughness: P.skin.roughness, metalness: P.skin.metalness,
      });
      if ('sheen' in this.skin) {
        this.skin.sheen = this.skinTone.clone().multiplyScalar(0.25);
      }

      this.glove = new THREE.MeshPhysicalMaterial({
        color: P.glove.color, roughness: P.glove.roughness, metalness: P.glove.metalness,
        normalMap: gloveGripNormal(), normalScale: new THREE.Vector2(0.5, 0.5),
      });
      this.cleatSole = new THREE.MeshPhysicalMaterial({
        color: P.cleatSole.color, roughness: P.cleatSole.roughness, metalness: P.cleatSole.metalness,
      });
      this.cleatUpper = new THREE.MeshPhysicalMaterial({
        color: P.cleatUpper.color, roughness: P.cleatUpper.roughness, metalness: P.cleatUpper.metalness,
      });
      this.sock = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f5, roughness: 0.85, metalness: 0.0 });
      this.belt = new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.55, metalness: 0.1 });
      // Shoulder-pad shell reads slightly tighter than jersey cloth.
      this.shoulder = new THREE.MeshPhysicalMaterial({
        color: jerseyColor, roughness: 0.62, metalness: 0.05,
        normalMap: weave, normalScale: weaveScale,
      });
    }
  };

  function jerseyFrontTexture(num, bg, fg) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.font = 'bold 84px -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(num), c.width / 2, c.height / 2);
    return new THREE.CanvasTexture(c);
  }
  function jerseyBackTexture(num, lastName, bg, fg) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    // Name up top — auto-shrink to fit
    const name = (lastName || '').toUpperCase();
    let fontSize = 32;
    ctx.font = 'bold ' + fontSize + 'px -apple-system, Helvetica, sans-serif';
    while (ctx.measureText(name).width > 118 && fontSize > 12) {
      fontSize -= 2;
      ctx.font = 'bold ' + fontSize + 'px -apple-system, Helvetica, sans-serif';
    }
    ctx.textBaseline = 'top';
    ctx.fillText(name, c.width / 2, 10);
    // Number centered
    ctx.font = 'bold 72px -apple-system, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), c.width / 2, c.height / 2 + 14);
    // Flip horizontally so text reads correctly from behind the player.
    const out = document.createElement('canvas'); out.width = 128; out.height = 128;
    const octx = out.getContext('2d');
    octx.translate(out.width, 0); octx.scale(-1, 1);
    octx.drawImage(c, 0, 0);
    return new THREE.CanvasTexture(out);
  }

  function helmetLogoTexture(letter, fg) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = fg || '#ffffff';
    ctx.font = 'bold 110px system-ui, -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4;
    ctx.fillText(String(letter), 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  function parseHeightInches(h) {
    if (!h) return 0;
    const m = /^(\d+)'(\d+)"?$/.exec(String(h).trim());
    if (!m) return 0;
    return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
  }

  // ---- LOD stand-ins (Phase 7) ----
  // Level 1: a ~150-triangle static figure in team colors for mid-distance.
  // Level 2: a camera-facing sprite for the far field. Both share cached
  // materials keyed by team colors so 44 players cost a handful of materials.
  const _lodMatCache = new Map();
  function lodLambert(colorHex) {
    let m = _lodMatCache.get(colorHex);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: colorHex });
      m.userData.sharedLOD = true;
      _lodMatCache.set(colorHex, m);
    }
    return m;
  }
  function buildSimpleLOD(uniforms) {
    const grp = new THREE.Group();
    const jersey = lodLambert('#' + uniforms.jersey.color.getHexString());
    const pants = lodLambert('#' + uniforms.pants.color.getHexString());
    const helmet = lodLambert('#' + uniforms.helmet.color.getHexString());
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.62, 7), pants);
    legs.position.y = 0.81; grp.add(legs);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.46, 1.35, 8), jersey);
    torso.position.y = 2.12; grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), helmet);
    head.position.y = 3.1; grp.add(head);
    return grp;
  }
  const _spriteMatCache = new Map();
  function buildBillboardLOD(uniforms) {
    const key = uniforms.jersey.color.getHexString() + ':' + uniforms.pants.color.getHexString();
    let mat = _spriteMatCache.get(key);
    if (!mat) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#' + uniforms.pants.color.getHexString();
      ctx.fillRect(10, 34, 12, 26);
      ctx.fillStyle = '#' + uniforms.jersey.color.getHexString();
      ctx.fillRect(6, 14, 20, 22);
      ctx.beginPath(); ctx.arc(16, 8, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#' + uniforms.helmet.color.getHexString(); ctx.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      mat.userData.sharedLOD = true;
      _spriteMatCache.set(key, mat);
    }
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.7, 3.4, 1);
    sprite.position.y = 1.7;
    // Sprites ignore parent rotation by design — that's the point of LOD 2.
    const grp = new THREE.Group();
    grp.add(sprite);
    return grp;
  }

  function createPlayerMesh(player, teamKey) {
    const team = FB.teams[teamKey];
    const GC = window.GRAPHICS_CONFIG;
    const T = tess();
    const primary = new THREE.Color(team.primaryColor);
    const secondary = new THREE.Color(team.secondaryColor);
    const secondaryHex = '#' + secondary.getHexString();

    // PHASE 1 — one UniformSystem per player builds the full PBR wardrobe.
    const uniforms = new FB.UniformSystem({
      primaryColor: '#' + primary.getHexString(),
      secondaryColor: secondaryHex,
      skinTone: skinToneFor(player),
      jerseyNumber: player.number,
      lastName: (player.name || '').split(' ').slice(-1)[0],
      playerPosition: player.position || '',
      variant: 'home',
    });
    const skinMat = uniforms.skin;
    const gloveMat = uniforms.glove;
    const sockMat = uniforms.sock;
    const beltMat = uniforms.belt;
    const pantStripeMat = uniforms.pantStripe;

    // --- Proportional scaling from real listed height/weight ---
    const heightIn = parseHeightInches(player.height) || 70;
    const weightLb = (player.weight && player.weight > 0) ? player.weight : 170;
    const scaleY = Math.max(0.85, Math.min(1.22, heightIn / 70));
    // Limb radii scale with muscleFactor (0.75–1.5). Torso/pads scale with a
    // gentler torsoFactor so heavier players read as thicker overall but the
    // weight delta is most visible in the arms and legs. Helmet is never
    // scaled — every player wears the same shell size.
    const muscleFactor = computeMuscleFactor(player);
    const torsoFactor = 1.0 + (muscleFactor - 1.0) * 0.4;

    const g = new THREE.Group();
    const pantsMat = uniforms.pants;

    // --- Legs with hip + knee pivots so they can swing and bend. ---
    // Each leg is a chain: hipPivot (at hip joint) -> thigh + kneePivot.
    // kneePivot (at knee joint) -> knee ball + sock + calf + foot.
    // Body front is +Z local; rotating a pivot's X axis swings fwd/back.
    const footL = 0.42, footW = 0.22, footH = 0.1;
    const hipX = 0.22 * torsoFactor;          // hip spacing scales with torso
    const ankleY = footH;
    const calfH = 0.68, thighH = 0.84;
    const kneeY = ankleY + calfH;
    const thighTopY = kneeY + thighH;
    // Joint cover radii follow the limb radii so knee/ankle balls don't
    // visually pop relative to a heavy player's thicker thigh/calf.
    const calfR = 0.17 * muscleFactor;
    const thighRTop = 0.22 * muscleFactor;     // used only for the stripe X-offset
    const rigLegs = {};
    for (const side of ['L', 'R']) {
      const dx = side === 'L' ? -hipX : hipX;
      const hipPivot = new THREE.Group();
      hipPivot.position.set(dx, thighTopY, 0);
      g.add(hipPivot);

      const thigh = new THREE.Mesh(getLimbGeometry('thigh', muscleFactor), pantsMat);
      thigh.position.set(0, -thighH / 2, 0);
      thigh.castShadow = true;
      thigh.receiveShadow = true;
      hipPivot.add(thigh);

      // Pants side-stripe (NFL/high-school style) running down the outside.
      const stripeX = (side === 'L' ? -1 : 1) * thighRTop * 0.92;
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, thighH * 0.95, 0.12),
        pantStripeMat
      );
      stripe.position.set(stripeX, -thighH / 2, 0);
      hipPivot.add(stripe);

      const kneePivot = new THREE.Group();
      kneePivot.position.set(0, -thighH, 0);
      hipPivot.add(kneePivot);

      // Knee joint cover removed — the thigh and calf lathe profiles are
      // shaped so their domed ends meet flush at the knee pivot.

      const sock = new THREE.Mesh(
        new THREE.CylinderGeometry(calfR * 0.95, calfR * 0.9, 0.22, 12),
        sockMat
      );
      sock.position.set(0, 0.11 - calfH, 0);
      sock.castShadow = true;
      kneePivot.add(sock);

      const calf = new THREE.Mesh(getLimbGeometry('calf', muscleFactor), skinMat);
      calf.position.set(0, 0.11 - calfH / 2, 0);
      calf.castShadow = true;
      calf.receiveShadow = true;
      kneePivot.add(calf);

      // Cleat: defined sole + upper + rounded toe box instead of a flat slab.
      const soleH = 0.035;
      const sole = new THREE.Mesh(new THREE.BoxGeometry(footW, soleH, footL), uniforms.cleatSole);
      sole.position.set(0, -calfH - footH + soleH / 2, 0.06);
      kneePivot.add(sole);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(footW * 0.94, footH - soleH, footL * 0.92), uniforms.cleatUpper);
      upper.position.set(0, -calfH - (footH - soleH) / 2 - soleH * 0.4, 0.05);
      upper.castShadow = true;
      kneePivot.add(upper);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(footW * 0.5, 8, 6), uniforms.cleatUpper);
      toe.scale.set(0.95, (footH - soleH) / (footW), 1.15);
      toe.position.set(0, -calfH - footH / 2 - soleH * 0.2, 0.06 + footL / 2 - footW * 0.25);
      kneePivot.add(toe);

      // Knee pad: a subtle bump under the pant hem on the front of the knee.
      const kneePad = new THREE.Mesh(new THREE.SphereGeometry(0.105 * muscleFactor, 8, 6), pantsMat);
      kneePad.scale.set(1.1, 1.2, 0.7);
      kneePad.position.set(0, 0.03, 0.14 * muscleFactor);
      kneePivot.add(kneePad);

      // Thigh pad: a wide shallow bump under the pants on the front of the
      // thigh — reads through the cloth like real thigh boards.
      const thighPad = new THREE.Mesh(new THREE.SphereGeometry(0.13 * muscleFactor, 8, 6), pantsMat);
      thighPad.scale.set(1.25, 1.7, 0.55);
      thighPad.position.set(0, -thighH * 0.42, 0.21 * muscleFactor);
      hipPivot.add(thighPad);

      rigLegs[side] = { hip: hipPivot, knee: kneePivot };
    }

    // --- Pelvis / hip pad + belt ---
    const pelvisH = 0.3;
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.95 * torsoFactor, pelvisH, 0.55 * torsoFactor), pantsMat);
    pelvis.position.y = thighTopY + pelvisH / 2;
    pelvis.castShadow = true;
    g.add(pelvis);
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.98 * torsoFactor, 0.08, 0.57 * torsoFactor),
      beltMat
    );
    belt.position.y = thighTopY + pelvisH + 0.04;
    g.add(belt);

    // --- Torso (jersey) with taper toward waist and number/name textures ---
    const torsoH = 1.0;
    const torsoBottomY = thighTopY + pelvisH + 0.08;
    const torsoY = torsoBottomY + torsoH / 2;
    const torsoTopW = 1.08 * torsoFactor, torsoBotW = 0.92 * torsoFactor;
    const torsoTopD = 0.58 * torsoFactor, torsoBotD = 0.52 * torsoFactor;
    // Use a buffer geometry box then warp vertices for taper. Simplest route: a
    // shallow trapezoidal prism using BoxGeometry + per-vertex scale. The
    // extra height segments give the cloth weave normal map surface to bend
    // over, so the jersey drapes rather than reading as a crate.
    const torsoGeo = new THREE.BoxGeometry(1, torsoH, 1, 2, 3, 2);
    const tp = torsoGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const fracTop = (y + torsoH / 2) / torsoH; // 0 at bottom, 1 at top
      const w = torsoBotW + (torsoTopW - torsoBotW) * fracTop;
      const d = torsoBotD + (torsoTopD - torsoBotD) * fracTop;
      tp.setX(i, tp.getX(i) * w);
      tp.setZ(i, tp.getZ(i) * d);
    }
    torsoGeo.computeVertexNormals();
    // Box face order: +x, -x, +y, -y, +z(front number), -z(back name+number).
    const torsoMats = [
      uniforms.jersey, uniforms.jersey, uniforms.jersey, uniforms.jersey,
      uniforms.jerseyFront, uniforms.jerseyBack,
    ];
    const torso = new THREE.Mesh(torsoGeo, torsoMats);
    torso.position.y = torsoY;
    torso.castShadow = true;
    g.add(torso);

    // --- Shoulders: slim yoke + full rounded caps for a natural shoulder line. ---
    const padsY = torsoY + torsoH / 2 + 0.06;
    const shoulderSpan = 1.18 * torsoFactor;
    const shoulderMat = uniforms.shoulder;
    const yoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, shoulderSpan, T.lathe),
      shoulderMat
    );
    yoke.rotation.z = Math.PI / 2;
    yoke.position.set(0, padsY, 0);
    yoke.castShadow = true;
    g.add(yoke);
    const capR = 0.22 * torsoFactor;
    for (const sgn of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(capR, T.sphereW, T.sphereH),
        shoulderMat
      );
      cap.position.set(sgn * shoulderSpan / 2, padsY, 0);
      cap.castShadow = true;
      g.add(cap);

      // Beefy shoulder pad — slightly wider than the shoulder line, matte finish.
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(0.52 * torsoFactor, 0.22, 0.6 * torsoFactor),
        shoulderMat
      );
      pad.position.set(sgn * shoulderSpan / 2, padsY + 0.12, 0);
      pad.castShadow = true;
      g.add(pad);
    }

    // --- Arms with shoulder + elbow pivots so arms can swing and elbow can
    //     stay bent ~90° pointing opposite of motion.
    const armMat = uniforms.jersey;
    const upperLen = 0.6;
    const foreLen = 0.55;
    const rigArms = {};
    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? -1 : 1;
      const shoulderX = sgn * (shoulderSpan / 2);
      const shoulderY = padsY - 0.12;

      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(shoulderX, shoulderY, 0);
      g.add(shoulderPivot);

      // Sleeve (jersey) — top portion of the upper arm, contoured at the deltoid.
      const sleeve = new THREE.Mesh(getLimbGeometry('sleeve', muscleFactor), armMat);
      sleeve.position.set(0, -upperLen * 0.22, 0);
      sleeve.castShadow = true;
      sleeve.receiveShadow = true;
      shoulderPivot.add(sleeve);

      // Bicep (skin) — bulges ~60% down the upper arm, tapers into the elbow.
      const bicep = new THREE.Mesh(getLimbGeometry('bicep', muscleFactor), skinMat);
      bicep.position.set(0, -upperLen * 0.75, 0);
      bicep.castShadow = true;
      bicep.receiveShadow = true;
      shoulderPivot.add(bicep);

      const elbowPivot = new THREE.Group();
      elbowPivot.position.set(0, -upperLen - 0.02, 0);
      shoulderPivot.add(elbowPivot);

      // Elbow joint cover removed — the bicep and forearm lathes terminate
      // in domed caps that meet flush at the elbow pivot.

      // Forearm — wider near the elbow, taper to wrist.
      const fore = new THREE.Mesh(getLimbGeometry('forearm', muscleFactor), skinMat);
      fore.position.set(0, -foreLen / 2, 0);
      fore.castShadow = true;
      fore.receiveShadow = true;
      elbowPivot.add(fore);

      // Gloved hand: a rounded mitt fitted to the wrist instead of a box.
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), gloveMat);
      glove.scale.set(0.85, 1.25, 0.78);
      glove.position.set(0, -foreLen - 0.12, 0);
      glove.castShadow = true;
      elbowPivot.add(glove);

      // Hold the elbow at a constant ~90° bend so the forearm points forward
      // and the elbow joint points behind the body (opposite of +Z motion).
      elbowPivot.rotation.x = -Math.PI / 2;

      rigArms[side] = { shoulder: shoulderPivot, elbow: elbowPivot };
    }

    // --- Neck + head (skin under helmet) ---
    const neckY = padsY + 0.16;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.16, 10), skinMat);
    neck.position.y = neckY;
    g.add(neck);
    const headY = neckY + 0.22;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, T.sphereW, T.sphereH), skinMat);
    head.position.y = headY;
    head.scale.set(0.95, 1.02, 1.02);
    g.add(head);

    // --- Helmet: ellipsoid shell + tinted visor + earholes + facemask ---
    // Hard shiny polycarbonate (clearcoat 1.0 / roughness 0.12 from the
    // uniform system) that picks up the stadium IBL.
    const helmetY = headY + 0.11;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, T.sphereW + 4, T.sphereH + 2), uniforms.helmet);
    helmet.position.y = helmetY;
    helmet.scale.set(1.08, 1.0, 1.18);
    helmet.castShadow = true;
    g.add(helmet);

    // Semi-transparent tinted visor: a front slice of the helmet sphere at
    // eye level, slightly inset from the shell so it never z-fights.
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.345, 16, 8,
        Math.PI * 0.30, Math.PI * 0.40,    // phi: patch centered on local +Z
        Math.PI * 0.42, Math.PI * 0.22),   // theta: eye-level band
      uniforms.visor
    );
    visor.position.y = helmetY;
    visor.scale.set(1.06, 1.0, 1.16);
    g.add(visor);
    // Back lip / bumper
    const bumper = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.04, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.4, metalness: 0.2 })
    );
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(0, helmetY - 0.3, 0);
    bumper.scale.set(1.12, 1.2, 1);
    g.add(bumper);
    // Ear holes (dark dots on sides)
    for (const sgn of [-1, 1]) {
      const ear = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 10),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.9 })
      );
      ear.rotation.y = sgn * Math.PI / 2;
      ear.position.set(sgn * 0.4, helmetY - 0.02, 0);
      g.add(ear);
    }
    // Facemask — modeled brushed-steel cage (metalness 0.95): a wraparound
    // perimeter hoop, three horizontal bars, and a center vertical bar.
    const maskMat = uniforms.facemask;
    const mask = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 6, 14, Math.PI),
      maskMat
    );
    mask.position.set(0, helmetY - 0.1, 0.36);
    mask.rotation.x = Math.PI / 2;
    g.add(mask);
    // Three horizontal cage bars.
    for (const yOff of [-0.13, -0.04, 0.06]) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.30, 6),
        maskMat
      );
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, helmetY - 0.1 + yOff, 0.42);
      g.add(bar);
    }
    // Center vertical bar tying the cage to the shell.
    const vBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.26, 6),
      maskMat
    );
    vBar.position.set(0, helmetY - 0.12, 0.43);
    vBar.rotation.x = 0.18;
    g.add(vBar);
    // Chin strap
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.018, 4, 10, Math.PI * 0.9),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
    );
    strap.position.set(0, helmetY - 0.28, 0.12);
    strap.rotation.x = Math.PI / 2.1;
    g.add(strap);

    // Team-letter helmet decal on each side.
    const logoLetter = (team.shortName || team.name || 'A').toString().trim().charAt(0).toUpperCase() || 'A';
    const logoTex = helmetLogoTexture(logoLetter, secondaryHex);
    const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true });
    for (const sgn of [-1, 1]) {
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), logoMat);
      logo.position.set(sgn * 0.405, helmetY + 0.02, 0);
      logo.rotation.y = sgn * Math.PI / 2;
      g.add(logo);
    }

    // ---- PHASE 7: three-level LOD ----
    // Level 0 (near):  the full articulated PBR rig above.
    // Level 1 (mid):   ~150-tri team-colored stand-in, no shadows.
    // Level 2 (far):   billboard sprite.
    // The renderer swaps levels automatically; the animation system skips
    // rig math whenever level 0 isn't the visible child.
    const lod = new THREE.LOD();
    lod.addLevel(g, GC.lod.full);
    lod.addLevel(buildSimpleLOD(uniforms), GC.lod.simple);
    lod.addLevel(buildBillboardLOD(uniforms), GC.lod.billboard);
    // Overall height scaling on the LOD root so all levels agree
    // (feet remain on the ground).
    lod.scale.y = scaleY;

    // --- Derived attributes: weight + height shape speed/accel subtly ---
    const rating = player.overall || 60;
    const weightPenalty = Math.max(0.82, Math.min(1.10, 170 / weightLb));
    const heightBonus = Math.max(0.95, Math.min(1.08, heightIn / 70));
    const speed = (4 + rating * 0.06) * weightPenalty;
    const accel = (8 + rating * 0.12) * weightPenalty;

    // Where the ball sits when this player carries it (scales with the player's height).
    const carryY = (torsoY + 0.15) * scaleY;

    return {
      mesh: lod, player, team: teamKey, role: null,
      rigRoot: g,
      baseSpeed: speed, accel,
      stamina: 100, rating,
      heightIn, weightLb,
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      assignment: null, isDown: false, route: null,
      jukeCooldown: 0,
      carryY,
      rig: {
        hipL: rigLegs.L.hip, hipR: rigLegs.R.hip,
        kneeL: rigLegs.L.knee, kneeR: rigLegs.R.knee,
        shoulderL: rigArms.L.shoulder, shoulderR: rigArms.R.shoulder,
        elbowL: rigArms.L.elbow, elbowR: rigArms.R.elbow,
      },
      // References for the Phase-6 animation system.
      parts: { torso },
      gaitPhase: 0,
    };
  }

  // Debug helper — places the lightest and heaviest currently-loaded players
  // side by side and zooms the camera in. Call from the console after the
  // pregame screen ('FB.showLineup()').
  FB.showLineup = function () {
    let lightP = null, heavyP = null, lightT = 'home', heavyT = 'home';
    for (const team of ['home', 'away']) {
      const t = FB.teams && FB.teams[team];
      if (!t || !t.players) continue;
      for (const p of t.players) {
        if (!p.weight || p.weight <= 0) continue;
        if (!lightP || p.weight < lightP.weight) { lightP = p; lightT = team; }
        if (!heavyP || p.weight > heavyP.weight) { heavyP = p; heavyT = team; }
      }
    }
    if (!lightP || !heavyP) { console.warn('Lineup: no rosters loaded yet'); return; }
    if (FB.hideAllPlayers) FB.hideAllPlayers();
    if (FB._lineupNodes) for (const n of FB._lineupNodes) FB.scene.remove(n);
    const a = createPlayerMesh(lightP, lightT);
    const b = createPlayerMesh(heavyP, heavyT);
    a.mesh.position.set(-1.7, 0, 0);
    b.mesh.position.set(+1.7, 0, 0);
    a.mesh.rotation.y = b.mesh.rotation.y = 0;
    FB.scene.add(a.mesh); FB.scene.add(b.mesh);
    FB._lineupNodes = [a.mesh, b.mesh];
    FB.camera.position.set(0, 3.6, 7.2);
    FB.camera.lookAt(0, 2.4, 0);
    console.log(
      '[lineup] LIGHT #' + lightP.number + ' ' + lightP.name + ' ' + lightP.weight + 'lb' +
      '   HEAVY #' + heavyP.number + ' ' + heavyP.name + ' ' + heavyP.weight + 'lb'
    );
    return { light: lightP, heavy: heavyP };
  };

  // Object pooling: every player mesh for a game is built once here and
  // reused for every play (placePlayer/hideAllPlayers toggle visibility —
  // nothing is created or destroyed mid-game). When a new game rebuilds the
  // pool, the previous pool's per-player materials and textures are
  // disposed; geometries live in shared caches and are kept.
  function disposeEnt(ent) {
    ent.mesh.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData && m.userData.sharedLOD) continue; // cached LOD materials
        // Only per-player number/name canvases are unique textures; the
        // weave/grip normals are module-level singletons.
        if (m.map && m.map !== _wovenTex && m.map !== _gripTex) m.map.dispose();
        m.dispose();
      }
    });
  }

  FB.buildTeamMeshes = function (teamKey) {
    const team = FB.teams[teamKey];
    for (const p of FB.activePlayers[teamKey]) {
      FB.scene.remove(p.mesh);
      disposeEnt(p);
    }
    FB.activePlayers[teamKey].length = 0;
    for (const pl of team.players) {
      const ent = createPlayerMesh(pl, teamKey);
      ent.mesh.visible = false;
      FB.scene.add(ent.mesh);
      FB.activePlayers[teamKey].push(ent);
    }
  };

  FB.getEntByNumber = function (teamKey, num) {
    return FB.activePlayers[teamKey].find(e => e.player.number === num);
  };

  const OFF_SLOTS = ['QB','RB','WR1','WR2','WR3','TE','LT','LG','C','RG','RT'];
  const DEF_SLOTS = ['LE','DT','NT','RE','MLB','WLB','SLB','LCB','RCB','FS','SS'];
  const ST_SLOTS = ['K','P','KR1','KR2','PR','LS','Gunner1','Gunner2'];
  FB.OFF_SLOTS = OFF_SLOTS; FB.DEF_SLOTS = DEF_SLOTS; FB.ST_SLOTS = ST_SLOTS;

  FB.getStarter = function (teamKey, slot) {
    const side = OFF_SLOTS.includes(slot) ? 'OFF' : ST_SLOTS.includes(slot) ? 'ST' : 'DEF';
    const n = FB.lineups[teamKey][side][slot];
    return n != null ? FB.getEntByNumber(teamKey, n) : null;
  };

  // ---- Formations ----
  FB.offenseFormation = function (losX, dir) {
    const b = losX;
    return [
      { slot: 'C',  x: b - 0.3 * dir, z: 0 },
      { slot: 'LG', x: b - 0.3 * dir, z: -2 },
      { slot: 'RG', x: b - 0.3 * dir, z: 2 },
      { slot: 'LT', x: b - 0.3 * dir, z: -4 },
      { slot: 'RT', x: b - 0.3 * dir, z: 4 },
      { slot: 'QB', x: b - 5 * dir, z: 0 },
      { slot: 'RB', x: b - 5 * dir, z: -2.5 },
      { slot: 'TE', x: b - 0.3 * dir, z: 6 },
      { slot: 'WR1', x: b - 0.3 * dir, z: -22 },
      { slot: 'WR2', x: b - 0.3 * dir, z: 20 },
      { slot: 'WR3', x: b - 2 * dir, z: -12 },
    ];
  };
  // Build defense formation based on the currently-selected defensive play.
  // `dir` comes in as the defensive team's own forward direction, so the
  // defense's own side of the LOS is the -dir side. We flip to a local `ddir`
  // that points FROM the LOS TOWARD the defense's territory, so positive
  // depths put defenders progressively further behind the ball on their side.
  FB.defenseFormation = function (losX, dir) {
    const play = (FB.selectedPlay && FB.selectedPlay.defense) || null;
    const formation = (play && play.formation) || '4-3';
    const assignments = (play && play.assignments) || {};
    const ddir = -dir; // defense's own side of the LOS
    const b = losX + 1 * ddir;

    // Start from a 4-3 base, then rewrite positions per formation / assignments.
    const spots = {
      LE:  { x: b,              z: -5 },
      DT:  { x: b,              z: -1.5 },
      NT:  { x: b,              z: 1.5 },
      RE:  { x: b,              z: 5 },
      WLB: { x: b + 4 * ddir,   z: -7 },
      MLB: { x: b + 4 * ddir,   z: 0 },
      SLB: { x: b + 4 * ddir,   z: 7 },
      LCB: { x: b + 6 * ddir,   z: -22 },
      RCB: { x: b + 6 * ddir,   z: 22 },
      FS:  { x: b + 13 * ddir,  z: -6 },
      SS:  { x: b + 13 * ddir,  z: 8 },
    };

    // Formation shell adjustments.
    if (formation === 'nickel') {
      spots.SLB.x = b + 5 * ddir; spots.SLB.z = 12;
      spots.WLB.x = b + 5 * ddir; spots.WLB.z = -12;
      spots.MLB.x = b + 4 * ddir; spots.MLB.z = 0;
    } else if (formation === 'dime') {
      spots.WLB.x = b + 6 * ddir; spots.WLB.z = -14;
      spots.SLB.x = b + 6 * ddir; spots.SLB.z = 14;
      spots.MLB.x = b + 5 * ddir; spots.MLB.z = 0;
    } else if (formation === '3-4') {
      spots.NT.x = b + 3 * ddir; spots.NT.z = 0;
      spots.DT.z = -2.5; spots.RE.z = 5.5; spots.LE.z = -5.5;
    } else if (formation === 'goal-line') {
      spots.LE.z = -6; spots.DT.z = -2; spots.NT.z = 2; spots.RE.z = 6;
      spots.MLB.x = b + 1 * ddir; spots.MLB.z = 0;
      spots.WLB.x = b + 1 * ddir; spots.WLB.z = -4;
      spots.SLB.x = b + 1 * ddir; spots.SLB.z = 4;
      spots.LCB.x = b + 1 * ddir; spots.LCB.z = -12;
      spots.RCB.x = b + 1 * ddir; spots.RCB.z = 12;
      spots.FS.x = b + 6 * ddir;  spots.FS.z = 0;
      spots.SS.x = b + 2 * ddir;  spots.SS.z = 7;
    } else if (formation === 'prevent') {
      spots.LE.x = b;             spots.LE.z = -4;
      spots.DT.x = b;             spots.DT.z = 0;
      spots.RE.x = b;             spots.RE.z = 4;
      spots.NT.x = b + 8 * ddir;  spots.NT.z = 0;
      spots.WLB.x = b + 10 * ddir; spots.WLB.z = -12;
      spots.MLB.x = b + 10 * ddir; spots.MLB.z = 0;
      spots.SLB.x = b + 10 * ddir; spots.SLB.z = 12;
      spots.LCB.x = b + 16 * ddir; spots.LCB.z = -18;
      spots.RCB.x = b + 16 * ddir; spots.RCB.z = 18;
      spots.FS.x = b + 22 * ddir;  spots.FS.z = -7;
      spots.SS.x = b + 22 * ddir;  spots.SS.z = 7;
    }

    // Coverage-specific tweaks from assignments.
    const adjust = (slot, assignment) => {
      if (!assignment) return;
      if (assignment.type === 'man') {
        if (slot === 'LCB' || slot === 'RCB') {
          spots[slot].x = b + 1 * ddir;
        } else if (slot === 'SS' || slot === 'FS') {
          spots[slot].x = b + 3 * ddir;
        }
      } else if (assignment.type === 'zone') {
        const depth = typeof assignment.depth === 'number' ? assignment.depth : 6;
        const lateral = typeof assignment.lateral === 'number' ? assignment.lateral : 0;
        const safeDepth = Math.max(2, depth);
        spots[slot].x = b + safeDepth * ddir;
        if (typeof assignment.lateral === 'number') spots[slot].z = lateral;
      } else if (assignment.type === 'rush') {
        if (['WLB','MLB','SLB','SS','FS','LCB','RCB'].includes(slot)) {
          spots[slot].x = b + 1 * ddir;
        }
      }
    };
    for (const slot of Object.keys(spots)) adjust(slot, assignments[slot]);

    // Safety clamp: every defender must be at least 0.5 yards on the
    // defense's own side of the LOS (ddir direction).
    for (const slot of Object.keys(spots)) {
      const behind = (spots[slot].x - losX) * ddir;
      if (behind < 0.5) spots[slot].x = losX + 0.5 * ddir;
    }

    return Object.keys(spots).map(slot => ({ slot, x: spots[slot].x, z: spots[slot].z }));
  };

  FB.placePlayer = function (ent, x, z, role) {
    ent.mesh.position.set(x, 0, z);
    ent.vel.set(0, 0, 0);
    ent.isDown = false;
    ent.mesh.visible = true;
    ent.role = role;
    const dir = FB.forwardDir(ent.team);
    // Body front is +Z local; rotate so it faces the team's forward X direction.
    ent.mesh.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
  };

  FB.hideAllPlayers = function () {
    for (const k of ['home','away']) for (const e of FB.activePlayers[k]) { e.mesh.visible = false; e.isDown = false; }
  };

  // Offset formations by s.spotZ so the line of scrimmage straddles the hash
  // when the previous play ended outside the hashes.
  function zOffsetForFormation() {
    const zOff = (FB.state && FB.state.spotZ) || 0;
    const half = FB.const.FIELD_WID / 2 - 2;
    return { zOff, half };
  }
  FB.spawnOffense = function (teamKey, losX) {
    const dir = FB.forwardDir(teamKey);
    const form = FB.offenseFormation(losX, dir);
    const { zOff, half } = zOffsetForFormation();
    for (const spot of form) {
      const ent = FB.getStarter(teamKey, spot.slot);
      if (!ent) continue;
      const sz = Math.max(-half, Math.min(half, spot.z + zOff));
      FB.placePlayer(ent, spot.x, sz, spot.slot);
      if (spot.slot === 'QB') FB.qb = ent;
    }
  };
  FB.spawnDefense = function (teamKey, losX) {
    const dir = FB.forwardDir(teamKey);
    const form = FB.defenseFormation(losX, dir);
    const { zOff, half } = zOffsetForFormation();
    for (const spot of form) {
      const ent = FB.getStarter(teamKey, spot.slot);
      if (!ent) continue;
      const sz = Math.max(-half, Math.min(half, spot.z + zOff));
      FB.placePlayer(ent, spot.x, sz, spot.slot);
    }
  };

  // --- Run-on animation: after spawn, slide players in from their sidelines. ---
  // Offense enters from +Z sideline, defense from -Z sideline; each animates to
  // its formation target over ~1.6s with a smooth ease-out so the gait kicks in.
  FB.runOnState = null;
  FB.startRunOn = function (offTeam, defTeam, cb) {
    const half = FB.const.FIELD_WID / 2;
    const targets = [];
    const gather = (teamKey, fromZ) => {
      for (const e of FB.activePlayers[teamKey]) {
        if (!e.mesh.visible) continue;
        const tx = e.mesh.position.x;
        const tz = e.mesh.position.z;
        // Start position: same X as target, Z pushed to the sideline.
        const sx = tx + (Math.random() - 0.5) * 6;
        const sz = fromZ + (Math.random() - 0.5) * 2;
        e.mesh.position.set(sx, 0, sz);
        // Face toward target so the gait reads correctly.
        const dx = tx - sx, dz = tz - sz;
        e.mesh.rotation.y = Math.atan2(dx, dz);
        targets.push({ ent: e, sx, sz, tx, tz });
      }
    };
    gather(offTeam, half + 8);
    gather(defTeam, -half - 8);
    FB.runOnState = {
      targets,
      duration: 1.6,
      t: 0,
      cb: cb || null,
      offTeam, defTeam,
      fired: false,
    };
    // Safety fallback in case the update loop stalls.
    const stateRef = FB.runOnState;
    setTimeout(() => {
      if (stateRef && !stateRef.fired) {
        stateRef.fired = true;
        finalizeRunOn(stateRef);
      }
    }, 3500);
  };

  function finalizeRunOn(r) {
    // Snap every player to its target and restore forward-facing rotation.
    for (const tgt of r.targets) {
      tgt.ent.mesh.position.set(tgt.tx, 0, tgt.tz);
      tgt.ent.vel.set(0, 0, 0);
      const dir = FB.forwardDir(tgt.ent.team);
      tgt.ent.mesh.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (FB.runOnState === r) FB.runOnState = null;
    if (r.cb) { try { r.cb(); } catch (_) {} }
  }

  FB.updateRunOn = function (dt) {
    const r = FB.runOnState;
    if (!r || r.fired) return;
    r.t = Math.min(r.duration, r.t + dt);
    const p = r.t / r.duration;
    // Ease-out: fast start, slow arrival.
    const ease = 1 - Math.pow(1 - p, 2.2);
    for (const tgt of r.targets) {
      const nx = tgt.sx + (tgt.tx - tgt.sx) * ease;
      const nz = tgt.sz + (tgt.tz - tgt.sz) * ease;
      // Approximate velocity so the gait animator sees motion.
      const px = tgt.ent.mesh.position.x, pz = tgt.ent.mesh.position.z;
      tgt.ent.mesh.position.set(nx, 0, nz);
      tgt.ent.vel.set((nx - px) / Math.max(0.0001, dt), 0, (nz - pz) / Math.max(0.0001, dt));
    }
    // Keep the ball with the QB while they jog to the line.
    if (FB.ball && FB.ballCarrier && FB.ballState && FB.ballState.carried) {
      FB.ball.position.copy(FB.ballCarrier.mesh.position)
        .add(new THREE.Vector3(0, FB.ballCarrier.carryY || 2.2, 0.3));
    }
    if (r.t >= r.duration) {
      r.fired = true;
      finalizeRunOn(r);
    }
  };

  FB.createBall = function () {
    const geom = new THREE.SphereGeometry(0.35, 16, 12);
    geom.scale(1, 0.6, 0.6);
    // Pebble-grain leather: standard material + low metalness, medium roughness.
    FB.ball = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: 0x7a4018, roughness: 0.55, metalness: 0.05,
    }));
    FB.ball.castShadow = true;
    // White laces — slim bar along the top.
    const laces = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xf6f3e6, roughness: 0.7 })
    );
    laces.position.set(0, 0.22, 0);
    FB.ball.add(laces);
    FB.scene.add(FB.ball);
  };

  FB.attachBallTo = function (ent) {
    FB.ballCarrier = ent;
    FB.ballState.carried = true;
    FB.ballState.inAir = false;
    FB.ballState.vel.set(0, 0, 0);
  };

  // Defenders & offense query
  FB.defendersOf = function (teamKey) {
    const def = teamKey === 'home' ? 'away' : 'home';
    return FB.activePlayers[def].filter(e => e.mesh.visible && !e.isDown && FB.DEF_SLOTS.includes(e.role));
  };
  FB.offenseOf = function (teamKey) {
    return FB.activePlayers[teamKey].filter(e => e.mesh.visible && !e.isDown);
  };
  FB.nearestDefender = function (pos, teamKey) {
    const defs = FB.defendersOf(teamKey);
    let best = null, bd = Infinity;
    for (const d of defs) {
      const dist = d.mesh.position.distanceTo(pos);
      if (dist < bd) { bd = dist; best = d; }
    }
    return { def: best, dist: bd };
  };

  // Returns visible receivers (for pass pick)
  FB.visibleReceivers = function (teamKey) {
    return FB.offenseOf(teamKey).filter(e => ['WR1','WR2','WR3','TE','RB'].includes(e.role));
  };

})(window.FB);

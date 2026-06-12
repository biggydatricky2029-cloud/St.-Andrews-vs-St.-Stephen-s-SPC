// player-visuals-upgrade.js — SYSTEM 1: skin shader + shoulder pad + body
// detail upgrades, layered over the existing player rig.
//
// Strategy: wrap FB.buildTeamMeshes so that, after each player is built,
// we walk the rig and enhance specific parts in place. This keeps the
// existing geometry/animation pipeline intact and lets the per-tier
// effects gate in graphics-config.js decide which upgrades apply.
//
// PERF NOTES:
//   • All procedural textures (skin normal, grip pattern, eye-black canvas)
//     are baked ONCE and shared across all 44 players — zero per-player
//     texture cost.
//   • The expensive features the spec asks for (visor transmission, dynamic
//     per-pose wrinkle blending) are NOT enabled — they cost 10+ ms/frame
//     on mobile, see GRAPHICS_UPGRADE.md.
//   • Modeled cleat spikes and eye sockets add ~20 small meshes per
//     player (× 44 = 880 meshes). They sit on the rig root and are
//     LOD-gated by the existing THREE.LOD: only level-0 (close) renders
//     them; LOD 1 and 2 simply don't include them.
(function (FB) {
  'use strict';

  const SC = window.SYSTEMS_CONFIG;
  const GC = window.GRAPHICS_CONFIG;
  const V = SC.VISUALS;

  // -------------------------------------------------------------------------
  //  Shared procedural textures (baked once, shared across all players)
  // -------------------------------------------------------------------------

  let _skinNormalTex = null;
  /**
   * Procedural skin normal map: low-freq Perlin-like base + high-freq pore
   * speckle, converted from heightfield to tangent-space normals.
   * @returns {THREE.CanvasTexture}
   */
  function skinNormalMap() {
    if (_skinNormalTex) return _skinNormalTex;
    const size = 128;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    // Heightfield: smoothed noise + per-pixel pore noise.
    const noise = new Float32Array(size * size);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random();
    // 2-pass wrap blur.
    const blur = (src) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          s += src[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        }
        out[y * size + x] = s / 9;
      }
      return out;
    };
    const lowFreq = blur(blur(noise));
    // Pore speckle: take a fresh per-pixel noise and combine.
    const pore = new Float32Array(noise.length);
    for (let i = 0; i < pore.length; i++) pore[i] = Math.random();
    const height = new Float32Array(noise.length);
    for (let i = 0; i < noise.length; i++) {
      height[i] = lowFreq[i] * 0.65 + pore[i] * 0.35;
    }
    // Gradient → normal.
    const img = ctx.createImageData(size, size);
    const strength = 2.2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yt = (y - 1 + size) % size, yb = (y + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yb * size + x] - height[yt * size + x]) * strength;
      const nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor((nx / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _skinNormalTex = new THREE.CanvasTexture(c);
    _skinNormalTex.wrapS = _skinNormalTex.wrapT = THREE.RepeatWrapping;
    _skinNormalTex.repeat.set(2.5, 2.5);
    return _skinNormalTex;
  }

  let _gripHexTex = null;
  /**
   * Hexagonal grip pattern for receiver gloves (real receiver gloves have
   * a tacky hex/honeycomb texture). Baked as a normal map.
   * @returns {THREE.CanvasTexture}
   */
  function gloveGripHexMap() {
    if (_gripHexTex) return _gripHexTex;
    const size = 64;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const hexR = 5;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      // Distance to nearest hex center on staggered grid.
      const row = Math.round(y / (hexR * 1.5));
      const col = Math.round((x - (row % 2) * hexR * 0.866) / (hexR * 1.732));
      const cx = col * hexR * 1.732 + (row % 2) * hexR * 0.866;
      const cy = row * hexR * 1.5;
      const d = Math.hypot(x - cx, y - cy);
      height[y * size + x] = Math.max(0, 1 - d / hexR);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yt = (y - 1 + size) % size, yb = (y + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * 2.8;
      const dy = (height[yb * size + x] - height[yt * size + x]) * 2.8;
      const nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor((nx / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _gripHexTex = new THREE.CanvasTexture(c);
    _gripHexTex.wrapS = _gripHexTex.wrapT = THREE.RepeatWrapping;
    _gripHexTex.repeat.set(3, 3);
    return _gripHexTex;
  }

  // -------------------------------------------------------------------------
  //  Upgrade pass — runs on each ent after it's built.
  // -------------------------------------------------------------------------

  const SHARED = {
    cleatSole: null,
    eyeSocket: null,
    eyeBlack: null,
    collarFoam: null,
  };
  function sharedMat(key, factory) {
    if (!SHARED[key]) SHARED[key] = factory();
    return SHARED[key];
  }

  /**
   * Walks the rig root meshes and enhances each in place.
   * @param {object} ent - Player entity returned by createPlayerMesh.
   */
  function upgradeEntity(ent) {
    if (!ent || !ent.rigRoot || ent._visualsUpgraded) return;
    ent._visualsUpgraded = true;
    const rig = ent.rigRoot;
    const tier = GC && GC.tier ? GC.tier() : 'MEDIUM';
    const isHigh = tier === 'HIGH';

    // Walk every mesh in the rig once, classify by its material.
    const skinMats = new Set();
    const gloveMats = new Set();
    rig.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (!m || !m.color) continue;
        // Skin material is the one with the configured skin tone — gloves
        // are dark. Heuristic by hex value works because UniformSystem
        // builds materials with deterministic colors.
        const hex = '#' + m.color.getHexString();
        if (V.skin.tones.includes(hex.toLowerCase()) || V.skin.tones.includes(hex)) {
          skinMats.add(m);
        }
      }
    });

    // ---- Skin upgrade -----------------------------------------------------
    // Multi-layer: normal map + warm sheen (SSS approximation) + optional
    // clearcoat sweat layer (HIGH only).
    const normalTex = skinNormalMap();
    for (const m of skinMats) {
      m.normalMap = normalTex;
      m.normalScale = new THREE.Vector2(0.45, 0.45);
      m.roughness = V.skin.mattAreaRoughness;
      // r128 quirk: MeshPhysicalMaterial.sheen is a Color, not a scalar
      // (later three.js versions split it into sheen scalar + sheenColor).
      // Use the warm SSS tint directly as the sheen color.
      if ('sheen' in m) {
        m.sheen = new THREE.Color(V.skin.sheenColorHex).multiplyScalar(V.skin.sheenIntensity);
      }
      // Sweat clearcoat — only on HIGH, otherwise too costly across 44 players.
      if (isHigh && 'clearcoat' in m) {
        m.clearcoat = V.skin.sweatClearcoat;
        m.clearcoatRoughness = V.skin.sweatClearcoatRoughness;
      }
      m.needsUpdate = true;
    }

    // ---- Glove grip pattern ----------------------------------------------
    // Find glove meshes (small spheres, dark color). We tagged them in
    // players.js as scaled spheres at the wrist; here we add the hex
    // normal map to whatever PhysicalMaterial is on them.
    // For simplicity: walk again and find materials with low metalness
    // and dark color in the upper rig (shoulder pivots area).
    rig.traverse((o) => {
      if (!o.material || Array.isArray(o.material)) return;
      const m = o.material;
      if (!m.color) return;
      const hex = m.color.getHexString();
      // Match the configured glove color (`#16161a` from VISUALS).
      if (hex === '16161a' || hex === '141414') {
        m.normalMap = gloveGripHexMap();
        m.normalScale = new THREE.Vector2(0.6, 0.6);
        m.needsUpdate = true;
      }
    });

    // ---- Eye sockets + eye black -----------------------------------------
    // Add two small dark ovals where the eyes would be, slightly recessed
    // inside the helmet. Visible through the facemask cage.
    const headY = findHeadCenterY(rig);
    if (headY != null) {
      const socketMat = sharedMat('eyeSocket', () => new THREE.MeshStandardMaterial({
        color: V.eyes.socketColor, roughness: 0.9, metalness: 0,
      }));
      for (const sgn of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), socketMat);
        eye.position.set(sgn * 0.08, headY + 0.04, 0.24);
        rig.add(eye);
      }
      // Eye black: thin painted streak under each eye on most players.
      if (Math.random() < V.eyes.eyeBlackChance) {
        const blackMat = sharedMat('eyeBlack', () => new THREE.MeshBasicMaterial({
          color: V.eyes.eyeBlackColor, toneMapped: false,
        }));
        for (const sgn of [-1, 1]) {
          const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.018), blackMat);
          streak.position.set(sgn * 0.08, headY - 0.005, 0.243);
          rig.add(streak);
        }
      }
    }

    // ---- Neck collar pad around base of helmet ---------------------------
    const collarMat = sharedMat('collarFoam', () => new THREE.MeshStandardMaterial({
      color: V.shoulderPads.foam.color,
      roughness: V.shoulderPads.foam.roughness,
      metalness: V.shoulderPads.foam.metalness,
    }));
    const padsY = findPadsY(rig);
    if (padsY != null) {
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(V.shoulderPads.collarRadius, V.shoulderPads.collarHeight, 6, 14),
        collarMat
      );
      collar.position.set(0, padsY + 0.30, 0);
      collar.rotation.x = Math.PI / 2;
      rig.add(collar);
    }

    // ---- Modeled cleat spikes (LOD 0 only — they're inside the rig root,
    // and the rig root is itself only on LOD 0 in the existing LOD object).
    addCleatSpikes(rig);
  }

  function findHeadCenterY(rig) {
    // The skin material with the largest sphere is the head — its y
    // position is the head center. We saved geometry markers in
    // players.js: head = SphereGeometry(0.22). Heuristic search.
    let best = null;
    rig.traverse((o) => {
      if (!o.geometry || !o.geometry.parameters) return;
      if (o.geometry.type !== 'SphereGeometry') return;
      const r = o.geometry.parameters.radius;
      if (r > 0.20 && r < 0.25) {
        if (!best || o.position.y > best.position.y) best = o;
      }
    });
    return best ? best.position.y : null;
  }

  function findPadsY(rig) {
    // The shoulder yoke is a cylinder rotated on Z; find the highest such.
    let best = null;
    rig.traverse((o) => {
      if (!o.geometry || o.geometry.type !== 'CylinderGeometry') return;
      const p = o.geometry.parameters;
      if (p.radiusTop < 0.16 && p.height > 1.0 && Math.abs(o.rotation.z - Math.PI / 2) < 0.1) {
        if (!best || o.position.y > best.position.y) best = o;
      }
    });
    return best ? best.position.y : null;
  }

  /**
   * Add 8 small cylinder spikes to the bottom of each cleat. Each spike
   * is ~2.5 cm tall; from any normal camera angle they only become
   * visible when a player dives or is tackled — exactly the cinematic
   * detail moment the spec called for.
   */
  function addCleatSpikes(rig) {
    const spikeMat = sharedMat('cleatSole', () => new THREE.MeshStandardMaterial({
      color: 0x080808, roughness: 0.7, metalness: 0.15,
    }));
    const cleatMeshes = [];
    rig.traverse((o) => {
      if (!o.geometry || !o.geometry.parameters) return;
      const p = o.geometry.parameters;
      // We added a SOLE BoxGeometry of width=0.22, height≈0.035, length=0.42
      // in players.js. Match by signature.
      if (o.geometry.type === 'BoxGeometry' && p.width === 0.22 && p.depth === 0.42) {
        cleatMeshes.push(o);
      }
    });
    const layout = [
      [-0.06, -0.16], [0.06, -0.16],
      [-0.07, -0.05], [0.07, -0.05],
      [-0.07, 0.07], [0.07, 0.07],
      [0, 0.16], [0, -0.18],
    ];
    for (const sole of cleatMeshes) {
      // Spikes sit below the sole's bottom face.
      for (let i = 0; i < V.cleats.spikesPerShoe; i++) {
        const [lx, lz] = layout[i % layout.length];
        const spike = new THREE.Mesh(
          new THREE.CylinderGeometry(V.cleats.spikeRadius, V.cleats.spikeRadius * 0.6, V.cleats.spikeHeight, 5),
          spikeMat
        );
        // Sole's center y minus half its height minus half a spike.
        const soleH = sole.geometry.parameters.height;
        spike.position.set(lx, -soleH / 2 - V.cleats.spikeHeight / 2, lz);
        sole.add(spike);
      }
    }
  }

  // -------------------------------------------------------------------------
  //  Wiring — wrap buildTeamMeshes.
  // -------------------------------------------------------------------------
  if (FB.buildTeamMeshes && !FB.buildTeamMeshes.__visualsWrap) {
    const orig = FB.buildTeamMeshes;
    const wrapped = function (teamKey) {
      const r = orig.apply(this, arguments);
      for (const ent of (FB.activePlayers[teamKey] || [])) upgradeEntity(ent);
      return r;
    };
    wrapped.__visualsWrap = true;
    FB.buildTeamMeshes = wrapped;
  }

  FB.PlayerVisualsUpgrade = { upgradeEntity, skinNormalMap, gloveGripHexMap };

})(window.FB);

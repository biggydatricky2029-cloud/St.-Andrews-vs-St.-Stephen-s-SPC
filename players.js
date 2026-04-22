// players.js — player meshes, formations, ball, spawn logic.
(function (FB) {
  'use strict';

  FB.activePlayers = { home: [], away: [] };
  FB.ballCarrier = null;
  FB.qb = null;
  FB.selectedDefender = null;
  FB.ball = null;
  FB.ballState = { carried: true, vel: new THREE.Vector3(), inAir: false, targetPlayer: null, kind: 'run', airTime: 0 };

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

  function createPlayerMesh(player, teamKey) {
    const team = FB.teams[teamKey];
    const primary = new THREE.Color(team.primaryColor);
    const secondary = new THREE.Color(team.secondaryColor);
    const primaryHex = '#' + primary.getHexString();
    const secondaryHex = '#' + secondary.getHexString();
    // PBR uniforms — broadcast-style with sRGB output + ACES tonemap.
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc48a66, roughness: 0.72, metalness: 0.0 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.15 });
    const cleatMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.45, metalness: 0.2 });
    const sockMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.85, metalness: 0.0 });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55, metalness: 0.15 });
    const pantStripeMat = new THREE.MeshStandardMaterial({ color: secondary.clone().lerp(new THREE.Color(0xffffff), 0.7), roughness: 0.7, metalness: 0.0 });

    // --- Proportional scaling from real listed height/weight ---
    const heightIn = parseHeightInches(player.height) || 70;
    const weightLb = (player.weight && player.weight > 0) ? player.weight : 170;
    const scaleY = Math.max(0.85, Math.min(1.22, heightIn / 70));
    const girth = Math.max(0.85, Math.min(1.55, Math.pow(weightLb / 170, 0.38)));

    const g = new THREE.Group();
    const pantsMat = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.78, metalness: 0.0 });

    // --- Legs with hip + knee pivots so they can swing and bend. ---
    // Each leg is a chain: hipPivot (at hip joint) -> thigh + kneePivot.
    // kneePivot (at knee joint) -> knee ball + sock + calf + foot.
    // Body front is +Z local; rotating a pivot's X axis swings fwd/back.
    const footL = 0.42, footW = 0.22, footH = 0.1;
    const hipX = 0.22 * girth;
    const ankleY = footH;
    const calfH = 0.68, thighH = 0.84;
    const kneeY = ankleY + calfH;
    const thighTopY = kneeY + thighH;
    const calfR = 0.17 * girth;
    const thighRTop = 0.22 * girth, thighRBot = 0.19 * girth;
    const rigLegs = {};
    for (const side of ['L', 'R']) {
      const dx = side === 'L' ? -hipX : hipX;
      const hipPivot = new THREE.Group();
      hipPivot.position.set(dx, thighTopY, 0);
      g.add(hipPivot);

      const thigh = new THREE.Mesh(
        new THREE.CylinderGeometry(thighRTop, thighRBot, thighH, 10),
        pantsMat
      );
      thigh.position.set(0, -thighH / 2, 0);
      thigh.castShadow = true;
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

      const knee = new THREE.Mesh(new THREE.SphereGeometry(calfR * 1.1, 10, 8), pantsMat);
      knee.position.set(0, 0, 0);
      knee.castShadow = true;
      kneePivot.add(knee);

      const sock = new THREE.Mesh(
        new THREE.CylinderGeometry(calfR * 0.95, calfR * 0.9, 0.22, 10),
        sockMat
      );
      sock.position.set(0, 0.11 - calfH, 0);
      sock.castShadow = true;
      kneePivot.add(sock);

      const calf = new THREE.Mesh(
        new THREE.CylinderGeometry(calfR * 1.05, calfR * 0.95, calfH - 0.22, 10),
        skinMat
      );
      calf.position.set(0, 0.11 - calfH / 2, 0);
      calf.castShadow = true;
      kneePivot.add(calf);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(footW, footH, footL), cleatMat);
      foot.position.set(0, -calfH - footH / 2, 0.06);
      foot.castShadow = true;
      kneePivot.add(foot);

      rigLegs[side] = { hip: hipPivot, knee: kneePivot };
    }

    // --- Pelvis / hip pad + belt ---
    const pelvisH = 0.3;
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.95 * girth, pelvisH, 0.55 * girth), pantsMat);
    pelvis.position.y = thighTopY + pelvisH / 2;
    pelvis.castShadow = true;
    g.add(pelvis);
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.98 * girth, 0.08, 0.57 * girth),
      beltMat
    );
    belt.position.y = thighTopY + pelvisH + 0.04;
    g.add(belt);

    // --- Torso (jersey) with taper toward waist and number/name textures ---
    const torsoH = 1.0;
    const torsoBottomY = thighTopY + pelvisH + 0.08;
    const torsoY = torsoBottomY + torsoH / 2;
    const torsoTopW = 1.08 * girth, torsoBotW = 0.92 * girth;
    const torsoTopD = 0.58 * girth, torsoBotD = 0.52 * girth;
    const frontTex = jerseyFrontTexture(player.number, primaryHex, secondaryHex);
    const lastName = (player.name || '').split(' ').slice(-1)[0];
    const backTex = jerseyBackTexture(player.number, lastName, primaryHex, secondaryHex);
    // Use a buffer geometry box then warp vertices for taper. Simplest route: a
    // shallow trapezoidal prism using BoxGeometry + per-vertex scale.
    const torsoGeo = new THREE.BoxGeometry(1, torsoH, 1, 1, 1, 1);
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
    // Jersey textures need sRGB so the printed numbers aren't washed under ACES.
    frontTex.encoding = THREE.sRGBEncoding;
    backTex.encoding = THREE.sRGBEncoding;
    const jerseyCfg = { roughness: 0.72, metalness: 0.0 };
    const torsoMats = [
      new THREE.MeshStandardMaterial(Object.assign({ color: primary }, jerseyCfg)),
      new THREE.MeshStandardMaterial(Object.assign({ color: primary }, jerseyCfg)),
      new THREE.MeshStandardMaterial(Object.assign({ color: primary }, jerseyCfg)),
      new THREE.MeshStandardMaterial(Object.assign({ color: primary }, jerseyCfg)),
      new THREE.MeshStandardMaterial(Object.assign({ map: frontTex }, jerseyCfg)),
      new THREE.MeshStandardMaterial(Object.assign({ map: backTex }, jerseyCfg)),
    ];
    const torso = new THREE.Mesh(torsoGeo, torsoMats);
    torso.position.y = torsoY;
    torso.castShadow = true;
    g.add(torso);

    // --- Shoulders: slim yoke + full rounded caps for a natural shoulder line. ---
    const padsY = torsoY + torsoH / 2 + 0.06;
    const shoulderSpan = 1.18 * girth;
    const shoulderMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.62, metalness: 0.05 });
    const yoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, shoulderSpan, 12),
      shoulderMat
    );
    yoke.rotation.z = Math.PI / 2;
    yoke.position.set(0, padsY, 0);
    yoke.castShadow = true;
    g.add(yoke);
    const capR = 0.22 * girth;
    for (const sgn of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(capR, 14, 12),
        shoulderMat
      );
      cap.position.set(sgn * shoulderSpan / 2, padsY, 0);
      cap.castShadow = true;
      g.add(cap);

      // Beefy shoulder pad — slightly wider than the shoulder line, matte finish.
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(0.52 * girth, 0.22, 0.6 * girth),
        shoulderMat
      );
      pad.position.set(sgn * shoulderSpan / 2, padsY + 0.12, 0);
      pad.castShadow = true;
      g.add(pad);
    }

    // --- Arms with shoulder + elbow pivots so arms can swing and elbow can
    //     stay bent ~90° pointing opposite of motion.
    const armMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.72, metalness: 0.0 });
    const upperLen = 0.6;
    const foreLen = 0.55;
    const armR = 0.135 * girth;
    const rigArms = {};
    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? -1 : 1;
      const shoulderX = sgn * (shoulderSpan / 2);
      const shoulderY = padsY - 0.12;

      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(shoulderX, shoulderY, 0);
      g.add(shoulderPivot);

      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(armR * 1.08, armR * 0.95, upperLen * 0.45, 10),
        armMat
      );
      sleeve.position.set(0, -upperLen * 0.22, 0);
      sleeve.castShadow = true;
      shoulderPivot.add(sleeve);

      const bicep = new THREE.Mesh(
        new THREE.CylinderGeometry(armR * 0.95, armR * 0.82, upperLen * 0.6, 10),
        skinMat
      );
      bicep.position.set(0, -upperLen * 0.75, 0);
      bicep.castShadow = true;
      shoulderPivot.add(bicep);

      const elbowPivot = new THREE.Group();
      elbowPivot.position.set(0, -upperLen - 0.02, 0);
      shoulderPivot.add(elbowPivot);

      const elbow = new THREE.Mesh(new THREE.SphereGeometry(armR * 0.92, 8, 6), skinMat);
      elbow.position.set(0, 0, 0);
      elbowPivot.add(elbow);

      const fore = new THREE.Mesh(
        new THREE.CylinderGeometry(armR * 0.82, armR * 0.66, foreLen, 10),
        skinMat
      );
      fore.position.set(0, -foreLen / 2, 0);
      fore.castShadow = true;
      elbowPivot.add(fore);

      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.2), gloveMat);
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat);
    head.position.y = headY;
    head.scale.set(0.95, 1.02, 1.02);
    g.add(head);

    // --- Helmet: ellipsoid shell with chin strap + earhole + facemask ---
    // MeshPhysicalMaterial with clearcoat so the helmet reads like painted
    // polycarbonate under the sun.
    const helmetY = headY + 0.11;
    const helmetMat = new THREE.MeshPhysicalMaterial({
      color: primary,
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14), helmetMat);
    helmet.position.y = helmetY;
    helmet.scale.set(1.08, 1.0, 1.18);
    helmet.castShadow = true;
    g.add(helmet);
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
    // Facemask — thin cage of dark metal bars
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x707076, roughness: 0.35, metalness: 0.85 });
    const mask = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 6, 14, Math.PI),
      maskMat
    );
    mask.position.set(0, helmetY - 0.1, 0.36);
    mask.rotation.x = Math.PI / 2;
    g.add(mask);
    // Two horizontal facemask bars for more "cage" detail.
    for (const yOff of [-0.08, 0.06]) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.28, 6),
        maskMat
      );
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, helmetY - 0.1 + yOff, 0.42);
      g.add(bar);
    }
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

    // Apply overall height scaling to the whole figure (feet remain on ground).
    g.scale.y = scaleY;

    // --- Derived attributes: weight + height shape speed/accel subtly ---
    const rating = player.overall || 60;
    const weightPenalty = Math.max(0.82, Math.min(1.10, 170 / weightLb));
    const heightBonus = Math.max(0.95, Math.min(1.08, heightIn / 70));
    const speed = (4 + rating * 0.06) * weightPenalty;
    const accel = (8 + rating * 0.12) * weightPenalty;

    // Where the ball sits when this player carries it (scales with the player's height).
    const carryY = (torsoY + 0.15) * scaleY;

    return {
      mesh: g, player, team: teamKey, role: null,
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
      gaitPhase: 0,
    };
  }

  FB.buildTeamMeshes = function (teamKey) {
    const team = FB.teams[teamKey];
    for (const p of FB.activePlayers[teamKey]) FB.scene.remove(p.mesh);
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

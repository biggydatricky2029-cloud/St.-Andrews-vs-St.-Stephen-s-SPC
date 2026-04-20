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
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xc48a66 });
    const gloveMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
    const cleatMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
    const sockMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
    const beltMat = new THREE.MeshLambertMaterial({ color: 0x141414 });

    // --- Proportional scaling from real listed height/weight ---
    const heightIn = parseHeightInches(player.height) || 70;
    const weightLb = (player.weight && player.weight > 0) ? player.weight : 170;
    const scaleY = Math.max(0.85, Math.min(1.22, heightIn / 70));
    const girth = Math.max(0.85, Math.min(1.55, Math.pow(weightLb / 170, 0.38)));

    const g = new THREE.Group();
    const pantsMat = new THREE.MeshLambertMaterial({ color: secondary });

    // --- Feet / cleats (pointed forward = +Z; hip spread along X). ---
    const footL = 0.42, footW = 0.22, footH = 0.1;
    const hipX = 0.22 * girth;
    for (const dx of [-hipX, hipX]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(footW, footH, footL), cleatMat);
      foot.position.set(dx, footH / 2, 0.06);
      foot.castShadow = true;
      g.add(foot);
    }

    // --- Legs: ankle, calf, knee, thigh (tapered), hips on X axis. ---
    const ankleY = footH;
    const calfH = 0.68, thighH = 0.84;
    const kneeY = ankleY + calfH;
    const thighTopY = kneeY + thighH;
    const calfR = 0.17 * girth;
    const thighRTop = 0.22 * girth, thighRBot = 0.19 * girth;
    for (const dx of [-hipX, hipX]) {
      const sock = new THREE.Mesh(
        new THREE.CylinderGeometry(calfR * 0.95, calfR * 0.9, 0.22, 10),
        sockMat
      );
      sock.position.set(dx, ankleY + 0.11, 0);
      sock.castShadow = true;
      g.add(sock);
      const calf = new THREE.Mesh(
        new THREE.CylinderGeometry(calfR * 1.05, calfR * 0.95, calfH - 0.22, 10),
        skinMat
      );
      calf.position.set(dx, ankleY + 0.22 + (calfH - 0.22) / 2, 0);
      calf.castShadow = true;
      g.add(calf);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(calfR * 1.1, 10, 8), pantsMat);
      knee.position.set(dx, kneeY, 0);
      knee.castShadow = true;
      g.add(knee);
      const thigh = new THREE.Mesh(
        new THREE.CylinderGeometry(thighRTop, thighRBot, thighH, 10),
        pantsMat
      );
      thigh.position.set(dx, kneeY + thighH / 2, 0);
      thigh.castShadow = true;
      g.add(thigh);
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
    const torsoMats = [
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ map: frontTex }),
      new THREE.MeshLambertMaterial({ map: backTex }),
    ];
    const torso = new THREE.Mesh(torsoGeo, torsoMats);
    torso.position.y = torsoY;
    torso.castShadow = true;
    g.add(torso);

    // --- Shoulders: slim yoke + full rounded caps for a natural shoulder line. ---
    const padsY = torsoY + torsoH / 2 + 0.06;
    const shoulderSpan = 1.18 * girth;
    const yoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, shoulderSpan, 12),
      new THREE.MeshLambertMaterial({ color: primary })
    );
    yoke.rotation.z = Math.PI / 2;
    yoke.position.set(0, padsY, 0);
    yoke.castShadow = true;
    g.add(yoke);
    const capR = 0.22 * girth;
    for (const sgn of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(capR, 14, 12),
        new THREE.MeshLambertMaterial({ color: primary })
      );
      cap.position.set(sgn * shoulderSpan / 2, padsY, 0);
      cap.castShadow = true;
      g.add(cap);
    }

    // --- Arms: sleeve + bicep + elbow + forearm + glove ---
    const armMat = new THREE.MeshLambertMaterial({ color: primary });
    const upperLen = 0.6;
    const foreLen = 0.55;
    const armR = 0.135 * girth;
    for (const sgn of [-1, 1]) {
      const shoulderX = sgn * (shoulderSpan / 2);
      const shoulderY = padsY - 0.12;
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(armR * 1.08, armR * 0.95, upperLen * 0.45, 10),
        armMat
      );
      sleeve.position.set(shoulderX, shoulderY - upperLen * 0.22, 0);
      sleeve.castShadow = true;
      g.add(sleeve);
      const bicep = new THREE.Mesh(
        new THREE.CylinderGeometry(armR * 0.95, armR * 0.82, upperLen * 0.6, 10),
        skinMat
      );
      bicep.position.set(shoulderX, shoulderY - upperLen * 0.75, 0);
      bicep.castShadow = true;
      g.add(bicep);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(armR * 0.92, 8, 6), skinMat);
      elbow.position.set(shoulderX, shoulderY - upperLen - 0.02, 0);
      g.add(elbow);
      const fore = new THREE.Mesh(
        new THREE.CylinderGeometry(armR * 0.82, armR * 0.66, foreLen, 10),
        skinMat
      );
      fore.position.set(shoulderX, shoulderY - upperLen - 0.02 - foreLen / 2, 0);
      fore.castShadow = true;
      g.add(fore);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.2), gloveMat);
      glove.position.set(shoulderX, shoulderY - upperLen - foreLen - 0.14, 0);
      glove.castShadow = true;
      g.add(glove);
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
    const helmetY = headY + 0.11;
    const helmetMat = new THREE.MeshLambertMaterial({ color: primary });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 14), helmetMat);
    helmet.position.y = helmetY;
    helmet.scale.set(1.08, 1.0, 1.18);
    helmet.castShadow = true;
    g.add(helmet);
    // Back lip / bumper
    const bumper = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.04, 6, 16),
      new THREE.MeshLambertMaterial({ color: 0x101010 })
    );
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(0, helmetY - 0.3, 0);
    bumper.scale.set(1.12, 1.2, 1);
    g.add(bumper);
    // Ear holes (dark dots on sides)
    for (const sgn of [-1, 1]) {
      const ear = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 10),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );
      ear.rotation.y = sgn * Math.PI / 2;
      ear.position.set(sgn * 0.4, helmetY - 0.02, 0);
      g.add(ear);
    }
    // Facemask
    const mask = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 6, 14, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    mask.position.set(0, helmetY - 0.1, 0.36);
    mask.rotation.x = Math.PI / 2;
    g.add(mask);
    // Chin strap
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.018, 4, 10, Math.PI * 0.9),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    strap.position.set(0, helmetY - 0.28, 0.12);
    strap.rotation.x = Math.PI / 2.1;
    g.add(strap);

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
  FB.defenseFormation = function (losX, dir) {
    const b = losX + 1 * dir;
    return [
      { slot: 'LE', x: b, z: -5 },
      { slot: 'DT', x: b, z: -1.5 },
      { slot: 'NT', x: b, z: 1.5 },
      { slot: 'RE', x: b, z: 5 },
      { slot: 'WLB', x: b + 4 * dir, z: -7 },
      { slot: 'MLB', x: b + 4 * dir, z: 0 },
      { slot: 'SLB', x: b + 4 * dir, z: 7 },
      { slot: 'LCB', x: b + 2 * dir, z: -22 },
      { slot: 'RCB', x: b + 2 * dir, z: 22 },
      { slot: 'FS', x: b + 12 * dir, z: -6 },
      { slot: 'SS', x: b + 12 * dir, z: 8 },
    ];
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

  FB.spawnOffense = function (teamKey, losX) {
    const dir = FB.forwardDir(teamKey);
    const form = FB.offenseFormation(losX, dir);
    for (const spot of form) {
      const ent = FB.getStarter(teamKey, spot.slot);
      if (!ent) continue;
      FB.placePlayer(ent, spot.x, spot.z, spot.slot);
      if (spot.slot === 'QB') FB.qb = ent;
    }
  };
  FB.spawnDefense = function (teamKey, losX) {
    const dir = FB.forwardDir(teamKey);
    const form = FB.defenseFormation(losX, dir);
    for (const spot of form) {
      const ent = FB.getStarter(teamKey, spot.slot);
      if (!ent) continue;
      FB.placePlayer(ent, spot.x, spot.z, spot.slot);
    }
  };

  FB.createBall = function () {
    const geom = new THREE.SphereGeometry(0.35, 12, 10);
    geom.scale(1, 0.6, 0.6);
    FB.ball = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: 0x6a3a16 }));
    FB.ball.castShadow = true;
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

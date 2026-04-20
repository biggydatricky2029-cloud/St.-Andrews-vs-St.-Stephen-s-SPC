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
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xc48a66 }); // generic skin tone

    // --- Proportional scaling from real listed height/weight ---
    // Baseline: 5'10" (70 in) and 170 lbs → scale factors of 1.0.
    const heightIn = parseHeightInches(player.height) || 70;
    const weightLb = (player.weight && player.weight > 0) ? player.weight : 170;
    const scaleY = Math.max(0.85, Math.min(1.22, heightIn / 70));
    const girth = Math.max(0.85, Math.min(1.55, Math.pow(weightLb / 170, 0.38)));

    const g = new THREE.Group();

    // --- Legs (two cylinders) ---
    const pantsMat = new THREE.MeshLambertMaterial({ color: secondary });
    const legH = 1.6;
    const legR = 0.18 * girth;
    for (const dz of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR * 0.88, legH, 8), pantsMat);
      leg.position.set(0, legH / 2, dz * girth);
      leg.castShadow = true;
      g.add(leg);
    }

    // --- Pelvis / hip pad ---
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.95 * girth, 0.3, 0.55 * girth), pantsMat);
    pelvis.position.y = legH + 0.15;
    pelvis.castShadow = true;
    g.add(pelvis);

    // --- Torso (jersey) with number/name textures on front/back ---
    const torsoW = 1.0 * girth;
    const torsoH = 1.05;
    const torsoD = 0.55 * girth;
    const torsoY = legH + 0.3 + torsoH / 2;
    const frontTex = jerseyFrontTexture(player.number, primaryHex, secondaryHex);
    const lastName = (player.name || '').split(' ').slice(-1)[0];
    const backTex = jerseyBackTexture(player.number, lastName, primaryHex, secondaryHex);
    const torsoMats = [
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ map: frontTex }),   // +Z front
      new THREE.MeshLambertMaterial({ map: backTex }),    // -Z back
    ];
    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), torsoMats);
    torso.position.y = torsoY;
    torso.castShadow = true;
    g.add(torso);

    // --- Shoulder pads (wider than torso, beveled top) ---
    const padsY = torsoY + torsoH / 2 + 0.08;
    const pads = new THREE.Mesh(
      new THREE.BoxGeometry(1.55 * girth, 0.32, torsoD + 0.18),
      new THREE.MeshLambertMaterial({ color: primary })
    );
    pads.position.y = padsY;
    pads.castShadow = true;
    g.add(pads);

    // --- Arms (upper tapered cylinders) ---
    const armMat = new THREE.MeshLambertMaterial({ color: primary });
    const foreMat = skinMat;
    const armLen = 0.65;
    const foreLen = 0.55;
    const armR = 0.14 * girth;
    for (const sgn of [-1, 1]) {
      const shoulderX = sgn * (0.55 * girth + armR * 0.9);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR * 0.88, armLen, 8), armMat);
      upper.position.set(shoulderX, padsY - 0.1 - armLen / 2, 0);
      upper.castShadow = true;
      g.add(upper);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(armR * 0.82, armR * 0.7, foreLen, 8), foreMat);
      fore.position.set(shoulderX, padsY - 0.1 - armLen - foreLen / 2, 0);
      fore.castShadow = true;
      g.add(fore);
    }

    // --- Neck ---
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.18, 8), skinMat);
    neck.position.y = padsY + 0.2;
    g.add(neck);

    // --- Helmet + facemask ---
    const helmetY = padsY + 0.55;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 12), new THREE.MeshLambertMaterial({ color: primary }));
    helmet.position.y = helmetY;
    helmet.scale.set(1.05, 0.95, 1.18);
    helmet.castShadow = true;
    g.add(helmet);
    const mask = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 6, 12, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    mask.position.set(0, helmetY - 0.08, 0.36);
    mask.rotation.x = Math.PI / 2;
    g.add(mask);

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
    ent.mesh.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
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

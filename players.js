// players.js — player meshes, formations, ball, spawn logic.
(function (FB) {
  'use strict';

  FB.activePlayers = { home: [], away: [] };
  FB.ballCarrier = null;
  FB.qb = null;
  FB.selectedDefender = null;
  FB.ball = null;
  FB.ballState = { carried: true, vel: new THREE.Vector3(), inAir: false, targetPlayer: null, kind: 'run', airTime: 0 };

  function jerseyNumberTexture(num, bg, fg) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.font = 'bold 84px -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(num), c.width / 2, c.height / 2);
    return new THREE.CanvasTexture(c);
  }

  function createPlayerMesh(player, teamKey) {
    const team = FB.teams[teamKey];
    const primary = new THREE.Color(team.primaryColor);
    const secondary = new THREE.Color(team.secondaryColor);
    const g = new THREE.Group();

    const pants = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.6),
      new THREE.MeshLambertMaterial({ color: secondary }));
    pants.position.y = 0.7; pants.castShadow = true; g.add(pants);

    const torsoTex = jerseyNumberTexture(player.number, '#' + primary.getHexString(), '#' + secondary.getHexString());
    const torsoMats = [
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ color: primary }),
      new THREE.MeshLambertMaterial({ map: torsoTex }),
      new THREE.MeshLambertMaterial({ map: torsoTex }),
    ];
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.7), torsoMats);
    torso.position.y = 2.0; torso.castShadow = true; g.add(torso);

    const pads = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.9),
      new THREE.MeshLambertMaterial({ color: primary }));
    pads.position.y = 2.6; pads.castShadow = true; g.add(pads);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10),
      new THREE.MeshLambertMaterial({ color: primary }));
    helmet.position.y = 3.1; helmet.scale.set(1.0, 0.95, 1.15); helmet.castShadow = true; g.add(helmet);
    const mask = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 6, 12, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x999999 }));
    mask.position.set(0, 3.0, 0.38); mask.rotation.x = Math.PI / 2; g.add(mask);

    const rating = player.overall || 60;
    const speed = 4 + rating * 0.06;
    const accel = 8 + rating * 0.12;
    return {
      mesh: g, player, team: teamKey, role: null,
      baseSpeed: speed, accel,
      stamina: 100, rating,
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      assignment: null, isDown: false, route: null,
      jukeCooldown: 0,
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

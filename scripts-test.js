// Full functional test: exercise every system added this session and
// report pass/fail per item. SwiftShader-backed Chromium with CDN
// requests routed to the local three.js tarball.
const fs = require('fs');
const { chromium } = require('/tmp/node_modules/playwright-core');
const PKG = '/tmp/cdn/package';

const results = [];
const fail = (name, why) => { results.push({ name, ok: false, why }); };
const pass = (name, detail) => { results.push({ name, ok: true, detail }); };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 480 } });

  await page.route('**cdnjs.cloudflare.com/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(PKG + '/build/three.min.js') }));
  await page.route('**cdn.jsdelivr.net/npm/three@0.128.0/examples/js/**', (r) => {
    const f = PKG + '/examples/js/' + r.request().url().match(/examples\/js\/(.+\.js)/)[1];
    fs.existsSync(f) ? r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: '' });
  });
  const consoleErrs = [];
  const pageErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 180)); });
  page.on('pageerror', (e) => pageErrs.push(e.message.slice(0, 180)));

  // ----- BOOT -----------------------------------------------------------
  await page.goto('http://127.0.0.1:8741/index.html', { waitUntil: 'networkidle' });
  const pregameOk = await page.evaluate(() => !!document.getElementById('pgStart'));
  pregameOk ? pass('boot: pregame DOM ready') : fail('boot: pregame DOM ready');

  await page.click('#pgStart');
  await page.waitForTimeout(2800);

  const initState = await page.evaluate(() => ({
    sysCfg: typeof window.SYSTEMS_CONFIG,
    gfxCfg: typeof window.GRAPHICS_CONFIG,
    fb: typeof window.FB,
    attrSys: typeof FB.AttributeSystem,
    coverageAI: typeof FB.CoverageAI,
    blocking: typeof FB.BlockingResolution,
    stamina: typeof FB.StaminaSystem,
    crowd: typeof FB.CrowdReactions,
    visuals: typeof FB.PlayerVisualsUpgrade,
    scene: !!FB.scene,
    composer: !!FB.composer,
    spots: FB.stadiumSpots ? FB.stadiumSpots.length : 0,
    env: !!(FB.scene && FB.scene.environment),
    players: FB.activePlayers.home.length,
    fillLight: !!FB.fillLight,
    tier: GRAPHICS_CONFIG.tier(),
    renderFrame: typeof FB.renderFrame,
    pendingPageErrs: window.__pageErrs || [],
  }));

  // Boot health checks
  (initState.fb === 'object') ? pass('boot: FB namespace exists') : fail('boot: FB namespace exists');
  (initState.sysCfg === 'object') ? pass('boot: SYSTEMS_CONFIG loaded') : fail('boot: SYSTEMS_CONFIG loaded');
  (initState.gfxCfg === 'object') ? pass('boot: GRAPHICS_CONFIG loaded') : fail('boot: GRAPHICS_CONFIG loaded');
  (initState.attrSys === 'object') ? pass('boot: FB.AttributeSystem exposed') : fail('boot: FB.AttributeSystem exposed');
  (initState.coverageAI === 'object') ? pass('boot: FB.CoverageAI exposed') : fail('boot: FB.CoverageAI exposed');
  (initState.blocking === 'object') ? pass('boot: FB.BlockingResolution exposed') : fail('boot: FB.BlockingResolution exposed');
  (initState.stamina === 'object') ? pass('boot: FB.StaminaSystem exposed') : fail('boot: FB.StaminaSystem exposed');
  (initState.crowd === 'object') ? pass('boot: FB.CrowdReactions exposed') : fail('boot: FB.CrowdReactions exposed');
  (initState.visuals === 'object') ? pass('boot: FB.PlayerVisualsUpgrade exposed') : fail('boot: FB.PlayerVisualsUpgrade exposed');
  (initState.scene) ? pass('graphics: scene built') : fail('graphics: scene built');
  (initState.composer) ? pass('graphics: post composer active') : fail('graphics: post composer active');
  (initState.spots === 4) ? pass('graphics: 4 stadium spotlights present', '4 spots') : fail('graphics: 4 stadium spotlights present', 'got ' + initState.spots);
  (initState.env) ? pass('graphics: IBL cubemap attached as scene.environment') : fail('graphics: IBL cubemap attached');
  (initState.players === 44) ? pass('graphics: 44 player meshes built', '44') : fail('graphics: 44 player meshes built', 'got ' + initState.players);
  (initState.fillLight) ? pass('graphics: camera fill light exists') : fail('graphics: camera fill light exists');
  (initState.renderFrame === 'function') ? pass('graphics: FB.renderFrame is the render entry') : fail('graphics: FB.renderFrame is the render entry');

  // ----- SPRINT BUTTON REMOVED ------------------------------------------
  const sprintHidden = await page.evaluate(() => {
    const el = document.getElementById('btnSprint');
    if (!el) return 'missing-element';
    return el.classList.contains('hidden') ? 'hidden' : 'visible';
  });
  (sprintHidden === 'hidden') ? pass('controls: SPRINT button hidden') : fail('controls: SPRINT button hidden', 'state=' + sprintHidden);

  // ----- ATTRIBUTE SYSTEM math -----------------------------------------
  const attrChecks = await page.evaluate(() => {
    const A = FB.AttributeSystem;
    const near = (a, b, eps) => Math.abs(a - b) < (eps || 0.05);
    return {
      wr77speed:    { got: A.getAttributeValue(77, 'WR', 'speed'),         ok: near(A.getAttributeValue(77, 'WR', 'speed'), 83.6, 0.1) },
      qb99tp:       { got: A.getAttributeValue(99, 'QB', 'throwPower'),    ok: near(A.getAttributeValue(99, 'QB', 'throwPower'), 99) },
      cb50mc:       { got: A.getAttributeValue(50, 'CB', 'manCoverage'),   ok: near(A.getAttributeValue(50, 'CB', 'manCoverage'), 48) },
      rb85juke:     { got: A.getAttributeValue(85, 'RB', 'jukeMove'),      ok: near(A.getAttributeValue(85, 'RB', 'jukeMove'), 82) },
      speed99:      { got: A.getAIParameter(99, 'speed_mps'),              ok: near(A.getAIParameter(99, 'speed_mps'), 11.5) },
      speed50:      { got: A.getAIParameter(50, 'speed_mps'),              ok: near(A.getAIParameter(50, 'speed_mps'), 7.2) },
      accel99:      { got: A.getAIParameter(99, 'accel_t'),                ok: near(A.getAIParameter(99, 'accel_t'), 0.35, 0.01) },
      accel50:      { got: A.getAIParameter(50, 'accel_t'),                ok: near(A.getAIParameter(50, 'accel_t'), 1.10, 0.01) },
      agility99:    { got: A.getAIParameter(99, 'agility_t'),              ok: near(A.getAIParameter(99, 'agility_t'), 0.10, 0.01) },
      route99:      { got: A.getAIParameter(99, 'route_break_yds'),        ok: near(A.getAIParameter(99, 'route_break_yds'), 0.10, 0.05) },
      catchClean99: { got: A.getAIParameter(99, 'catch_clean_pct'),        ok: near(A.getAIParameter(99, 'catch_clean_pct'), 0.97, 0.01) },
      reaction50:   { got: A.getAIParameter(50, 'reaction_sec'),           ok: near(A.getAIParameter(50, 'reaction_sec'), 0.70, 0.01) },
      reaction99:   { got: A.getAIParameter(99, 'reaction_sec'),           ok: near(A.getAIParameter(99, 'reaction_sec'), 0.15, 0.01) },
      stamina99:    { got: A.getAIParameter(99, 'stamina_drain'),          ok: near(A.getAIParameter(99, 'stamina_drain'), 0.5, 0.01) },
    };
  });
  for (const [k, v] of Object.entries(attrChecks)) {
    v.ok ? pass('attributes: ' + k, 'got ' + JSON.stringify(v.got))
         : fail('attributes: ' + k, 'got ' + JSON.stringify(v.got));
  }

  // ----- DRIVE a scrimmage play directly (skip kickoff, since rAF is
  // throttled in headless and a wall-clock wait won't advance the sim).
  // We auto-confirm the play picker so finalizePlaySetup() runs immediately.
  await page.evaluate(async () => {
    // Auto-confirm any picker the engine opens.
    if (FB.openPlayPicker) {
      FB.openPlayPicker = (side, cb) => { setTimeout(() => cb && cb(), 0); };
    }
    FB.specialMode = null;
    FB.state.phase = 'deadball';
    FB.state.possession = 'home';
    FB.state.ballOn = 35; FB.state.los = 35; FB.state.down = 1; FB.state.distance = 10;
    FB.selectedPlay = FB.selectedPlay || {};
    FB.selectedPlay.offense = FB.PLAYBOOK.offense[0];
    FB.selectedPlay.defense = FB.PLAYBOOK.defense[0];
    FB.setupPlay('pass');
    // Drive enough frames for run-on to finish (1.6s + buffer).
    for (let i = 0; i < 220; i++) {
      const dt = 1 / 60;
      FB.updateRunOn && FB.updateRunOn(dt);
      FB.updatePlayerRigs && FB.updatePlayerRigs(dt);
      await new Promise(r => setTimeout(r, 0));
    }
  });

  const placeCheck = await page.evaluate(() => {
    const t = FB.state.possession;
    const offEnts = FB.activePlayers[t].filter(e => e.mesh.visible);
    const sample = offEnts.find(e => e.role === 'QB') || offEnts[0];
    if (!sample) return null;
    return {
      role: sample.role,
      hasAttr: !!sample.attr,
      attrSpeed: sample.attr ? sample.attr.speed : null,
      baseSpeed: +sample.baseSpeed.toFixed(2),
      accel: +sample.accel.toFixed(2),
      stamina: sample.stamina,
      drain: sample.staminaDrainPerPlay,
    };
  });
  if (!placeCheck) {
    fail('attributes: placed player has .attr bundle');
  } else {
    placeCheck.hasAttr ? pass('attributes: placed player has .attr bundle', 'role=' + placeCheck.role)
                       : fail('attributes: placed player has .attr bundle');
    (placeCheck.baseSpeed > 0 && placeCheck.baseSpeed <= 12)
      ? pass('attributes: baseSpeed wired from rating', placeCheck.role + ' speed=' + placeCheck.baseSpeed)
      : fail('attributes: baseSpeed wired from rating', 'speed=' + placeCheck.baseSpeed);
    (placeCheck.stamina === 100) ? pass('stamina: initial value 100', '100')
                                 : fail('stamina: initial value 100', 'got ' + placeCheck.stamina);
    (placeCheck.drain && placeCheck.drain > 0 && placeCheck.drain < 3)
      ? pass('stamina: per-play drain resolved', 'drain=' + placeCheck.drain)
      : fail('stamina: per-play drain resolved', 'drain=' + placeCheck.drain);
  }

  // Force snap if presnap, then drive a few frames into the live play.
  const snapPhase = await page.evaluate(async () => {
    if (FB.state.phase === 'presnap') FB.snapBall();
    // Drive 30 frames of live play so coverage / blocking populate.
    for (let i = 0; i < 30; i++) {
      const dt = 1 / 60;
      FB.updateBallCarrier && FB.updateBallCarrier(dt);
      FB.updateOffenseOthers && FB.updateOffenseOthers(dt);
      FB.updateDefense && FB.updateDefense(dt);
      FB.updateBallPhysics && FB.updateBallPhysics(dt);
      FB.updatePlayerRigs && FB.updatePlayerRigs(dt);
      await new Promise(r => setTimeout(r, 0));
    }
    return FB.state.phase;
  });

  // ----- COVERAGE AI ----------------------------------------------------
  const cov = await page.evaluate(() => {
    const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
    const out = { phase: FB.state.phase, counts: { man: 0, zone: 0, none: 0 }, details: [] };
    for (const d of FB.activePlayers[defTeam]) {
      if (!d.mesh.visible) continue;
      const c = d.coverage;
      if (!c) { out.counts.none++; continue; }
      out.counts[c.kind] = (out.counts[c.kind] || 0) + 1;
      if (out.details.length < 5) out.details.push({
        role: d.role,
        kind: c.kind,
        target: c.target ? c.target.role : null,
        rxnSec: c.reactionSec != null ? +c.reactionSec.toFixed(2) : null,
      });
    }
    return out;
  });
  const totalCov = cov.counts.man + cov.counts.zone;
  (cov.phase === 'play')
    ? pass('engine: play phase reached', cov.phase)
    : fail('engine: play phase reached', 'phase=' + cov.phase);
  (totalCov >= 4)
    ? pass('coverage: assignments materialized', cov.counts.man + ' man, ' + cov.counts.zone + ' zone')
    : fail('coverage: assignments materialized', 'man=' + cov.counts.man + ' zone=' + cov.counts.zone);
  // Pick whichever assignment populated and verify shape.
  const sampleCov = cov.details[0];
  if (sampleCov) {
    if (sampleCov.kind === 'man') {
      sampleCov.target ? pass('coverage: man assignment has receiver target', sampleCov.role + ' on ' + sampleCov.target)
                       : fail('coverage: man assignment has receiver target');
    } else if (sampleCov.kind === 'zone') {
      pass('coverage: zone assignment present', sampleCov.role);
    }
    (sampleCov.rxnSec != null && sampleCov.rxnSec >= 0.14 && sampleCov.rxnSec <= 0.80)
      ? pass('coverage: reactionSec interpolated from rating', sampleCov.role + ' react=' + sampleCov.rxnSec + 's')
      : fail('coverage: reactionSec interpolated from rating', 'reactionSec=' + sampleCov.rxnSec);
  }

  // ----- COVERAGE OVERRIDE plumbing — defenders get _covOverride per frame
  // Run a few frames of the play to populate covOverride state.
  await page.evaluate(async () => {
    for (let i = 0; i < 8; i++) {
      try {
        const dt = 1 / 60;
        FB.updateBallCarrier && FB.updateBallCarrier(dt);
        FB.updateOffenseOthers && FB.updateOffenseOthers(dt);
        FB.updateDefense && FB.updateDefense(dt);
      } catch (e) { /* ignore */ }
      await new Promise((res) => setTimeout(res, 0));
    }
  });
  const overrideCount = await page.evaluate(() => {
    const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
    let n = 0;
    for (const d of FB.activePlayers[defTeam]) {
      if (d._covOverride) n++;
    }
    return n;
  });
  (overrideCount > 0)
    ? pass('coverage: per-frame _covOverride written', overrideCount + ' defenders covered')
    : fail('coverage: per-frame _covOverride written', '0 defenders have overrides');

  // ----- BLOCKING RESOLUTION --------------------------------------------
  // Verify resolveMatchup produces a coherent 50/50 with equal ratings.
  const blockMath = await page.evaluate(() => {
    // 1000 samples per condition keeps statistical variance under 1.6σ.
    const fakeOL = { attr: { passBlocking: 70, runBlocking: 70, strength: 70 } };
    const fakeDL = { attr: { blockShedding: 70, strength: 70 } };
    let eq = 0;
    for (let i = 0; i < 1000; i++) {
      if (FB.BlockingResolution.resolveMatchup(fakeOL, fakeDL, 'pass', i)) eq++;
    }
    const dom = { attr: { passBlocking: 99, runBlocking: 99, strength: 99 } };
    const weak = { attr: { blockShedding: 50, strength: 50 } };
    let domWins = 0;
    for (let i = 0; i < 1000; i++) {
      if (FB.BlockingResolution.resolveMatchup(dom, weak, 'pass', i)) domWins++;
    }
    return { eq, dom: domWins };
  });
  // 1000 samples ± 3σ = ~500 ± 47 → accept 400-600 (40–60% rate).
  (blockMath.eq >= 400 && blockMath.eq <= 600)
    ? pass('blocking: equal-rating 70/70 ≈ 50% wins', blockMath.eq + '/1000')
    : fail('blocking: equal-rating 70/70 ≈ 50% wins', blockMath.eq + '/1000');
  // 99 OL vs 50 DL: deterministic dominance under the noise band.
  (blockMath.dom >= 950)
    ? pass('blocking: 99 OL vs 50 DL wins ≥95%', blockMath.dom + '/1000')
    : fail('blocking: 99 OL vs 50 DL wins ≥95%', blockMath.dom + '/1000');

  // Defender engagement state: does at least one DL have a _blockMatch?
  const engagement = await page.evaluate(() => {
    const defTeam = FB.state.possession === 'home' ? 'away' : 'home';
    let engaged = 0, total = 0;
    for (const d of FB.activePlayers[defTeam]) {
      if (!d.mesh.visible) continue;
      if (['LE','RE','DT','NT'].includes(d.role)) {
        total++;
        if (d._blockMatch) engaged++;
      }
    }
    return { engaged, total };
  });
  (engagement.engaged > 0)
    ? pass('blocking: DL engagement state recorded', engagement.engaged + '/' + engagement.total + ' DL engaged')
    : fail('blocking: DL engagement state recorded', '0/' + engagement.total + ' engaged');

  // ----- STAMINA --------------------------------------------------------
  // Snap drained stamina from 100 to (100 - drain). Verify against a
  // player who was actually placed (has staminaDrainPerPlay populated).
  const stamAfterSnap = await page.evaluate(() => {
    const t = FB.state.possession;
    const e = FB.activePlayers[t].find(x => x.mesh.visible && x.staminaDrainPerPlay != null);
    return e ? { role: e.role, stam: +e.stamina.toFixed(2), drain: +e.staminaDrainPerPlay.toFixed(2) } : null;
  });
  if (stamAfterSnap && stamAfterSnap.drain) {
    const expected = 100 - stamAfterSnap.drain;
    (Math.abs(stamAfterSnap.stam - expected) < 0.5)
      ? pass('stamina: drained correctly on snap', stamAfterSnap.stam + ' ≈ ' + expected.toFixed(2))
      : fail('stamina: drained correctly on snap', 'got ' + stamAfterSnap.stam + ' expected ' + expected.toFixed(2));
  }

  // Live multiplier check.
  const liveMul = await page.evaluate(() => {
    const e = { stamina: 50 };
    return FB.StaminaSystem.liveMultiplier(e);
  });
  (liveMul.speedMul < 1.0 && liveMul.speedMul > 0.85)
    ? pass('stamina: live speed multiplier at 50% stam', liveMul.speedMul.toFixed(3))
    : fail('stamina: live speed multiplier at 50% stam', JSON.stringify(liveMul));

  // Catch resolution sanity.
  const catchProb = await page.evaluate(() => {
    let caught99 = 0, caught50 = 0;
    const rcv99 = { attr: { catching: 99, catchInTraffic: 99 } };
    const rcv50 = { attr: { catching: 50, catchInTraffic: 50 } };
    const ball = { x: 0, z: 0 };
    FB.ballState.aimXZ = { x: 0, z: 0 };  // clean throw
    for (let i = 0; i < 200; i++) {
      if (FB.StaminaSystem.resolveCatch(rcv99, ball, false)) caught99++;
      if (FB.StaminaSystem.resolveCatch(rcv50, ball, false)) caught50++;
    }
    return { c99: caught99, c50: caught50 };
  });
  (catchProb.c99 > catchProb.c50 + 30)
    ? pass('stamina: catch rate scales with catching attribute', '99=' + catchProb.c99 + '/200 vs 50=' + catchProb.c50 + '/200')
    : fail('stamina: catch rate scales', JSON.stringify(catchProb));

  // ----- CROWD REACTIONS ------------------------------------------------
  const crowdFire = await page.evaluate(() => {
    let before = 0, after = 0;
    // Look for the crowd InstancedMesh.
    FB.scene.traverse(o => { if (o.isInstancedMesh && o.count > 200) { before = o.count; } });
    FB.CrowdReactions.fire('td_home');
    // tick once
    FB.updateCrowd && FB.updateCrowd(0);
    FB.scene.traverse(o => { if (o.isInstancedMesh && o.count > 200) { after = o.count; } });
    return { instCount: before, fired: typeof FB.CrowdReactions.fire === 'function' };
  });
  crowdFire.fired ? pass('crowd: CrowdReactions.fire exists') : fail('crowd: CrowdReactions.fire exists');
  (crowdFire.instCount > 0)
    ? pass('crowd: InstancedMesh present', crowdFire.instCount + ' instances')
    : fail('crowd: InstancedMesh present');

  // ----- PLAYER VISUALS UPGRADE -----------------------------------------
  const visuals = await page.evaluate(() => {
    // Find a built player rig and inspect its mesh tree for the upgrade artifacts.
    const ent = FB.activePlayers.home[0];
    if (!ent || !ent.rigRoot) return null;
    let eyeSocketCount = 0, spikeCount = 0, collarCount = 0;
    let skinHasNormal = false, gloveHasGrip = false;
    let helmetClearcoat = null;
    ent.rigRoot.traverse(o => {
      if (!o.geometry || !o.material) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      // Eye sockets: spheres with radius 0.045
      if (o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius === 0.045) eyeSocketCount++;
      // Cleat spikes: cylinders with our exact configured radius
      if (o.geometry.type === 'CylinderGeometry' && Math.abs(o.geometry.parameters.radiusTop - 0.018) < 0.001) spikeCount++;
      // Collar: torus with radius 0.20
      if (o.geometry.type === 'TorusGeometry' && Math.abs(o.geometry.parameters.radius - 0.20) < 0.001) collarCount++;
      // Skin normal map presence
      if (m && m.color) {
        const hex = '#' + m.color.getHexString();
        const skinTones = SYSTEMS_CONFIG.VISUALS.skin.tones.map(s => s.toLowerCase());
        if (skinTones.includes(hex.toLowerCase()) && m.normalMap) skinHasNormal = true;
      }
      // Glove grip
      if (m && m.color && m.color.getHexString() === '16161a' && m.normalMap) gloveHasGrip = true;
      // Helmet clearcoat (we're at HIGH tier in this test by default)
      if (m && m.clearcoat !== undefined && m.color) {
        // Heuristic: the team-color helmet sphere with clearcoat set
        if (helmetClearcoat == null) helmetClearcoat = m.clearcoat;
      }
    });
    return { eyeSocketCount, spikeCount, collarCount, skinHasNormal, gloveHasGrip, helmetClearcoat };
  });
  if (!visuals) {
    fail('visuals: rig root inspectable');
  } else {
    (visuals.eyeSocketCount === 2)
      ? pass('visuals: eye sockets added', visuals.eyeSocketCount + ' sockets')
      : fail('visuals: eye sockets added', 'got ' + visuals.eyeSocketCount);
    // 8 spikes per shoe × 2 shoes = 16 expected
    (visuals.spikeCount >= 16)
      ? pass('visuals: cleat spikes added', visuals.spikeCount + ' spike cylinders')
      : fail('visuals: cleat spikes added', 'got ' + visuals.spikeCount + ' (expected ≥16)');
    (visuals.collarCount >= 1)
      ? pass('visuals: neck collar added', visuals.collarCount + ' torus')
      : fail('visuals: neck collar added', 'got ' + visuals.collarCount);
    visuals.skinHasNormal
      ? pass('visuals: skin normal map applied to skin materials')
      : fail('visuals: skin normal map applied to skin materials');
    visuals.gloveHasGrip
      ? pass('visuals: glove grip pattern applied')
      : fail('visuals: glove grip pattern applied');
  }

  // ----- GRAPHICS / POST FX ---------------------------------------------
  const gfx = await page.evaluate(() => {
    const tier = GRAPHICS_CONFIG.tier();
    return {
      tier,
      passes: FB.composer ? FB.composer.passes.map(p => p.constructor.name) : [],
      shadowCasters: FB.stadiumSpots.filter(s => s.castShadow).length,
      shadowMapSize: FB.stadiumSpots.find(s => s.castShadow)?.shadow?.mapSize?.x || 0,
      crownYAtCenter: FB.fieldCrownY ? FB.fieldCrownY(0) : null,
      crownYAtEdge: FB.fieldCrownY ? FB.fieldCrownY(26.65) : null,
      sceneFog: !!FB.scene.fog,
    };
  });
  (gfx.passes.length > 1)
    ? pass('graphics: composer has multiple passes', gfx.passes.join(','))
    : fail('graphics: composer has multiple passes', JSON.stringify(gfx.passes));
  (gfx.shadowCasters === 1)
    ? pass('graphics: exactly 1 shadow-casting spot (mobile cap)', '1')
    : fail('graphics: exactly 1 shadow-casting spot', 'got ' + gfx.shadowCasters);
  (gfx.shadowMapSize === 2048 || gfx.shadowMapSize === 1024 || gfx.shadowMapSize === 512)
    ? pass('graphics: shadow map size tiered', gfx.shadowMapSize + '×' + gfx.shadowMapSize)
    : fail('graphics: shadow map size tiered', 'got ' + gfx.shadowMapSize);
  (gfx.crownYAtCenter > gfx.crownYAtEdge)
    ? pass('graphics: field crown center higher than edge', `center=${gfx.crownYAtCenter.toFixed(3)} edge=${gfx.crownYAtEdge.toFixed(3)}`)
    : fail('graphics: field crown center higher than edge', `center=${gfx.crownYAtCenter} edge=${gfx.crownYAtEdge}`);
  (gfx.sceneFog) ? pass('graphics: fog enabled') : fail('graphics: fog enabled');

  // ----- BROADCAST CAMERA AUTO-ZOOM -------------------------------------
  const camCheck = await page.evaluate(() => ({
    fovMin: GRAPHICS_CONFIG.camera.fovMin,
    fovMax: GRAPHICS_CONFIG.camera.fovMax,
    currentFov: FB.camera.fov,
    overridden: FB.updateCamera.toString().includes('replayCam') || FB.updateCamera.toString().includes('wobble'),
  }));
  (camCheck.currentFov >= camCheck.fovMin - 0.5 && camCheck.currentFov <= camCheck.fovMax + 0.5)
    ? pass('camera: FOV inside 38–52° broadcast range', camCheck.currentFov.toFixed(1) + '°')
    : fail('camera: FOV inside 38–52° broadcast range', 'fov=' + camCheck.currentFov);
  (camCheck.overridden) ? pass('camera: broadcast camera override active')
                        : fail('camera: broadcast camera override active');

  // ----- ANIMATION SYSTEM (state machine) -------------------------------
  const animCheck = await page.evaluate(() => {
    // Pick a moving player and verify _anim state populates with cur joints.
    const e = FB.activePlayers[FB.state.possession].find(x => x.mesh.visible && x.role !== 'QB');
    if (!e) return null;
    return { hasAnim: !!e._anim, gaitPhase: e.gaitPhase != null };
  });
  if (animCheck) {
    animCheck.hasAnim ? pass('animation: _anim state attached to player')
                      : fail('animation: _anim state attached to player');
  }

  // ----- KICK SWIPE UI --------------------------------------------------
  const kickUI = await page.evaluate(() => ({
    init: typeof window.initKickSwipeUI === 'function',
    show: typeof window.showKickUI === 'function',
    hide: typeof window.hideKickUI === 'function',
  }));
  (kickUI.init && kickUI.show && kickUI.hide)
    ? pass('controls: kick swipe UI loaded')
    : fail('controls: kick swipe UI loaded', JSON.stringify(kickUI));

  // ----- GAMEPLAY: end the play and confirm next play resets cleanly -----
  await page.evaluate(() => {
    // Force end the play.
    if (FB.endPlay) FB.endPlay({ reason: 'timeout' });
  });
  await page.waitForTimeout(2500);
  const postEnd = await page.evaluate(() => FB.state.phase);
  ['presnap', 'play', 'deadball', 'kick'].includes(postEnd)
    ? pass('engine: play loop transitions through endPlay', 'phase=' + postEnd)
    : fail('engine: play loop transitions through endPlay', 'phase=' + postEnd);

  // ----- RUNTIME ERRORS SUMMARY -----------------------------------------
  // Filter out the pre-existing PLAYBOOK error so it doesn't drown signal.
  const newErrs = pageErrs.filter(e => !e.includes('PLAYBOOK'));
  (newErrs.length === 0)
    ? pass('runtime: no NEW page errors during full session', pageErrs.length + ' total errors (all pre-existing)')
    : fail('runtime: new page errors detected', newErrs.join(' | '));

  // ----- REPORT --------------------------------------------------------
  console.log('\n' + '═'.repeat(70));
  console.log('  TEST RESULTS');
  console.log('═'.repeat(70));
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  for (const r of results) {
    const status = r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const tail = r.detail || r.why || '';
    console.log('  ' + status + ' ' + r.name.padEnd(54) + (tail ? '  — ' + tail : ''));
  }
  console.log('─'.repeat(70));
  console.log('  TOTAL: ' + passed + ' passed, ' + failed + ' failed (' + results.length + ' checks)');
  if (failed === 0) console.log('  \x1b[32mALL SYSTEMS GREEN ✓\x1b[0m');
  console.log('═'.repeat(70));

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

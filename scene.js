// scene.js — Three.js scene setup, field, stadium, camera, state.
// Original assets. No licensed material.
window.FB = window.FB || {};

(function (FB) {
  'use strict';

  FB.const = { FIELD_LEN: 120, FIELD_WID: 53.3, EZ: 10 };

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
  };
  FB.diffMult = { freshman: 0.86, jv: 1.05, varsity: 1.27, allspc: 1.45, easy: 0.88, normal: 1.10, hard: 1.27 };
  FB.diffLabels = { freshman: 'FRESHMAN', jv: 'JV', varsity: 'VARSITY', allspc: 'ALL SPC' };
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

  // ---- Three.js ----
  FB.initThree = function () {
    const canvas = document.getElementById('gl');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0a1020, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x8cbbe0, 80, 260);
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 500);
    camera.position.set(-70, 18, 0); camera.lookAt(0, 2, 0);

    const hemi = new THREE.HemisphereLight(0xbcd9f7, 0x3d5a3d, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe8c0, 0.95);
    sun.position.set(-40, 60, 30); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
    scene.add(sun);

    FB.scene = scene; FB.camera = camera; FB.renderer = renderer;
    FB.clock = new THREE.Clock();
    FB.playCam = { shake: 0 };

    createSky();
    createField();
    createStadium();

    window.addEventListener('resize', FB.onResize);
    window.addEventListener('orientationchange', FB.onResize);
  };

  FB.onResize = function () {
    FB.renderer.setSize(window.innerWidth, window.innerHeight);
    FB.camera.aspect = window.innerWidth / window.innerHeight;
    FB.camera.updateProjectionMatrix();
  };

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

  function mowedTurfTexture() {
    const { FIELD_LEN } = FB.const;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');
    const stripePx = c.width / (FIELD_LEN / 5);
    for (let i = 0; i < FIELD_LEN / 5; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#2f7a3a' : '#256832';
      ctx.fillRect(i * stripePx, 0, stripePx + 1, c.height);
    }
    for (let n = 0; n < 2400; n++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.04) + ')';
      ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  function endZoneTexture(label, primary, secondary) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = primary; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = secondary;
    ctx.font = 'bold 80px -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label.toUpperCase(), c.width / 2, c.height / 2);
    return new THREE.CanvasTexture(c);
  }

  function yardNumberTexture(n) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), c.width / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c); t.transparent = true; return t;
  }

  function createField() {
    const { FIELD_LEN, FIELD_WID, EZ } = FB.const;
    const group = new THREE.Group();
    FB.scene.add(group);
    FB.fieldGroup = group;

    const turf = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_LEN, FIELD_WID),
      new THREE.MeshLambertMaterial({ map: mowedTurfTexture() })
    );
    turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true; group.add(turf);

    const homeEZ = new THREE.Mesh(new THREE.PlaneGeometry(EZ, FIELD_WID),
      new THREE.MeshLambertMaterial({ map: endZoneTexture('HIGHLANDERS', '#0a2463', '#ffffff'), polygonOffset: true, polygonOffsetFactor: -1 }));
    homeEZ.rotation.x = -Math.PI / 2; homeEZ.position.set(-55, 0.01, 0); group.add(homeEZ);
    const awayEZ = new THREE.Mesh(new THREE.PlaneGeometry(EZ, FIELD_WID),
      new THREE.MeshLambertMaterial({ map: endZoneTexture('SPARTANS', '#b22222', '#ffd700'), polygonOffset: true, polygonOffsetFactor: -1 }));
    awayEZ.rotation.x = -Math.PI / 2; awayEZ.position.set(55, 0.01, 0); group.add(awayEZ);

    for (let yd = -50; yd <= 50; yd += 5) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, FIELD_WID),
        new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2 }));
      line.rotation.x = -Math.PI / 2; line.position.set(yd, 0.02, 0); group.add(line);
    }
    for (let yd = -40; yd <= 40; yd += 10) {
      const n = 50 - Math.abs(yd);
      for (const zSide of [-18, 18]) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(5, 5),
          new THREE.MeshBasicMaterial({ map: yardNumberTexture(n), transparent: true, polygonOffset: true, polygonOffsetFactor: -3 }));
        pl.rotation.x = -Math.PI / 2; pl.position.set(yd, 0.03, zSide); group.add(pl);
      }
    }
    for (let yd = -49; yd <= 49; yd++) {
      for (const z of [-6, 6]) {
        const h = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        h.rotation.x = -Math.PI / 2; h.position.set(yd, 0.025, z); group.add(h);
      }
    }
    for (const z of [-FIELD_WID / 2, FIELD_WID / 2]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_LEN, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      s.rotation.x = -Math.PI / 2; s.position.set(0, 0.02, z); group.add(s);
    }
    for (const side of [-55, 55]) {
      const postMat = new THREE.MeshLambertMaterial({ color: 0xffd54a });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4, 8), postMat);
      base.position.set(side > 0 ? side + 5 : side - 5, 2, 0); group.add(base);
      const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.17, 8), postMat);
      cross.rotation.x = Math.PI / 2; cross.position.set(base.position.x, 4, 0); group.add(cross);
      for (const zp of [-3.08, 3.08]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 10, 8), postMat);
        up.position.set(base.position.x, 9, zp); group.add(up);
      }
    }

    FB.firstDownLine = new THREE.Mesh(new THREE.PlaneGeometry(0.4, FIELD_WID),
      new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.65, polygonOffset: true, polygonOffsetFactor: -4 }));
    FB.firstDownLine.rotation.x = -Math.PI / 2; FB.firstDownLine.position.y = 0.04; group.add(FB.firstDownLine);

    FB.losLine = new THREE.Mesh(new THREE.PlaneGeometry(0.35, FIELD_WID),
      new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4 }));
    FB.losLine.rotation.x = -Math.PI / 2; FB.losLine.position.y = 0.04; group.add(FB.losLine);
  }

  function createStadium() {
    const g = new THREE.Group(); FB.scene.add(g);
    const colors = [0x223355, 0x2a3d60, 0x334870];
    for (let ring = 0; ring < 3; ring++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(70 + ring * 6, 2.5, 8, 48),
        new THREE.MeshLambertMaterial({ color: colors[ring] }));
      t.rotation.x = Math.PI / 2; t.position.set(0, 4 + ring * 2, 0); t.scale.set(1, 1, 0.55); g.add(t);
    }
    for (let i = 0; i < 80; i++) {
      const ang = (i / 80) * Math.PI * 2;
      const dot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5),
        new THREE.MeshLambertMaterial({ color: Math.random() > 0.5 ? 0xffd700 : 0xffffff }));
      dot.position.set(Math.cos(ang) * 68, 5 + Math.random() * 2, Math.sin(ang) * 38); g.add(dot);
    }
    // "BECK STADIUM" sign mounted above the end-zone stands.
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
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: false });
    const signGeo = new THREE.PlaneGeometry(48, 9);
    const sign1 = new THREE.Mesh(signGeo, signMat);
    sign1.position.set(0, 16, -44); g.add(sign1);
    const sign2 = new THREE.Mesh(signGeo, signMat);
    sign2.position.set(0, 16, 44); sign2.rotation.y = Math.PI; g.add(sign2);
  }
})(window.FB);

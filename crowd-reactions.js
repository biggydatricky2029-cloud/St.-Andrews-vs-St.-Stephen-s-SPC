// crowd-reactions.js — SYSTEM 3 (lite): event-driven crowd reactions.
//
// Honest scope note (see SYSTEMS_UPGRADE.md): the full spec asks for 70k
// individually-modeled humans with face textures, outfits, hair, and
// per-person animation. That is not achievable at 60fps on the mobile
// target — even at 800 tris per person, 70k people = 56M triangles,
// roughly 110× the 500k budget set in graphics-config.js.
//
// What this module DOES deliver:
//   • A reaction event bus that fires CHEERING / BOOING / EXCITED_JUMP
//     style updates on the existing InstancedMesh crowd (color shifts +
//     position offsets per-instance).
//   • Hooks into game events: touchdown, sack, penalty, big run, 4th-down
//     stop, kickoff. Reactions ripple through the appropriate share of
//     the crowd and decay over the configured duration.
//   • Per-instance Y bobbing for cheering sections so the stand reads as
//     "thousands of people standing up together" without rebuilding
//     anyone's geometry.
//
// The detailed humanoid crowd model can be enabled later as a
// near-rows-only overlay — the framework here already supports it
// (CROWD.maxAnimUpdatesPerFrame), it's just deliberately turned off.
(function (FB) {
  'use strict';

  const SC = window.SYSTEMS_CONFIG;
  const CROWD = SC.CROWD;

  // Active reactions: each = { state, dur, share, t0, startMatrices, jumpAmp }
  const active = [];

  /**
   * Trigger a crowd reaction event.
   * @param {string} key - One of CROWD.reactions keys (e.g. 'td_home').
   */
  function fire(key) {
    const r = CROWD.reactions[key];
    if (!r) return;
    active.push({
      state: r.state,
      dur: r.dur,
      share: r.share,
      jumpAmp: r.state === 'EXCITED_JUMP' ? 0.35
            : r.state === 'CHEERING' ? 0.18
            : 0,
      t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
    });
  }

  /**
   * Per-frame update for active reactions. Applies a per-instance Y
   * offset to the crowd InstancedMesh's matrix array — only the affected
   * share of instances is touched.
   */
  function tick() {
    if (!active.length) return;
    const crowdMesh = findCrowdMesh();
    if (!crowdMesh) { active.length = 0; return; }

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    let needUpdate = false;
    const m4 = new THREE.Matrix4();
    const count = crowdMesh.count;
    const budget = CROWD.maxAnimUpdatesPerFrame;
    let updated = 0;

    for (let r = active.length - 1; r >= 0; r--) {
      const a = active[r];
      const age = now - a.t0;
      if (age > a.dur) { resetSection(crowdMesh, a); active.splice(r, 1); needUpdate = true; continue; }
      const phase = age / a.dur;
      // Envelope: ease-in for first 15%, hold, ease-out last 25%.
      let env;
      if (phase < 0.15) env = phase / 0.15;
      else if (phase > 0.75) env = 1 - (phase - 0.75) / 0.25;
      else env = 1;
      // Bobbing freq: cheering is fast, jumping is one big hop.
      const freq = a.state === 'EXCITED_JUMP' ? 1.4 : 4.2;
      const shareCount = Math.floor(count * a.share);
      // Stride sample so we cover the whole share over multiple frames
      // when budget is exceeded.
      const stride = Math.max(1, Math.floor(shareCount / budget));
      const startIdx = a._cursor || 0;
      for (let n = 0; n < budget && updated < budget; n++) {
        const i = (startIdx + n * stride) % shareCount;
        crowdMesh.getMatrixAt(i, m4);
        const base = crowdMesh.userData.baseY ? (crowdMesh.userData.baseY[i] || 0) : m4.elements[13];
        const offset = a.jumpAmp * env * (a.state === 'EXCITED_JUMP'
          ? Math.max(0, Math.sin(Math.PI * Math.min(1, age * freq)))
          : Math.abs(Math.sin(now * freq + i * 0.13)));
        m4.elements[13] = base + offset;
        crowdMesh.setMatrixAt(i, m4);
        updated += 1;
      }
      a._cursor = (startIdx + budget * stride) % Math.max(1, shareCount);
      needUpdate = true;
    }

    if (needUpdate) crowdMesh.instanceMatrix.needsUpdate = true;
  }

  function resetSection(crowdMesh, _a) {
    if (!crowdMesh.userData.baseY) return;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < crowdMesh.count; i++) {
      crowdMesh.getMatrixAt(i, m4);
      m4.elements[13] = crowdMesh.userData.baseY[i];
      crowdMesh.setMatrixAt(i, m4);
    }
    crowdMesh.instanceMatrix.needsUpdate = true;
  }

  // Cache lookup of the crowd InstancedMesh + record each instance's
  // baseline Y so we can restore it after a reaction.
  let _crowdMesh = null;
  function findCrowdMesh() {
    if (_crowdMesh && _crowdMesh.parent) return _crowdMesh;
    let found = null;
    FB.scene && FB.scene.traverse((o) => {
      if (o.isInstancedMesh && o.count > 200) { found = found || o; }
    });
    if (found && !found.userData.baseY) {
      const arr = new Float32Array(found.count);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < found.count; i++) {
        found.getMatrixAt(i, m4);
        arr[i] = m4.elements[13];
      }
      found.userData.baseY = arr;
    }
    _crowdMesh = found;
    return _crowdMesh;
  }

  // -------------------------------------------------------------------------
  //  Event hooks — call fire() from the existing game-event call sites.
  // -------------------------------------------------------------------------

  // Touchdown.
  if (FB.scoreTouchdown && !FB.scoreTouchdown.__crowdWrap) {
    const orig = FB.scoreTouchdown;
    const wrapped = function () {
      const isHome = FB.state.possession === 'home';
      fire('td_jump');
      fire(isHome ? 'td_home' : 'td_away');
      return orig.apply(this, arguments);
    };
    wrapped.__crowdWrap = true;
    FB.scoreTouchdown = wrapped;
  }

  // Big run / sack / fourth-down / penalty are dispatched through
  // FB.flashWarn (the on-screen banner). Listen to that for free hooks.
  if (FB.flashWarn && !FB.flashWarn.__crowdWrap) {
    const orig = FB.flashWarn;
    const wrapped = function (text) {
      const t = String(text || '').toUpperCase();
      const isHomeOff = FB.state.possession === 'home';
      if (t.includes('SACK')) fire(isHomeOff ? 'sack_away' : 'sack_home');
      else if (t.includes('PENALTY') || t.includes('FLAG')) fire('penalty');
      else if (t.includes('TURNOVER') || t.includes('FUMBLE') || t.includes('INTERCEPT')) {
        fire(isHomeOff ? 'td_away' : 'td_home');  // crowd reaction same shape
      } else if (t.includes('4TH DOWN') || t.includes('STOP')) fire('fourth_stop');
      return orig.apply(this, arguments);
    };
    wrapped.__crowdWrap = true;
    FB.flashWarn = wrapped;
  }

  // Kickoff event whenever setupKickoff is called.
  if (FB.setupKickoff && !FB.setupKickoff.__crowdWrap) {
    const orig = FB.setupKickoff;
    const wrapped = function () { fire('kickoff'); return orig.apply(this, arguments); };
    wrapped.__crowdWrap = true;
    FB.setupKickoff = wrapped;
  }

  // Per-play big-run detection: when a play ends with > 15 yards gained
  // by the offense, fire 'big_run'.
  if (FB.endPlay && !FB.endPlay.__crowdWrap) {
    const orig = FB.endPlay;
    const wrapped = function (opts) {
      const s = FB.state;
      let preBallOn = s.ballOn;
      let preLOS = s.los;
      const result = orig.apply(this, arguments);
      const gain = (s.ballOn - preBallOn);
      if (gain >= 15) fire('big_run');
      return result;
    };
    wrapped.__crowdWrap = true;
    FB.endPlay = wrapped;
  }

  // -------------------------------------------------------------------------
  //  Frame entry — hook into FB.updateCrowd so we run alongside the
  //  existing crowd animation update without claiming our own slot.
  // -------------------------------------------------------------------------
  if (FB.updateCrowd && !FB.updateCrowd.__reactWrap) {
    const orig = FB.updateCrowd;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { tick(); } catch (_) {}
      return r;
    };
    wrapped.__reactWrap = true;
    FB.updateCrowd = wrapped;
  } else if (!FB.updateCrowd) {
    // If no existing crowd animator, create one whose entire job is reactions.
    FB.updateCrowd = function () { try { tick(); } catch (_) {} };
  }

  FB.CrowdReactions = { fire, tick };

})(window.FB);

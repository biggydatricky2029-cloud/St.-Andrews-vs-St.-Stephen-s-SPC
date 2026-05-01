/**
 * PvP State Sync
 * ----------------------------------------------------------------
 * Replaces the stubs in pvp-client.js with real serializer/applier
 * wired against the actual FB engine shape:
 *   ball       : FB.ball.position + FB.ballState
 *   players    : FB.activePlayers[team][i].mesh.position/rotation
 *   score      : FB.state.score
 *   clock      : FB.state.clockSeconds / quarter / playClock
 *   possession : FB.state.possession / down / distance / ballOn / los
 *   phase      : FB.state.phase
 *
 * Loaded AFTER pvp-client.js so its top-level function declarations
 * shadow the stubs on the global object.
 *
 * Caveats (this file alone does not solve all of multiplayer):
 *  - Animation isn't part of the snapshot — the game's rig system
 *    drives poses from positions/velocity, so visuals follow.
 *  - The guest-side "freeze authoritative state" is done by wrapping
 *    FB.tickClock + AI updates so they no-op on guest. Gating uses
 *    (!pvp.connected || pvp.isHost) so single-player is untouched.
 *  - Real desync handling, clock auth handoff, end-of-half logic --
 *    all need playtest iteration; this is the first working pass.
 * ----------------------------------------------------------------
 */

(function () {
  'use strict';

  // -----------------------------------------------------------
  // ID HELPERS
  // -----------------------------------------------------------
  function entityId(team, ent) {
    const num = ent && ent.player ? ent.player.number : '?';
    return team + ':' + num;
  }

  function findEntityById(id) {
    if (!id || !window.FB) return null;
    const sep = id.indexOf(':');
    if (sep < 0) return null;
    const team = id.slice(0, sep);
    const num  = parseInt(id.slice(sep + 1), 10);
    const arr  = FB.activePlayers && FB.activePlayers[team];
    if (!arr) return null;
    for (const e of arr) if (e.player && e.player.number === num) return e;
    return null;
  }


  // -----------------------------------------------------------
  // SERIALIZER (host)
  // -----------------------------------------------------------
  function getCurrentGameState() {
    if (!window.FB) return null;
    return {
      tick       : Date.now(),
      ball       : serializeBall(),
      players    : serializePlayers(),
      score      : serializeScore(),
      clock      : serializeClock(),
      possession : serializePossession(),
      playPhase  : serializePlayPhase(),
    };
  }

  function serializeBall() {
    const b = FB.ball;
    if (!b || !b.position) return null;
    const bs = FB.ballState || {};
    return {
      x       : b.position.x,
      y       : b.position.y,
      z       : b.position.z,
      inAir   : !!bs.inAir,
      carried : !!bs.carried,
      kind    : bs.kind || null,
      carrier : FB.ballCarrier ? entityId(FB.ballCarrier.team || teamOf(FB.ballCarrier), FB.ballCarrier) : null,
    };
  }

  // FB entities don't carry a .team field directly -- derive from the array
  // they live in. Cache lookups so we're not searching every frame.
  const _teamCache = new WeakMap();
  function teamOf(ent) {
    if (!ent) return 'home';
    if (ent.team) return ent.team;
    if (_teamCache.has(ent)) return _teamCache.get(ent);
    if (FB.activePlayers) {
      if (FB.activePlayers.home && FB.activePlayers.home.includes(ent)) {
        _teamCache.set(ent, 'home'); return 'home';
      }
      if (FB.activePlayers.away && FB.activePlayers.away.includes(ent)) {
        _teamCache.set(ent, 'away'); return 'away';
      }
    }
    return 'home';
  }

  function serializePlayers() {
    const out = [];
    if (!FB.activePlayers) return out;
    for (const team of ['home', 'away']) {
      const arr = FB.activePlayers[team] || [];
      for (const e of arr) {
        if (!e.mesh) continue;
        out.push({
          id      : entityId(team, e),
          team,
          role    : e.role,
          x       : e.mesh.position.x,
          y       : e.mesh.position.y,
          z       : e.mesh.position.z,
          rotY    : e.mesh.rotation.y,
          visible : !!e.mesh.visible,
          down    : !!e.isDown,
          hasBall : (FB.ballCarrier === e),
        });
      }
    }
    return out;
  }

  function serializeScore() {
    const s = FB.state || {};
    return {
      home: (s.score && s.score.home) || 0,
      away: (s.score && s.score.away) || 0,
    };
  }

  function serializeClock() {
    const s = FB.state || {};
    return {
      seconds   : s.clockSeconds || 0,
      quarter   : s.quarter || 1,
      playClock : s.playClock || 0,
    };
  }

  function serializePossession() {
    const s = FB.state || {};
    return {
      team     : s.possession || 'home',
      down     : s.down || 1,
      distance : s.distance || 10,
      ballOn   : s.ballOn || 25,
      los      : s.los || 25,
    };
  }

  function serializePlayPhase() {
    const s = FB.state || {};
    return {
      phase    : s.phase || 'pregame',
      playType : s.playType || null,
    };
  }


  // -----------------------------------------------------------
  // APPLIER (guest)
  // -----------------------------------------------------------
  function pvpApplyStateSync(state) {
    if (!state || !window.FB) return;
    if (state.tick && pvp._lastTick && state.tick < pvp._lastTick) return;
    pvp._lastTick = state.tick;

    applyBallSync(state.ball);
    applyPlayersSync(state.players);
    applyScoreSync(state.score);
    applyClockSync(state.clock);
    applyPossessionSync(state.possession);
    applyPlayPhaseSync(state.playPhase);

    if (FB.updateHUD) FB.updateHUD();
  }

  function applyBallSync(bs) {
    if (!bs || !FB.ball || !FB.ball.position) return;
    const lerp = 0.35;
    FB.ball.position.x += (bs.x - FB.ball.position.x) * lerp;
    FB.ball.position.y += (bs.y - FB.ball.position.y) * lerp;
    FB.ball.position.z += (bs.z - FB.ball.position.z) * lerp;
    if (FB.ballState) {
      FB.ballState.inAir   = bs.inAir;
      FB.ballState.carried = bs.carried;
      if (bs.kind) FB.ballState.kind = bs.kind;
    }
    if (bs.carrier) {
      const carrier = findEntityById(bs.carrier);
      if (carrier) FB.ballCarrier = carrier;
    } else {
      FB.ballCarrier = null;
    }
  }

  function applyPlayersSync(list) {
    if (!list || !list.length || !FB.activePlayers) return;
    const lerp = 0.30;
    for (const ps of list) {
      const ent = findEntityById(ps.id);
      if (!ent || !ent.mesh) continue;
      ent.mesh.visible = ps.visible;
      ent.isDown = ps.down;
      // Skip lerp for the local player so input feels responsive --
      // the host will reconcile if we drift, but we don't snap mid-step.
      const isMyControlled = (ps.team === pvp.myTeam) && (FB.userCtrl === ent);
      if (isMyControlled) continue;
      ent.mesh.position.x += (ps.x - ent.mesh.position.x) * lerp;
      ent.mesh.position.y += (ps.y - ent.mesh.position.y) * lerp;
      ent.mesh.position.z += (ps.z - ent.mesh.position.z) * lerp;
      // Shortest-path interpolation for rotation around Y.
      let dr = ps.rotY - ent.mesh.rotation.y;
      while (dr > Math.PI)  dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      ent.mesh.rotation.y += dr * lerp;
    }
  }

  function applyScoreSync(sc) {
    if (!sc || !FB.state || !FB.state.score) return;
    FB.state.score.home = sc.home;
    FB.state.score.away = sc.away;
  }

  function applyClockSync(c) {
    if (!c || !FB.state) return;
    FB.state.clockSeconds = c.seconds;
    FB.state.quarter      = c.quarter;
    FB.state.playClock    = c.playClock;
  }

  function applyPossessionSync(p) {
    if (!p || !FB.state) return;
    FB.state.possession = p.team;
    FB.state.down       = p.down;
    FB.state.distance   = p.distance;
    FB.state.ballOn     = p.ballOn;
    FB.state.los        = p.los;
  }

  function applyPlayPhaseSync(p) {
    if (!p || !FB.state) return;
    FB.state.phase = p.phase;
    if (p.playType !== undefined) FB.state.playType = p.playType;
  }


  // -----------------------------------------------------------
  // OPPONENT INPUT MIRROR (host receives guest input)
  // -----------------------------------------------------------
  function pvpReceiveOpponentInput(action, data) {
    if (!window.FB) return;
    data = data || {};
    switch (action) {
      case 'snap':
        if (FB.snapBall && FB.state && FB.state.phase === 'presnap') FB.snapBall();
        break;
      case 'pass':
        // Receiver index requires the guest's chip mapping -- send it as data.
        if (FB.throwPassToReceiver && data.receiverIndex != null) {
          FB.throwPassToReceiver(data.receiverIndex);
        }
        break;
      case 'handoff':
        if (FB.handoffToRB) FB.handoffToRB();
        break;
      case 'juke':
        if (FB.tryJuke) FB.tryJuke();
        break;
      case 'sprint':
        // Sprint is a held input; the guest should stream button down/up state
        // so the host can mirror it. Stub no-ops without that wire-up.
        break;
      case 'dive':
        if (FB.onDive) FB.onDive();
        break;
      case 'play_call':
        // Stash for the host's play-resolution layer to consume.
        pvp._opponentPlay = data.play;
        pvp._opponentSide = data.side;
        break;
    }
  }


  // -----------------------------------------------------------
  // GAME EVENT RECEIVER (cosmetic mirror -- state_sync drives truth)
  // -----------------------------------------------------------
  function pvpReceiveGameEvent(event) {
    if (!event) return;
    const log = (window.FB && FB.state && FB.state.log) || null;
    switch (event.kind) {
      case 'touchdown':
        if (log) log.push('REMOTE: touchdown ' + (event.team || ''));
        break;
      case 'fumble':
        if (log) log.push('REMOTE: fumble');
        break;
      case 'interception':
        if (log) log.push('REMOTE: interception');
        break;
    }
    if (FB.updateHUD) FB.updateHUD();
  }


  // -----------------------------------------------------------
  // OPPONENT PLAY CALL (host stores guest's pick)
  // -----------------------------------------------------------
  function pvpReceiveOpponentPlay(play, side) {
    pvp._opponentPlay = play;
    pvp._opponentSide = side;
    // The single-player engine resolves both plays itself when the user
    // confirms via the play picker; this stash is here so a future
    // host-authoritative resolver can read it.
  }


  // -----------------------------------------------------------
  // PER-FRAME SYNC TICK
  // -----------------------------------------------------------
  let _pvpSyncFrameCount = 0;
  function pvpSyncTick() {
    if (!pvp.connected) return;
    _pvpSyncFrameCount++;
    if (pvp.isHost && _pvpSyncFrameCount % 3 === 0) {
      const state = getCurrentGameState();
      if (state) pvpSendStateUpdate(state);
    }
  }


  // -----------------------------------------------------------
  // GUEST-SIDE AUTHORITATIVE SUPPRESSION
  // ------------------------------------------------------------
  // On guest, the AI/physics/clock callers in step() should not run -- the
  // host's state_sync drives them. We wrap each authoritative FB update to
  // bail out when (pvp.connected && !pvp.isHost). Single-player and host are
  // untouched.
  // -----------------------------------------------------------
  function isGuest() { return pvp.connected && !pvp.isHost; }

  function suppressOnGuest(name) {
    const fn = window.FB && FB[name];
    if (!fn || fn.__pvpGuestGated) return;
    const wrapped = function () {
      if (isGuest()) return;
      return fn.apply(this, arguments);
    };
    wrapped.__pvpGuestGated = true;
    FB[name] = wrapped;
  }

  function installGuestGates() {
    if (!window.FB) return;
    [
      'updateBallCarrier',
      'updateOffenseOthers',
      'updateDefense',
      'updateKickoffCoverage',
      'updateBallPhysics',
      'tickClock',
      'tickKickMeter',
    ].forEach(suppressOnGuest);
  }


  // -----------------------------------------------------------
  // LOOP HOOK
  // ------------------------------------------------------------
  // Wrap FB.updateHUD (called every frame at the bottom of step()) so we
  // get a per-frame callback without modifying logic-loop.js.
  // -----------------------------------------------------------
  function installLoopHook() {
    if (!window.FB || !FB.updateHUD || FB.updateHUD.__pvpSyncWrapped) return;
    const orig = FB.updateHUD;
    const wrapped = function () {
      const ret = orig.apply(this, arguments);
      try { pvpSyncTick(); } catch (e) { console.warn('[pvp] sync tick error', e); }
      return ret;
    };
    wrapped.__pvpSyncWrapped = true;
    FB.updateHUD = wrapped;
  }


  // -----------------------------------------------------------
  // EXPORTS — overwrite the stubs declared in pvp-client.js by
  // assigning to the global object.
  // -----------------------------------------------------------
  window.getCurrentGameState     = getCurrentGameState;
  window.pvpApplyStateSync       = pvpApplyStateSync;
  window.pvpReceiveOpponentInput = pvpReceiveOpponentInput;
  window.pvpReceiveGameEvent     = pvpReceiveGameEvent;
  window.pvpReceiveOpponentPlay  = pvpReceiveOpponentPlay;
  window.pvpSyncTick             = pvpSyncTick;


  // -----------------------------------------------------------
  // INIT
  // -----------------------------------------------------------
  window.addEventListener('DOMContentLoaded', () => {
    // Defer past pvp-client's own DOMContentLoaded handler and past the
    // FB modules' loop registration.
    setTimeout(() => {
      installGuestGates();
      installLoopHook();
    }, 0);
  });
})();

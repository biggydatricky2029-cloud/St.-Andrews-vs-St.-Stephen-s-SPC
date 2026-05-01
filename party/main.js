/**
 * PartyKit server for the football game's online PvP.
 * ----------------------------------------------------------------
 * Two room types are served from this same Server class, keyed off
 * the room id:
 *   - 'public-matchmaking-queue' = lobby for random matchmaking
 *   - any other id (a 6-char code) = a private game room
 *
 * Game flow:
 *   client -> 'join_lobby' {playerName, team}
 *   server -> 'lobby_update' {players: {id: {name, team, ready}}}
 *   client -> 'player_ready'
 *   server -> 'lobby_update' (with ready flags set)
 *   when both ready, server -> 'game_start' with assignments[]
 *   each assignment: {playerId, name, team, side, altColors}
 *
 * Same-team support: if both players pick the same team, the second
 * joiner is assigned the other side with altColors=true. The client
 * uses that flag to swap primaryColor to black so the two teams are
 * visually distinguishable on the field.
 *
 * Forwarding rules:
 *   play_call    -> opponent_play_call (to other player)
 *   input        -> opponent_input
 *   state_update -> state_sync
 *   snap         -> snap
 *   game_event   -> game_event
 *   chat         -> chat (broadcast to all)
 * ----------------------------------------------------------------
 */

const QUEUE_ROOM = 'public-matchmaking-queue';

export default class FootballRoom {
  constructor(room) {
    this.room = room;
    /** @type {Object<string, {name:string, team:string, ready:boolean, joinOrder:number}>} */
    this.players = {};
    /** @type {Array<{id:string, name:string}>} */
    this.queueWaiting = [];
    this.gameStarted = false;
    this.joinCounter = 0;
  }

  isQueueRoom() {
    return this.room.id === QUEUE_ROOM;
  }

  async onConnect(conn) {
    // Tell the client its own id so it can match itself against future
    // payloads (assignments, hostId, etc.). The browser WebSocket API
    // doesn't expose the server-side connection id otherwise.
    conn.send(JSON.stringify({ type: 'hello', selfId: conn.id }));
    if (this.isQueueRoom()) return;
    if (Object.keys(this.players).length >= 2) {
      conn.send(JSON.stringify({ type: 'error', reason: 'room_full' }));
      try { conn.close(); } catch (e) { /* noop */ }
    }
  }

  async onMessage(message, sender) {
    let data;
    try { data = JSON.parse(message); }
    catch (e) { return; }

    if (this.isQueueRoom()) {
      this.handleQueueMessage(data, sender);
    } else {
      this.handleGameMessage(data, sender);
    }
  }

  async onClose(conn) {
    if (this.isQueueRoom()) {
      this.queueWaiting = this.queueWaiting.filter(p => p.id !== conn.id);
      this.broadcastQueuePositions();
      return;
    }
    if (this.players[conn.id]) {
      delete this.players[conn.id];
      this.broadcast({ type: 'player_left' });
      // Reset gameStarted so a rematch path can fire again if both rejoin.
      this.gameStarted = false;
    }
  }

  // -----------------------------------------------------------
  // GAME ROOM
  // -----------------------------------------------------------
  handleGameMessage(data, sender) {
    switch (data.type) {
      case 'join_lobby':
        if (!this.players[sender.id]) {
          this.players[sender.id] = {
            name: String(data.playerName || 'Player').slice(0, 16),
            team: data.team === 'spartans' ? 'spartans' : 'highlanders',
            ready: false,
            joinOrder: this.joinCounter++,
          };
        }
        this.broadcastLobbyUpdate();
        break;

      case 'player_ready':
        if (this.players[sender.id]) {
          this.players[sender.id].ready = true;
          this.broadcastLobbyUpdate();
          if (this.bothReady() && !this.gameStarted) {
            this.startGame();
          }
        }
        break;

      case 'chat': {
        const from = (this.players[sender.id] || {}).name || 'Anonymous';
        const text = String(data.message || '').slice(0, 200);
        if (text) this.broadcast({ type: 'chat', from, message: text });
        break;
      }

      case 'snap':
        this.forwardToOther(sender.id, { type: 'snap' });
        break;

      case 'play_call':
        this.forwardToOther(sender.id, {
          type: 'opponent_play_call',
          play: data.play,
          side: data.side,
        });
        break;

      case 'input':
        this.forwardToOther(sender.id, {
          type: 'opponent_input',
          action: data.action,
          data: data.data || {},
        });
        break;

      case 'state_update':
        this.forwardToOther(sender.id, {
          type: 'state_sync',
          state: data.state,
        });
        break;

      case 'game_event':
        this.forwardToOther(sender.id, {
          type: 'game_event',
          event: data.event,
        });
        break;
    }
  }

  bothReady() {
    const ids = Object.keys(this.players);
    return ids.length === 2 && ids.every(id => this.players[id].ready);
  }

  startGame() {
    this.gameStarted = true;
    const ids = Object.keys(this.players)
      .sort((a, b) => this.players[a].joinOrder - this.players[b].joinOrder);
    const [hostId, guestId] = ids;
    const hostP  = this.players[hostId];
    const guestP = this.players[guestId];
    const sameTeam = hostP.team === guestP.team;

    const assignments = [
      {
        playerId   : hostId,
        name       : hostP.name,
        team       : hostP.team,
        side       : sameTeam ? 'home' : (hostP.team === 'highlanders' ? 'home' : 'away'),
        altColors  : false,
      },
      {
        playerId   : guestId,
        name       : guestP.name,
        team       : guestP.team,
        side       : sameTeam ? 'away' : (guestP.team === 'highlanders' ? 'home' : 'away'),
        altColors  : sameTeam,
      },
    ];

    this.broadcast({ type: 'game_start', hostId, assignments });
  }

  broadcastLobbyUpdate() {
    // Don't expose joinOrder to clients.
    const out = {};
    for (const id of Object.keys(this.players)) {
      const p = this.players[id];
      out[id] = { name: p.name, team: p.team, ready: p.ready };
    }
    this.broadcast({ type: 'lobby_update', players: out });
  }

  // -----------------------------------------------------------
  // QUEUE ROOM
  // -----------------------------------------------------------
  handleQueueMessage(data, sender) {
    if (data.type === 'join_queue') {
      // Drop dupes
      this.queueWaiting = this.queueWaiting.filter(p => p.id !== sender.id);
      this.queueWaiting.push({
        id: sender.id,
        name: String(data.playerName || 'Player').slice(0, 16),
      });

      while (this.queueWaiting.length >= 2) {
        const p1 = this.queueWaiting.shift();
        const p2 = this.queueWaiting.shift();
        const code = randomCode();
        // Random team split for matched players.
        const flip = Math.random() < 0.5;
        this.sendToConn(p1.id, {
          type: 'matched', roomCode: code,
          team: flip ? 'highlanders' : 'spartans',
        });
        this.sendToConn(p2.id, {
          type: 'matched', roomCode: code,
          team: flip ? 'spartans' : 'highlanders',
        });
      }
      this.broadcastQueuePositions();
    }
  }

  broadcastQueuePositions() {
    for (let i = 0; i < this.queueWaiting.length; i++) {
      this.sendToConn(this.queueWaiting[i].id, {
        type: 'queue_position', position: i + 1,
      });
    }
  }

  // -----------------------------------------------------------
  // CONNECTION HELPERS
  // -----------------------------------------------------------
  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const conn of this.room.getConnections()) conn.send(msg);
  }

  forwardToOther(senderId, data) {
    const msg = JSON.stringify(data);
    for (const conn of this.room.getConnections()) {
      if (conn.id !== senderId) conn.send(msg);
    }
  }

  sendToConn(connId, data) {
    const msg = JSON.stringify(data);
    for (const conn of this.room.getConnections()) {
      if (conn.id === connId) { conn.send(msg); return; }
    }
  }
}

function randomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

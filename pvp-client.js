/**
 * PvP Online Multiplayer Client
 * ----------------------------------------------------------------
 * Wires the lobby UI + Partykit websocket sync into the existing
 * single-player game without modifying any of the gameplay files.
 *
 * BEFORE THIS WILL WORK:
 *   1. Deploy the Partykit server (`npx partykit deploy`)
 *   2. Set PARTYKIT_HOST below to the host you were assigned
 *      (no protocol — just `your-app.your-user.partykit.dev`)
 * ----------------------------------------------------------------
 */

// ============================================================
// CONFIG — set after deploying Partykit
// ============================================================
const PARTYKIT_HOST = 'highlanders-vs-spartans.biggydatricky2029-cloud.partykit.dev';
const QUEUE_ROOM = 'public-matchmaking-queue';

function pvpHostReady() {
  if (!PARTYKIT_HOST) {
    alert(
      'Online PvP is not configured yet.\n\n' +
      'Deploy the Partykit server and set PARTYKIT_HOST in pvp-client.js.'
    );
    return false;
  }
  return true;
}


// ============================================================
// PvP STATE
// ============================================================
const pvp = {
  socket       : null,
  roomCode     : null,
  myTeam       : null,      // 'highlanders' or 'spartans'
  myName       : null,
  isHost       : false,
  opponentName : null,
  connected    : false,
  inQueue      : false,
  queueSocket  : null,
};


// ============================================================
// LOBBY UI
// ============================================================
function injectPvPStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #pvp-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.88);
      z-index: 9999;
      font-family: 'Arial Black', Arial, sans-serif;
      color: #fff;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    #pvp-overlay.active { display: flex; }

    .pvp-card {
      background: #1a1a2e;
      border: 2px solid #4fc3f7;
      border-radius: 16px;
      padding: 32px 40px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      max-height: 90vh;
      overflow-y: auto;
    }

    .pvp-title {
      font-size: 2rem;
      color: #4fc3f7;
      margin-bottom: 6px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .pvp-subtitle {
      font-size: 0.85rem;
      color: #90caf9;
      margin-bottom: 28px;
    }

    .pvp-btn {
      display: block;
      width: 100%;
      padding: 14px;
      margin: 10px 0;
      border: none;
      border-radius: 10px;
      font-size: 1.1rem;
      font-weight: bold;
      cursor: pointer;
      letter-spacing: 1px;
      transition: transform 0.1s, opacity 0.2s;
    }
    .pvp-btn:active { transform: scale(0.97); }
    .pvp-btn.blue   { background: #1565c0; color: #fff; }
    .pvp-btn.green  { background: #2e7d32; color: #fff; }
    .pvp-btn.red    { background: #c62828; color: #fff; }
    .pvp-btn.gray   { background: #37474f; color: #ccc; }
    .pvp-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .pvp-input {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 2px solid #4fc3f7;
      background: #0d1117;
      color: #fff;
      font-size: 1.1rem;
      text-align: center;
      letter-spacing: 3px;
      margin: 8px 0 16px;
      box-sizing: border-box;
    }

    .pvp-team-row {
      display: flex;
      gap: 12px;
      margin: 16px 0;
    }

    .pvp-team-btn {
      flex: 1;
      padding: 18px 8px;
      border-radius: 12px;
      border: 3px solid transparent;
      background: #0d1b2a;
      color: #fff;
      font-size: 1rem;
      font-weight: bold;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .pvp-team-btn.selected { border-color: #4fc3f7; background: #1a3a5c; }
    .pvp-team-btn .team-emoji { font-size: 2rem; display: block; margin-bottom: 6px; }

    .pvp-lobby-players {
      display: flex;
      justify-content: space-around;
      align-items: center;
      margin: 20px 0;
    }

    .pvp-player-slot { text-align: center; width: 45%; }
    .pvp-player-slot .slot-label {
      font-size: 0.75rem;
      color: #78909c;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .pvp-player-slot .slot-name {
      font-size: 1.1rem;
      font-weight: bold;
      margin: 4px 0;
      min-height: 1.5em;
    }
    .pvp-player-slot .slot-team { font-size: 0.85rem; color: #4fc3f7; }
    .pvp-player-slot .slot-ready {
      display: inline-block;
      margin-top: 6px;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.75rem;
      background: #2e7d32;
      color: #fff;
    }

    .pvp-room-code-display {
      background: #0d1117;
      border: 2px solid #4fc3f7;
      border-radius: 10px;
      padding: 10px 20px;
      font-size: 2rem;
      letter-spacing: 8px;
      margin: 12px 0;
      color: #4fc3f7;
    }

    .pvp-spinner {
      width: 44px;
      height: 44px;
      border: 4px solid #1a3a5c;
      border-top-color: #4fc3f7;
      border-radius: 50%;
      animation: pvp-spin 0.9s linear infinite;
      margin: 16px auto;
    }
    @keyframes pvp-spin { to { transform: rotate(360deg); } }

    .pvp-status {
      font-size: 0.9rem;
      color: #90caf9;
      margin: 8px 0;
      min-height: 1.4em;
    }

    .pvp-chat-box {
      background: #0d1117;
      border: 1px solid #263238;
      border-radius: 8px;
      height: 90px;
      overflow-y: auto;
      padding: 8px;
      text-align: left;
      font-size: 0.8rem;
      color: #b0bec5;
      margin: 12px 0 6px;
    }

    .pvp-abandon-banner {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #b71c1c;
      color: #fff;
      padding: 24px 40px;
      border-radius: 14px;
      font-size: 1.4rem;
      font-weight: bold;
      z-index: 10000;
      text-align: center;
    }

    #pvp-menu-btn {
      display: block;
      width: 100%;
      padding: 14px;
      margin: 10px 0 0;
      border: none;
      border-radius: 10px;
      font-size: 1.05rem;
      font-weight: bold;
      background: #6a1b9a;
      color: #fff;
      cursor: pointer;
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
}

function injectPvPHTML() {
  // Insert "Play Online" button into the pre-game action row, right after
  // the START GAME button. Falls back to body append if pgStart isn't found.
  const menuBtn = document.createElement('button');
  menuBtn.id        = 'pvp-menu-btn';
  menuBtn.type      = 'button';
  menuBtn.textContent = 'PLAY ONLINE (PvP)';
  menuBtn.addEventListener('click', () => showScreen('mode-select'));

  const startBtn = document.getElementById('pgStart');
  if (startBtn && startBtn.parentNode) {
    startBtn.parentNode.appendChild(menuBtn);
  } else {
    document.body.appendChild(menuBtn);
  }

  const overlay = document.createElement('div');
  overlay.id = 'pvp-overlay';
  overlay.innerHTML = `
    <div class="pvp-card" id="pvp-screen-mode-select">
      <div class="pvp-title">Online PvP</div>
      <div class="pvp-subtitle">Play against a real opponent online</div>
      <button class="pvp-btn green" data-action="queue">Public Matchmaking</button>
      <button class="pvp-btn blue"  data-action="show-create">Create Private Room</button>
      <button class="pvp-btn blue"  data-action="show-join">Join with Room Code</button>
      <button class="pvp-btn gray"  data-action="close">Back</button>
    </div>

    <div class="pvp-card" id="pvp-screen-create-room" style="display:none">
      <div class="pvp-title">Create Room</div>
      <div class="pvp-subtitle">Share the code with your friend</div>
      <label style="font-size:0.85rem;color:#90caf9">Your Name</label>
      <input class="pvp-input" id="pvp-create-name" maxlength="16" placeholder="Enter name" style="letter-spacing:1px">
      <label style="font-size:0.85rem;color:#90caf9">Pick Your Team</label>
      <div class="pvp-team-row">
        <button class="pvp-team-btn" id="team-btn-highlanders" data-team="highlanders">
          <span class="team-emoji">A</span>Highlanders
        </button>
        <button class="pvp-team-btn" id="team-btn-spartans" data-team="spartans">
          <span class="team-emoji">S</span>Spartans
        </button>
      </div>
      <button class="pvp-btn green" data-action="create-room">Create Room</button>
      <button class="pvp-btn gray"  data-action="show-mode">Back</button>
    </div>

    <div class="pvp-card" id="pvp-screen-join-room" style="display:none">
      <div class="pvp-title">Join Room</div>
      <div class="pvp-subtitle">Enter the code your friend shared</div>
      <label style="font-size:0.85rem;color:#90caf9">Your Name</label>
      <input class="pvp-input" id="pvp-join-name" maxlength="16" placeholder="Enter name" style="letter-spacing:1px">
      <label style="font-size:0.85rem;color:#90caf9">Room Code</label>
      <input class="pvp-input" id="pvp-join-code" maxlength="6" placeholder="ABC123">
      <label style="font-size:0.85rem;color:#90caf9">Pick Your Team</label>
      <div class="pvp-team-row">
        <button class="pvp-team-btn" id="team-btn-join-highlanders" data-team="highlanders" data-context="join">
          <span class="team-emoji">A</span>Highlanders
        </button>
        <button class="pvp-team-btn" id="team-btn-join-spartans" data-team="spartans" data-context="join">
          <span class="team-emoji">S</span>Spartans
        </button>
      </div>
      <button class="pvp-btn green" data-action="join-room">Join Room</button>
      <button class="pvp-btn gray"  data-action="show-mode">Back</button>
    </div>

    <div class="pvp-card" id="pvp-screen-lobby" style="display:none">
      <div class="pvp-title">Lobby</div>
      <div id="pvp-room-code-section">
        <div class="pvp-subtitle">Share this code with your friend:</div>
        <div class="pvp-room-code-display" id="pvp-room-code-text">------</div>
        <button class="pvp-btn blue" style="padding:8px;font-size:0.85rem" data-action="copy-code">Copy Code</button>
      </div>
      <div class="pvp-lobby-players">
        <div class="pvp-player-slot">
          <div class="slot-label">You</div>
          <div class="slot-name" id="lobby-my-name">--</div>
          <div class="slot-team" id="lobby-my-team">--</div>
          <span class="slot-ready" id="lobby-my-ready" style="display:none">Ready</span>
        </div>
        <div style="color:#4fc3f7;font-size:1.5rem">VS</div>
        <div class="pvp-player-slot">
          <div class="slot-label">Opponent</div>
          <div class="slot-name" id="lobby-opp-name">Waiting...</div>
          <div class="slot-team" id="lobby-opp-team">--</div>
          <span class="slot-ready" id="lobby-opp-ready" style="display:none">Ready</span>
        </div>
      </div>
      <div class="pvp-spinner" id="lobby-spinner"></div>
      <div class="pvp-status" id="lobby-status">Waiting for opponent to join...</div>
      <div class="pvp-chat-box" id="pvp-chat-messages"></div>
      <div style="display:flex;gap:8px">
        <input class="pvp-input" id="pvp-chat-input" placeholder="Chat..." maxlength="80"
               style="margin:0;flex:1;letter-spacing:0px">
        <button class="pvp-btn blue" style="width:60px;padding:0" data-action="send-chat">Send</button>
      </div>
      <button class="pvp-btn green" id="lobby-ready-btn" data-action="ready" style="margin-top:14px">
        Ready Up
      </button>
      <button class="pvp-btn red" data-action="disconnect">Leave Room</button>
    </div>

    <div class="pvp-card" id="pvp-screen-queue" style="display:none">
      <div class="pvp-title">Matchmaking</div>
      <div class="pvp-subtitle">Looking for an opponent...</div>
      <div class="pvp-spinner"></div>
      <div class="pvp-status" id="queue-status">Searching...</div>
      <button class="pvp-btn red" data-action="leave-queue">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Wire up overlay actions via delegation (avoids inline onclick globals).
  overlay.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action], [data-team]');
    if (!t) return;
    if (t.dataset.team) {
      selectTeam(t.dataset.team, t.dataset.context || null);
      return;
    }
    switch (t.dataset.action) {
      case 'queue':       pvpStartPublicQueue(); break;
      case 'show-create': showScreen('create-room'); break;
      case 'show-join':   showScreen('join-room'); break;
      case 'show-mode':   showScreen('mode-select'); break;
      case 'close':       closePvP(); break;
      case 'create-room': pvpCreateRoom(); break;
      case 'join-room':   pvpJoinRoom(); break;
      case 'copy-code':   copyRoomCode(); break;
      case 'send-chat':   pvpSendChat(); break;
      case 'ready':       pvpMarkReady(); break;
      case 'disconnect':  pvpDisconnect(); closePvP(); break;
      case 'leave-queue': pvpLeaveQueue(); break;
    }
  });
  const chatInput = document.getElementById('pvp-chat-input');
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pvpSendChat(); });

  const banner = document.createElement('div');
  banner.id = 'pvp-abandon-banner';
  banner.className = 'pvp-abandon-banner';
  banner.innerHTML = `
    Opponent Disconnected<br>
    <span style="font-size:1rem;font-weight:normal">The game has ended.</span><br>
    <button class="pvp-btn gray" id="pvp-abandon-close" style="margin-top:14px;width:auto;padding:10px 28px">Return to Menu</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('pvp-abandon-close').addEventListener('click', closePvPAbandoned);
}


// ============================================================
// SCREEN MANAGEMENT
// ============================================================
function showScreen(screenId) {
  const overlay = document.getElementById('pvp-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  overlay.querySelectorAll('.pvp-card').forEach(s => { s.style.display = 'none'; });
  const target = document.getElementById('pvp-screen-' + screenId);
  if (target) target.style.display = 'block';
}

function closePvP() {
  const overlay = document.getElementById('pvp-overlay');
  if (overlay) overlay.classList.remove('active');
  pvpDisconnect();
}

function closePvPAbandoned() {
  document.getElementById('pvp-abandon-banner').style.display = 'none';
  closePvP();
}

let _selectedTeam     = null;
let _selectedTeamJoin = null;

function selectTeam(team, context) {
  if (context === 'join') {
    _selectedTeamJoin = team;
    document.getElementById('team-btn-join-highlanders').classList.toggle('selected', team === 'highlanders');
    document.getElementById('team-btn-join-spartans').classList.toggle('selected', team === 'spartans');
  } else {
    _selectedTeam = team;
    document.getElementById('team-btn-highlanders').classList.toggle('selected', team === 'highlanders');
    document.getElementById('team-btn-spartans').classList.toggle('selected', team === 'spartans');
  }
}

function copyRoomCode() {
  if (!pvp.roomCode) return;
  navigator.clipboard && navigator.clipboard.writeText(pvp.roomCode);
  alert('Room code ' + pvp.roomCode + ' copied!');
}


// ============================================================
// ROOM CREATION / JOIN
// ============================================================
function pvpCreateRoom() {
  if (!pvpHostReady()) return;
  const name = document.getElementById('pvp-create-name').value.trim() || 'Player 1';
  const team = _selectedTeam;
  if (!team) { alert('Please pick a team first!'); return; }

  pvp.roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  pvp.myName   = name;
  pvp.myTeam   = team;
  pvpConnect(pvp.roomCode, name, team);
}

function pvpJoinRoom() {
  if (!pvpHostReady()) return;
  const name = document.getElementById('pvp-join-name').value.trim() || 'Player 2';
  const code = document.getElementById('pvp-join-code').value.trim().toUpperCase();
  const team = _selectedTeamJoin;
  if (!code || code.length < 4) { alert('Enter a valid room code.'); return; }
  if (!team) { alert('Please pick a team first!'); return; }

  pvp.roomCode = code;
  pvp.myName   = name;
  pvp.myTeam   = team;
  pvpConnect(code, name, team);
}


// ============================================================
// PUBLIC MATCHMAKING
// ============================================================
function pvpStartPublicQueue() {
  if (!pvpHostReady()) return;
  showScreen('queue');
  document.getElementById('queue-status').textContent = 'Searching for opponent...';

  pvp.queueSocket = new WebSocket('wss://' + PARTYKIT_HOST + '/party/' + QUEUE_ROOM);
  pvp.queueSocket.onopen = () => {
    pvp.queueSocket.send(JSON.stringify({
      type      : 'join_queue',
      playerName: pvp.myName || 'Player',
    }));
  };
  pvp.queueSocket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'matched') {
      pvp.roomCode = msg.roomCode;
      pvp.myTeam   = msg.team;
      pvp.myName   = pvp.myName || 'Player';
      pvp.queueSocket.close();
      pvpConnect(msg.roomCode, pvp.myName, pvp.myTeam);
    }
    if (msg.type === 'queue_position') {
      document.getElementById('queue-status').textContent =
        'Position in queue: ' + msg.position + ' -- searching...';
    }
  };
  pvp.queueSocket.onerror = () => {
    document.getElementById('queue-status').textContent = 'Connection error. Try again.';
  };
}

function pvpLeaveQueue() {
  if (pvp.queueSocket) pvp.queueSocket.close();
  showScreen('mode-select');
}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================
function pvpConnect(roomCode, playerName, team) {
  showScreen('lobby');
  document.getElementById('pvp-room-code-text').textContent = roomCode;
  document.getElementById('lobby-my-name').textContent = playerName;
  document.getElementById('lobby-my-team').textContent =
    team === 'highlanders' ? 'Highlanders' : 'Spartans';
  document.getElementById('lobby-status').textContent = 'Connecting...';

  pvp.socket = new WebSocket('wss://' + PARTYKIT_HOST + '/party/' + roomCode);
  pvp.socket.onopen = () => {
    pvp.connected = true;
    document.getElementById('lobby-status').textContent = 'Connected! Waiting for opponent...';
    pvp.socket.send(JSON.stringify({
      type      : 'join_lobby',
      playerName: playerName,
      team      : team,
    }));
  };
  pvp.socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    pvpHandleMessage(msg);
  };
  pvp.socket.onclose = () => { pvp.connected = false; };
  pvp.socket.onerror = () => {
    document.getElementById('lobby-status').textContent = 'Connection failed. Check your room code.';
  };
}


// ============================================================
// MESSAGE HANDLER
// ============================================================
function pvpHandleMessage(msg) {
  switch (msg.type) {
    case 'hello':
      pvp.selfId = msg.selfId;
      break;

    case 'lobby_update': {
      const all = msg.players || {};
      const ids = Object.keys(all);
      const me = pvp.selfId && all[pvp.selfId] ? all[pvp.selfId] : null;
      const opponent = ids.map(id => all[id]).find((p, i) => ids[i] !== pvp.selfId);

      if (me) {
        document.getElementById('lobby-my-ready').style.display = me.ready ? 'inline-block' : 'none';
      }
      if (opponent) {
        document.getElementById('lobby-opp-name').textContent = opponent.name;
        document.getElementById('lobby-opp-team').textContent =
          opponent.team === 'highlanders' ? 'Highlanders' : 'Spartans';
        document.getElementById('lobby-spinner').style.display = 'none';
        document.getElementById('lobby-opp-ready').style.display =
          opponent.ready ? 'inline-block' : 'none';
        pvp.opponentName = opponent.name;

        const bothReady = me && me.ready && opponent.ready;
        document.getElementById('lobby-status').textContent = bothReady
          ? 'Both ready -- starting game...'
          : (me && me.ready
              ? 'Waiting for opponent to ready up...'
              : (opponent.ready
                  ? 'Opponent is ready -- ready up when set.'
                  : 'Opponent joined! Ready up when set.'));
      } else {
        document.getElementById('lobby-opp-name').textContent = 'Waiting...';
        document.getElementById('lobby-opp-team').textContent = '--';
        document.getElementById('lobby-opp-ready').style.display = 'none';
        document.getElementById('lobby-status').textContent =
          (me && me.ready) ? 'Ready -- waiting for opponent to join...'
                           : 'Waiting for opponent to join...';
      }
      break;
    }
    case 'game_start': {
      pvp.isHost = (msg.hostId === pvp.selfId);
      const assignments = msg.assignments || [];
      pvp.myAssignment = assignments.find(a => a.playerId === pvp.selfId) || null;
      pvp.opponentAssignment = assignments.find(a => a.playerId !== pvp.selfId) || null;
      document.getElementById('pvp-overlay').classList.remove('active');
      pvpStartLocalGame(pvp.myTeam, pvp.isHost);
      break;
    }
    case 'opponent_play_call':
      pvpReceiveOpponentPlay(msg.play, msg.side);
      break;
    case 'snap':
      if (!pvp.isHost) pvpReceiveSnap();
      break;
    case 'opponent_input':
      pvpReceiveOpponentInput(msg.action, msg.data);
      break;
    case 'state_sync':
      if (!pvp.isHost) pvpApplyStateSync(msg.state);
      break;
    case 'game_event':
      pvpReceiveGameEvent(msg.event);
      break;
    case 'chat': {
      const box = document.getElementById('pvp-chat-messages');
      box.appendChild(Object.assign(document.createElement('div'), {
        innerHTML: '<b>' + escapeHtml(msg.from) + ':</b> ' + escapeHtml(msg.message),
      }));
      box.scrollTop = box.scrollHeight;
      break;
    }
    case 'player_left':
    case 'game_abandoned':
      document.getElementById('pvp-abandon-banner').style.display = 'block';
      pvpHandleOpponentLeft();
      break;
    case 'error':
      if (msg.reason === 'room_full') {
        alert('Room is full! Ask your friend for a new code.');
        showScreen('mode-select');
      }
      if (msg.reason === 'team_taken') {
        alert('That team is already taken. Please pick the other team.');
      }
      break;
    case 'rematch_start':
      pvpStartLocalGame(pvp.myTeam, pvp.isHost);
      break;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}


// ============================================================
// SEND HELPERS — no-op when not in a PvP game
// ============================================================
function pvpSendPlayCall(play, side) {
  if (!pvp.connected) return;
  pvp.socket.send(JSON.stringify({ type: 'play_call', play, side }));
}
function pvpSendSnap() {
  if (!pvp.connected) return;
  pvp.socket.send(JSON.stringify({ type: 'snap' }));
}
function pvpSendInput(action, data) {
  if (!pvp.connected) return;
  pvp.socket.send(JSON.stringify({ type: 'input', action, data: data || {} }));
}
function pvpSendStateUpdate(state) {
  if (!pvp.connected || !pvp.isHost) return;
  pvp.socket.send(JSON.stringify({ type: 'state_update', state }));
}
function pvpSendGameEvent(event) {
  if (!pvp.connected) return;
  pvp.socket.send(JSON.stringify({ type: 'game_event', event }));
}
function pvpMarkReady() {
  if (!pvp.connected) return;
  pvp.socket.send(JSON.stringify({ type: 'player_ready' }));
  document.getElementById('lobby-my-ready').style.display = 'inline-block';
  document.getElementById('lobby-ready-btn').disabled = true;
  document.getElementById('lobby-status').textContent = 'Waiting for opponent to ready up...';
}
function pvpSendChat() {
  const input = document.getElementById('pvp-chat-input');
  const msg = input.value.trim();
  if (!msg || !pvp.connected) return;
  pvp.socket.send(JSON.stringify({ type: 'chat', message: msg }));
  input.value = '';
}
function pvpDisconnect() {
  if (pvp.socket) { pvp.socket.close(); pvp.socket = null; }
  pvp.connected = false;
  pvp.isHost = false;
}


// ============================================================
// RECEIVE HOOKS — wired to the existing FB game engine
// ============================================================
function pvpStartLocalGame(team, isHost) {
  if (window.FB) applyPvPTeamAssignments();
  const startBtn = document.getElementById('pgStart');
  if (startBtn) startBtn.click();
  console.log('[pvp] game starting -- team:', team, 'isHost:', isHost,
              'side:', pvp.myAssignment && pvp.myAssignment.side,
              'alt:', pvp.myAssignment && pvp.myAssignment.altColors);
}

// When both players pick the same team, the server assigns one of them
// altColors=true. We clone the chosen team into the other slot so both sides
// of the field share the same roster, then darken the alt side's primary
// color so the two are visually distinguishable on the field.
function applyPvPTeamAssignments() {
  const FB = window.FB;
  if (!FB || !FB.teams) return;
  const me  = pvp.myAssignment;
  const opp = pvp.opponentAssignment;
  if (!me || !opp) {
    // Fallback: legacy path that just sets userTeam.
    FB.userTeam = (pvp.myTeam === 'spartans') ? 'away' : 'home';
    return;
  }

  // If both players are on the same team, clone the source team data into
  // the other side slot so the engine has 22 distinct entities to render.
  if (me.team === opp.team) {
    const sourceKey = (me.team === 'highlanders') ? 'home' : 'away';
    const otherKey  = sourceKey === 'home' ? 'away' : 'home';
    const cloneTeam = JSON.parse(JSON.stringify(FB.teams[sourceKey]));
    FB.teams[otherKey] = cloneTeam;
    if (FB.lineups) FB.lineups[otherKey] = JSON.parse(JSON.stringify(FB.lineups[sourceKey]));
  }

  // Apply alt colors -- swap primary to near-black, keep secondary as-is so
  // numbers/lettering stay light blue against the dark jersey.
  for (const a of [me, opp]) {
    if (a.altColors && FB.teams[a.side]) {
      FB.teams[a.side].primaryColor = '#0a0a0a';
    }
  }

  // Refresh the HUD logo letters in case team data changed.
  const logoHome = document.getElementById('logoHome');
  const logoAway = document.getElementById('logoAway');
  if (logoHome && FB.teams.home) logoHome.textContent = FB.teams.home.initial || 'H';
  if (logoAway && FB.teams.away) logoAway.textContent = FB.teams.away.initial || 'A';

  FB.userTeam = me.side;
}

function pvpReceiveOpponentPlay(play, side) {
  // TODO: feed the opponent's selection into FB.selectedPlay[side] when the
  // playPicker isn't open on this client. Requires authoritative play
  // resolution -- only meaningful once the host/guest sync layer is built.
  console.log('[pvp] opponent called play:', play, side);
}

function pvpReceiveSnap() {
  // Guest mirrors the host's snap timing.
  if (window.FB && window.FB.snapBall && window.FB.state && window.FB.state.phase === 'presnap') {
    window.FB.snapBall();
  }
}

function pvpReceiveOpponentInput(action, data) {
  // TODO: route to the same handlers as the local input buttons but applied
  // to the opponent's controlled player. Needs a player-id mapping that
  // doesn't exist in the single-player code yet.
  console.log('[pvp] opponent input:', action, data);
}

function pvpApplyStateSync(state) {
  // TODO: deserialize host's authoritative snapshot (player positions, ball,
  // score, clock) into FB.state. Stub kept until the host-side serializer
  // exists; otherwise we'd half-apply state and desync.
  console.log('[pvp] state sync received', state && Object.keys(state));
}

function pvpReceiveGameEvent(event) {
  // Mirror the same UI feedback the local engine would trigger. Real
  // possession/score changes are still applied by the host's state_sync;
  // this is just for cosmetic echo on the guest.
  console.log('[pvp] game event:', event);
}

function pvpHandleOpponentLeft() {
  // Pause the loop if it's running.
  if (window.FB && window.FB.stopLoop) window.FB.stopLoop();
  console.log('[pvp] opponent disconnected');
}


// ============================================================
// GAME ENGINE INTEGRATION (monkey-patch FB hooks)
// ------------------------------------------------------------
// We wrap a handful of FB functions instead of editing the gameplay files
// directly. Each wrapper calls the original first, then forwards the event
// to the PvP layer. When not connected, every pvpSend* call returns early,
// so single-player behavior is unchanged.
// ============================================================
function installFBHooks() {
  const FB = window.FB;
  if (!FB) return false;

  if (FB.snapBall && !FB.snapBall.__pvpWrapped) {
    const orig = FB.snapBall;
    const wrapped = function () {
      const ret = orig.apply(this, arguments);
      // Only the host announces the snap; guests receive it via 'snap' msg.
      if (pvp.connected && pvp.isHost) pvpSendSnap();
      return ret;
    };
    wrapped.__pvpWrapped = true;
    FB.snapBall = wrapped;
  }

  if (FB.scoreTouchdown && !FB.scoreTouchdown.__pvpWrapped) {
    const orig = FB.scoreTouchdown;
    const wrapped = function () {
      const ret = orig.apply(this, arguments);
      if (pvp.connected) pvpSendGameEvent({ kind: 'touchdown', team: FB.state && FB.state.possession });
      return ret;
    };
    wrapped.__pvpWrapped = true;
    FB.scoreTouchdown = wrapped;
  }

  if (FB.endPlay && !FB.endPlay.__pvpWrapped) {
    const orig = FB.endPlay;
    const wrapped = function (opts) {
      const ret = orig.apply(this, arguments);
      if (pvp.connected && opts && (opts.reason === 'fumble' || opts.reason === 'interception' || opts.reason === 'td')) {
        pvpSendGameEvent({ kind: opts.reason });
      }
      return ret;
    };
    wrapped.__pvpWrapped = true;
    FB.endPlay = wrapped;
  }

  // recordUserPlay is the natural seam for play-call broadcasting -- ui.js
  // already calls it from the CONFIRM button handler.
  const origRecord = FB.recordUserPlay;
  if (origRecord && !origRecord.__pvpWrapped) {
    const wrapped = function (side, play) {
      const ret = origRecord.apply(this, arguments);
      if (pvp.connected && play) pvpSendPlayCall(play.id, side);
      return ret;
    };
    wrapped.__pvpWrapped = true;
    FB.recordUserPlay = wrapped;
  }

  return true;
}


// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  injectPvPStyles();
  injectPvPHTML();

  // FB modules also wire up on DOMContentLoaded; defer hook install so the
  // engine has finished defining its functions.
  setTimeout(installFBHooks, 0);
});

// Expose a couple of names globally so future debugging from devtools works.
window.pvp = pvp;
window.pvpStartPublicQueue = pvpStartPublicQueue;
window.installFBHooks = installFBHooks;

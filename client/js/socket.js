/**
 * Shadow Mafia — Socket.IO Client Connection
 *
 * This file handles all socket event emission/reception and
 * delegates to the UI modules for rendering.
 */

let socket = null;
let playerId = null;
let roomCode = null;
let currentGameState = null;

/**
 * Get or create a unique session ID for reconnects.
 */
function getSessionId() {
  let sid = localStorage.getItem('shadowMafiaSessionId');
  if (!sid) {
    sid = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem('shadowMafiaSessionId', sid);
  }
  return sid;
}

/**
 * Initialize socket connection.
 */
function initSocket() {
  if (socket) {
    socket.disconnect();
    socket.removeAllListeners();
  }
  
  socket = io({
    transports: ['websocket', 'polling'],
    auth: { sessionId: getSessionId() }
  });

  // Initialize VoiceManager
  if (typeof VoiceManager !== 'undefined') {
    window.voiceManager = new VoiceManager(socket);
  }

  // ── Connection Events ────────────────────────────────────

  socket.on('connect', () => {
    setConnectionStatus(true);
    console.log('[Socket] Connected:', socket.id);
  });

  socket.on('disconnect', () => {
    setConnectionStatus(false);
    console.log('[Socket] Disconnected');
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
    setConnectionStatus(false);
  });

  // ── Lobby Events ─────────────────────────────────────────

  socket.on('lobby:joined', (data) => {
    playerId = data.playerId;
    roomCode = data.roomCode;
    currentGameState = data;
    showLobby(data);

    // Initialize voice and join voice room
    if (window.voiceManager) {
      window.voiceManager.localPlayerId = playerId;
      window.voiceManager.initialize().then((success) => {
        if (success) {
          window.voiceManager.joinVoiceRoom(roomCode);
        }
      });
    }
  });

  socket.on('lobby:playerUpdate', (data) => {
    currentGameState = { ...currentGameState, ...data };
    updateLobbyPlayers(data.players, data.hostId);
  });

  socket.on('lobby:notification', (data) => {
    showLobbyNotification(data);
  });

  socket.on('lobby:kicked', (data) => {
    alert(data.message || 'You were removed from the room.');
    resetToLobby();
  });

  // ── Game Events ──────────────────────────────────────────

  socket.on('game:started', (data) => {
    currentGameState = data.gameState;
    showGameScreen(data.gameState);
  });

  socket.on('role:assigned', (data) => {
    showRoleReveal(data);
  });

  socket.on('phase:night', (data) => {
    updatePhase('night', data);
  });

  socket.on('night:action', (data) => {
    showNightAction(data);
  });

  socket.on('night:waiting', (data) => {
    showNightWaiting(data);
  });

  socket.on('night:step', (data) => {
    onNightStep(data);
  });

  socket.on('mafia:voteUpdate', (data) => {
    updateMafiaVote(data);
  });

  socket.on('phase:morning', (data) => {
    showMorning(data);
  });

  socket.on('morning:detective_result', (data) => {
    showDetectiveResult(data);
  });

  socket.on('phase:day', (data) => {
    updatePhase('day', data);
    showDayPhase(data);
  });

  socket.on('chat:message', (data) => {
    addChatMessage(data);
  });

  socket.on('chat:typing', (data) => {
    if (currentGameState && currentGameState.players) {
      const player = currentGameState.players.find(p => p.id === data.playerId);
      if (player) {
        player.typing = data.isTyping;
        updatePlayerStatus(currentGameState.players);
      }
    }
  });

  socket.on('phase:voting', (data) => {
    updatePhase('voting', data);
    showVotingPhase(data);
  });

  socket.on('vote:update', (data) => {
    updateVoteSummary(data);
  });

  socket.on('vote:result', (data) => {
    showVoteResult(data);
  });

  socket.on('action:result', (data) => {
    handleActionResult(data);
  });

  socket.on('game:ended', (data) => {
    showGameResult(data);
  });

  // ── WebRTC Voice Signaling Events ──────────────────────────
  //
  // All voice signaling goes through Socket.IO.
  // Audio streams flow peer-to-peer via WebRTC.

  socket.on('voice:joined', (data) => {
    // Voice system confirmed — join voice room with all participants
    if (window.voiceManager) {
      // Connect to all existing participants
      const participants = data.participants || [];
      for (const p of participants) {
        window.voiceManager.connectToPeer(p.id, p.name);
      }
    }
  });

  socket.on('voice:player-joined', (data) => {
    // A new player joined voice — connect to them
    if (window.voiceManager) {
      window.voiceManager.connectToPeer(data.id, data.name);
    }
  });

  socket.on('voice:offer', (data) => {
    if (window.voiceManager) {
      window.voiceManager.handleOffer(data.fromId, data.offer);
    }
  });

  socket.on('voice:answer', (data) => {
    if (window.voiceManager && data.fromId) {
      window.voiceManager.handleAnswer(data.fromId, data.answer);
    }
  });

  socket.on('voice:ice-candidate', (data) => {
    if (window.voiceManager && data.fromId) {
      window.voiceManager.handleIceCandidate(data.fromId, data.candidate);
    }
  });

  socket.on('voice:speaking', (data) => {
    if (window.voiceManager) {
      window.voiceManager.onRemoteSpeaking(data.playerId, data.speaking);
    }
  });

  socket.on('voice:muted', (data) => {
    if (window.voiceManager) {
      window.voiceManager.onRemoteMuted(data.playerId, data.muted);
    }
  });

  socket.on('voice:permissions', (data) => {
    // Phase-based voice permission update
    if (window.voiceManager) {
      window.voiceManager.updateVoicePermissions(data);
    }
  });

  socket.on('voice:player-left', (data) => {
    // A player left — disconnect their peer connection
    if (window.voiceManager) {
      window.voiceManager.disconnectPeer(data.playerId);
    }
  });

  // ── Error Events ─────────────────────────────────────────

  socket.on('error', (data) => {
    showError(data.message || 'An error occurred.');
  });

  return socket;
}

/**
 * Update the connection status indicator.
 * @param {boolean} connected
 */
function setConnectionStatus(connected) {
  const el = document.getElementById('connection-status');
  if (!el) return;
  el.classList.toggle('disconnected', !connected);
  el.querySelector('.status-text').textContent = connected ? 'Connected' : 'Disconnected';
}

/**
 * Create a new game room.
 * @param {string} playerName
 */
function createRoom(playerName) {
  socket.emit('lobby:create', { playerName });
}

/**
 * Join an existing game room.
 * @param {string} roomCode
 * @param {string} playerName
 */
function joinRoom(roomCode, playerName) {
  socket.emit('lobby:join', { roomCode, playerName });
}

/**
 * Start the game (host only).
 */
function startGame() {
  socket.emit('game:start', {});
}

/**
 * Perform a game action (night action, etc.).
 * @param {string} actionType
 * @param {string} targetId
 */
function performAction(actionType, targetId) {
  socket.emit('game:action', { actionType, targetId });
}

/**
 * Send a chat message.
 * @param {string} message
 */
function sendChat() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat:send', { message: msg });
  input.value = '';
  sendTyping(false);
}

let typingTimeout = null;
let lastTypingEmit = 0;

/**
 * Send typing status with throttling to prevent socket spam.
 * @param {boolean} isTyping
 */
function sendTyping(isTyping) {
  if (!socket) return;
  
  const now = Date.now();
  if (isTyping) {
    if (now - lastTypingEmit < 1500) return;
  }
  
  lastTypingEmit = now;
  socket.emit('chat:typing', { isTyping });
}

/**
 * Cast a vote.
 * @param {string} targetId
 */
function castVote(targetId) {
  socket.emit('vote:cast', { targetId });
}

/**
 * Kick a player from the lobby (host only).
 * @param {string} targetId
 */
function kickPlayer(targetId) {
  socket.emit('lobby:kick', { targetId });
}

/**
 * Reset the UI back to the join/create lobby screen after being kicked or leaving.
 */
function resetToLobby() {
  playerId = null;
  roomCode = null;
  currentGameState = null;

  document.getElementById('join-section').classList.remove('hidden');
  document.getElementById('lobby-info').classList.add('hidden');
  document.getElementById('lobby-screen').classList.add('active');
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('result-overlay').classList.add('hidden');
  document.getElementById('role-overlay').classList.add('hidden');

  document.getElementById('create-name').value = '';
  document.getElementById('join-name').value = '';
  document.getElementById('join-code').value = '';
  document.getElementById('error-message').classList.add('hidden');
}

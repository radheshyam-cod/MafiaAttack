/**
 * Shadow Mafia — Lobby UI
 *
 * Handles lobby screen rendering: player list with kick buttons (host only),
 * notifications, and all lobby interactions.
 */

/**
 * Show the lobby screen after joining/creating a room.
 * @param {object} data - { roomCode, playerId, players, hostId, playerCount }
 */
function showLobby(data) {
  // Switch screens
  document.getElementById('join-section').classList.add('hidden');
  document.getElementById('lobby-info').classList.remove('hidden');
  document.getElementById('lobby-screen').classList.add('active');
  document.getElementById('game-screen').classList.remove('active');

  // Set room code
  const codeDisplay = document.getElementById('room-code-display');
  if (codeDisplay) codeDisplay.textContent = data.roomCode;

  // Update player list
  updateLobbyPlayers(data.players, data.hostId);

  // Enable/disable start button
  updateStartButton(data.players, data.hostId);
}

/**
 * Update the player list in the lobby, including kick buttons for the host.
 * @param {Array} players
 * @param {string} hostId
 */
function updateLobbyPlayers(players, hostId) {
  const list = document.getElementById('player-list');
  const count = document.getElementById('player-count');
  if (!list || !count) return;

  count.textContent = players.length;

  const isHost = playerId === hostId;

  list.innerHTML = players.map(p => {
    const isPlayerHost = p.id === hostId;
    const initial = getInitial(p.name);
    const color = getAvatarColor(p.name);
    
    // Default to online if not specified (for now, will update backend to send status)
    const status = p.status || 'online';

    // Kick button: visible only to the host, hidden for the host themselves
    const showKick = isHost && !isPlayerHost;
    const kickBtn = showKick
      ? '<button class="btn-kick" onclick="handleKickPlayer(\'' + p.id + '\')" title="Remove ' + escapeHtml(p.name) + '">✕</button>'
      : '';

    return '<li class="player-chip" data-player-id="' + p.id + '">' +
      '<div class="chip-avatar player-avatar" style="background: ' + color + '">' + initial + 
      '<div class="player-status-indicator ' + status + '"></div></div>' +
      '<span class="player-name">' + escapeHtml(p.name) + '</span>' +
      (isPlayerHost ? '<span class="player-badge player-host">HOST</span>' : '') +
      '<div class="chip-voice-controls"><span class="chip-mic-icon">🎤</span><input type="range" class="voice-volume-slider" min="0" max="1" step="0.05" value="1" oninput="handleVolumeChange(\'' + p.id + '\', this.value)" title="Volume"></div>' +
      kickBtn +
      '</li>';
  }).join('');

  updateStartButton(players, hostId);
}

/**
 * Enable or disable the start button based on player count and host status.
 * @param {Array} players
 * @param {string} hostId
 */
function updateStartButton(players, hostId) {
  const btn = document.getElementById('btn-start');
  if (!btn) return;

  const isHost = playerId === hostId;
  const enoughPlayers = players.length >= 5;
  btn.disabled = !isHost || !enoughPlayers;
  btn.title = !isHost ? 'Only the host can start the game'
    : !enoughPlayers ? 'Need ' + (5 - players.length) + ' more player(s)'
    : 'Start the game';

  if (!isHost) {
    btn.innerHTML = '<span class="btn-icon">⏳</span> Waiting for host to start...';
  } else if (!enoughPlayers) {
    btn.innerHTML = '<span class="btn-icon">⏳</span> Need ' + (5 - players.length) + ' more';
  } else {
    btn.innerHTML = '<span class="btn-icon">▶</span> Start Game';
  }
}

/**
 * Show a lobby notification (join, leave, kick, disconnect).
 * @param {object} data - { type: string, message: string, playerName: string }
 */
function showLobbyNotification(data) {
  const container = document.getElementById('lobby-notifications');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'lobby-notification ' + (data.type || 'info');

  const icons = {
    join: '→',
    leave: '←',
    kick: '✕',
    disconnect: '⚠',
  };
  const icon = icons[data.type] || '•';

  el.innerHTML = '<span class="notif-icon">' + icon + '</span><span class="notif-message">' + escapeHtml(data.message) + '</span>';

  container.appendChild(el);
  scrollToBottom(container);

  if (window.audioManager) {
    if (data.type === 'join') window.audioManager.play('join');
    if (data.type === 'leave' || data.type === 'disconnect') window.audioManager.play('leave');
  }

  // Auto-remove after a few seconds
  setTimeout(() => {
    if (el.parentNode) {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => {
        if (el.parentNode) el.remove();
      }, 300);
    }
  }, 4000);
}

/**
 * Handle the "Create Room" button click.
 */
function handleCreateRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) {
    showError('Please enter your name.');
    document.getElementById('create-name').focus();
    return;
  }
  if (name.length > 20) {
    showError('Name must be 20 characters or less.');
    return;
  }
  createRoom(name);
}

/**
 * Handle the "Join Room" button click.
 */
function handleJoinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim();

  if (!name) {
    showError('Please enter your name.');
    document.getElementById('join-name').focus();
    return;
  }
  if (name.length > 20) {
    showError('Name must be 20 characters or less.');
    return;
  }
  if (!code || code.length < 6) {
    showError('Please enter a valid 6-digit room code.');
    document.getElementById('join-code').focus();
    return;
  }

  joinRoom(code, name);
}

/**
 * Copy the room code to the clipboard.
 */
async function copyRoomCode() {
  const codeEl = document.getElementById('room-code-display');
  if (!codeEl) return;
  const code = codeEl.textContent;
  if (!code || code === '------') return;

  await copyToClipboard(code);
  const btn = document.querySelector('.room-header .btn');
  if (btn) {
    btn.textContent = '✅ Copied!';
    btn.style.pointerEvents = 'none';
    setTimeout(() => {
      btn.innerHTML = '📋 Copy';
      btn.style.pointerEvents = '';
    }, 2000);
  }
}

/**
 * Handle start game button click.
 */
function handleStartGame() {
  const btn = document.getElementById('btn-start');
  if (!btn || btn.disabled) return;
  startGame();
}

/**
 * Handle kick player button click.
 * @param {string} targetId
 */
function handleKickPlayer(targetId) {
  if (!confirm('Remove this player from the room?')) return;
  kickPlayer(targetId);
}

/**
 * Leave the lobby and go back to the join/create screen.
 */
function handleLeaveLobby() {
  if (confirm('Leave this room?')) {
    window.location.reload();
  }
}



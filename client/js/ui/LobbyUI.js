/**
 * Shadow Mafia — Lobby UI
 *
 * Renders the "Gathering Hall": create/join, room code, seated
 * player portraits and notifications. All public function names and
 * DOM ids are preserved.
 */

function showLobby(data) {
  document.getElementById('join-section').classList.add('hidden');
  document.getElementById('lobby-info').classList.remove('hidden');
  document.getElementById('lobby-screen').classList.add('active');
  document.getElementById('game-screen').classList.remove('active');

  if (window.SceneManager) SceneManager.go('lobby');

  const codeDisplay = document.getElementById('room-code-display');
  if (codeDisplay) codeDisplay.textContent = data.roomCode;

  updateLobbyPlayers(data.players, data.hostId);
  updateStartButton(data.players, data.hostId);
}

let previousLobbyPlayers = new Set();

function updateLobbyPlayers(players, hostId) {
  const list = document.getElementById('player-list');
  const count = document.getElementById('player-count');
  if (!list || !count) return;

  count.textContent = players.length;
  const isHost = playerId === hostId;
  const currentIds = new Set(players.map(p => p.id));

  // Detect newly joined players
  let newlyJoined = false;
  players.forEach(p => {
    if (!previousLobbyPlayers.has(p.id) && previousLobbyPlayers.size > 0 && p.id !== playerId) {
      newlyJoined = true;
      if (window.showToast) window.showToast('👤 ' + escapeHtml(p.name) + ' entered the village.', 'info');
    }
  });

  if (newlyJoined && window.audioManager) {
    window.audioManager.play('join');
  }

  list.innerHTML = players.map(p => {
    const isPlayerHost = p.id === hostId;
    const showKick = isHost && !isPlayerHost;

    // Add drop-in animation class if newly joined, or if it's the initial load
    let styleClass = '';
    if (!previousLobbyPlayers.has(p.id)) {
      styleClass = 'animation: drop-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; opacity: 0;';
    }

    return buildPlayerChip(p, true, isPlayerHost, showKick, p.id === playerId, styleClass);
  }).join('');

  previousLobbyPlayers = currentIds;
  updateStartButton(players, hostId);
}

function updateStartButton(players, hostId) {
  const btn = document.getElementById('btn-start');
  if (!btn) return;

  const isHost = playerId === hostId;
  const enoughPlayers = players.length >= 5;
  btn.disabled = !isHost || !enoughPlayers;
  btn.title = !isHost ? 'Only the host can start the game'
    : !enoughPlayers ? 'Need ' + (5 - players.length) + ' more player(s)'
      : 'Start the game';
  btn.classList.toggle('ready', isHost && enoughPlayers);

  if (!isHost) btn.innerHTML = '<span class="btn-icon">⏳</span> Waiting for host to start...';
  else if (!enoughPlayers) btn.innerHTML = '<span class="btn-icon">⏳</span> Need ' + (5 - players.length) + ' more';
  else btn.innerHTML = '<span class="btn-icon">▶</span> Start Game';

  const ready = document.getElementById('ready-caption');
  if (ready) ready.classList.toggle('hidden', !(isHost && enoughPlayers));
}

function showLobbyNotification(data) {
  const container = document.getElementById('lobby-notifications');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'lobby-notification ' + (data.type || 'info');
  const icons = { join: '→', leave: '←', kick: '✕', disconnect: '⚠' };
  const icon = icons[data.type] || '•';
  el.innerHTML = '<span class="notif-icon">' + icon + '</span><span class="notif-message">' + escapeHtml(data.message) + '</span>';

  container.appendChild(el);
  scrollToBottom(container);

  // Top-center toast + sound for the "someone joined" moment
  if (window.toastManager) {
    const t = data.type === 'join' ? 'success' : (data.type === 'kick' ? 'error' : 'warning');
    window.toastManager.show(data.message, t, 3200);
  }
  if (window.audioManager) {
    if (data.type === 'join') window.audioManager.play('join');
    if (data.type === 'leave' || data.type === 'disconnect') window.audioManager.play('leave');
  }

  setTimeout(() => {
    if (el.parentNode) {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
    }
  }, 4000);
}

/* Microphone self-test: unmute and let the local lantern glow on VAD. */
function testMicrophone() {
  if (!window.voiceManager) {
    if (window.toastManager) window.toastManager.show('Microphone is still warming up…', 'warning');
    return;
  }
  const vm = window.voiceManager;
  if (vm.muted) vm.toggleMute(false);
  if (window.audioManager) window.audioManager.unlock();

  const btn = document.getElementById('btn-mic-test');
  const hint = document.getElementById('mic-test-hint');
  const youChip = document.querySelector('.player-chip.is-you');
  if (btn) btn.classList.add('testing');
  if (youChip) youChip.classList.add('mic-testing');
  if (hint) { hint.textContent = '🔊 Listening… say something!'; hint.classList.add('active'); }
  if (window.toastManager) window.toastManager.show('Mic test — your lantern glows when it hears you.', 'info', 3500);

  clearTimeout(window._micTestTimer);
  window._micTestTimer = setTimeout(() => {
    if (btn) btn.classList.remove('testing');
    if (youChip) youChip.classList.remove('mic-testing');
    if (hint) { hint.textContent = 'Speak — your lantern glows when it hears you.'; hint.classList.remove('active'); }
  }, 6000);
}

function handleCreateRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) { showError('Please enter your name.'); document.getElementById('create-name').focus(); return; }
  if (name.length > 20) { showError('Name must be 20 characters or less.'); return; }
  createRoom(name);
}

function handleJoinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim();
  if (!name) { showError('Please enter your name.'); document.getElementById('join-name').focus(); return; }
  if (name.length > 20) { showError('Name must be 20 characters or less.'); return; }
  if (!code || code.length < 6) { showError('Please enter a valid 6-digit room code.'); document.getElementById('join-code').focus(); return; }
  joinRoom(code, name);
}

async function copyRoomCode() {
  const codeEl = document.getElementById('room-code-display');
  if (!codeEl) return;
  const code = codeEl.textContent;
  if (!code || code === '------') return;

  if (window.audioManager) window.audioManager.unlock();
  await copyToClipboard(code);
  const btn = document.querySelector('.room-header .btn');
  if (btn) {
    btn.textContent = '✅ Copied!';
    btn.classList.add('copied');
    btn.style.pointerEvents = 'none';
    setTimeout(() => { btn.innerHTML = '📋 Copy'; btn.classList.remove('copied'); btn.style.pointerEvents = ''; }, 2000);
  }
}

function handleStartGame() {
  const btn = document.getElementById('btn-start');
  if (!btn || btn.disabled) return;
  startGame();
}

function handleKickPlayer(targetId) {
  if (!confirm('Remove this player from the room?')) return;
  kickPlayer(targetId);
}

function handleLeaveLobby() {
  if (confirm('Leave this room?')) window.location.reload();
}

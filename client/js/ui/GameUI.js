/**
 * Shadow Mafia — Game UI
 *
 * Handles all in-game rendering: phase transitions, night actions,
 * chat, voting, player status and timers.
 */

let phaseTimerInterval = null;
let nightStepTimerInterval = null;

/**
 * Show the game screen and initialize game state.
 * @param {object} state - Game state from server
 */
function showGameScreen(state) {
  document.getElementById('lobby-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  document.getElementById('join-section').classList.remove('hidden');
  document.getElementById('lobby-info').classList.add('hidden');
  document.getElementById('result-overlay').classList.add('hidden');
  document.getElementById('role-overlay').classList.add('hidden');

  document.getElementById('game-room-code').textContent = state.roomCode || roomCode;
  updatePlayerStatus(state.players);
}

/**
 * Show the role reveal overlay.
 * Mafia members see their teammates' names here.
 * @param {object} data - { role, team, description, mafiaTeam? }
 */
function showRoleReveal(data) {
  const overlay = document.getElementById('role-overlay');
  const icon = document.getElementById('role-card-icon');
  const title = document.getElementById('role-card-title');
  const desc = document.getElementById('role-card-desc');
  const team = document.getElementById('role-card-team');
  const revealContainer = document.getElementById('role-reveal');

  if (icon) icon.textContent = data.role.icon || '🎭';
  if (title) title.textContent = data.role.name;
  if (desc) desc.textContent = data.description;
  if (team) {
    team.textContent = 'Team: ' + (data.team.charAt(0).toUpperCase() + data.team.slice(1));
    team.className = 'role-card-team ' + (data.team === 'mafia' ? 'team-mafia' : 'team-village');
  }

  // Show mafia teammates for mafia members
  if (revealContainer && data.mafiaTeam && data.mafiaTeam.length > 0) {
    const names = data.mafiaTeam.map(function(m) {
      return '<div class="mafia-ally">🔪 ' + escapeHtml(m.name) + '</div>';
    }).join('');
    revealContainer.innerHTML = '<div class="mafia-ally-header">Your Mafia allies:</div>' + names;
    revealContainer.classList.remove('hidden');
  } else if (revealContainer) {
    revealContainer.innerHTML = '';
    revealContainer.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
}

/**
 * Close the role reveal overlay.
 */
function closeRoleReveal() {
  document.getElementById('role-overlay').classList.add('hidden');
}

/**
 * Update the phase badge, round number, and start timer.
 * @param {string} phase
 * @param {object} data
 */
function updatePhase(phase, data) {
  hideAllPanels();

  const badge = document.getElementById('phase-badge');
  const round = document.getElementById('round-number');
  const alive = document.getElementById('alive-count');

  if (badge) {
    const names = {
      night: '🌙 Night',
      morning: '🌅 Morning',
      day: '☀️ Day',
      voting: '🗳️ Voting',
      ended: '🎭 Ended',
    };
    badge.textContent = names[phase] || phase;
    badge.className = 'phase-badge ' + phase;
  }
  
  document.body.className = 'theme-' + phase;

  if (data.players) {
    updatePlayerStatus(data.players);
  }

  if (alive && data.players) {
    const aliveCount = data.players.filter(p => p.isAlive).length;
    alive.textContent = 'Alive: ' + aliveCount;
  }

  if (window.audioManager) {
    if (phase === 'night') window.audioManager.play('night', true);
    else if (phase === 'morning' || phase === 'day') window.audioManager.play('morning', true);
    else if (phase === 'voting') window.audioManager.play('voting', true);
  }

  // Clear night step timer when transitioning phases
  clearNightStepTimerDisplay();

  startPhaseTimer(data.phase);
}

/**
 * Hide all action panels and announcement.
 */
function hideAllPanels() {
  document.getElementById('night-panel').classList.add('hidden');
  document.getElementById('day-panel').classList.add('hidden');
  document.getElementById('voting-panel').classList.add('hidden');
  document.getElementById('game-announcement').classList.add('hidden');
}

/**
 * Start the phase countdown timer.
 * @param {object} phaseState
 */
function startPhaseTimer(phaseState) {
  if (phaseTimerInterval) {
    clearInterval(phaseTimerInterval);
    phaseTimerInterval = null;
  }

  const timerEl = document.getElementById('timer-display');
  if (!timerEl) return;

  if (!phaseState || phaseState.timeRemaining < 0) {
    timerEl.textContent = '--:--';
    return;
  }

  const updateTimer = () => {
    const elapsed = Date.now() - (phaseState.startedAt || Date.now());
    const remaining = Math.max(0, phaseState.timeRemaining - elapsed);
    timerEl.textContent = formatTime(remaining);
    timerEl.classList.toggle('urgent', remaining < 10000);
    
    if (phaseState.name === 'voting' && remaining > 0 && remaining <= 10000) {
      if (window.audioManager) window.audioManager.triggerHeartbeat();
    }

    if (remaining <= 0 && phaseTimerInterval) {
      clearInterval(phaseTimerInterval);
      phaseTimerInterval = null;
    }
  };

  updateTimer();
  phaseTimerInterval = setInterval(updateTimer, 1000);
}

/**
 * Handle a night step transition.
 * Shows a brief announcement about whose turn it is.
 * @param {object} data - { step, title }
 */
function onNightStep(data) {
  const announcement = document.getElementById('game-announcement');
  const text = document.getElementById('announcement-text');

  if (announcement && text) {
    announcement.classList.remove('hidden');
    text.textContent = data.title || '🌙 Night Phase';

    // Auto-hide after a few seconds so action panels can show
    clearTimeout(window._nightStepTimer);
    window._nightStepTimer = setTimeout(() => {
      announcement.classList.add('hidden');
    }, 3000);
  }
}

/**
 * Show night action panel for active players.
 * @param {object} data - { actionType, message, targets, timeRemaining }
 */
function showNightAction(data) {
  const panel = document.getElementById('night-panel');
  const title = document.getElementById('night-action-title');
  const instruction = document.getElementById('night-action-instruction');
  const targets = document.getElementById('night-targets');
  const waiting = document.getElementById('night-waiting');
  const timerEl = document.getElementById('night-step-timer');

  panel.classList.remove('hidden');
  waiting.classList.add('hidden');

  const actionLabels = {
    mafia_kill: '🔪 Mafia — Choose Your Victim',
    detective_investigate: '🔍 Detective — Investigate a Player',
    doctor_protect: '💉 Doctor — Protect a Player',
  };
  if (title) title.textContent = actionLabels[data.actionType] || '🌙 Night Phase';
  if (instruction) instruction.textContent = data.message;

  // Render target buttons
  const isMafiaKill = data.actionType === 'mafia_kill';
  targets.innerHTML = (data.targets || []).map(t => {
    return '<button class="target-btn' + (isMafiaKill ? ' mafia-target' : '') + '" data-target-id="' + t.id + '" onclick="selectNightTarget(\'' + t.id + '\')">' +
      '<span class="target-name">' + escapeHtml(t.name) + '</span>' +
      '<span class="target-check">✓ Selected</span>' +
      '</button>';
  }).join('');

  if (targets.innerHTML === '') {
    targets.innerHTML = '<p class="action-instruction" style="grid-column: 1/-1; text-align:center; padding: 12px;">No valid targets available.</p>';
  }

  // Start the night step timer countdown display
  startNightStepTimerDisplay(data.timeRemaining, timerEl);
}

/**
 * Select a night action target and auto-confirm.
 * @param {string} targetId
 */
function selectNightTarget(targetId) {
  const panel = document.getElementById('night-panel');
  const title = document.getElementById('night-action-title');
  const instruction = document.getElementById('night-action-instruction');
  const targets = document.getElementById('night-targets');
  const waiting = document.getElementById('night-waiting');
  const timerEl = document.getElementById('night-step-timer');

  // Determine action type from title
  const titleText = title ? title.textContent : '';
  let actionType = 'mafia_kill';
  if (titleText.includes('Detective')) actionType = 'detective_investigate';
  else if (titleText.includes('Doctor')) actionType = 'doctor_protect';

  // Send the action immediately
  performAction(actionType, targetId);

  // Show waiting state (keep timer running for the rest of the step)
  if (title) title.textContent = '🌙 Night Phase';
  targets.innerHTML = '';
  waiting.classList.remove('hidden');

  // Timer continues counting down in the waiting state (interval already running)

  // Visual feedback on the clicked button
  document.querySelectorAll('#night-targets .target-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.targetId === targetId) {
      btn.classList.add('selected');
    }
  });
}

/**
 * Show the night waiting state for players without night actions.
 * @param {object} data - { message, timeRemaining }
 */
function showNightWaiting(data) {
  const panel = document.getElementById('night-panel');
  const title = document.getElementById('night-action-title');
  const targets = document.getElementById('night-targets');
  const waiting = document.getElementById('night-waiting');
  const timerEl = document.getElementById('night-step-timer');

  panel.classList.remove('hidden');
  targets.innerHTML = '';
  waiting.classList.remove('hidden');

  if (title) title.textContent = '🌙 Night Phase';

  // Start the night step timer countdown display
  startNightStepTimerDisplay(data.timeRemaining, timerEl);
}

/**
 * Update mafia vote tracking (shown to mafia members).
 * @param {object} data
 */
function updateMafiaVote(data) {
  document.querySelectorAll('#night-targets .target-btn').forEach(btn => {
    if (btn.dataset.targetId === data.targetId) {
      btn.classList.add('selected');
    }
  });
}

/**
 * Show the morning announcement.
 * @param {object} data
 */
function showMorning(data) {
  hideAllPanels();

  const announcement = document.getElementById('game-announcement');
  const text = document.getElementById('announcement-text');
  const alive = document.getElementById('alive-count');

  announcement.classList.remove('hidden');

  if (data.killed) {
    text.innerHTML = data.message + '<br><strong>' + escapeHtml(data.killed.name) + '</strong> was found dead this morning... 💀';
  } else {
    text.innerHTML = '☀️ ' + data.message;
  }

  if (data.players) {
    updatePlayerStatus(data.players);
  }
  if (alive) {
    alive.textContent = 'Alive: ' + (data.remainingAlive || 0);
  }
}

/**
 * Show the Detective's investigation result privately during morning.
 * Shows a role-card-like overlay that auto-dismisses after 8 seconds.
 * @param {object} data - { targetId, targetName, alignment }
 */
function showDetectiveResult(data) {
  const overlay = document.getElementById('role-overlay');
  const icon = document.getElementById('role-card-icon');
  const title = document.getElementById('role-card-title');
  const desc = document.getElementById('role-card-desc');
  const team = document.getElementById('role-card-team');
  const revealContainer = document.getElementById('role-reveal');

  if (!overlay || !icon || !title || !desc || !team) return;

  icon.textContent = '🔍';
  title.textContent = 'Investigation Result';
  desc.innerHTML = 'You investigated <strong>' + escapeHtml(data.targetName) + '</strong>.';

  const isMafia = data.alignment === 'mafia';
  team.textContent = isMafia ? 'Team: Mafia 🔪' : 'Team: Village 👤';
  team.className = 'role-card-team ' + (isMafia ? 'team-mafia' : 'team-village');

  // Hide the mafia teammate section since this is a detective result, not role reveal
  if (revealContainer) {
    revealContainer.innerHTML = '';
    revealContainer.classList.add('hidden');
  }

  // Remove existing auto-hide timer
  if (window._detectiveTimer) {
    clearTimeout(window._detectiveTimer);
  }

  overlay.classList.remove('hidden');

  // Auto-hide after 8 seconds
  window._detectiveTimer = setTimeout(function() {
    overlay.classList.add('hidden');
    window._detectiveTimer = null;
  }, 8000);
}

/**
 * Show the day phase (discussion/chat).
 * @param {object} data
 */
function showDayPhase(data) {
  const panel = document.getElementById('day-panel');
  panel.classList.remove('hidden');

  const chat = document.getElementById('chat-messages');
  if (chat && chat.querySelector('.chat-empty')) {
    chat.innerHTML = '';
  }
}

/**
 * Add a chat message to the chat area.
 * @param {object} data
 */
function addChatMessage(data) {
  const chat = document.getElementById('chat-messages');
  if (!chat) return;

  const empty = chat.querySelector('.chat-empty');
  if (empty) empty.remove();

  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg slide-up';
  msgEl.innerHTML = '<div class="msg-author" style="color: ' + getAvatarColor(data.playerName) + '">' +
    escapeHtml(data.playerName) + '</div>' +
    '<div class="msg-text">' + escapeHtml(data.message) + '</div>';

  chat.appendChild(msgEl);
  scrollToBottom(chat);

  if (window.audioManager) window.audioManager.play('chat');
}

/**
 * Send a chat message from the chat input.
 */
function sendChatMessage() {
  sendChat();
}

/**
 * Night step timer display - updates the instruction/timer every second.
 * @param {number} timeRemaining - ms remaining for this step, or -1 if no timer
 * @param {HTMLElement|null} timerEl - the timer display element
 */
function startNightStepTimerDisplay(timeRemaining, timerEl) {
  // Clear any existing night step timer
  if (nightStepTimerInterval) {
    clearInterval(nightStepTimerInterval);
    nightStepTimerInterval = null;
  }

  if (!timerEl) return;

  if (!timeRemaining || timeRemaining < 0) {
    timerEl.classList.add('hidden');
    return;
  }

  timerEl.classList.remove('hidden');
  timerEl.textContent = formatTime(timeRemaining);

  const startedAt = Date.now();
  const initialRemaining = timeRemaining;

  nightStepTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, initialRemaining - elapsed);
    timerEl.textContent = formatTime(remaining);
    timerEl.classList.toggle('urgent', remaining < 10000);

    if (remaining <= 0) {
      clearInterval(nightStepTimerInterval);
      nightStepTimerInterval = null;
      timerEl.textContent = '00:00';
    }
  }, 1000);
}

/**
 * Clear the night step timer display.
 */
function clearNightStepTimerDisplay() {
  if (nightStepTimerInterval) {
    clearInterval(nightStepTimerInterval);
    nightStepTimerInterval = null;
  }
  const timerEl = document.getElementById('night-step-timer');
  if (timerEl) timerEl.classList.add('hidden');
}

/**
 * Show the voting phase.
 * Supports tie-breaker rounds with restricted votable targets.
 * @param {object} data - { alivePlayers, players, votableTargets, isTieBreaker, votingRound }
 */
function showVotingPhase(data) {
  const panel = document.getElementById('voting-panel');
  const targets = document.getElementById('voting-targets');
  const waiting = document.getElementById('voting-waiting');
  const summary = document.getElementById('vote-summary');
  const title = panel ? panel.querySelector('h3') : null;
  const instruction = panel ? panel.querySelector('.action-instruction') : null;

  panel.classList.remove('hidden');
  targets.classList.remove('hidden');
  waiting.classList.add('hidden');
  summary.classList.add('hidden');

  // Update heading for tie-breaker
  if (title) {
    title.textContent = data.isTieBreaker ? '🗳️ Tie-Breaker Vote' : '🗳️ Voting Phase';
  }
  if (instruction) {
    instruction.textContent = data.isTieBreaker
      ? 'Re-vote! Choose between the tied players.'
      : 'Vote for who you think is Mafia!';
  }

  // Determine which targets to show
  const voteTargets = data.votableTargets || data.alivePlayers ||
    (data.players ? data.players.filter(p => p.isAlive) : []);

  targets.innerHTML = voteTargets.map(p => {
    return '<button class="target-btn" data-target-id="' + p.id + '" onclick="selectVoteTarget(\'' + p.id + '\')">' +
      '<span class="target-name">' + escapeHtml(p.name) + '</span>' +
      '<span class="target-check">✓ Voted</span>' +
      '</button>';
  }).join('');

  if (targets.innerHTML === '') {
    targets.innerHTML = '<p class="action-instruction" style="grid-column: 1/-1; text-align:center; padding: 12px;">No one to vote for.</p>';
  }
}

/**
 * Select a vote target and auto-cast the vote.
 * @param {string} targetId
 */
function selectVoteTarget(targetId) {
  const targets = document.getElementById('voting-targets');
  const waiting = document.getElementById('voting-waiting');
  const summary = document.getElementById('vote-summary');

  // Mark selected button
  document.querySelectorAll('#voting-targets .target-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.targetId === targetId);
    if (btn.dataset.targetId === targetId) {
      btn.disabled = true;
    }
  });

  // Hide targets grid, show waiting indicator within voting panel
  targets.classList.add('hidden');
  if (waiting) {
    waiting.classList.remove('hidden');
    waiting.querySelector('p').textContent = 'Vote cast! Waiting for other players to vote...';
  }

  // Show the vote summary so the user can see live updates
  summary.classList.remove('hidden');

  castVote(targetId);
}

/**
 * Update the live vote summary.
 * @param {object} data
 */
function updateVoteSummary(data) {
  const summary = document.getElementById('vote-summary');
  const list = document.getElementById('vote-list');
  const waiting = document.getElementById('voting-waiting');
  if (!summary || !list) return;

  summary.classList.remove('hidden');

  if (!data.votes || data.votes.length === 0) {
    list.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No votes yet.</p>';
    return;
  }

  // Update the waiting message with progress
  if (waiting && !waiting.classList.contains('hidden')) {
    const castCount = data.votes.reduce((sum, v) => sum + v.votes, 0);
    const totalVoters = data.totalVoters || 0;
    const remaining = totalVoters - castCount;
    const msg = waiting.querySelector('p');
    if (msg) {
      msg.textContent = 'Vote cast! ' + castCount + '/' + totalVoters + ' voted. Waiting for ' + remaining + ' more...';
    }
  }

  const maxVotes = data.votes.length > 0 ? Math.max(...data.votes.map(v => v.votes)) : 0;

  list.innerHTML = data.votes.map(v => {
    return '<div class="vote-item slide-up' + (v.votes === maxVotes && maxVotes > 0 ? ' leading' : '') + '">' +
      '<span class="vote-name">' + escapeHtml(v.playerName) + '</span>' +
      '<span class="vote-count">' + v.votes + ' vote' + (v.votes !== 1 ? 's' : '') + '</span>' +
      '</div>';
  }).join('');
}

/**
 * Show the vote result.
 * @param {object} data
 */
function showVoteResult(data) {
  hideAllPanels();

  const announcement = document.getElementById('game-announcement');
  const text = document.getElementById('announcement-text');

  announcement.classList.remove('hidden');

  if (data.eliminated) {
    text.innerHTML = data.message + '<br><br>' +
      '<span style="font-size: 2rem;">' + data.eliminated.icon + '</span><br>' +
      '<strong>' + escapeHtml(data.eliminated.name) + '</strong> was <strong>' +
      escapeHtml(data.eliminated.role) + '</strong> (' +
      (data.eliminated.team === 'mafia' ? '🔪 Mafia' : '👤 Village') + ')';
  } else {
    text.innerHTML = data.message || 'No one was eliminated.';
  }

  if (data.players) {
    updatePlayerStatus(data.players);
  }

  // If there's a re-vote needed (tie), the 'phase:voting' event will
  // re-show the voting panel via showVotingPhase(). No extra work needed.
}

let _updatePlayerStatusRaf = null;

/**
 * Update the player status grid. Throttled to prevent layout thrashing.
 * @param {Array} players
 */
function updatePlayerStatus(players) {
  if (_updatePlayerStatusRaf) cancelAnimationFrame(_updatePlayerStatusRaf);
  
  _updatePlayerStatusRaf = requestAnimationFrame(() => {
    const grid = document.getElementById('player-status-grid');
    if (!grid || !players) return;

    grid.innerHTML = players.map(p => {
      const status = p.status || 'online';
      const isTyping = p.typing ? ' typing' : '';
      
      return '<div class="player-chip' + (p.isAlive ? '' : ' dead') + '" data-player-id="' + p.id + '">' +
        '<div class="chip-avatar player-avatar" style="background: ' + getAvatarColor(p.name) + '">' +
        getInitial(p.name) + 
        (p.isAlive ? '<div class="player-status-indicator ' + status + isTyping + '"></div>' : '') +
        '</div>' +
        '<div class="chip-name">' + escapeHtml(p.name) + '</div>' +
        (p.isAlive ? '<div class="chip-voice-controls"><span class="chip-mic-icon">🎤</span><input type="range" class="voice-volume-slider" min="0" max="1" step="0.05" value="1" oninput="handleVolumeChange(\'' + p.id + '\', this.value)" title="Volume"></div>' : '<div class="chip-icon">💀</div>') +
        '</div>';
    }).join('');
    
    _updatePlayerStatusRaf = null;
  });
}

/**
 * Handle action result from server.
 * @param {object} data
 */
function handleActionResult(data) {
  if (!data.success && data.message) {
    showError(data.message);
  }
}

/**
 * Show game over overlay.
 * @param {object} data - { winner: { team, message }, players }
 */
function showGameResult(data) {
  clearInterval(phaseTimerInterval);
  phaseTimerInterval = null;
  clearNightStepTimerDisplay();

  const overlay = document.getElementById('result-overlay');
  const icon = document.getElementById('result-icon');
  const title = document.getElementById('result-title');
  const message = document.getElementById('result-message');

  overlay.classList.remove('hidden');

  if (data.winner.team === 'mafia') {
    icon.textContent = '🔪';
    title.textContent = 'Mafia Wins!';
    if (window.audioManager) window.audioManager.play('mafiaWin');
  } else {
    icon.textContent = '🏆';
    title.textContent = 'Village Wins!';
    if (window.audioManager) window.audioManager.play('villagersWin');
  }

  message.textContent = data.winner.message;
}

/**
 * Back to lobby after game ends.
 */
function backToLobby() {
  window.location.reload();
}

// ── Keyboard Shortcuts ─────────────────────────────────

document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    // Send chat message if chat input is focused
    const chatInput = document.getElementById('chat-input');
    if (chatInput && document.activeElement === chatInput) {
      e.preventDefault();
      sendChatMessage();
    }
  }
});

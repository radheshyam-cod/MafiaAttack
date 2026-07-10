/**
 * Shadow Mafia — Utility Functions
 */

/**
 * Show an error message to the user.
 * @param {string} message
 */
function showError(message) {
  if (window.toastManager) {
    window.toastManager.error(message);
    return;
  }
  const el = document.getElementById('error-message');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

/**
 * Switch between tabs (create/join).
 * @param {string} tab
 */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('tab-create').classList.toggle('active', tab === 'create');
  document.getElementById('tab-join').classList.toggle('active', tab === 'join');
}

/**
 * Get the initial of a player name for the avatar.
 * @param {string} name
 * @returns {string}
 */
function getInitial(name) {
  return name ? name.charAt(0).toUpperCase() : '?';
}

/**
 * Generate a random color from a seed string.
 * @param {string} str
 * @returns {string}
 */
function getAvatarColor(str) {
  const colors = [
    '#6c63ff', '#ff4757', '#2ed573', '#ffa502',
    '#3742fa', '#ff6b81', '#7bed9f', '#eccc68',
    '#70a1ff', '#ff7f50', '#5352ed', '#a4b0be',
  ];
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Copy text to clipboard.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

/**
 * Format milliseconds into mm:ss.
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
  if (ms < 0) return '--:--';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Scroll an element to the bottom.
 * @param {HTMLElement} el
 */
function scrollToBottom(el) {
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

/**
 * Escape HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Build a player "portrait" chip used in both the lobby table and
 * the in-game world table.
 * @param {object} p - player { id, name, isAlive, status, typing }
 * @param {boolean} isLobby - show host badge + kick button
 * @param {boolean} isHost - is this player the host
 * @param {boolean} showKick - render a kick button (host only, not self)
 * @returns {string} HTML
 */
function buildPlayerChip(p, isLobby, isHost, showKick, isYou, inlineStyle = '') {
  const initial = getInitial(p.name);
  const color = getAvatarColor(p.name);
  const status = p.status || 'online';
  const isTyping = p.typing ? ' typing' : '';
  const alive = p.isAlive;

  const hostBadge = isHost ? '<span class="player-badge player-host">👑 HOST</span>' : '';
  const youBadge = (isYou && !isHost) ? '<span class="player-badge player-you">YOU</span>' : '';
  const roleBadge = p.roleName ? `<span class="player-badge player-role ${p.team === 'mafia' ? 'role-mafia' : 'role-village'}">${escapeHtml(p.roleName)}</span>` : '';

  const kick = (isLobby && showKick)
    ? '<button class="btn-kick" onclick="handleKickPlayer(\'' + p.id + '\')" title="Remove ' + escapeHtml(p.name) + '">✕</button>'
    : '';
  const voice = alive
    ? '<div class="chip-voice-controls"><span class="chip-mic-icon">🎤</span>' +
    '<input type="range" class="voice-volume-slider" min="0" max="1" step="0.05" value="1" ' +
    'oninput="handleVolumeChange(\'' + p.id + '\', this.value)" title="Volume"></div>'
    : '<div class="chip-icon ghost-icon">👻</div>';

  const avatarContent = alive ? initial + `<div class="player-status-indicator ${status}${isTyping}"></div>` : '👻';

  return '<li class="player-chip' + (alive ? '' : ' dead') + (isYou ? ' is-you' : '') + '" data-player-id="' + p.id + '"' + (inlineStyle ? ' style="' + inlineStyle + '"' : '') + '>' +
    '<div class="chip-avatar player-avatar" style="background:' + color + '">' + avatarContent + '</div>' +
    '<span class="player-name">' + escapeHtml(p.name) + '</span>' +
    '<div class="chip-badges">' + hostBadge + youBadge + roleBadge + '</div>' +
    voice + kick +
    '</li>';
}

/**
 * Render a grid of clickable portrait tiles for night actions / voting.
 * @param {Array} targets
 * @param {string} actionType - mafia_kill | detective_investigate | doctor_protect | vote
 * @param {string} verb - label shown on selection
 * @returns {string} HTML
 */
function renderTargetTiles(targets, actionType, verb) {
  const isMafiaKill = actionType === 'mafia_kill';
  return (targets || []).map(t => {
    const handler = actionType === 'vote' ? "selectVoteTarget('" : "selectNightTarget('";
    return '<button class="target-btn' + (isMafiaKill ? ' mafia-target' : '') + '" ' +
      'data-target-id="' + t.id + '" onclick="' + handler + t.id + '\')">' +
      '<div class="target-avatar" style="background:' + getAvatarColor(t.name) + '">' + getInitial(t.name) + '</div>' +
      '<span class="target-name">' + escapeHtml(t.name) + '</span>' +
      '<span class="target-check">' + (verb || '✓ Selected') + '</span>' +
      '</button>';
  }).join('');
}

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

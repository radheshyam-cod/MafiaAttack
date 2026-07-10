/**
 * Shadow Mafia — Main Entry Point
 *
 * Initializes the application when the DOM is ready: boots the
 * particle engine + scene manager, connects the socket, and sets up
 * the chat typing indicator.
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('🎭 Shadow Mafia — Initializing...');

  // Boot the cinematic layer
  if (window.ParticleEngine) ParticleEngine.init();
  if (window.SceneManager) SceneManager.init();

  // Initialize Socket.IO connection — all event handlers
  // are registered inside socket.js
  initSocket();

  // Unlock audio on the first user gesture (browser autoplay policy)
  const unlock = () => {
    if (window.audioManager) window.audioManager.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // Auto-focus the create name input after a short delay
  setTimeout(() => {
    const input = document.getElementById('create-name');
    if (input && document.activeElement !== input) input.focus();
  }, 300);

  // Setup typing indicator on chat input
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      sendTyping(true);
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => sendTyping(false), 2000);
    });
  }
});

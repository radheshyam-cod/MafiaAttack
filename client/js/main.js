/**
 * Shadow Mafia — Main Entry Point
 *
 * Initializes the application when the DOM is ready.
 */

/**
 * Initialize all core game components when the DOM is ready.
 * Handles the socket connection initialization, UI focus management,
 * and sets up the global debounced typing indicator for chat.
 * 
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎭 Shadow Mafia — Initializing...');

  // Initialize Socket.IO connection — all event handlers
  // are registered inside socket.js
  initSocket();

  // Auto-focus the create name input after a short delay
  setTimeout(() => {
    const input = document.getElementById('create-name');
    if (input) input.focus();
  }, 300);

  // Setup typing indicator on chat input
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    /**
     * Listen to the input event on chat to trigger the typing indicator.
     * `sendTyping(true)` is debounced within `socket.js` to prevent spam.
     * A timeout resets the typing status to false if the user stops typing for 2 seconds.
     */
    chatInput.addEventListener('input', () => {
      sendTyping(true);
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        sendTyping(false);
      }, 2000);
    });
  }
});

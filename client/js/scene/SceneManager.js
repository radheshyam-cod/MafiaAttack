/**
 * Shadow Mafia — Scene Manager
 *
 * Single source of truth for which "world" is currently on screen.
 * Drives the body theme class, the particle engine scene, and the
 * cinematic phase-banner transition. Pure presentation — no game logic.
 */
window.SceneManager = {
  current: 'lobby',

  init() {
    this.go('lobby');
    this._syncSoundButton();
  },

  /**
   * Transition the whole UI into a named scene/world.
   * @param {string} scene - lobby | night | morning | day | voting | ended
   */
  go(scene) {
    document.body.className = 'theme-' + scene;
    const pScene = scene === 'ended' ? 'results' : scene;
    if (window.ParticleEngine) ParticleEngine.setScene(pScene);
    if (window.audioManager) {
      if (scene === 'lobby') window.audioManager.startAmbient();
      else window.audioManager.stopAmbient();
    }
    this.current = scene;
  },

  /** Re-trigger the phase banner entrance animation. */
  swapBanner() {
    const banner = document.getElementById('phase-banner');
    if (!banner) return;
    banner.classList.remove('banner-swap');
    void banner.offsetWidth; // force reflow so the animation replays
    banner.classList.add('banner-swap');
  },

  /** Particle burst at a point (used for eliminations / wins). */
  burst(x, y, count = 36, colors) {
    if (window.ParticleEngine) ParticleEngine.burst(x, y, count, colors);
  },

  _syncSoundButton() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    const on = !window.audioManager || window.audioManager.enabled;
    btn.classList.toggle('muted', !on);
    const icon = btn.querySelector('.sound-icon');
    if (icon) icon.textContent = on ? '🔊' : '🔇';
  },
};

/** Global sound toggle (wired from the floating button). */
window.toggleSound = function () {
  const enabled = window.audioManager ? window.audioManager.toggle() : true;
  const btn = document.getElementById('sound-toggle');
  if (btn) {
    btn.classList.toggle('muted', !enabled);
    const icon = btn.querySelector('.sound-icon');
    if (icon) icon.textContent = enabled ? '🔊' : '🔇';
  }
  if (enabled && window.audioManager) window.audioManager.unlock();
};

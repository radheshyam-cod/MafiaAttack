/**
 * Shadow Mafia — Cinematic Narrator Engine
 * Uses window.speechSynthesis to read out phases and dramatic moments.
 */
class NarratorEngine {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.enabled = true;
    
    // Attempt to load voices asynchronously
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this.selectVoice();
    }
    // Also try immediately in case they are already loaded
    this.selectVoice();
  }

  selectVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (voices.length === 0) return;
    
    // Look for a deep, dramatic English voice (e.g., Google UK English Male, Daniel, or similar)
    this.voice = voices.find(v => 
      v.name.includes('Google UK English Male') || 
      v.name.includes('Daniel') ||
      v.name.includes('Oliver')
    ) || voices.find(v => v.lang.startsWith('en-GB')) || voices[0];
  }

  /**
   * Speak a phrase, returning a promise that resolves when speech finishes.
   * @param {string} text 
   * @returns {Promise<void>}
   */
  speak(text) {
    // Check if audio is globally muted (re-using audioManager logic if possible)
    if (window.audioManager && !window.audioManager.enabled) return Promise.resolve();
    if (!this.enabled || !this.synth) return Promise.resolve();
    
    if (this.synth.speaking) {
      this.synth.cancel(); // Stop current speech
    }
    
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      if (this.voice) utterance.voice = this.voice;
      
      utterance.pitch = 0.6; // Deeper voice
      utterance.rate = 0.85; // Slow, dramatic pacing
      utterance.volume = 1.0;
      
      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        console.warn('Narrator error:', e);
        resolve();
      };
      
      this.synth.speak(utterance);
      
      // Fallback timeout in case speech synthesis gets stuck (common browser bug)
      setTimeout(() => {
        if (this.synth.speaking) this.synth.cancel();
        resolve();
      }, text.length * 150 + 2000); 
    });
  }

  stop() {
    if (this.synth) this.synth.cancel();
  }
}

window.narrator = new NarratorEngine();

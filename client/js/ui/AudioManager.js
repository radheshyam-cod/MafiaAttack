class AudioManager {
  constructor() {
    this.sounds = {
      night: new Audio('/assets/sounds/night.mp3'),
      morning: new Audio('/assets/sounds/morning.mp3'),
      voting: new Audio('/assets/sounds/voting.mp3'),
      villagersWin: new Audio('/assets/sounds/villagers-win.mp3'),
      mafiaWin: new Audio('/assets/sounds/mafia-win.mp3'),
      chat: this.createSyntheticBeep(600, 'sine', 0.1),
      join: this.createSyntheticBeep(400, 'triangle', 0.1),
      leave: this.createSyntheticBeep(300, 'triangle', 0.1)
    };

    // Preload and adjust volumes
    Object.values(this.sounds).forEach(audio => {
      if (audio instanceof Audio) {
        audio.volume = 0.5;
        audio.preload = 'auto';
      }
    });

    this.currentMusic = null;
    this.enabled = true;
    this.fadeIntervals = [];
  }

  createSyntheticBeep(freq, type, duration) {
    // Basic synthetic sound for UI interactions
    return {
      play: () => {
        if (!this.enabled || !window.AudioContext) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      }
    };
  }

  play(soundName, loop = false) {
    if (!this.enabled || !this.sounds[soundName]) return;
    
    const sound = this.sounds[soundName];
    
    // If it's a background music track
    if (['night', 'morning', 'voting'].includes(soundName)) {
      this.crossfadeTo(sound, loop);
    } else {
      // One-shot sound
      if (sound instanceof Audio) {
        sound.currentTime = 0;
        sound.play().catch(e => console.log("Audio play blocked by browser:", e));
      } else if (sound.play) {
        sound.play(); // Synthetic sound
      }
    }
  }

  crossfadeTo(newMusic, loop) {
    if (this.currentMusic === newMusic) return;

    // Clear any existing fades
    this.fadeIntervals.forEach(clearInterval);
    this.fadeIntervals = [];

    const fadeDuration = 1500;
    const steps = 30;
    const stepTime = fadeDuration / steps;

    if (this.currentMusic && this.currentMusic instanceof Audio) {
      const oldMusic = this.currentMusic;
      let vol = oldMusic.volume;
      const stepVol = vol / steps;
      const fadeOut = setInterval(() => {
        vol = Math.max(0, vol - stepVol);
        if (vol > 0) {
          oldMusic.volume = vol;
        } else {
          clearInterval(fadeOut);
          oldMusic.pause();
          oldMusic.currentTime = 0;
        }
      }, stepTime);
      this.fadeIntervals.push(fadeOut);
    }

    if (newMusic instanceof Audio) {
      this.currentMusic = newMusic;
      newMusic.loop = loop;
      newMusic.volume = 0;
      newMusic.currentTime = 0;
      newMusic.play().catch(e => console.log("Audio play blocked by browser:", e));

      let vol = 0;
      const targetVol = 0.5;
      const stepVol = targetVol / steps;
      const fadeIn = setInterval(() => {
        vol = Math.min(targetVol, vol + stepVol);
        if (vol < targetVol) {
          newMusic.volume = vol;
        } else {
          clearInterval(fadeIn);
        }
      }, stepTime);
      this.fadeIntervals.push(fadeIn);
    }
  }

  stopMusic() {
    this.fadeIntervals.forEach(clearInterval);
    this.fadeIntervals = [];

    if (this.currentMusic && this.currentMusic instanceof Audio) {
      const music = this.currentMusic;
      let vol = music.volume;
      const fadeOut = setInterval(() => {
        vol = Math.max(0, vol - 0.05);
        if (vol > 0) {
          music.volume = vol;
        } else {
          clearInterval(fadeOut);
          music.pause();
          music.currentTime = 0;
        }
      }, 50);
      this.fadeIntervals.push(fadeOut);
      this.currentMusic = null;
    }
  }

  triggerHeartbeat() {
    if (!this.enabled || !window.AudioContext) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  stopAll() {
    this.stopMusic();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.stopAll();
    }
    return this.enabled;
  }
}

const audioManager = new AudioManager();
window.audioManager = audioManager;

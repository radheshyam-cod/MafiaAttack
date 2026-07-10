/**
 * Shadow Mafia — Audio Manager
 *
 * Handles ambient music crossfades per phase and a library of
 * synthetic UI/ambience cues generated with the Web Audio API.
 * Public API (kept stable): play, stopMusic, stopAll, toggle,
 * createSyntheticBeep.
 */
class AudioManager {
  constructor() {
    this.enabled = this._loadPref();

    this.sounds = {
      night: new Audio('/assets/sounds/night.mp3'),
      morning: new Audio('/assets/sounds/morning.mp3'),
      voting: new Audio('/assets/sounds/voting.mp3'),
      villagersWin: new Audio('/assets/sounds/villagers-win.mp3'),
      mafiaWin: new Audio('/assets/sounds/mafia-win.mp3'),
    };

    Object.values(this.sounds).forEach((audio) => {
      if (audio instanceof Audio) {
        audio.volume = 0.5;
        audio.preload = 'auto';
      }
    });

    this.currentMusic = null;
    this.fadeIntervals = [];
    this.ctx = null;
    this.master = null;
    this.ambient = null;
  }

  _loadPref() {
    try {
      const v = localStorage.getItem('shadowMafiaSound');
      return v === null ? true : v !== 'off';
    } catch {
      return true;
    }
  }

  _savePref() {
    try { localStorage.setItem('shadowMafiaSound', this.enabled ? 'on' : 'off'); } catch {}
  }

  /** Lazily create / resume a single shared AudioContext. */
  ensureCtx() {
    if (!window.AudioContext && !window.webkitAudioContext) return null;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0.0001;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Resume audio after a user gesture (autoplay policy). */
  unlock() {
    this.ensureCtx();
  }

  /** Soft evolving village drone for the lobby (background ambience). */
  startAmbient() {
    if (!this.enabled || this.ambient) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.gain.exponentialRampToValueAtTime(0.05, now + 2.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.connect(master);
    master.connect(this.master || ctx.destination);

    const freqs = [110, 164.81, 220];
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5 / freqs.length;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 1.6;
      lfo.connect(lfoG);
      lfoG.connect(o.frequency);
      o.connect(g);
      g.connect(filter);
      o.start();
      lfo.start();
      return [o, lfo];
    });
    this.ambient = { master, oscs };
  }

  /** Fade out and stop the ambient drone. */
  stopAmbient() {
    if (!this.ambient || !this.ctx) { this.ambient = null; return; }
    const now = this.ctx.currentTime;
    const { master, oscs } = this.ambient;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    const toStop = oscs;
    setTimeout(() => {
      toStop.forEach(([o, l]) => { try { o.stop(); l.stop(); } catch (e) {} });
    }, 1400);
    this.ambient = null;
  }

  createSyntheticBeep(freq, type, duration) {
    return {
      play: () => this._tone({ freq, type, duration, gain: 0.1 }),
    };
  }

  _tone({ freq, type = 'sine', duration = 0.15, gain = 0.12, slideTo = null, delay = 0 }) {
    const ctx = this.ensureCtx();
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(this.master || ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  _noiseSwell(duration = 0.5, gain = 0.12) {
    const ctx = this.ensureCtx();
    if (!ctx || !this.enabled) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + duration);
    src.connect(filter); filter.connect(g); g.connect(this.master || ctx.destination);
    src.start();
  }

  /** Single "lub-dub" heartbeat (used by voting urgency + reveals). */
  triggerHeartbeat() {
    if (!this.enabled) return;
    this._tone({ freq: 60, type: 'sine', duration: 0.18, gain: 0.22 });
    this._tone({ freq: 48, type: 'sine', duration: 0.2, gain: 0.18, delay: 0.2 });
  }

  /** Looping heartbeat for the Mafia role reveal. */
  startRevealHeartbeat(loops = 5) {
    this.stopRevealHeartbeat();
    if (!this.enabled) return;
    let i = 0;
    const tick = () => {
      this._tone({ freq: 62, type: 'sine', duration: 0.2, gain: 0.24 });
      this._tone({ freq: 50, type: 'sine', duration: 0.22, gain: 0.18, delay: 0.22 });
      i++;
      if (i < loops) this._heartbeatTimer = setTimeout(tick, 1150);
    };
    tick();
  }

  stopRevealHeartbeat() {
    if (this._heartbeatTimer) { clearTimeout(this._heartbeatTimer); this._heartbeatTimer = null; }
  }

  /** Per-role ambience cue that opens the cinematic reveal. */
  playRevealCue(kind) {
    if (!this.enabled) return;
    switch (kind) {
      case 'mafia':
        this._tone({ freq: 72, type: 'sawtooth', duration: 1.6, gain: 0.12, slideTo: 38 });
        break;
      case 'doctor':
        [330, 440, 587, 740].forEach((f, i) => this._tone({ freq: f, type: 'sine', duration: 0.5, gain: 0.07, delay: i * 0.12 }));
        break;
      case 'detective':
        [523, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'triangle', duration: 0.4, gain: 0.08, delay: i * 0.16 }));
        break;
      default:
        [392, 494, 587].forEach((f, i) => this._tone({ freq: f, type: 'sine', duration: 0.5, gain: 0.07, delay: i * 0.1 }));
    }
  }

  /** Looping buffer of white noise (for wind). */
  _noiseSource(ctx, seconds = 2) {
    const frames = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  /** Start the synthesized night bed: low drone, wind, crickets. */
  startNightAmbient() {
    if (!this.enabled) return;
    this.stopNightAmbient();
    const ctx = this.ensureCtx();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 3);
    master.connect(this.master || ctx.destination);
    this.nightMaster = master;
    this.nightNodes = [];

    // Low drone
    [55, 82.5, 110].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.16 / (i + 1);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + i * 0.03;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.05;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      o.connect(g); g.connect(master);
      o.start(); lfo.start();
      this.nightNodes.push(o, lfo);
    });

    // Wind — filtered noise with a slow swell
    const wind = this._noiseSource(ctx, 4);
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 520; wf.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0.14;
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.08;
    const wlfoG = ctx.createGain(); wlfoG.gain.value = 0.1;
    wlfo.connect(wlfoG); wlfoG.connect(wg.gain);
    wind.connect(wf); wf.connect(wg); wg.connect(master);
    wind.start(); wlfo.start();
    this.nightNodes.push(wind, wlfo);

    // Crickets — rhythmic high chirps
    const chirp = () => {
      if (!this.nightMaster) return;
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        this._tone({ freq: 4200 + Math.random() * 400, type: 'sine', duration: 0.05, gain: 0.035, delay: i * 0.07 });
      }
      this.cricketTimer = setTimeout(chirp, 600 + Math.random() * 500);
    };
    this.cricketTimer = setTimeout(chirp, 1200);
  }

  /** Stop the night bed (drone, wind, crickets). */
  stopNightAmbient() {
    if (this.cricketTimer) { clearTimeout(this.cricketTimer); this.cricketTimer = null; }
    if (this.owlTimer) { clearTimeout(this.owlTimer); this.owlTimer = null; }
    if (this.wolfTimer) { clearTimeout(this.wolfTimer); this.wolfTimer = null; }
    if (this.nightMaster && this.ctx) {
      const now = this.ctx.currentTime;
      const m = this.nightMaster; const nodes = this.nightNodes || [];
      m.gain.cancelScheduledValues(now);
      m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), now);
      m.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      setTimeout(() => {
        nodes.forEach(n => { try { n.stop(); } catch (e) {} });
        try { m.disconnect(); } catch (e) {}
      }, 1400);
    }
    this.nightNodes = [];
    this.nightMaster = null;
  }

  /** Owl hoot — two descending notes. */
  playOwl() {
    if (!this.enabled) return;
    this._tone({ freq: 380, type: 'sine', duration: 0.5, gain: 0.09, slideTo: 300, delay: 0 });
    this._tone({ freq: 360, type: 'sine', duration: 0.5, gain: 0.08, slideTo: 300, delay: 0.75 });
  }

  /** Wolf howl — rises then falls. */
  playWolf() {
    if (!this.enabled) return;
    this._tone({ freq: 280, type: 'sawtooth', duration: 0.9, gain: 0.07, slideTo: 520, delay: 0 });
    this._tone({ freq: 520, type: 'sine', duration: 1.1, gain: 0.05, slideTo: 220, delay: 0.85 });
  }

  /** Synthetic cue library used for transitions / UI feedback. */
  _synth(name) {
    switch (name) {
      case 'chat': this._tone({ freq: 620, type: 'sine', duration: 0.1, gain: 0.07 }); break;
      case 'join': this._tone({ freq: 440, type: 'triangle', duration: 0.12, gain: 0.1 }); this._tone({ freq: 660, type: 'triangle', duration: 0.14, gain: 0.09, delay: 0.09 }); break;
      case 'leave': this._tone({ freq: 420, type: 'triangle', duration: 0.14, gain: 0.1, slideTo: 240 }); break;
      case 'click': this._tone({ freq: 520, type: 'square', duration: 0.06, gain: 0.05 }); break;
      case 'phase_transition':
        this._tone({ freq: 330, type: 'sine', duration: 0.5, gain: 0.1 });
        this._tone({ freq: 495, type: 'sine', duration: 0.6, gain: 0.08, delay: 0.05 });
        this._tone({ freq: 660, type: 'sine', duration: 0.7, gain: 0.06, delay: 0.1 });
        break;
      case 'death':
        this._tone({ freq: 200, type: 'sawtooth', duration: 0.6, gain: 0.14, slideTo: 50 });
        this._noiseSwell(0.55, 0.12);
        break;
      case 'vote':
        this._tone({ freq: 300, type: 'square', duration: 0.12, gain: 0.08, slideTo: 180 });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'triangle', duration: 0.4, gain: 0.1, delay: i * 0.13 }));
        break;
      case 'lose':
        [440, 370, 294, 220].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', duration: 0.45, gain: 0.09, delay: i * 0.16 }));
        break;
      default: break;
    }
  }

  play(soundName, loop = false) {
    if (!this.enabled) return;

    if (this.sounds[soundName]) {
      const sound = this.sounds[soundName];
      if (['night', 'morning', 'voting'].includes(soundName)) {
        this.crossfadeTo(sound, loop);
      } else {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      }
      return;
    }

    this._synth(soundName);
  }

  crossfadeTo(newMusic, loop) {
    if (this.currentMusic === newMusic) return;
    this.fadeIntervals.forEach(clearInterval);
    this.fadeIntervals = [];

    const fadeDuration = 1400;
    const steps = 28;
    const stepTime = fadeDuration / steps;

    if (this.currentMusic && this.currentMusic instanceof Audio) {
      const old = this.currentMusic;
      let vol = old.volume;
      const stepVol = vol / steps;
      const out = setInterval(() => {
        vol = Math.max(0, vol - stepVol);
        if (vol > 0) old.volume = vol;
        else { clearInterval(out); old.pause(); old.currentTime = 0; }
      }, stepTime);
      this.fadeIntervals.push(out);
    }

    if (newMusic instanceof Audio) {
      this.currentMusic = newMusic;
      newMusic.loop = loop;
      newMusic.volume = 0;
      newMusic.currentTime = 0;
      newMusic.play().catch(() => {});
      let vol = 0;
      const target = 0.5;
      const stepVol = target / steps;
      const inn = setInterval(() => {
        vol = Math.min(target, vol + stepVol);
        if (vol < target) newMusic.volume = vol;
        else clearInterval(inn);
      }, stepTime);
      this.fadeIntervals.push(inn);
    }
  }

  stopMusic() {
    this.fadeIntervals.forEach(clearInterval);
    this.fadeIntervals = [];
    if (this.currentMusic && this.currentMusic instanceof Audio) {
      const m = this.currentMusic;
      let vol = m.volume;
      const out = setInterval(() => {
        vol = Math.max(0, vol - 0.05);
        if (vol > 0) m.volume = vol;
        else { clearInterval(out); m.pause(); m.currentTime = 0; }
      }, 50);
      this.fadeIntervals.push(out);
      this.currentMusic = null;
    }
  }

  stopAll() { this.stopMusic(); }

  toggle() {
    this.enabled = !this.enabled;
    this._savePref();
    if (!this.enabled) { this.stopAll(); this.stopAmbient(); }
    else this.ensureCtx();
    return this.enabled;
  }

  setEnabled(on) {
    this.enabled = on;
    this._savePref();
    if (!on) { this.stopAll(); this.stopAmbient(); }
    else this.ensureCtx();
    return this.enabled;
  }
}

const audioManager = new AudioManager();
window.audioManager = audioManager;

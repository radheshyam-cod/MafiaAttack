/**
 * Shadow Mafia — Particle Engine
 *
 * Lightweight canvas-based particle system for cinematic ambience.
 * Each game "scene" gets its own drifting particles. Performance-minded:
 * capped ambient count, DPR-aware canvas, honours prefers-reduced-motion.
 */
const ParticleEngine = {
  canvas: null,
  ctx: null,
  particles: [],
  animationId: null,
  running: false,
  currentScene: null,
  mouseX: 0,
  mouseY: 0,
  w: window.innerWidth,
  h: window.innerHeight,
  reduceMotion: false,

  init() {
    this.canvas = document.getElementById('particle-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    this.setScene('lobby');
    this.start();
  },

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  start() {
    if (this.running) return;
    this.running = true;
    this.animate();
  },

  stop() {
    this.running = false;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.animationId = null;
    this.particles = [];
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.w, this.h);
  },

  setScene(scene) {
    this.currentScene = scene;
    this.particles = [];
    this.spawnForScene(scene);
  },

  ambientCount() {
    if (this.reduceMotion) return 12;
    return this.currentScene === 'results' ? 0 : 54;
  },

  spawnForScene(scene) {
    const count = this.ambientCount();
    for (let i = 0; i < count; i++) this.particles.push(this.createParticle(scene, true));
  },

  createParticle(scene, randomY = false) {
    const w = this.w, h = this.h;
    const p = {
      x: Math.random() * w,
      y: randomY ? Math.random() * h : h + 10,
      size: 0, speedX: 0, speedY: 0,
      opacity: 0, life: 0, maxLife: 0, color: '255,255,255',
    };

    switch (scene) {
      case 'lobby':
        if (Math.random() < 0.22) {
          // Wind streak — faint horizontal drift
          p.wind = true;
          p.size = Math.random() * 1.1 + 0.5;
          p.speedX = -(Math.random() * 1.4 + 0.7);
          p.speedY = (Math.random() - 0.5) * 0.12;
          p.opacity = Math.random() * 0.16 + 0.05;
          p.maxLife = Infinity; p.life = Infinity; p.color = '180,200,255';
          p.len = Math.random() * 26 + 16;
        } else {
          // Firefly — warm, slow, wandering glow
          p.size = Math.random() * 2.2 + 1;
          p.speedY = Math.random() * -0.25 - 0.04;
          p.speedX = (Math.random() - 0.5) * 0.3;
          p.opacity = Math.random() * 0.5 + 0.2;
          p.maxLife = Infinity; p.life = Infinity; p.color = '255,200,90';
          p.sway = Math.random() * 0.6 + 0.25;
          p.phase = Math.random() * Math.PI * 2;
        }
        break;
      case 'night':
        p.size = Math.random() * 2 + 0.5; p.speedY = Math.random() * -0.2 - 0.05;
        p.speedX = (Math.random() - 0.5) * 0.3; p.opacity = Math.random() * 0.3 + 0.05;
        p.maxLife = Infinity; p.life = Infinity; p.color = '150,160,230'; break;
      case 'morning':
        p.size = Math.random() * 4 + 2; p.speedY = Math.random() * -0.5 - 0.2;
        p.speedX = (Math.random() - 0.5) * 0.6; p.opacity = Math.random() * 0.6 + 0.2;
        p.maxLife = Infinity; p.life = Infinity; p.color = '255,205,130'; break;
      case 'day':
        p.size = Math.random() * 2.5 + 0.5; p.speedY = Math.random() * -0.15 - 0.05;
        p.speedX = (Math.random() - 0.5) * 0.2; p.opacity = Math.random() * 0.25 + 0.05;
        p.maxLife = Infinity; p.life = Infinity; p.color = '210,225,255'; break;
      case 'voting':
        p.size = Math.random() * 3 + 1; p.speedY = Math.random() * -0.6 - 0.3;
        p.speedX = (Math.random() - 0.5) * 1.2; p.opacity = Math.random() * 0.5 + 0.2;
        p.maxLife = Infinity; p.life = Infinity; p.color = '255,80,100'; break;
      case 'results':
        p.size = Math.random() * 6 + 3; p.speedY = Math.random() * 3 + 2;
        p.speedX = (Math.random() - 0.5) * 4; p.opacity = Math.random() * 0.8 + 0.2;
        p.y = -20; p.maxLife = 200 + Math.random() * 100; p.life = p.maxLife;
        p.rotation = Math.random() * 360; p.rotationSpeed = (Math.random() - 0.5) * 10;
        const cols = ['255,215,0', '220,20,60', '147,112,219', '50,205,50', '255,140,0'];
        p.color = cols[Math.floor(Math.random() * cols.length)]; break;
      default:
        p.size = Math.random() * 2 + 1; p.speedY = Math.random() * -0.3 - 0.1;
        p.speedX = (Math.random() - 0.5) * 0.4; p.opacity = Math.random() * 0.4 + 0.1;
        p.maxLife = Infinity; p.life = Infinity; p.color = '200,200,255';
    }
    return p;
  },

  animate() {
    if (!this.running || !this.ctx) return;
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const scene = this.currentScene || 'lobby';
    const t = Date.now() * 0.001;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      if (p.life !== Infinity) {
        p.life--;
        p.opacity = (p.life / p.maxLife) * 0.85;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      }

      if (scene === 'results') {
        p.y += p.speedY; p.x += p.speedX; p.rotation += p.rotationSpeed || 0; p.speedY += 0.05;
        if (p.y > h + 20) { this.particles.splice(i, 1); continue; }
      } else if (p.wind) {
        p.x += p.speedX; p.y += p.speedY;
        if (p.x < -p.len - 10) { p.x = w + p.len + 10; p.y = Math.random() * h; }
      } else {
        p.y += p.speedY;
        const sway = p.sway != null ? p.sway : 0.1;
        const ph = p.phase != null ? p.phase : i;
        p.x += p.speedX + Math.sin(t + ph) * sway;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
      }

      if (p.wind) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len, p.y);
        ctx.strokeStyle = 'rgba(' + p.color + ',' + p.opacity + ')';
        ctx.lineWidth = p.size;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.color + ',' + p.opacity + ')';
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    while (this.particles.length < this.ambientCount()) this.particles.push(this.createParticle(scene, true));

    this.animationId = requestAnimationFrame(() => this.animate());
  },

  burst(x, y, count = 36, colors) {
    if (this.reduceMotion) count = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x || this.w / 2, y: y || this.h / 2,
        size: Math.random() * 5 + 2,
        speedX: (Math.random() - 0.5) * 8,
        speedY: (Math.random() - 0.5) * 8,
        opacity: 1, life: 60 + Math.random() * 40, maxLife: 100,
        rotation: Math.random() * 360, rotationSpeed: (Math.random() - 0.5) * 15,
        color: colors ? colors[Math.floor(Math.random() * colors.length)] : '255,255,255',
      });
    }
  },
};

window.ParticleEngine = ParticleEngine;

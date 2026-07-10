/**
 * Shadow Mafia — Game UI
 *
 * Renders all in-game scenes: phase transitions, night actions,
 * chat, voting, player "table", timers and overlays. Every public
 * function name and DOM id is preserved so socket.js keeps working.
 */

let phaseTimerInterval = null;
let nightStepTimerInterval = null;

const PHASE_WORLD = {
  night: 'The Shadows',
  morning: 'The Dawn',
  day: 'The Town Square',
  voting: 'The Trial',
  ended: 'The Verdict',
};

/* ── Screen / scene boot ─────────────────────────────────── */

function showGameScreen(state) {
  document.getElementById('lobby-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  document.getElementById('join-section').classList.remove('hidden');
  document.getElementById('lobby-info').classList.add('hidden');
  document.getElementById('result-overlay').classList.add('hidden');
  document.getElementById('role-overlay').classList.add('hidden');
  if (window.audioManager) window.audioManager.stopNightAmbient();

  document.getElementById('game-room-code').textContent = state.roomCode || roomCode;
  if (window.SceneManager) SceneManager.go('night');
  updatePlayerStatus(state.players);
}

/* ── Cinematic transition ─────────────────────────────────── */

function triggerCinematic(title, subtitle, isBlood = false, duration = 3000) {
  const overlay = document.getElementById('cinematic-overlay');
  const titleEl = document.getElementById('cinematic-title');
  const subtitleEl = document.getElementById('cinematic-subtitle');
  const emblemEl = document.getElementById('cinematic-emblem');
  if (!overlay) return;

  titleEl.textContent = title;
  subtitleEl.textContent = subtitle || '';

  let emblem = '🌙';
  if (title.indexOf('Night') >= 0) emblem = '🌙';
  else if (title.indexOf('Discussion') >= 0) emblem = '☀️';
  else if (title.indexOf('Voting') >= 0) emblem = '🗳️';
  else if (title.indexOf('Sun') >= 0) emblem = '🌅';
  if (isBlood) emblem = '🩸';
  if (emblemEl) emblemEl.textContent = emblem;

  if (isBlood) titleEl.classList.add('blood');
  else titleEl.classList.remove('blood');

  overlay.classList.remove('hidden');

  if (window.audioManager) {
    if (isBlood) window.audioManager.play('death');
    else window.audioManager.play('phase_transition');
  }

  if (overlay._hideTimer) clearTimeout(overlay._hideTimer);
  overlay._hideTimer = setTimeout(() => overlay.classList.add('hidden'), duration);
}

/* ── Night cinematic — "Night Falls" ───────────────────── */

const NIGHT_NARRATOR = ['Night has fallen.', 'Everyone close your eyes.'];

function buildNightScene() {
  const reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stars = document.getElementById('nc-stars');
  if (stars) {
    stars.innerHTML = '';
    const n = reduce ? 40 : 110;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'nc-star';
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 62).toFixed(2) + '%';
      const sz = (Math.random() * 1.6 + 1).toFixed(1);
      s.style.width = sz + 'px'; s.style.height = sz + 'px';
      s.style.animationDelay = (Math.random() * 1.6).toFixed(2) + 's, ' + (1.6 + Math.random() * 2).toFixed(2) + 's';
      stars.appendChild(s);
    }
  }

  const ff = document.getElementById('nc-fireflies');
  if (ff) {
    ff.innerHTML = '';
    const m = reduce ? 8 : 18;
    for (let i = 0; i < m; i++) {
      const f = document.createElement('span');
      f.className = 'nc-firefly';
      f.style.left = (Math.random() * 100).toFixed(2) + '%';
      f.style.top = (40 + Math.random() * 55).toFixed(2) + '%';
      f.style.setProperty('--sz', (Math.random() * 4 + 3).toFixed(1) + 'px');
      f.style.setProperty('--dx', (Math.random() * 80 - 40).toFixed(0) + 'px');
      f.style.setProperty('--dy', (-Math.random() * 80 - 20).toFixed(0) + 'px');
      f.style.setProperty('--dur', (Math.random() * 6 + 7).toFixed(1) + 's');
      f.style.animationDelay = (Math.random() * 6).toFixed(2) + 's';
      ff.appendChild(f);
    }
  }

  const wind = document.getElementById('nc-wind');
  if (wind) {
    wind.innerHTML = '';
    const w = reduce ? 4 : 9;
    for (let i = 0; i < w; i++) {
      const s = document.createElement('span');
      s.className = 'nc-wind-streak';
      s.style.top = (Math.random() * 90).toFixed(2) + '%';
      s.style.setProperty('--wdur', (Math.random() * 3 + 3).toFixed(1) + 's');
      s.style.animationDelay = (Math.random() * 6).toFixed(2) + 's';
      wind.appendChild(s);
    }
  }
}

function showNightCinematic(data) {
  const overlay = document.getElementById('night-cinematic');
  if (!overlay) return;

  // Don't stack two full-screen cinematics: wait until the role reveal
  // (if still showing) has been dismissed by the player.
  const roleOverlay = document.getElementById('role-overlay');
  if (roleOverlay && !roleOverlay.classList.contains('hidden')) {
    overlay._waitRole = setTimeout(() => showNightCinematic(data), 250);
    return;
  }
  if (overlay._waitRole) { clearTimeout(overlay._waitRole); overlay._waitRole = null; }

  buildNightScene();

  overlay.classList.remove('hidden', 'nc-out');
  overlay.setAttribute('aria-hidden', 'false');
  void overlay.offsetWidth;
  overlay.classList.add('nc-active');

  document.body.classList.add('cinematic-lock');

  // Server already mutes everyone at night; reinforce locally for the transition.
  if (window.voiceManager && window.voiceManager.setMutedInternal) {
    window.voiceManager.setMutedInternal(true);
  }

  if (window.audioManager) {
    window.audioManager.startNightAmbient();
    if (window.audioManager.playOwl) overlay._nTimers = overlay._nTimers || [];
    if (window.audioManager.playOwl) setTimeout(() => window.audioManager.playOwl(), 4200);
    if (window.audioManager.playWolf) setTimeout(() => window.audioManager.playWolf(), 7200);
  }

  const l1 = document.getElementById('nc-line-1');
  const l2 = document.getElementById('nc-line-2');
  const hint = document.getElementById('nc-watch-hint');
  if (l1) l1.textContent = NIGHT_NARRATOR[0];
  if (l2) l2.textContent = NIGHT_NARRATOR[1];

  if (overlay._nTimers) overlay._nTimers.forEach(clearTimeout);
  overlay._nTimers = [];
  overlay._nTimers.push(setTimeout(() => { if (l1) l1.classList.add('show'); speakNarrator(NIGHT_NARRATOR[0]); }, 2600));
  overlay._nTimers.push(setTimeout(() => { if (l2) l2.classList.add('show'); speakNarrator(NIGHT_NARRATOR[1]); }, 5200));
  overlay._nTimers.push(setTimeout(() => { if (hint) hint.classList.add('show'); }, 6200));

  // Watch-only window; role turns begin as this ends (server matches this delay).
  const DURATION = 9000;
  overlay._nTimers.push(setTimeout(() => closeNightCinematic(), DURATION));
}

function closeNightCinematic() {
  const overlay = document.getElementById('night-cinematic');
  if (!overlay) return;
  if (overlay._nTimers) { overlay._nTimers.forEach(clearTimeout); overlay._nTimers = null; }

  overlay.classList.remove('nc-active');
  overlay.classList.add('nc-out');
  document.body.classList.remove('cinematic-lock');

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('nc-out');
    ['nc-stars', 'nc-fireflies', 'nc-wind'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    ['nc-line-1', 'nc-line-2', 'nc-watch-hint'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('show');
    });
  }, 1000);
}

/* ── Role reveal (cinematic scene) ───────────────────────── */

const ROLE_NARRATORS = {
  mafia: 'In the crimson dark, a pact is sealed. You are Mafia — strike while the town sleeps.',
  doctor: 'A sacred light bends to your will. You are the Doctor — heal the innocent, and keep hope alive.',
  detective: 'Truth hides in plain sight. You are the Detective — unmask the deception.',
  villager: 'You are one of the townsfolk. Trust your instincts, and root out the liars among you.',
};

const ROLE_PARTICLE_COLORS = {
  mafia: ['255,59,92', '180,20,30', '255,120,140'],
  doctor: ['120,200,255', '80,140,255', '200,240,255'],
  detective: ['255,215,120', '245,197,66', '255,240,200'],
  villager: ['255,200,120', '255,170,90', '255,230,170'],
};

function roleRevealKey(data) {
  const n = ((data.role && data.role.name) || '').toLowerCase();
  if (n.indexOf('mafia') >= 0) return 'mafia';
  if (n.indexOf('doctor') >= 0) return 'doctor';
  if (n.indexOf('detective') >= 0) return 'detective';
  return 'villager';
}

function spawnRoleParticles(kind, count) {
  const layer = document.getElementById('rc-particles');
  if (!layer) return;
  layer.innerHTML = '';
  const colors = ROLE_PARTICLE_COLORS[kind] || ['255,255,255'];
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const n = reduceMotion ? Math.floor(count / 2) : count;
  for (let i = 0; i < n; i++) {
    const d = document.createElement('span');
    d.className = 'rc-particle';
    const c = colors[Math.floor(Math.random() * colors.length)];
    d.style.setProperty('--c', c);
    d.style.setProperty('--size', (Math.random() * 4 + 2).toFixed(1) + 'px');
    d.style.setProperty('--dur', (Math.random() * 4 + 4).toFixed(1) + 's');
    d.style.left = (Math.random() * 100).toFixed(2) + '%';
    d.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
    layer.appendChild(d);
  }
}

function speakNarrator(text) {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; u.pitch = 0.82; u.volume = 0.95; u.lang = 'en-US';
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(x => /en[-_]US/i.test(x.lang) && /male|daniel|rishi|google|microsoft|fred|diego/i.test(x.name)) ||
        voices.find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    };
    if (window.speechSynthesis.getVoices().length) pick();
    else window.speechSynthesis.onvoiceschanged = pick;
  } catch (e) { /* speech unavailable */ }
}

function showRoleReveal(data) {
  const overlay = document.getElementById('role-overlay');
  if (!overlay) return;
  const key = roleRevealKey(data);

  const icon = document.getElementById('role-card-icon');
  const title = document.getElementById('role-card-title');
  const desc = document.getElementById('role-card-desc');
  const team = document.getElementById('role-card-team');
  const card = document.getElementById('role-card');
  const revealContainer = document.getElementById('role-reveal-allies');
  const narratorText = document.getElementById('rc-narrator-text');

  if (icon) icon.textContent = data.role.icon || '🎭';
  if (title) title.textContent = data.role.name;
  if (desc) desc.textContent = data.description;
  if (team) {
    team.textContent = 'Team: ' + (data.team.charAt(0).toUpperCase() + data.team.slice(1));
    team.className = 'rc-card-team ' + (data.team === 'mafia' ? 'team-mafia' : 'team-village');
  }
  if (card) card.className = 'rc-card ' + (data.team === 'mafia' ? 'team-mafia' : 'team-village');
  if (narratorText) narratorText.textContent = ROLE_NARRATORS[key] || '';

  if (revealContainer) {
    if (data.mafiaTeam && data.mafiaTeam.length > 0) {
      const names = data.mafiaTeam.map(m => '<div class="mafia-ally">🔪 ' + escapeHtml(m.name) + '</div>').join('');
      revealContainer.innerHTML = '<div class="mafia-ally-header">Your Mafia allies</div>' + names;
      revealContainer.classList.remove('hidden');
    } else {
      revealContainer.innerHTML = '';
      revealContainer.classList.add('hidden');
    }
  }


  void overlay.offsetWidth; // reflow so transitions replay
  overlay.classList.add('rc-active');

  if (window.audioManager) {
    window.audioManager.playRevealCue(key);
    if (key === 'mafia') window.audioManager.startRevealHeartbeat();
  }
  spawnRoleParticles(key, key === 'villager' ? 26 : 34);
  speakNarrator(ROLE_NARRATORS[key]);

  // Blackout held briefly, then the scene reveals itself.
  if (overlay._revealTimer) clearTimeout(overlay._revealTimer);
  overlay._revealTimer = setTimeout(() => {
    overlay.classList.add('rc-reveal');
  }, 650);
}

function closeRoleReveal() {
  const overlay = document.getElementById('role-overlay');
  if (!overlay) return;
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  if (window.audioManager) window.audioManager.stopRevealHeartbeat();
  const layer = document.getElementById('rc-particles');
  if (layer) layer.innerHTML = '';

  overlay.classList.remove('rc-active', 'rc-reveal');
  overlay.classList.add('rc-out');
  if (overlay._revealTimer) { clearTimeout(overlay._revealTimer); overlay._revealTimer = null; }

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('rc-out', 'role-mafia', 'role-doctor', 'role-detective', 'role-villager', 'rc-minimal');
    const lt = document.getElementById('rc-particles');
    if (lt) lt.innerHTML = '';
  }, 820);
}

/* ── Phase updates ────────────────────────────────────────── */

function updatePhase(phase, data) {
  hideAllPanels();

  const badge = document.getElementById('phase-badge');
  const round = document.getElementById('round-number');
  const alive = document.getElementById('alive-count');
  const caption = document.getElementById('world-caption');

  if (badge) {
    const names = {
      night: '🌙 Night', morning: '🌅 Morning',
      day: '☀️ Day', voting: '🗳️ Voting', ended: '🎭 Ended',
    };
    badge.textContent = names[phase] || phase;
    badge.className = 'phase-badge ' + phase;
  }

  if (caption) caption.textContent = PHASE_WORLD[phase] || 'The Town';

  if (window.SceneManager) {
    SceneManager.go(phase);
    SceneManager.swapBanner();
  } else {
    document.body.className = 'theme-' + phase;
  }

  if (phase === 'night') showNightCinematic(data);
  else if (phase === 'day') triggerCinematic('Discussion Time', 'Find the Mafia', false, 2000);
  else if (phase === 'voting') triggerCinematic('Voting Time', 'Cast your vote!', true, 2000);

  if (data.players) updatePlayerStatus(data.players);

  if (alive && data.players) {
    alive.textContent = 'Alive: ' + data.players.filter(p => p.isAlive).length;
  }

  if (window.audioManager) {
    if (phase === 'night') window.audioManager.play('night', true);
    else if (phase === 'morning' || phase === 'day') window.audioManager.play('morning', true);
    else if (phase === 'voting') window.audioManager.play('voting', true);
  }

  clearNightStepTimerDisplay();
  startPhaseTimer(data.phase);
}

function hideAllPanels() {
  document.getElementById('night-panel').classList.add('hidden');
  document.getElementById('day-panel').classList.add('hidden');
  document.getElementById('voting-panel').classList.add('hidden');
  document.getElementById('game-announcement').classList.add('hidden');
  const msc = document.getElementById('mafia-secure-channel');
  if (msc) {
    msc.classList.remove('msc-active');
    setTimeout(() => msc.classList.add('hidden'), 500); // Wait for fade out
  }
  const dc = document.getElementById('doctor-cinematic');
  if (dc) {
    dc.classList.remove('dc-active');
    setTimeout(() => dc.classList.add('hidden'), 800);
  }
  const det = document.getElementById('detective-cinematic');
  if (det) {
    det.classList.remove('det-active');
    setTimeout(() => det.classList.add('hidden'), 800);
  }
  const detRes = document.getElementById('detective-result-cinematic');
  if (detRes) {
    detRes.classList.remove('det-res-active');
    setTimeout(() => detRes.classList.add('hidden'), 500);
  }
}

function startPhaseTimer(phaseState) {
  if (phaseTimerInterval) { clearInterval(phaseTimerInterval); phaseTimerInterval = null; }
  const timerEl = document.getElementById('timer-display');
  if (!timerEl) return;

  if (!phaseState || phaseState.timeRemaining < 0) { timerEl.textContent = '--:--'; return; }

  const updateTimer = () => {
    const elapsed = Date.now() - (phaseState.startedAt || Date.now());
    const remaining = Math.max(0, phaseState.timeRemaining - elapsed);
    timerEl.textContent = formatTime(remaining);
    timerEl.classList.toggle('urgent', remaining < 10000);
    
    const vignette = document.getElementById('vignette-danger');
    if (phaseState.name === 'voting' && remaining > 0 && remaining <= 10000) {
      if (window.audioManager) window.audioManager.triggerHeartbeat();
      if (vignette) vignette.classList.add('active');
    } else {
      if (vignette) vignette.classList.remove('active');
    }
    
    if (remaining <= 0 && phaseTimerInterval) { clearInterval(phaseTimerInterval); phaseTimerInterval = null; }
  };
  updateTimer();
  phaseTimerInterval = setInterval(updateTimer, 1000);
}

function onNightStep(data) {
  const announcement = document.getElementById('game-announcement');
  const text = document.getElementById('announcement-text');
  if (announcement && text) {
    announcement.classList.remove('hidden');
    text.textContent = data.title || '🌙 Night Phase';
    clearTimeout(window._nightStepTimer);
    window._nightStepTimer = setTimeout(() => announcement.classList.add('hidden'), 3000);
  }
}

/* ── Night actions ────────────────────────────────────────── */

async function showNightAction(data) {
  if (data.actionType === 'doctor_protect') {
    if (window.showDoctorCinematic) window.showDoctorCinematic(data);
    return;
  }
  
  if (data.actionType === 'detective_investigate') {
    if (window.showDetectiveCinematic) window.showDetectiveCinematic(data);
    return;
  }

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
  
  if (data.actionType === 'mafia_kill' && data.timeRemaining > 30) {
    if (title) title.textContent = '🔪 Mafia — Discuss and Decide';
    if (instruction) instruction.textContent = 'Use voice/chat to discuss. Targeting opens in 30 seconds...';
    if (window.narrator) window.narrator.speak('Mafia, wake up. Discuss who you will eliminate.');
    
    // Wait for 30 seconds for discussion
    await new Promise(r => setTimeout(r, 30000));
    
    if (title) title.textContent = '🔪 Mafia — Choose Your Victim';
    if (instruction) instruction.textContent = 'Select your target now.';
    if (window.narrator) window.narrator.speak('Time to vote. Choose your victim.');
  } else {
    if (title) title.textContent = actionLabels[data.actionType] || '🌙 Night Phase';
    if (instruction) instruction.textContent = data.message;
    
    if (window.narrator) {
      if (data.actionType === 'doctor_protect') window.narrator.speak('Doctor, wake up. Choose who to protect.');
      if (data.actionType === 'detective_investigate') window.narrator.speak('Detective, wake up. Choose someone to investigate.');
    }
  }

  // Targets are now handled directly on the player chips
  document.querySelectorAll('.player-chip').forEach(chip => chip.classList.remove('is-target', 'selected-target'));
  if (data.targets && data.targets.length > 0) {
    data.targets.forEach(t => {
      const chip = document.querySelector(`.player-chip[data-player-id="${t.id}"]`);
      if (chip) chip.classList.add('is-target');
    });
  } else {
    if (instruction) instruction.textContent = 'No valid targets available.';
  }

  startNightStepTimerDisplay(data.timeRemaining, timerEl);
}

function selectNightTarget(targetId) {
  const panel = document.getElementById('night-panel');
  const title = document.getElementById('night-action-title');
  const instruction = document.getElementById('night-action-instruction');
  const targets = document.getElementById('night-targets');
  const waiting = document.getElementById('night-waiting');
  const timerEl = document.getElementById('night-step-timer');

  const titleText = title ? title.textContent : '';
  let actionType = 'mafia_kill';
  if (titleText.indexOf('Detective') >= 0) actionType = 'detective_investigate';
  else if (titleText.indexOf('Doctor') >= 0) actionType = 'doctor_protect';

  performAction(actionType, targetId);

  if (title) title.textContent = '🌙 Night Phase';
  if (instruction) instruction.textContent = '';
  targets.innerHTML = '';
  waiting.classList.remove('hidden');

  document.querySelectorAll('.player-chip.is-target').forEach(chip => {
    chip.classList.remove('is-target');
    if (chip.dataset.playerId === targetId) chip.classList.add('selected-target');
  });
}

function showNightWaiting(data) {
  const panel = document.getElementById('night-panel');
  const title = document.getElementById('night-action-title');
  const targets = document.getElementById('night-targets');
  const waiting = document.getElementById('night-waiting');
  const timerEl = document.getElementById('night-step-timer');

  const msc = document.getElementById('mafia-secure-channel');
  if (msc) {
    msc.classList.remove('msc-active');
    setTimeout(() => msc.classList.add('hidden'), 500);
  }

  const dc = document.getElementById('doctor-cinematic');
  if (dc) {
    dc.classList.remove('dc-active');
    setTimeout(() => dc.classList.add('hidden'), 800);
  }

  const det = document.getElementById('detective-cinematic');
  if (det) {
    det.classList.remove('det-active');
    setTimeout(() => det.classList.add('hidden'), 800);
  }

  const detRes = document.getElementById('detective-result-cinematic');
  if (detRes) {
    detRes.classList.remove('det-res-active');
    setTimeout(() => detRes.classList.add('hidden'), 500);
  }

  panel.classList.remove('hidden');
  targets.innerHTML = '';
  waiting.classList.remove('hidden');
  if (title) title.textContent = '🌙 Night Phase';
  startNightStepTimerDisplay(data.timeRemaining, timerEl);
}

function updateMafiaVote(data) {
  document.querySelectorAll('#night-targets .target-btn').forEach(btn => {
    if (btn.dataset.targetId === data.targetId) btn.classList.add('selected');
  });
}

/* ── Morning ──────────────────────────────────────────────── */

async function showMorning(data) {
  hideAllPanels();
  const announcement = document.getElementById('game-announcement');
  const text = document.getElementById('announcement-text');
  const alive = document.getElementById('alive-count');
  const badge = document.getElementById('phase-badge');
  const caption = document.getElementById('world-caption');
  const world = document.getElementById('stage-world');

  // Activate the "dawn" world - CSS handles sun rise, fog clear, golden sky, warm lighting
  if (badge) { badge.textContent = '🌅 Morning'; badge.className = 'phase-badge morning'; }
  if (caption) caption.textContent = PHASE_WORLD.morning || 'The Dawn';
  if (window.SceneManager) { SceneManager.go('morning'); SceneManager.swapBanner(); }
  
  // Birds begin singing
  if (window.audioManager) { 
    window.audioManager.stopNightAmbient(); 
    window.audioManager.play('morning', true); 
  }

  if (window.narrator) {
    window.narrator.speak('Morning has arrived.');
    await new Promise(r => setTimeout(r, 3000));
  }

  if (data.killed) {
    // Camera zooms, Grayscale effect
    if (world) {
      world.style.transition = 'transform 4s ease-out, filter 4s ease-out';
      world.style.transform = 'scale(1.15)';
      world.style.filter = 'grayscale(100%) brightness(0.7)';
    }

    // Bell rings
    if (window.audioManager) window.audioManager.play('death');

    // Player card fades
    const chip = document.querySelector(`.player-chip[data-player-id="${data.killed.id}"]`);
    if (chip) {
      chip.style.transition = 'opacity 3s ease, filter 3s ease';
      chip.style.opacity = '0.3';
      chip.style.filter = 'grayscale(100%)';
    }

    if (window.narrator) {
      window.narrator.speak(escapeHtml(data.killed.name) + ' was found dead.');
      await new Promise(r => setTimeout(r, 4000));
    }
    
    // Show death animation
    if (window.SceneManager) {
      let rect = { left: window.innerWidth / 2, top: window.innerHeight / 2 };
      if (chip) rect = chip.getBoundingClientRect();
      SceneManager.burst(rect.left, rect.top, 80, ['255,59,92', '120,20,30', '50,0,0']);
    }

    // Revert camera zoom and grayscale slowly
    if (world) {
      world.style.transition = 'transform 3s ease-in, filter 3s ease-in';
      world.style.transform = 'scale(1)';
      world.style.filter = 'grayscale(0%) brightness(1)';
    }

    text.innerHTML = '<strong>' + escapeHtml(data.killed.name) + '</strong> was found dead this morning... 💀';
    announcement.classList.remove('hidden');
    triggerCinematic('Sun Rises', escapeHtml(data.killed.name) + ' was murdered.', true, 3500);

  } else {
    // Play hopeful music
    if (window.audioManager) window.audioManager.play('hopeful_morning');
    
    if (window.narrator) {
      window.narrator.speak('Everyone survived.');
      await new Promise(r => setTimeout(r, 3000));
    }
    
    text.innerHTML = '☀️ Everyone survived.';
    announcement.classList.remove('hidden');
    triggerCinematic('Sun Rises', 'Everyone survived.', false, 3000);
  }

  if (data.players) updatePlayerStatus(data.players);
  if (alive) alive.textContent = 'Alive: ' + (data.remainingAlive || 0);
}

function showDetectiveResult(data) {
  const overlay = document.getElementById('role-overlay');
  const icon = document.getElementById('role-card-icon');
  const title = document.getElementById('role-card-title');
  const desc = document.getElementById('role-card-desc');
  const team = document.getElementById('role-card-team');
  const card = document.getElementById('role-card');
  const revealContainer = document.getElementById('role-reveal-allies');

  if (!overlay || !icon || !title || !desc || !team) return;

  icon.textContent = '🔍';
  title.textContent = 'Investigation Result';
  desc.innerHTML = 'You investigated <strong>' + escapeHtml(data.targetName) + '</strong>.';

  const isMafia = data.alignment === 'mafia';
  team.textContent = isMafia ? 'Team: Mafia 🔪' : 'Team: Village 👤';
  team.className = 'rc-card-team ' + (isMafia ? 'team-mafia' : 'team-village');
  if (card) card.className = 'rc-card ' + (isMafia ? 'team-mafia' : 'team-village');

  if (revealContainer) { revealContainer.innerHTML = ''; revealContainer.classList.add('hidden'); }

  overlay.classList.remove('rc-out', 'rc-reveal', 'rc-minimal',
    'role-mafia', 'role-doctor', 'role-detective', 'role-villager');
  overlay.classList.add('rc-minimal');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  void overlay.offsetWidth;
  overlay.classList.add('rc-active', 'rc-reveal');

  if (window.audioManager) window.audioManager.play(isMafia ? 'death' : 'click');

  if (window._detectiveTimer) clearTimeout(window._detectiveTimer);
  window._detectiveTimer = setTimeout(() => {
    overlay.classList.remove('rc-active', 'rc-reveal');
    overlay.classList.add('rc-out');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.classList.remove('rc-out', 'rc-minimal');
    }, 820);
    window._detectiveTimer = null;
  }, 8000);
}

/* ── Day / chat ───────────────────────────────────────────── */

let dayTimerInterval = null;

function showDayPhase(data) {
  hideAllPanels();
  const panel = document.getElementById('day-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  
  if (window.SceneManager) {
    SceneManager.go('discussion'); // we will use discussion or day
    document.body.className = 'theme-discussion';
  }

  // Set timer
  if (dayTimerInterval) clearInterval(dayTimerInterval);
  const timerEl = document.getElementById('day-timer');
  const startedAt = Date.now();
  const initialRemaining = data.timeRemaining || 180000;
  
  dayTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, initialRemaining - elapsed);
    if (timerEl) timerEl.textContent = formatTime(remaining);
    if (remaining <= 0) {
      clearInterval(dayTimerInterval);
      dayTimerInterval = null;
    }
  }, 1000);

  const chat = document.getElementById('chat-messages');
  if (chat && chat.querySelector('.chat-empty')) chat.innerHTML = '';

  renderDayPlayerCircle(data.players || currentGameState.players);
}

function renderDayPlayerCircle(players) {
  const container = document.getElementById('day-player-circle');
  if (!container) return;
  container.innerHTML = '';
  
  const total = players.length;
  const radius = window.innerWidth > 800 ? 250 : 150; // pixels
  
  players.forEach((p, i) => {
    const angle = (i / total) * 2 * Math.PI - Math.PI / 2; // start at top
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    const div = document.createElement('div');
    div.className = 'disc-avatar' + (p.isAlive ? '' : ' dead');
    div.dataset.playerId = p.id;
    div.style.transform = `translate(${x}px, ${y}px)`;
    
    div.innerHTML = `
      <div class="disc-name">${escapeHtml(p.name)}</div>
      <div class="disc-mic">🎤</div>
    `;
    container.appendChild(div);
  });
}

window.sendReaction = function(emoji) {
  if (socket) socket.emit('chat:reaction', { emoji });
};

window.toggleRaiseHand = function() {
  const btn = document.getElementById('btn-raise-hand');
  if (!btn) return;
  const isActive = btn.classList.contains('active');
  btn.classList.toggle('active', !isActive);
  if (socket) socket.emit('action:raise_hand', { active: !isActive });
};

window.handleDayReaction = function(data) {
  const avatar = document.querySelector(`.disc-avatar[data-player-id="${data.playerId}"]`);
  if (!avatar) return;
  const el = document.createElement('div');
  el.className = 'disc-reaction';
  el.textContent = data.emoji;
  avatar.appendChild(el);
  setTimeout(() => el.remove(), 2000);
};

window.handleDayRaiseHand = function(data) {
  const avatar = document.querySelector(`.disc-avatar[data-player-id="${data.playerId}"]`);
  if (!avatar) return;
  let hand = avatar.querySelector('.disc-hand');
  if (data.active) {
    if (!hand) {
      hand = document.createElement('div');
      hand.className = 'disc-hand';
      hand.textContent = '✋';
      avatar.appendChild(hand);
    }
  } else {
    if (hand) hand.remove();
  }
};

window.handleDayTyping = function(data) {
  const avatar = document.querySelector(`.disc-avatar[data-player-id="${data.playerId}"]`);
  if (!avatar) return;
  let typing = avatar.querySelector('.disc-typing');
  if (data.isTyping) {
    if (!typing) {
      typing = document.createElement('div');
      typing.className = 'disc-typing';
      typing.innerHTML = '💬'; // or dots
      typing.style.position = 'absolute';
      typing.style.bottom = '-10px';
      avatar.appendChild(typing);
    }
  } else {
    if (typing) typing.remove();
  }
};

function addChatMessage(data) {
  // Check if Mafia channel is active and route message there
  const mscPanel = document.getElementById('mafia-secure-channel');
  if (mscPanel && mscPanel.classList.contains('msc-active')) {
    const chatLog = document.getElementById('msc-chat-log');
    if (!chatLog) return;
    
    const msgEl = document.createElement('div');
    msgEl.className = 'msc-chat-msg';
    if (data.playerId === playerId) msgEl.classList.add('self');
    
    // Typewriter effect
    msgEl.innerHTML = '<span class="msc-chat-author">' + escapeHtml(data.playerName) + ':</span> ' + 
                      '<span class="msc-typewriter">' + escapeHtml(data.message) + '</span>';
    chatLog.appendChild(msgEl);
    scrollToBottom(chatLog);
    if (window.audioManager) window.audioManager.play('chat');
    return;
  }

  const chat = document.getElementById('chat-messages');
  if (!chat) return;
  const empty = chat.querySelector('.chat-empty');
  if (empty) empty.remove();

  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';
  msgEl.innerHTML = '<div class="msg-author" style="color:' + getAvatarColor(data.playerName) + '">' +
    escapeHtml(data.playerName) + '</div>' +
    '<div class="msg-text">' + escapeHtml(data.message) + '</div>';

  chat.appendChild(msgEl);
  scrollToBottom(chat);
  if (window.audioManager) window.audioManager.play('chat');
}

function sendChatMessage() { sendChat(); }

function startNightStepTimerDisplay(timeRemaining, timerEl) {
  if (nightStepTimerInterval) { clearInterval(nightStepTimerInterval); nightStepTimerInterval = null; }
  if (!timerEl) return;
  if (!timeRemaining || timeRemaining < 0) { timerEl.classList.add('hidden'); return; }

  timerEl.classList.remove('hidden');
  timerEl.textContent = formatTime(timeRemaining);

  const startedAt = Date.now();
  const initialRemaining = timeRemaining;
  nightStepTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, initialRemaining - elapsed);
    timerEl.textContent = formatTime(remaining);
    timerEl.classList.toggle('urgent', remaining < 10000);
    
    const vignette = document.getElementById('vignette-danger');
    if (remaining > 0 && remaining <= 10000) {
      if (window.audioManager) window.audioManager.triggerHeartbeat();
      if (vignette) vignette.classList.add('active');
    } else {
      if (vignette) vignette.classList.remove('active');
    }
    
    if (remaining <= 0) { 
      clearInterval(nightStepTimerInterval); 
      nightStepTimerInterval = null; 
      timerEl.textContent = '00:00'; 
      if (vignette) vignette.classList.remove('active');
    }
  }, 1000);
}

function clearNightStepTimerDisplay() {
  if (nightStepTimerInterval) { clearInterval(nightStepTimerInterval); nightStepTimerInterval = null; }
  const timerEl = document.getElementById('night-step-timer');
  if (timerEl) timerEl.classList.add('hidden');
}

/* ── Voting ───────────────────────────────────────────────── */

let votingTimerInterval = null;

async function showVotingPhase(data) {
  hideAllPanels();
  const panel = document.getElementById('voting-panel');
  if (!panel) return;
  panel.classList.remove('hidden');

  if (window.SceneManager) {
    SceneManager.go('voting');
    document.body.className = 'theme-voting';
  }

  const title = document.getElementById('voting-title');
  const instruction = document.getElementById('voting-instruction');
  const waiting = document.getElementById('voting-waiting');
  if (waiting) waiting.classList.add('hidden');

  if (title) title.textContent = data.isTieBreaker ? '🗳️ Tie-Breaker Vote' : '🗳️ Voting Phase';
  if (instruction) instruction.textContent = data.isTieBreaker
    ? 'Re-vote! Choose between the tied players.'
    : 'Vote for who you think is Mafia!';

  if (window.narrator) {
    if (data.isTieBreaker) {
      window.narrator.speak('We have a tie. Re-vote between the tied players.');
    } else {
      window.narrator.speak('Town, it is time to vote. Choose who you think is the Mafia.');
    }
  }

  const voteTargets = data.votableTargets || data.alivePlayers ||
    (data.players ? data.players.filter(p => p.isAlive) : []);

  // Render circular voting layout
  const circle = document.getElementById('voting-player-circle');
  if (circle) {
    circle.innerHTML = '';
    const total = voteTargets.length;
    const radius = window.innerWidth > 800 ? 280 : 160;
    
    voteTargets.forEach((t, i) => {
      const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      const div = document.createElement('div');
      div.className = 'vote-card';
      div.dataset.playerId = t.id;
      div.style.transform = `translate(${x}px, ${y}px)`;
      div.onclick = () => selectVoteTarget(t.id);
      
      div.innerHTML = `
        <div class="vc-avatar">${t.avatar || '👤'}</div>
        <div class="vc-name">${escapeHtml(t.name)}</div>
      `;
      circle.appendChild(div);
    });
  }

  // Setup specialized voting timer
  if (votingTimerInterval) clearInterval(votingTimerInterval);
  const timerEl = document.getElementById('voting-timer');
  const vignette = document.getElementById('voting-vignette');
  if (vignette) vignette.classList.remove('danger');
  
  const startedAt = Date.now();
  const initialRemaining = data.timeRemaining || 45000;
  let warned10s = false;

  votingTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, initialRemaining - elapsed);
    if (timerEl) {
      timerEl.textContent = formatTime(remaining);
      timerEl.classList.toggle('urgent', remaining <= 10000);
    }
    
    if (remaining > 0 && remaining <= 10000) {
      if (!warned10s) {
        warned10s = true;
        if (window.narrator) window.narrator.speak('Ten seconds remaining.');
        if (vignette) vignette.classList.add('danger');
        document.body.classList.add('danger-shake');
      }
      if (window.audioManager) window.audioManager.triggerHeartbeat();
    } else {
      document.body.classList.remove('danger-shake');
    }
    
    if (remaining <= 0) {
      clearInterval(votingTimerInterval);
      votingTimerInterval = null;
      document.body.classList.remove('danger-shake');
      if (vignette) vignette.classList.remove('danger');
    }
  }, 1000);
}

function selectVoteTarget(targetId) {
  const waiting = document.getElementById('voting-waiting');

  document.querySelectorAll('.vote-card').forEach(card => {
    card.classList.remove('is-selected');
    if (card.dataset.playerId === targetId) card.classList.add('is-selected');
  });

  if (waiting) {
    waiting.classList.remove('hidden');
    waiting.querySelector('p').textContent = 'Vote cast! Waiting for others...';
  }
  
  if (window.audioManager) window.audioManager.play('click');
  castVote(targetId);
}

function updateVoteSummary(data) {
  const waiting = document.getElementById('voting-waiting');
  
  // Clear all badges
  document.querySelectorAll('.vote-badge').forEach(b => b.remove());

  if (!data.votes || data.votes.length === 0) return;

  if (waiting && !waiting.classList.contains('hidden')) {
    const castCount = data.votes.reduce((s, v) => s + v.votes, 0);
    const totalVoters = data.totalVoters || 0;
    const remaining = totalVoters - castCount;
    const msg = waiting.querySelector('p');
    if (msg) msg.textContent = 'Vote cast! Waiting for ' + remaining + ' more...';
  }

  // Add badges to cards
  data.votes.forEach(v => {
    if (v.votes > 0) {
      const card = document.querySelector(`.vote-card[data-player-id="${v.targetId}"]`);
      if (card) {
        const badge = document.createElement('div');
        badge.className = 'vote-badge';
        badge.textContent = v.votes;
        card.appendChild(badge);
      }
    }
  });
}

function showVoteResult(data) {
  hideAllPanels();
  const announcement = document.getElementById('game-announcement');
  const text = document.getElementById('announcement-text');
  announcement.classList.remove('hidden');

  if (data.eliminated) {
    if (window.narrator) {
      window.narrator.speak(escapeHtml(data.eliminated.name) + ' has been eliminated.');
    }
    
    // Dramatic presentation
    document.body.className = 'theme-voting'; // Keep darkness
    if (window.audioManager) window.audioManager.play('death');
    
    text.innerHTML = '<span style="font-size:3rem; text-shadow: 0 0 20px #f00;">' + data.eliminated.icon + '</span><br>' +
      '<strong style="font-size:2.5rem; color:#fff;">' + escapeHtml(data.eliminated.name) + '</strong><br>' +
      '<span style="font-size:1.5rem; color:#aaa;">was</span><br>' +
      '<strong style="font-size:2rem; color:' + (data.eliminated.team === 'mafia' ? '#dc143c' : '#4a90e2') + ';">' + escapeHtml(data.eliminated.role) + '</strong>';
      
    if (window.SceneManager) SceneManager.burst(window.innerWidth / 2, window.innerHeight / 2, 80, ['255,0,0', '220,20,60', '100,0,0']);
    document.body.classList.add('danger-shake');
    setTimeout(() => { document.body.classList.remove('danger-shake'); }, 1000);
  } else {
    if (window.narrator) window.narrator.speak('The town could not reach a decision.');
    text.innerHTML = '<span style="font-size:2rem;">⚖️</span><br><strong>' + (data.message || 'No one was eliminated.') + '</strong>';
  }

  if (data.players) updatePlayerStatus(data.players);
}

/* ── Player status (the "table") ─────────────────────────── */

let _updatePlayerStatusRaf = null;

function updatePlayerStatus(players) {
  if (_updatePlayerStatusRaf) cancelAnimationFrame(_updatePlayerStatusRaf);
  _updatePlayerStatusRaf = requestAnimationFrame(() => {
    const grid = document.getElementById('player-status-grid');
    if (!grid || !players) return;
    const n = players.length;
    grid.innerHTML = players.map((p, i) => {
      // Calculate circle coordinates (isometric perspective)
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rx = window.innerWidth < 600 ? 38 : 32; // width percentage
      const ry = 26; // height percentage
      const left = 50 + Math.cos(angle) * rx;
      const top = 52 + Math.sin(angle) * ry;
      const zIndex = Math.round(top); // isometric z-index sorting
      const style = `left: ${left}%; top: ${top}%; z-index: ${zIndex};`;
      return buildPlayerChip(p, false, false, false, p.id === playerId, style);
    }).join('');
    _updatePlayerStatusRaf = null;
  });
}

function handleActionResult(data) {
  if (!data.success && data.message) showError(data.message);
}

/* ── Game result ──────────────────────────────────────────── */

function showGameResult(data) {
  clearInterval(phaseTimerInterval); phaseTimerInterval = null;
  clearNightStepTimerDisplay();
  hideAllPanels();

  const cinematic = document.getElementById('game-over-cinematic');
  const bgVillage = document.getElementById('goc-bg-village');
  const bgMafia = document.getElementById('goc-bg-mafia');
  const emblem = document.getElementById('goc-emblem');
  const title = document.getElementById('goc-title');
  const subtitle = document.getElementById('goc-subtitle');
  const statsContainer = document.getElementById('goc-stats');
  const rolesGrid = document.getElementById('goc-roles-grid');
  const playAgainBtn = document.getElementById('goc-play-again-btn');

  if (!cinematic) return;

  if (window.SceneManager) SceneManager.go('ended');
  cinematic.classList.remove('hidden');

  // Background and Audio Setup
  if (data.winner.team === 'mafia') {
    document.body.className = 'theme-gameover-mafia';
    bgVillage.classList.add('hidden');
    bgMafia.classList.remove('hidden');
    
    emblem.textContent = '🔪';
    title.textContent = 'Mafia Wins';
    if (window.narrator) window.narrator.speak('The Mafia controls the village.');
    
    if (window.audioManager) { 
      window.audioManager.stopNightAmbient(); 
      window.audioManager.stopMusic(); 
      window.audioManager.play('mafiaWin'); 
      window.audioManager.play('lose'); 
    }
    
    if (window.SceneManager) {
      setTimeout(() => SceneManager.burst(window.innerWidth / 2, window.innerHeight * 0.4, 80, ['255,0,0', '150,0,0', '50,0,0']), 300);
    }
  } else {
    document.body.className = 'theme-gameover-village';
    bgMafia.classList.add('hidden');
    bgVillage.classList.remove('hidden');
    
    emblem.textContent = '🏆';
    title.textContent = 'Village Wins';
    if (window.narrator) window.narrator.speak('The village has survived.');
    
    if (window.audioManager) { 
      window.audioManager.stopMusic(); 
      window.audioManager.play('villagersWin'); 
      window.audioManager.play('win'); 
    }
    
    if (window.SceneManager) {
      setTimeout(() => SceneManager.burst(window.innerWidth / 2, window.innerHeight * 0.4, 80, ['245,197,66', '255,255,255', '255,215,0']), 300);
    }
  }
  
  subtitle.textContent = data.winner.message;

  // Build Stats
  if (data.stats) {
    statsContainer.innerHTML = `
      <div class="goc-stat-box"><div class="goc-stat-value">${data.stats.daysElapsed}</div><div class="goc-stat-label">Days Survived</div></div>
      <div class="goc-stat-box"><div class="goc-stat-value">${data.survivors ? data.survivors.length : 0}</div><div class="goc-stat-label">Survivors</div></div>
      <div class="goc-stat-box"><div class="goc-stat-value">${data.dead ? data.dead.length : 0}</div><div class="goc-stat-label">Casualties</div></div>
    `;
  }

  // Build Roles Grid
  if (data.allPlayers && rolesGrid) {
    rolesGrid.innerHTML = data.allPlayers.map(p => `
      <div class="goc-role-card team-${p.team || 'village'} ${!p.isAlive ? 'status-dead' : ''}">
        <div class="goc-role-icon">${p.icon || '👤'}</div>
        <div class="goc-role-name">${escapeHtml(p.name)}</div>
        <div class="goc-role-identity">${escapeHtml(p.role)}</div>
      </div>
    `).join('');
  }

  // Play Again Button (Host Only)
  if (playAgainBtn && typeof currentGameState !== 'undefined' && currentGameState && typeof playerId !== 'undefined') {
    if (currentGameState.hostId === playerId) playAgainBtn.classList.remove('hidden');
    else playAgainBtn.classList.add('hidden');
  }
}

function playAgain() { if (window.socket) window.socket.emit('game:playAgain'); }
function leaveGame() { window.location.reload(); }

/* ── Keyboard ─────────────────────────────────────────────── */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const chatInput = document.getElementById('chat-input');
    if (chatInput && document.activeElement === chatInput) { e.preventDefault(); sendChatMessage(); }
  }
});

/* ── Interactive Player Map (Cinematic mode) ──────────────── */
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.player-chip.is-target');
  if (chip) {
    const targetId = chip.dataset.playerId;
    const nightPanel = document.getElementById('night-panel');
    const votingPanel = document.getElementById('voting-panel');
    
    if (votingPanel && !votingPanel.classList.contains('hidden')) {
      if (typeof selectVoteTarget === 'function') selectVoteTarget(targetId);
    } else if (nightPanel && !nightPanel.classList.contains('hidden')) {
      if (typeof selectNightTarget === 'function') selectNightTarget(targetId);
    }
  }
});

/* ── Mafia Secure Channel ───────────────────────────────────── */

let mscTimerInterval = null;

window.showMafiaChannel = function(data) {
  // Hide normal night wait
  const waiting = document.getElementById('night-waiting');
  if (waiting) waiting.classList.add('hidden');

  const mscPanel = document.getElementById('mafia-secure-channel');
  if (!mscPanel) return;

  mscPanel.classList.remove('hidden');
  // force reflow
  void mscPanel.offsetWidth;
  mscPanel.classList.add('msc-active');

  // Set up header
  const phaseLabel = document.getElementById('msc-phase-label');
  if (phaseLabel) phaseLabel.textContent = 'Discussion Phase';

  const votingSection = document.getElementById('msc-voting-section');
  if (votingSection) votingSection.classList.add('hidden');

  // Populate team
  const teamList = document.getElementById('msc-team-list');
  if (teamList) {
    teamList.innerHTML = '';
    const meItem = document.createElement('li');
    meItem.id = `msc-team-${playerId}`;
    meItem.innerHTML = `<div class="voice-indicator"></div>You (Mafia)`;
    teamList.appendChild(meItem);

    if (data.mafiaTeam) {
      data.mafiaTeam.forEach(m => {
        const li = document.createElement('li');
        li.id = `msc-team-${m.id}`;
        li.innerHTML = `<div class="voice-indicator"></div>${escapeHtml(m.name)}`;
        teamList.appendChild(li);
      });
    }
  }

  // Clear chat log
  const chatLog = document.getElementById('msc-chat-log');
  if (chatLog) chatLog.innerHTML = '';

  // Setup input
  const input = document.getElementById('msc-chat-input');
  const sendBtn = document.getElementById('msc-chat-send');
  if (input && sendBtn) {
    input.value = '';
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        sendMafiaChat();
      } else {
        socket.emit('chat:typing', { isTyping: true });
        clearTimeout(input.typingTimeout);
        input.typingTimeout = setTimeout(() => socket.emit('chat:typing', { isTyping: false }), 2000);
      }
    };
    sendBtn.onclick = sendMafiaChat;
  }

  // Timer
  startMscTimer(data.duration);
};

window.showMafiaVoting = function(data) {
  const phaseLabel = document.getElementById('msc-phase-label');
  if (phaseLabel) phaseLabel.textContent = 'Voting Phase';

  const votingSection = document.getElementById('msc-voting-section');
  if (votingSection) votingSection.classList.remove('hidden');

  const targetsContainer = document.getElementById('msc-targets');
  if (targetsContainer && data.targets) {
    targetsContainer.innerHTML = '';
    data.targets.forEach(t => {
      const card = document.createElement('div');
      card.className = 'msc-target-card';
      card.dataset.targetId = t.id;
      card.innerHTML = `
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="vote-count">0</div>
      `;
      card.onclick = () => {
        // Send vote
        socket.emit('vote:cast', { targetId: t.id });
        document.querySelectorAll('.msc-target-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      };
      targetsContainer.appendChild(card);
    });
  }

  startMscTimer(data.duration);
};

window.updateMafiaVoteSummary = function(data) {
  // Reset all vote counts
  document.querySelectorAll('.msc-target-card .vote-count').forEach(el => el.textContent = '0');
  
  // Actually, we'd need a list of all votes to show per card, but the server only sends
  // the total votes for this specific targetId. Let's just update the specific target.
  const card = document.querySelector(`.msc-target-card[data-target-id="${data.targetId}"]`);
  if (card) {
    const countEl = card.querySelector('.vote-count');
    if (countEl) countEl.textContent = data.totalVotes;
  }
};

function sendMafiaChat() {
  const input = document.getElementById('msc-chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (msg) {
    socket.emit('chat:send', { message: msg });
    socket.emit('chat:typing', { isTyping: false });
    input.value = '';
  }
}

function startMscTimer(durationMs) {
  const timerEl = document.getElementById('msc-timer');
  if (!timerEl) return;
  
  if (mscTimerInterval) clearInterval(mscTimerInterval);
  const endTime = Date.now() + durationMs;
  
  function update() {
    const remain = Math.max(0, endTime - Date.now());
    timerEl.textContent = Math.ceil(remain / 1000);
    if (remain <= 0) clearInterval(mscTimerInterval);
  }
  update();
  mscTimerInterval = setInterval(update, 1000);
}

// Intercept Voice and Typing indicators in the MSC
const originalOnRemoteSpeaking = window.voiceManager ? window.voiceManager.onRemoteSpeaking.bind(window.voiceManager) : null;
if (window.voiceManager) {
  window.voiceManager.onRemoteSpeaking = function(pId, isSpeaking) {
    if (originalOnRemoteSpeaking) originalOnRemoteSpeaking(pId, isSpeaking);
    const mscItem = document.getElementById(`msc-team-${pId}`);
    if (mscItem) {
      if (isSpeaking) mscItem.classList.add('speaking');
      else mscItem.classList.remove('speaking');
    }
  };
}

let mscTypers = new Set();
// We must override the previous 'chat:typing' event or simply process it again.
// Since socket.js adds it globally, let's patch the DOM logic here if MSC is open.
window.handleMscTyping = function(data) {
  const mscPanel = document.getElementById('mafia-secure-channel');
  if (mscPanel && mscPanel.classList.contains('msc-active')) {
    if (data.isTyping && data.playerId !== playerId) mscTypers.add(data.playerId);
    else mscTypers.delete(data.playerId);
    
    const indicator = document.getElementById('msc-typing-indicator');
    if (indicator) {
      if (mscTypers.size > 0) {
        indicator.textContent = mscTypers.size + (mscTypers.size === 1 ? ' person is ' : ' people are ') + 'typing...';
      } else {
        indicator.textContent = '';
      }
    }
  }
};

/* ── Doctor Cinematic ───────────────────────────────────────── */

let dcTimerInterval = null;

window.showDoctorCinematic = function(data) {
  // Hide normal night UI
  const nightPanel = document.getElementById('night-panel');
  if (nightPanel) nightPanel.classList.add('hidden');

  const dcPanel = document.getElementById('doctor-cinematic');
  if (!dcPanel) return;

  dcPanel.classList.remove('hidden');
  void dcPanel.offsetWidth;
  dcPanel.classList.add('dc-active');

  const targetsContainer = document.getElementById('dc-targets');
  if (targetsContainer && data.targets) {
    targetsContainer.innerHTML = '';
    data.targets.forEach(t => {
      const card = document.createElement('div');
      card.className = 'dc-target-card';
      card.dataset.targetId = t.id;
      card.innerHTML = `
        <div class="avatar">${t.isDead ? '💀' : '👤'}</div>
        <div class="name">${escapeHtml(t.name)}</div>
      `;
      card.onclick = () => {
        // Confirm choice
        document.querySelectorAll('.dc-target-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        
        socket.emit('action:night', { actionType: 'doctor_protect', targetId: t.id });
        
        // Show healing animation
        const anim = document.getElementById('dc-healing-anim');
        if (anim) {
          anim.classList.remove('hidden');
          if (window.audioManager) window.audioManager.play('heal'); // assuming sound
          
          setTimeout(() => {
            anim.classList.add('hidden');
            // Return to sleep
            dcPanel.classList.remove('dc-active');
            setTimeout(() => dcPanel.classList.add('hidden'), 800);
            
            // Show waiting
            const waiting = document.getElementById('night-waiting');
            if (waiting) waiting.classList.remove('hidden');
            if (nightPanel) nightPanel.classList.remove('hidden');
            
          }, 2000);
        }
      };
      targetsContainer.appendChild(card);
    });
  }

  // Timer
  const timerEl = document.getElementById('dc-timer');
  if (timerEl) {
    if (dcTimerInterval) clearInterval(dcTimerInterval);
    const endTime = Date.now() + data.timeRemaining;
    
    function update() {
      const remain = Math.max(0, endTime - Date.now());
      timerEl.textContent = Math.ceil(remain / 1000);
      if (remain <= 0) {
        clearInterval(dcTimerInterval);
        dcPanel.classList.remove('dc-active');
        setTimeout(() => dcPanel.classList.add('hidden'), 800);
      }
    }
    update();
    dcTimerInterval = setInterval(update, 1000);
  }

  if (window.narrator) {
    window.narrator.speak('Doctor, wake up. Choose who to protect.');
  }
};

/* ── Detective Cinematic ───────────────────────────────────────── */

let detTimerInterval = null;

window.showDetectiveCinematic = function(data) {
  // Hide normal night UI
  const nightPanel = document.getElementById('night-panel');
  if (nightPanel) nightPanel.classList.add('hidden');

  const detPanel = document.getElementById('detective-cinematic');
  if (!detPanel) return;

  detPanel.classList.remove('hidden');
  void detPanel.offsetWidth;
  detPanel.classList.add('det-active');

  if (window.audioManager) window.audioManager.play('investigate'); // Use investigation sound if available or fallback

  const targetsContainer = document.getElementById('det-targets');
  if (targetsContainer && data.targets) {
    targetsContainer.innerHTML = '';
    data.targets.forEach(t => {
      const card = document.createElement('div');
      card.className = 'det-target-card';
      card.dataset.targetId = t.id;
      card.innerHTML = `
        <div class="avatar">${t.isDead ? '💀' : '👤'}</div>
        <div class="name">${escapeHtml(t.name)}</div>
      `;
      card.onclick = () => {
        // Confirm choice
        document.querySelectorAll('.det-target-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        
        socket.emit('action:night', { actionType: 'detective_investigate', targetId: t.id });
        
        // Hide cinematic
        detPanel.classList.remove('det-active');
        setTimeout(() => detPanel.classList.add('hidden'), 800);
        
        // The server will immediately send 'night:detective_result'
        // which triggers showDetectiveResultCinematic.
      };
      targetsContainer.appendChild(card);
    });
  }

  // Timer
  const timerEl = document.getElementById('det-timer');
  if (timerEl) {
    if (detTimerInterval) clearInterval(detTimerInterval);
    const endTime = Date.now() + data.timeRemaining;
    
    function update() {
      const remain = Math.max(0, endTime - Date.now());
      timerEl.textContent = Math.ceil(remain / 1000);
      if (remain <= 0) {
        clearInterval(detTimerInterval);
        detPanel.classList.remove('det-active');
        setTimeout(() => detPanel.classList.add('hidden'), 800);
      }
    }
    update();
    detTimerInterval = setInterval(update, 1000);
  }

  if (window.narrator) {
    window.narrator.speak('Detective, wake up. Choose someone to investigate.');
  }
};

window.showDetectiveResultCinematic = function(data) {
  const detRes = document.getElementById('detective-result-cinematic');
  if (!detRes) return;

  // Populate paper
  const nameEl = document.getElementById('det-paper-name');
  if (nameEl) nameEl.textContent = data.targetName;

  const stampEl = document.getElementById('det-paper-stamp');
  if (stampEl) {
    stampEl.textContent = data.alignment;
    stampEl.className = 'det-paper-stamp'; // reset
    void stampEl.offsetWidth; // trigger reflow
    if (data.alignment === 'Mafia') {
      stampEl.classList.add('stamp-mafia');
      if (window.audioManager) window.audioManager.play('stamp_bad'); 
    } else {
      stampEl.classList.add('stamp-not-mafia');
      if (window.audioManager) window.audioManager.play('stamp_good');
    }
  }

  detRes.classList.remove('hidden');
  void detRes.offsetWidth;
  detRes.classList.add('det-res-active');

  // Trigger stamp animation after a short delay
  setTimeout(() => {
    if (stampEl) stampEl.classList.add('stamp-active');
  }, 400);

  // Hide after 4 seconds and return to sleep
  setTimeout(() => {
    detRes.classList.remove('det-res-active');
    setTimeout(() => {
      detRes.classList.add('hidden');
      const waiting = document.getElementById('night-waiting');
      if (waiting) waiting.classList.remove('hidden');
      const nightPanel = document.getElementById('night-panel');
      if (nightPanel) nightPanel.classList.remove('hidden');
    }, 500);
  }, 4000);
};

/**
 * Pure phase state machine.
 *
 * Manages phase transitions, timer scheduling, and delegates
 * phase-specific action handling to each phase module.
 *
 * Has NO references to Socket.IO. All results are returned
 * as plain objects for the GameEngine to emit.
 */
export class PhaseManager {
  /**
   * @param {import('./GameStore.js').GameStore} store
   */
  constructor(store) {
    this.store = store;
    this.timer = null;
    this.duration = 0;
    this.currentPhase = null;

    /** Sequential night step tracking: null | 'mafia' | 'doctor' | 'detective' | 'complete' */
    this.nightStep = null;

    /** Night step timer for auto-advance when step times out */
    this.nightStepTimer = null;
    this.nightStepStartedAt = null;
  }

  // ── Duration Constants ──────────────────────────────────────

  /** Duration per night step in ms (30s). */
  static get NIGHT_STEP_DURATION() { return 30000; }

  /** Duration for the voting phase in ms (45s). */
  static get VOTING_DURATION() { return 45000; }

  /**
   * Get the duration for a phase in milliseconds.
   * @param {string} phaseName
   * @returns {number}
   */
  getDuration(phaseName) {
    const durations = {
      night: 30000,
      morning: 10000,
      day: 45000,
      voting: PhaseManager.VOTING_DURATION,
    };
    return durations[phaseName] || 0;
  }

  /**
   * Start a new phase.
   * @param {string} phaseName - 'night' | 'morning' | 'day' | 'voting'
   * @param {Function} onTimeout - Callback when the phase timer expires
   * @returns {object} Phase start result to emit
   */
  startPhase(phaseName, onTimeout) {
    // Clear any existing timer
    this.clearTimer();

    this.duration = this.getDuration(phaseName);
    this.store.setPhase(phaseName);
    this.store.clearVotes();

    // Import phase modules lazily to avoid circular deps
    let phaseData;
    switch (phaseName) {
      case 'morning':
        phaseData = this.startMorning();
        break;
      case 'day':
        phaseData = this.startDay();
        break;
      case 'voting':
        phaseData = this.startVoting();
        break;
      default:
        throw new Error(`Unknown phase: ${phaseName}`);
    }

    // Start timer
    if (this.duration > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        onTimeout(phaseName);
      }, this.duration);
    }

    return {
      phase: this.store.getPhaseState(this.duration),
      ...phaseData,
    };
  }

  /**
   * Clear the phase timer.
   */
  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    this.clearTimer();
    this.clearNightStepTimer();
    this.currentPhase = null;
  }

  // ── Night Step Timer Management ─────────────────────────────

  /**
   * Start the timer for the current night step.
   * After NIGHT_STEP_DURATION ms, calls the callback to auto-advance.
   * @param {Function} onTimeout - Called when the step timer expires
   */
  startNightStepTimer(onTimeout) {
    this.clearNightStepTimer();
    this.nightStepStartedAt = Date.now();
    this.nightStepTimer = setTimeout(() => {
      this.nightStepTimer = null;
      if (onTimeout) onTimeout();
    }, PhaseManager.NIGHT_STEP_DURATION);
  }

  /**
   * Clear the night step timer.
   */
  clearNightStepTimer() {
    if (this.nightStepTimer) {
      clearTimeout(this.nightStepTimer);
      this.nightStepTimer = null;
    }
    this.nightStepStartedAt = null;
  }

  /**
   * Get the remaining time for the current night step in ms.
   * @returns {number} Remaining ms, or -1 if no timer is active
   */
  getNightStepTimeRemaining() {
    if (!this.nightStepStartedAt) return -1;
    const elapsed = Date.now() - this.nightStepStartedAt;
    return Math.max(0, PhaseManager.NIGHT_STEP_DURATION - elapsed);
  }

  // ── Night Phase (Sequential Steps) ────────────────────────
  //
  // Night actions happen in order:
  //   1. Mafia — all alive mafia vote on a victim
  //   2. Doctor — chooses someone to protect
  //   3. Detective — investigates someone
  //
  // Each step waits for ALL required players to act OR the
  // step timer (30s) to expire before advancing. Uncast actions
  // are simply not performed (no kill = peaceful night,
  // no protect = no protection, no investigate = no info).

  /**
   * Ordered night steps.
   */
  static get NIGHT_STEPS() {
    return ['mafia', 'doctor', 'detective'];
  }

  /**
   * Get the action type string for a role name.
   */
  static getActionTypeForRole(roleName) {
    const map = {
      Mafia: 'mafia_kill',
      Doctor: 'doctor_protect',
      Detective: 'detective_investigate',
    };
    return map[roleName] || null;
  }

  /**
   * Initialize the night phase.
   * @returns {object} Phase start data
   */
  startNight() {
    this.store.roundNumber++;
    this.store.clearNightActions();
    this.currentPhase = 'night';
    this.nightStep = 'mafia';

    return {
      type: 'night',
      message: 'Night falls. Close your eyes.',
      players: this.store.getAlivePlayers().map(p => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive,
      })),
      nightStep: 'mafia',
    };
  }

  /**
   * Get the current night step.
   * @returns {string|null}
   */
  getNightStep() {
    return this.nightStep;
  }

  /**
   * Check if all players in the current step have completed their actions.
   * @returns {boolean}
   */
  isCurrentStepComplete() {
    if (!this.nightStep || this.nightStep === 'complete') return true;

    switch (this.nightStep) {
      case 'mafia':
        return this.isMafiaStepComplete();
      case 'doctor':
        return this.isDoctorStepComplete();
      case 'detective':
        return this.isDetectiveStepComplete();
      default:
        return false;
    }
  }

  /**
   * Mafia step: complete when ALL alive mafia have cast a kill vote.
   * If no mafia alive (edge case), step is immediately complete.
   * @returns {boolean}
   */
  isMafiaStepComplete() {
    const onlineMafia = this.store.getAliveMafia().filter(m => m.status === 'online');
    if (onlineMafia.length === 0) return true;
    return onlineMafia.every(m => this.store.mafiaKills.has(m.id));
  }

  /**
   * Doctor step: complete when Doctor has acted, or if Doctor is dead.
   * @returns {boolean}
   */
  isDoctorStepComplete() {
    const onlineAlive = this.store.getAlivePlayers().filter(p => p.status === 'online');
    const doctor = onlineAlive.find(p => p.role && p.role.name === 'Doctor');
    // Complete if no online Doctor, or if Doctor has already protected someone
    if (!doctor) return true;
    return this.store.doctorProtected.length > 0;
  }

  /**
   * Detective step: complete when Detective has acted, or if Detective is dead.
   * @returns {boolean}
   */
  isDetectiveStepComplete() {
    const onlineAlive = this.store.getAlivePlayers().filter(p => p.status === 'online');
    const detective = onlineAlive.find(p => p.role && p.role.name === 'Detective');
    // Complete if no online Detective (no stored detection data)
    if (!detective) return true;
    return this.detectiveActed === true;
  }

  /**
   * Advance to the next night step.
   * @returns {string|null} The new step, or 'complete' if all steps done
   */
  advanceNightStep() {
    // Defensive guard: if nightStep is null (after resolveNight) or already complete, return complete.
    if (!this.nightStep || this.nightStep === 'complete') return 'complete';

    const steps = PhaseManager.NIGHT_STEPS;
    const currentIndex = steps.indexOf(this.nightStep);

    if (currentIndex === -1 || currentIndex >= steps.length - 1) {
      this.nightStep = 'complete';
      this.detectiveActed = false;
      return 'complete';
    }

    this.nightStep = steps[currentIndex + 1];
    return this.nightStep;
  }

  /**
   * Check if the entire night is complete (all steps done).
   * @returns {boolean}
   */
  isNightComplete() {
    return this.nightStep === 'complete';
  }

  /**
   * Get action data for a specific role.
   * Returns the targets, action type, and message for that role's night action.
   * @param {string} roleName - 'Mafia' | 'Doctor' | 'Detective'
   * @returns {{ actionType: string, message: string, targets: Array<{id: string, name: string}> }|null}
   */
  getActionDataForRole(roleName) {
    switch (roleName) {
      case 'Mafia':
        return this.getMafiaActionData();
      case 'Doctor':
        return this.getDoctorActionData();
      case 'Detective':
        return this.getDetectiveActionData();
      default:
        return null;
    }
  }

  /**
   * Get action data for the Mafia step.
   * @returns {object}
   */
  getMafiaActionData() {
    const targets = this.store.getAlivePlayers()
      .filter(p => (!p.role || p.role.team !== 'mafia'))
      .map(p => ({ id: p.id, name: p.name }));

    return {
      actionType: 'mafia_kill',
      message: 'Choose a player to eliminate tonight.',
      targets,
    };
  }

  /**
   * Get action data for the Doctor step.
   * @returns {object}
   */
  getDoctorActionData() {
    const targets = this.store.getAlivePlayers()
      .map(p => ({ id: p.id, name: p.name }));

    return {
      actionType: 'doctor_protect',
      message: 'Choose a player to protect tonight.',
      targets,
    };
  }

  /**
   * Get action data for the Detective step.
   * @returns {object}
   */
  getDetectiveActionData() {
    const detectiveId = this.getAliveDetective()?.id;
    const targets = this.store.getAlivePlayers()
      .filter(p => p.id !== detectiveId)
      .map(p => ({ id: p.id, name: p.name }));

    return {
      actionType: 'detective_investigate',
      message: 'Choose a player to investigate.',
      targets,
    };
  }

  /**
   * Get the alive Doctor player.
   * @returns {import('./Player.js').Player|null}
   */
  getDoctorPlayer() {
    const players = this.store.getAlivePlayers();
    return players.find(p => p.role && p.role.name === 'Doctor') || null;
  }

  /**
   * Get alive Mafia players.
   * @returns {import('./Player.js').Player[]}
   */
  getAliveMafiaPlayers() {
    return this.store.getAliveMafia();
  }

  /**
   * Get the alive Detective player.
   * @returns {import('./Player.js').Player|null}
   */
  getAliveDetective() {
    const players = this.store.getAlivePlayers();
    return players.find(p => p.role && p.role.name === 'Detective') || null;
  }

  /**
   * Handle a night action from a player.
   * @param {import('./Player.js').Player} player
   * @param {string} actionType
   * @param {import('./Player.js').Player} target
   * @returns {object} { success, message, target?, alignment?, stepComplete?: boolean }
   */
  handleNightAction(player, actionType, target) {
    let result;

    switch (actionType) {
      case 'mafia_kill':
        if (this.nightStep !== 'mafia') return { success: false, message: 'It is not the Mafia phase.' };
        this.store.addMafiaKill(player.id, target.id);
        result = { success: true, target: target.id, message: `You voted to eliminate ${target.name}.` };
        break;

      case 'doctor_protect':
        if (this.nightStep !== 'doctor') return { success: false, message: 'It is not the Doctor phase.' };
        this.store.addDoctorProtection(target.id);
        result = { success: true, target: target.id, message: `You will protect ${target.name} tonight.` };
        break;

      case 'detective_investigate': {
        if (this.nightStep !== 'detective') return { success: false, message: 'It is not the Detective phase.' };
        const alignment = target.role.getAlignment();
        this.detectiveActed = true;
        // Store the result for the morning reveal
        this.store.setDetectiveResult({
          targetId: target.id,
          targetName: target.name,
          alignment,
        });
        result = {
          success: true,
          target: target.id,
          alignment,
          message: `${target.name} is on the **${alignment}** team.`,
        };
        break;
      }

      default:
        return { success: false, message: 'Unknown action type.' };
    }

    // Check if this action completed the current step
    result.stepComplete = this.isCurrentStepComplete();

    return result;
  }

  /**
   * Get a waiting message for non-acting players in the current step.
   * Includes estimated remaining time.
   * @param {import('./Player.js').Player} player
   * @returns {string}
   */
  getWaitingMessage(player) {
    if (!player.isAlive) return 'You are dead. Waiting for the morning...';

    switch (this.nightStep) {
      case 'mafia':
        return 'The Mafia is choosing their target...';
      case 'doctor':
        return 'The Doctor is making their rounds...';
      case 'detective':
        return 'The Detective is investigating...';
      default:
        return 'Night falls. Close your eyes.';
    }
  }

  /**
   * Get a title for the current night step (for broadcasting transition messages).
   * @returns {string}
   */
  getStepTitle() {
    switch (this.nightStep) {
      case 'mafia': return '🌙 The Mafia is plotting...';
      case 'doctor': return '💉 The Doctor is making rounds...';
      case 'detective': return '🔍 The Detective is investigating...';
      default: return '🌙 Night Phase';
    }
  }

  /**
   * Resolve the night phase after all steps are complete.
   * @returns {object} Morning result to emit, including private detective result
   */
  resolveNight() {
    const result = this.store.resolveNightActions();
    const killedPlayer = result.killed ? this.store.players.get(result.killed) : null;

    // Retrieve the detective's investigation result
    const detectiveResult = this.store.getDetectiveResult();

    this.clearNightStepTimer();
    this.nightStep = null;
    this.detectiveActed = false;

    return {
      type: 'morning',
      message: result.message,
      killed: killedPlayer ? { id: killedPlayer.id, name: killedPlayer.name } : null,
      players: this.store.getPublicPlayers(),
      remainingAlive: this.store.getAliveCount(),
      totalPlayers: this.store.players.size,
      nightResult: result,
      detectiveResult, // included for the GameEngine to send privately to the Detective
    };
  }

  // ── Morning Phase ──────────────────────────────────────────

  startMorning() {
    this.currentPhase = 'morning';
    return {
      type: 'morning_announcement',
    };
  }

  // ── Day Phase ──────────────────────────────────────────────

  startDay() {
    this.currentPhase = 'day';
    return {
      type: 'day',
      message: 'The sun rises. Discuss who you suspect is Mafia!',
      players: this.store.getPublicPlayers(),
    };
  }

  // ── Voting Phase (Timed + Wait-for-All + Tie Re-Vote) ────

  /**
   * Start a new voting round.
   * @param {string[]|null} restrictedTargets - If set, only these player IDs can be voted on (tie-break)
   * @returns {object} Voting phase start data
   */
  startVoting(restrictedTargets = null) {
    this.currentPhase = 'voting';
    this.store.incrementVotingRound();
    this.store.clearVotes();
    this.store.setVotableTargets(restrictedTargets);

    const allAlive = this.store.getAlivePlayers();
    const votable = restrictedTargets
      ? allAlive.filter(p => restrictedTargets.includes(p.id))
      : allAlive;

    return {
      type: 'voting',
      message: restrictedTargets
        ? 'Tie-breaker round! Vote between the tied players.'
        : 'Time to vote! Who do you think is Mafia?',
      players: this.store.getPublicPlayers(),
      alivePlayers: allAlive.map(p => ({ id: p.id, name: p.name })),
      votableTargets: votable.map(p => ({ id: p.id, name: p.name })),
      votingRound: this.store.getVotingRound(),
      isTieBreaker: restrictedTargets !== null,
    };
  }

  /**
   * Handle a vote.
   * @param {import('./Player.js').Player} voter
   * @param {import('./Player.js').Player} target
   * @returns {object} { success, message, allVoted?: boolean }
   */
  handleVote(voter, target) {
    const recorded = this.store.castVote(voter.id, target.id);
    if (!recorded) {
      return { success: false, message: 'You have already voted.' };
    }

    const result = { success: true, message: `You voted to eliminate ${target.name}.` };

    // Check if all alive players have now voted
    if (this.store.isVotingComplete()) {
      result.allVoted = true;
    }

    return result;
  }

  /**
   * Get the current vote summary.
   * @returns {object}
   */
  getVoteSummary() {
    const counts = this.store.getVoteCounts();
    const summary = [];

    for (const [playerId, count] of counts) {
      const player = this.store.players.get(playerId);
      summary.push({
        playerId,
        playerName: player ? player.name : 'Unknown',
        votes: count,
      });
    }

    summary.sort((a, b) => b.votes - a.votes);

    return {
      votes: summary,
      totalVotes: this.store.votes.size,
      totalVoters: this.store.getAliveCount(),
    };
  }

  /**
   * Resolve the voting round.
   * If tie, returns information for a re-vote.
   * If clear winner, eliminates the target.
   * @returns {object} { eliminated, message, isTie, tiedIds?, needsReVote? }
   */
  resolveVoting() {
    const { eliminatedId, isTie, tiedIds } = this.store.resolveVotes();

    if (isTie && this.store.getVotingRound() > 1) {
      return {
        eliminated: null,
        message: 'The town could not reach a decision again. The day ends peacefully.',
        isTie: false,
        needsReVote: false,
      };
    }

    if (isTie || !eliminatedId) {
      // Tie — return tied players for re-vote
      const tiedPlayers = tiedIds.map(id => {
        const p = this.store.players.get(id);
        return p ? { id: p.id, name: p.name } : null;
      }).filter(Boolean);

      return {
        eliminated: null,
        message: tiedIds.length === 0
          ? 'No one voted. A peaceful day.'
          : `It\'s a tie between ${tiedPlayers.map(t => t.name).join(' and ')}! Re-vote needed.`,
        isTie: true,
        tiedIds,
        tiedPlayers,
        needsReVote: true,
      };
    }

    // Clear winner
    const eliminated = this.store.players.get(eliminatedId);
    if (eliminated) {
      eliminated.eliminate();

      return {
        eliminated: {
          id: eliminated.id,
          name: eliminated.name,
          role: eliminated.role?.name || 'Unknown',
          icon: eliminated.role?.icon || '❓',
          team: eliminated.role?.getAlignment() || 'unknown',
        },
        message: `${eliminated.name} (${eliminated.role?.icon || ''} ${eliminated.role?.name || 'Unknown'}) has been eliminated.`,
        players: this.store.getPublicPlayers(),
        isTie: false,
        needsReVote: false,
      };
    }

    return {
      eliminated: null,
      message: 'No one was eliminated.',
      isTie: false,
      needsReVote: false,
    };
  }
}

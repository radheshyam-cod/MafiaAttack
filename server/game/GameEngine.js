import { GameStore } from './GameStore.js';
import { GameValidator } from './GameValidator.js';
import { PhaseManager } from './PhaseManager.js';
import { RoleFactory } from './RoleFactory.js';

/**
 * GameEngine — the single authority for game logic.
 *
 * Responsibilities:
 * 1. Validate ALL client inputs via GameValidator (never trust the client)
 * 2. Mutate state via GameStore (pure data)
 * 3. Manage phases via PhaseManager (pure state machine)
 * 4. Emit results to clients via Socket.IO (only I/O boundary)
 *
 * This is the ONLY class that touches `io`. Every other class
 * in the game/ directory is pure logic.
 */
export class GameEngine {
  /**
   * @param {string} roomCode
   * @param {import('socket.io').Server} io
   */
  constructor(roomCode, io) {
    /** @type {GameStore} */
    this.store = new GameStore(roomCode);

    /** @type {import('socket.io').Server} */
    this.io = io;

    /** @type {PhaseManager} */
    this.phases = new PhaseManager(this.store);

    /** @type {boolean} */
    this.destroyed = false;

    /** Guards against race conditions from simultaneous action+timeout advancement */
    this._advancingNight = false;
    this._votingResolved = false;
  }

  /**
   * Add a player to the lobby.
   * @param {string} playerId
   * @param {string} name
   * @param {string} socketId
   * @returns {object} { success: boolean, error?: string }
   */
  addPlayer(playerId, name, socketId) {
    const nameVal = GameValidator.validateName(name);
    if (!nameVal.valid) return { success: false, error: nameVal.error };

    try {
      this.store.addPlayer(playerId, name.trim(), socketId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a player from the game.
   * @param {string} playerId
   */
  removePlayer(playerId) {
    this.store.removePlayer(playerId);
  }

  /**
   * Start the game.
   * @param {string} socketId - Host's socket ID
   * @returns {object} { success: boolean, error?: string }
   */
  startGame(socketId) {
    // Validate host
    const hostVal = GameValidator.validateHost(this.store, socketId);
    if (!hostVal.valid) return { success: false, error: hostVal.error };

    // Validate game state
    const stateVal = GameValidator.validateGameStart(this.store);
    if (!stateVal.valid) return { success: false, error: stateVal.error };

    // Assign roles
    RoleFactory.assignRoles(this.store);

    this.store.state = 'playing';

    // Broadcast game started FIRST so clients can transition to game screen
    this.broadcastGameStarted();

    // Send role reveals to each player
    this.sendRoleReveals();

    // Start night phase
    this.startNightPhase();

    return { success: true };
  }

  /**
   * Send each player their role assignment privately.
   * Mafia members also receive the names of their teammates.
   */
  sendRoleReveals() {
    const mafiaTeam = this.getMafiaTeamInfo();

    for (const player of this.store.players.values()) {
      if (!player.socketId) continue;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (!socket || !player.role) continue;

      const reveal = {
        role: player.role.toJSON(),
        team: player.role.getAlignment(),
        description: player.role.description,
      };

      // Mafia members see their teammates
      if (player.role.team === 'mafia') {
        reveal.mafiaTeam = mafiaTeam.filter(m => m.id !== player.id);
      }

      socket.emit('role:assigned', reveal);
    }
  }

  /**
   * Get info about all mafia members for role reveals.
   * @returns {Array<{id: string, name: string}>}
   */
  getMafiaTeamInfo() {
    const mafia = [];
    for (const player of this.store.players.values()) {
      if (player.role && player.role.team === 'mafia') {
        mafia.push({ id: player.id, name: player.name });
      }
    }
    return mafia;
  }

  // ── Phase Management ───────────────────────────────────────

  /**
   * Broadcast the game started event to all players.
   */
  broadcastGameStarted() {
    this.io.to(this.store.roomCode).emit('game:started', {
      gameState: this.store.getPublicState(),
    });
  }

  /**
   * Start the night phase with sequential steps.
   * Broadcasts phase start, then sends actions for the first step (Mafia).
   */
  /**
   * Broadcast voice permissions to all players based on the current phase.
   *
   * Voice rules per phase:
   * - lobby: all players can speak
   * - night (before steps): all muted
   * - mafia step: only alive mafia players can speak/hear each other
   * - doctor step: only Doctor mic enabled
   * - detective step: only Detective mic enabled
   * - morning/day/voting/ended: all alive players can speak
   */
  broadcastVoicePermissions() {
    if (!this.store || !this.store.roomCode) return;

    const isNightStep = this.store.phase === 'night' && this.phases && this.phases.getNightStep();
    const nightStep = isNightStep ? this.phases.getNightStep() : null;

    let speakingIds = [];

    if (this.store.state === 'lobby') {
      // Lobby: everyone can speak
      speakingIds = Array.from(this.store.players.values())
        .filter(p => p.isAlive)
        .map(p => p.id);
    } else if (this.store.state === 'playing') {
      switch (nightStep) {
        case 'mafia': {
          // Only alive mafia can speak and hear each other
          speakingIds = this.store.getAliveMafia().map(p => p.id);
          break;
        }
        case 'doctor': {
          // Only Doctor mic enabled
          const doctor = this.store.findPlayerByRole('Doctor');
          if (doctor && doctor.isAlive) speakingIds = [doctor.id];
          break;
        }
        case 'detective': {
          // Only Detective mic enabled
          const detective = this.store.findPlayerByRole('Detective');
          if (detective && detective.isAlive) speakingIds = [detective.id];
          break;
        }
        default: {
          // morning, day, voting, or night before step start
          if (this.store.phase === 'night') {
            // Night before any step: everyone muted
            speakingIds = [];
          } else {
            // morning, day, voting: all alive players can speak
            speakingIds = this.store.getAlivePlayers().map(p => p.id);
          }
          break;
        }
      }
    } else if (this.store.state === 'ended') {
      // Winner screen: all alive can speak
      speakingIds = Array.from(this.store.players.values())
        .filter(p => p.isAlive)
        .map(p => p.id);
    }

    // Broadcast to all players in the room
    this.io.to(this.store.roomCode).emit('voice:permissions', {
      phase: this.store.phase,
      nightStep,
      speakingIds,
      state: this.store.state,
    });
  }

  startNightPhase() {
    this._advancingNight = false;

    const phaseData = this.phases.startNight();

    this.store.setPhase('night');

    // Broadcast phase start to all players
    this.io.to(this.store.roomCode).emit('phase:night', {
      phase: this.store.getPhaseState(0),
      players: phaseData.players,
      nightStep: 'mafia',
    });

    // Broadcast voice permissions (everyone muted for night)
    this.broadcastVoicePermissions();

    // Send actions for the first step and start its timer
    this.sendActionsForCurrentStep();
    this.phases.startNightStepTimer(() => this.onNightStepTimeout());
  }

  /**
   * Send action prompts for the current night step to the appropriate players.
   * Players not involved in the current step receive a waiting message.
   */
  sendActionsForCurrentStep() {
    const step = this.phases.getNightStep();
    if (!step || step === 'complete') return;

    const stepTitle = this.phases.getStepTitle();

    // Broadcast step transition to all players
    this.io.to(this.store.roomCode).emit('night:step', {
      step,
      title: stepTitle,
    });

    // Broadcast voice permissions for the new step
    this.broadcastVoicePermissions();

    for (const player of this.store.players.values()) {
      if (!player.socketId) continue;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (!socket) continue;

      if (!player.isAlive) {
        socket.emit('night:waiting', {
          message: 'You are dead. Waiting for the morning...',
        });
        continue;
      }

      const action = this.getActionForCurrentStep(player);
      if (action) {
        socket.emit('night:action', action);
      } else {
        socket.emit('night:waiting', {
          message: this.phases.getWaitingMessage(player),
          timeRemaining: this.phases.getNightStepTimeRemaining(),
        });
      }
    }
  }

  /**
   * Send the current night action to a specific player (for reconnects).
   * @param {string} playerId
   */
  sendNightActionToPlayer(playerId) {
    const player = this.store.players.get(playerId);
    if (!player || !player.socketId) return;
    const socket = this.io.sockets.sockets.get(player.socketId);
    if (!socket) return;
    
    if (!player.isAlive) {
      socket.emit('night:waiting', {
        message: 'You are dead. Waiting for the morning...',
      });
      return;
    }

    const action = this.getActionForCurrentStep(player);
    if (action) {
      socket.emit('night:action', action);
    } else {
      socket.emit('night:waiting', {
        message: this.phases.getWaitingMessage(player),
        timeRemaining: this.phases.getNightStepTimeRemaining(),
      });
    }
  }

  /**
   * Get the action prompt for a player based on the current night step.
   * @param {import('./Player.js').Player} player
   * @returns {object|null}
   */
  getActionForCurrentStep(player) {
    const step = this.phases.getNightStep();
    if (!step || !player.role) return null;

    switch (step) {
      case 'mafia': {
        // Only alive mafia players who haven't voted yet get the action screen
        if (player.role.name !== 'Mafia') return null;
        if (this.store.mafiaKills.has(player.id)) return null; // already voted
        const data = this.phases.getActionDataForRole('Mafia');
        return { ...data, timeRemaining: this.phases.getNightStepTimeRemaining() };
      }
      case 'doctor': {
        if (player.role.name !== 'Doctor') return null;
        if (this.store.doctorProtected.length > 0) return null; // already acted
        const data = this.phases.getActionDataForRole('Doctor');
        return { ...data, timeRemaining: this.phases.getNightStepTimeRemaining() };
      }
      case 'detective': {
        if (player.role.name !== 'Detective') return null;
        // Check if detective already acted this night
        const data = this.phases.getActionDataForRole('Detective');
        // If detective already acted, they won't get the action screen
        // (handled by the step completion check)
        return { ...data, timeRemaining: this.phases.getNightStepTimeRemaining() };
      }
      default:
        return null;
    }
  }

  /**
   * Handle a night action from a player.
   * After execution, checks if the current step is complete and auto-advances.
   * @param {string} socketId
   * @param {string} actionType
   * @param {string} targetId
   * @returns {Promise<object>}
   */
  async handleNightAction(socketId, actionType, targetId) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return playerVal;

    const actionVal = GameValidator.validateNightAction(
      this.store, playerVal.player, actionType, targetId
    );
    if (!actionVal.valid) return actionVal;

    const result = this.phases.handleNightAction(playerVal.player, actionType, actionVal.target);
    if (!result.success) return result;

    // For mafia kills, notify allies
    if (actionType === 'mafia_kill') {
      this.notifyMafiaAllies(playerVal.player, targetId);
    }

    // Check if the current step is complete — if so, advance
    // Called synchronously (not via setImmediate) to avoid race conditions
    // with the night step timeout also trying to advance.
    if (result.stepComplete) {
      this.advanceNightStep();
    }

    return result;
  }

  /**
   * Handle a night step timeout — all required players didn't act in time.
   * Simply advance to the next step; uncast actions are skipped.
   */
  onNightStepTimeout() {
    if (this.destroyed) return;
    console.log(`[Night] Step timed out (${this.phases.getNightStep()}), advancing...`);
    this.advanceNightStep();
  }

  /**
   * Advance to the next night step or resolve if all steps are done.
   * Uses a guard (_advancingNight) to prevent race conditions when
   * both a last-second action and the timeout try to advance simultaneously.
   */
  advanceNightStep() {
    if (this.destroyed || this._advancingNight) return;
    this._advancingNight = true;

    // Clear the current step timer
    this.phases.clearNightStepTimer();

    const result = this.phases.advanceNightStep();

    if (this.phases.isNightComplete()) {
      this.resolveNightPhase();
    } else {
      this.sendActionsForCurrentStep();
      this.phases.startNightStepTimer(() => this.onNightStepTimeout());
    }

    this._advancingNight = false;
  }

  /**
   * Notify mafia allies about a kill vote.
   * @param {import('./Player.js').Player} voter
   * @param {string} targetId
   */
  notifyMafiaAllies(voter, targetId) {
    const mafiaPlayers = this.store.getAliveMafia();
    for (const mafia of mafiaPlayers) {
      if (mafia.socketId && mafia.socketId !== voter.socketId) {
        const mafiaSocket = this.io.sockets.sockets.get(mafia.socketId);
        if (mafiaSocket) {
          mafiaSocket.emit('mafia:voteUpdate', {
            voterId: voter.id,
            targetId,
            totalVotes: this.store.mafiaKills.size,
            totalMafia: mafiaPlayers.length,
          });
        }
      }
    }
  }

  /**
   * Handle a phase timeout (morning, day, voting).
   * @param {string} phaseName
   */
  onPhaseTimeout(phaseName) {
    if (this.destroyed) return;

    switch (phaseName) {
      case 'morning':
        this.afterMorning();
        break;

      case 'day':
        this.startVotingPhase();
        break;
    }
  }

  /**
   * Resolve the night phase and transition to morning.
   * Broadcasts the public result to everyone, then privately
   * sends the Detective's investigation result if one exists.
   */
  resolveNightPhase() {
    const result = this.phases.resolveNight();

    // Update phase state BEFORE emitting
    this.store.setPhase('morning');
    const morningDuration = this.phases.getDuration('morning');

    // Broadcast public morning result to all players
    this.io.to(this.store.roomCode).emit('phase:morning', {
      phase: this.store.getPhaseState(morningDuration),
      message: result.message,
      killed: result.killed,
      players: result.players,
      remainingAlive: result.remainingAlive,
      totalPlayers: result.totalPlayers,
    });

    // Broadcast voice permissions for morning (all alive can speak)
    this.broadcastVoicePermissions();

    // Privately send the Detective's investigation result
    if (result.detectiveResult) {
      const detectivePlayer = this.phases.getAliveDetective();
      if (detectivePlayer && detectivePlayer.socketId) {
        const detectiveSocket = this.io.sockets.sockets.get(detectivePlayer.socketId);
        if (detectiveSocket) {
          detectiveSocket.emit('morning:detective_result', {
            targetId: result.detectiveResult.targetId,
            targetName: result.detectiveResult.targetName,
            alignment: result.detectiveResult.alignment,
          });
        }
      }
    }

    this.phases.startPhase('morning', (endedPhase) => {
      this.onPhaseTimeout(endedPhase);
    });
  }

  /**
   * After morning phase ends, check win or go to day.
   */
  afterMorning() {
    const winner = this.store.checkWinCondition();
    if (winner) {
      this.endGame();
    } else {
      this.startDayPhase();
    }
  }

  /**
   * Start the day discussion phase.
   */
  startDayPhase() {
    const phaseData = this.phases.startPhase('day', (endedPhase) => {
      this.onPhaseTimeout(endedPhase);
    });

    this.io.to(this.store.roomCode).emit('phase:day', {
      phase: phaseData.phase,
      message: phaseData.message,
      players: phaseData.players,
    });

    // Broadcast voice permissions for day (all alive can speak)
    this.broadcastVoicePermissions();
  }

  /**
   * Handle a chat message from a player.
   * @param {string} socketId
   * @param {string} message
   * @returns {object}
   */
  handleChat(socketId, message) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return playerVal;

    const chatVal = GameValidator.validateChat(this.store, playerVal.player, message);
    if (!chatVal.valid) return chatVal;

    // Broadcast the chat message
    this.io.to(this.store.roomCode).emit('chat:message', {
      playerId: playerVal.player.id,
      playerName: playerVal.player.name,
      message: message.trim().substring(0, 500),
      timestamp: Date.now(),
      isAlive: playerVal.player.isAlive,
    });

    return { success: true, message: 'Message sent.' };
  }

  /**
   * Start the voting phase with a 45-second timeout.
   * Players who don't vote in time are counted as abstaining.
   * @param {string[]|null} restrictedTargets - For tie-breaker rounds
   */
  startVotingPhase(restrictedTargets = null) {
    this._votingResolved = false;
    this.store.setPhase('voting');

    const phaseData = this.phases.startVoting(restrictedTargets);

    this.io.to(this.store.roomCode).emit('phase:voting', {
      phase: this.store.getPhaseState(PhaseManager.VOTING_DURATION),
      message: phaseData.message,
      players: phaseData.players,
      alivePlayers: phaseData.alivePlayers,
      votableTargets: phaseData.votableTargets,
      votingRound: phaseData.votingRound,
      isTieBreaker: phaseData.isTieBreaker,
    });

    // Broadcast voice permissions for voting (all alive can speak)
    this.broadcastVoicePermissions();

    // Start voting timeout timer
    this.phases.clearTimer();
    this.phases.timer = setTimeout(() => {
      this.phases.timer = null;
      this.resolveVotingPhase();
    }, PhaseManager.VOTING_DURATION);
  }

  /**
   * Handle a vote cast.
   * After each vote, checks if all players have voted. If so, resolves immediately.
   * @param {string} socketId
   * @param {string} targetId
   * @returns {Promise<object>}
   */
  async handleVote(socketId, targetId) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return playerVal;

    const voteVal = GameValidator.validateVote(this.store, playerVal.player, targetId);
    if (!voteVal.valid) return voteVal;

    const result = this.phases.handleVote(playerVal.player, voteVal.target);
    if (!result.success) return result;

    // Broadcast updated vote summary
    this.io.to(this.store.roomCode).emit('vote:update', this.phases.getVoteSummary());

    // If all players have voted, resolve immediately
    if (result.allVoted) {
      this.resolveVotingPhase();
    }

    return result;
  }

  /**
   * Resolve the voting round.
   * Uses a guard (_votingResolved) to prevent race conditions when
   * both the last vote and the timer try to resolve simultaneously.
   * If tie, starts a re-vote between tied players.
   * Otherwise, eliminates the winner and checks win condition.
   */
  resolveVotingPhase() {
    if (this.destroyed || this._votingResolved) return;
    this._votingResolved = true;

    // Clear the voting timer
    this.phases.clearTimer();

    const result = this.phases.resolveVoting();
    const voteSummary = this.phases.getVoteSummary();

    // Broadcast vote result
    this.io.to(this.store.roomCode).emit('vote:result', {
      ...result,
      votes: voteSummary.votes,
    });

    if (result.needsReVote) {
      // Start a tie-breaker re-vote between tied players
      this.startVotingPhase(result.tiedIds);
    } else {
      // Check win condition
      const winner = this.store.checkWinCondition();
      if (winner) {
        this.endGame();
      } else {
        this.startNightPhase();
      }
    }
  }

  /**
   * End the game and announce winner.
   */
  endGame() {
    this.store.state = 'ended';
    this.phases.destroy();

    const winner = this.store.winner;
    if (winner) {
      const allPlayers = this.store.getAllPlayersWithRoles();
      const survivors = allPlayers.filter(p => p.isAlive);
      const dead = allPlayers.filter(p => !p.isAlive);

      this.io.to(this.store.roomCode).emit('game:ended', {
        winner,
        players: this.store.getPublicPlayers(),
        allPlayers,
        survivors,
        dead,
        stats: this.store.getGameStats(),
      });

      // Broadcast voice permissions for winner screen (all alive can speak)
      this.broadcastVoicePermissions();
    }
  }

  /**
   * Reset the game back to lobby state so players can play again.
   * The host triggers this. Keeps the same players but resets all game state.
   * @param {string} socketId
   * @returns {object} { success: boolean, error?: string }
   */
  playAgain(socketId) {
    const hostVal = GameValidator.validateHost(this.store, socketId);
    if (!hostVal.valid) return { success: false, error: hostVal.error };

    if (this.store.state !== 'ended') {
      return { success: false, error: 'Game has not ended yet.' };
    }

    // Preserve players but reset their state
    for (const player of this.store.players.values()) {
      player.role = null;
      player.isAlive = true;
      player.isHost = (player.id === this.store.hostId);
    }

    // Reset store state
    this.store.state = 'lobby';
    this.store.roundNumber = 0;
    this.store.phase = null;
    this.store.phaseStartedAt = null;
    this.store.winner = null;
    this.store.clearVotes();
    this.store.clearNightActions();

    // Broadcast lobby state to all players
    this.io.to(this.store.roomCode).emit('game:playAgain', {
      players: this.store.getPublicPlayers(),
      hostId: this.store.hostId,
      playerCount: this.store.players.size,
    });

    // Broadcast voice permissions for lobby (everyone can speak)
    this.broadcastVoicePermissions();

    console.log(`[Room] Play again: ${this.store.roomCode}`);

    return { success: true };
  }

  /**
   * Get the public game state.
   * @param {string|null} forSocketId
   * @returns {object}
   */
  getState(forSocketId = null) {
    const state = this.store.getPublicState(forSocketId);
    state.phase = this.store.phase ? this.store.getPhaseState(this.phases.duration) : null;
    return state;
  }

  /**
   * Clean up the engine.
   */
  destroy() {
    this.destroyed = true;
    this.phases.destroy();
  }
}

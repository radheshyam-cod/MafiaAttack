import { GameStore } from './GameStore.js';
import { GameValidator } from './GameValidator.js';
import { PhaseManager } from './PhaseManager.js';
import { RoleFactory } from './RoleFactory.js';

export class GameEngine {
  constructor(roomCode, io) {
    this.store = new GameStore(roomCode);
    this.io = io;
    this.phases = new PhaseManager(this.store);
    this.destroyed = false;
    this._advancingNight = false;
    this._votingResolved = false;
    this._mafiaPhase = null;
    this._mafiaDiscussionTimer = null;
    this._mafiaVoteTimer = null;
  }

  _getSocket(socketId) {
    return socketId ? this.io.sockets.sockets.get(socketId) : null;
  }

  _routeToMafia(player, event, payload) {
    if (player.role?.team !== 'mafia' || !player.isAlive) return false;
    for (const mafia of this.store.getAliveMafia()) {
      const s = this._getSocket(mafia.socketId);
      if (s) s.emit(event, payload);
    }
    return true;
  }

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

  removePlayer(playerId) {
    this.store.removePlayer(playerId);
  }

  startGame(socketId) {
    const hostVal = GameValidator.validateHost(this.store, socketId);
    if (!hostVal.valid) return { success: false, error: hostVal.error };
    const stateVal = GameValidator.validateGameStart(this.store);
    if (!stateVal.valid) return { success: false, error: stateVal.error };

    RoleFactory.assignRoles(this.store);
    this.store.state = 'playing';
    this.broadcastGameStarted();
    this.sendRoleReveals();
    this.startNightPhase();
    return { success: true };
  }

  sendRoleReveals() {
    const mafiaTeam = this.getMafiaTeamInfo();
    for (const player of this.store.players.values()) {
      const socket = this._getSocket(player.socketId);
      if (!socket || !player.role) continue;

      const reveal = {
        role: player.role.toJSON(),
        team: player.role.getAlignment(),
        description: player.role.description,
      };
      if (player.role.team === 'mafia') {
        reveal.mafiaTeam = mafiaTeam.filter(m => m.id !== player.id);
      }
      socket.emit('role:assigned', reveal);
    }
  }

  getMafiaTeamInfo() {
    const mafia = [];
    for (const player of this.store.players.values()) {
      if (player.role?.team === 'mafia') {
        mafia.push({ id: player.id, name: player.name });
      }
    }
    return mafia;
  }

  broadcastGameStarted() {
    this.io.to(this.store.roomCode).emit('game:started', {
      gameState: this.store.getPublicState(),
    });
  }

  _resolveSpeakingIds() {
    const state = this.store.state;
    if (state === 'lobby' || state === 'ended') {
      return Array.from(this.store.players.values())
        .filter(p => p.isAlive)
        .map(p => p.id);
    }

    if (state !== 'playing') return [];

    const hasStep = this.store.phase === 'night' && this.phases.getNightStep();
    const nightStep = hasStep ? this.phases.getNightStep() : null;

    if (!nightStep) {
      return this.store.phase === 'night' ? [] : this.store.getAlivePlayers().map(p => p.id);
    }

    switch (nightStep) {
      case 'mafia': return this.store.getAliveMafia().map(p => p.id);
      case 'doctor': {
        const doctor = this.store.findPlayerByRole('Doctor');
        return doctor?.isAlive ? [doctor.id] : [];
      }
      case 'detective': {
        const detective = this.store.findPlayerByRole('Detective');
        return detective?.isAlive ? [detective.id] : [];
      }
      default: return [];
    }
  }

  broadcastVoicePermissions() {
    if (!this.store?.roomCode) return;
    const baseIds = this._resolveSpeakingIds();

    for (const player of this.store.players.values()) {
      if (!player.socketId) continue;
      const isNightStep = this.store.state === 'playing' && this.store.phase === 'night' && this.phases.getNightStep();
      const speakingIds = isNightStep && !baseIds.includes(player.id) ? [] : baseIds;

      this.io.to(player.socketId).emit('voice:permissions', {
        phase: this.store.phase,
        nightStep: this.phases.getNightStep() || null,
        speakingIds,
        state: this.store.state,
      });
    }
  }

  startNightPhase() {
    this._advancingNight = false;
    const phaseData = this.phases.startNight();
    this.store.setPhase('night');

    this.io.to(this.store.roomCode).emit('phase:night', {
      phase: this.store.getPhaseState(0),
      players: phaseData.players,
      nightStep: 'mafia',
    });
    this.broadcastVoicePermissions();

    const introDelay = this.phases.getNightIntroDelay();
    const cb = () => {
      if (this.destroyed || this.store.state !== 'playing' || this.store.phase !== 'night') return;
      this.sendActionsForCurrentStep();
      this.phases.startNightStepTimer(() => this.onNightStepTimeout());
    };

    if (introDelay > 0) {
      this._nightIntroTimer = setTimeout(cb, introDelay);
    } else {
      cb();
    }
  }

  sendActionsForCurrentStep() {
    const step = this.phases.getNightStep();
    if (!step || step === 'complete') return;

    this.io.to(this.store.roomCode).emit('night:step', { step, title: this.phases.getStepTitle() });

    if (step === 'mafia') {
      this.startMafiaChannel();
      return;
    }

    this.broadcastVoicePermissions();

    for (const player of this.store.players.values()) {
      const socket = this._getSocket(player.socketId);
      if (!socket) continue;

      if (!player.isAlive) {
        socket.emit('night:waiting', { message: 'You are dead. Waiting for the morning...' });
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

  startMafiaChannel() {
    this.broadcastVoicePermissions();
    this._mafiaPhase = 'discussion';
    this.store.mafiaKills.clear();

    const discussionDur = this.phases.getMafiaDiscussionDuration() || 30000;
    const mafiaTeam = this.getMafiaTeamInfo();

    for (const player of this.store.players.values()) {
      const socket = this._getSocket(player.socketId);
      if (!socket) continue;

      if (!player.isAlive) {
        socket.emit('night:waiting', { message: 'You are dead. Waiting for the morning...' });
      } else if (player.role?.team === 'mafia') {
        socket.emit('mafia:channel_start', {
          duration: discussionDur,
          mafiaTeam: mafiaTeam.filter(m => m.id !== player.id),
        });
      } else {
        socket.emit('night:waiting', {
          message: 'Sleeping...',
          timeRemaining: discussionDur + (this.phases.getMafiaVoteDuration() || 10000),
        });
      }
    }

    clearTimeout(this._mafiaDiscussionTimer);
    this._mafiaDiscussionTimer = setTimeout(() => this.startMafiaVoting(), discussionDur);
  }

  startMafiaVoting() {
    this._mafiaPhase = 'voting';
    const voteDur = this.phases.getMafiaVoteDuration() || 10000;
    const actionData = this.phases.getActionDataForRole('Mafia');

    for (const mafia of this.store.getAliveMafia()) {
      const socket = this._getSocket(mafia.socketId);
      if (socket) {
        socket.emit('mafia:vote_start', { duration: voteDur, targets: actionData.targets });
      }
    }

    clearTimeout(this._mafiaVoteTimer);
    this._mafiaVoteTimer = setTimeout(() => this.resolveMafiaVoting(), voteDur);
  }

  resolveMafiaVoting() {
    this._mafiaPhase = null;
    const aliveMafia = this.store.getAliveMafia();
    const votes = Array.from(this.store.mafiaKills.values());

    if (votes.length > 0) {
      const counts = new Map();
      let maxVotes = 0;
      let finalTarget = null;
      for (const t of votes) {
        const c = (counts.get(t) || 0) + 1;
        counts.set(t, c);
        if (c > maxVotes) { maxVotes = c; finalTarget = t; }
      }
      this.store.mafiaKills.clear();
      for (const mafia of aliveMafia) this.store.mafiaKills.set(mafia.id, finalTarget);
    } else {
      this.store.mafiaKills.clear();
      for (const mafia of aliveMafia) this.store.mafiaKills.set(mafia.id, 'abstain');
    }

    this.advanceNightStep();
  }

  sendNightActionToPlayer(playerId) {
    const player = this.store.players.get(playerId);
    const socket = this._getSocket(player?.socketId);
    if (!socket) return;

    if (!player.isAlive) {
      socket.emit('night:waiting', { message: 'You are dead. Waiting for the morning...' });
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

  getActionForCurrentStep(player) {
    const step = this.phases.getNightStep();
    if (!step || !player.role) return null;

    if (step === 'mafia') return null;

    const roleStepMap = { doctor: 'Doctor', detective: 'Detective' };
    if (player.role.name !== roleStepMap[step]) return null;

    const acted = step === 'doctor'
      ? this.store.doctorProtected.length > 0
      : step === 'detective' && this.store.getDetectiveResult() !== null;
    if (acted) return null;

    const data = this.phases.getActionDataForRole(roleStepMap[step]);
    return { ...data, timeRemaining: this.phases.getNightStepTimeRemaining() };
  }

  async handleNightAction(socketId, actionType, targetId) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return playerVal;
    const { player } = playerVal;

    const actionVal = GameValidator.validateNightAction(this.store, player, actionType, targetId);
    if (!actionVal.valid) return actionVal;

    const result = this.phases.handleNightAction(player, actionType, actionVal.target);
    if (!result.success) return result;

    if (actionType === 'detective_investigate') {
      const detectiveSocket = this._getSocket(player.socketId);
      if (detectiveSocket) {
        detectiveSocket.emit('night:detective_result', {
          targetId: actionVal.target.id,
          targetName: actionVal.target.name,
          alignment: actionVal.target.role === 'Mafia' ? 'Mafia' : 'Not Mafia',
        });
      }
    }

    if (actionType === 'mafia_kill') {
      this.notifyMafiaAllies(player, targetId);
    }

    if (result.stepComplete && actionType !== 'mafia_kill') {
      this.advanceNightStep();
    }

    return result;
  }

  onNightStepTimeout() {
    if (this.destroyed) return;
    this.advanceNightStep();
  }

  advanceNightStep() {
    if (this.destroyed || this._advancingNight) return;
    this._advancingNight = true;
    this.phases.clearNightStepTimer();
    this.phases.advanceNightStep();

    if (this.phases.isNightComplete()) {
      this.resolveNightPhase();
    } else {
      this.sendActionsForCurrentStep();
      this.phases.startNightStepTimer(() => this.onNightStepTimeout());
    }

    this._advancingNight = false;
  }

  notifyMafiaAllies(voter, targetId) {
    const mafiaPlayers = this.store.getAliveMafia();
    for (const mafia of mafiaPlayers) {
      if (!mafia.socketId || mafia.socketId === voter.socketId) continue;
      const socket = this._getSocket(mafia.socketId);
      if (!socket) continue;
      socket.emit('mafia:voteUpdate', {
        voterId: voter.id,
        targetId,
        totalVotes: this.store.mafiaKills.size,
        totalMafia: mafiaPlayers.length,
      });
    }
  }

  onPhaseTimeout(phaseName) {
    if (this.destroyed) return;
    if (phaseName === 'morning') this.afterMorning();
    else if (phaseName === 'day') this.startVotingPhase();
  }

  resolveNightPhase() {
    const result = this.phases.resolveNight();
    this.store.setPhase('morning');
    const morningDuration = this.phases.getDuration('morning');

    this.io.to(this.store.roomCode).emit('phase:morning', {
      phase: this.store.getPhaseState(morningDuration),
      message: result.message,
      killed: result.killed,
      players: result.players,
      remainingAlive: result.remainingAlive,
      totalPlayers: result.totalPlayers,
    });
    this.broadcastVoicePermissions();

    if (result.detectiveResult) {
      const detective = this._getSocket(this.phases.getAliveDetective()?.socketId);
      if (detective) {
        detective.emit('morning:detective_result', {
          targetId: result.detectiveResult.targetId,
          targetName: result.detectiveResult.targetName,
          alignment: result.detectiveResult.alignment,
        });
      }
    }

    this.phases.startPhase('morning', (p) => this.onPhaseTimeout(p));
  }

  afterMorning() {
    const winner = this.store.checkWinCondition();
    if (winner) this.endGame();
    else this.startDayPhase();
  }

  startDayPhase() {
    const phaseData = this.phases.startPhase('day', (p) => this.onPhaseTimeout(p));
    this.io.to(this.store.roomCode).emit('phase:day', {
      phase: phaseData.phase,
      message: phaseData.message,
      players: phaseData.players,
    });
    this.broadcastVoicePermissions();
  }

  handleChat(socketId, message) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return playerVal;
    const { player } = playerVal;

    const chatVal = GameValidator.validateChat(this.store, player, message);
    if (!chatVal.valid) return chatVal;

    const msgPayload = {
      playerId: player.id,
      playerName: player.name,
      message: message.trim().substring(0, 500),
      timestamp: Date.now(),
      isAlive: player.isAlive,
    };

    if (this.store.phase === 'night' && this.phases.getNightStep() === 'mafia') {
      if (this._routeToMafia(player, 'chat:message', msgPayload)) {
        return { success: true, message: 'Message sent securely.' };
      }
      return { success: false, message: 'You cannot speak right now.' };
    }

    this.io.to(this.store.roomCode).emit('chat:message', msgPayload);
    return { success: true, message: 'Message sent.' };
  }

  handleTyping(socketId, isTyping) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return;

    const payload = { playerId: playerVal.player.id, isTyping: !!isTyping };

    if (this.store.phase === 'night' && this.phases.getNightStep() === 'mafia') {
      this._routeToMafia(playerVal.player, 'chat:typing', payload);
      return;
    }

    this.io.to(this.store.roomCode).emit('chat:typing', payload);
  }

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
    this.broadcastVoicePermissions();

    this.phases.clearTimer();
    this.phases.timer = setTimeout(() => {
      this.phases.timer = null;
      this.resolveVotingPhase();
    }, PhaseManager.VOTING_DURATION);
  }

  async handleVote(socketId, targetId) {
    const playerVal = GameValidator.validatePlayer(this.store, socketId);
    if (!playerVal.valid) return playerVal;
    const { player } = playerVal;

    const voteVal = GameValidator.validateVote(this.store, player, targetId);
    if (!voteVal.valid) return voteVal;

    const result = this.phases.handleVote(player, voteVal.target);
    if (!result.success) return result;

    this.io.to(this.store.roomCode).emit('vote:update', this.phases.getVoteSummary());

    if (result.allVoted) this.resolveVotingPhase();
    return result;
  }

  resolveVotingPhase() {
    if (this.destroyed || this._votingResolved) return;
    this._votingResolved = true;
    this.phases.clearTimer();

    const result = this.phases.resolveVoting();
    this.io.to(this.store.roomCode).emit('vote:result', {
      ...result,
      votes: this.phases.getVoteSummary().votes,
    });

    if (result.needsReVote) {
      this.startVotingPhase(result.tiedIds);
    } else {
      const winner = this.store.checkWinCondition();
      if (winner) this.endGame();
      else this.startNightPhase();
    }
  }

  endGame() {
    clearTimeout(this._nightIntroTimer);
    this._nightIntroTimer = null;
    this.store.state = 'ended';
    this.phases.destroy();

    if (!this.store.winner) return;
    const allPlayers = this.store.getAllPlayersWithRoles();

    this.io.to(this.store.roomCode).emit('game:ended', {
      winner: this.store.winner,
      players: this.store.getPublicPlayers(),
      allPlayers,
      survivors: allPlayers.filter(p => p.isAlive),
      dead: allPlayers.filter(p => !p.isAlive),
      stats: this.store.getGameStats(),
    });
    this.broadcastVoicePermissions();
  }

  playAgain(socketId) {
    const hostVal = GameValidator.validateHost(this.store, socketId);
    if (!hostVal.valid) return { success: false, error: hostVal.error };
    if (this.store.state !== 'ended') return { success: false, error: 'Game has not ended yet.' };

    for (const player of this.store.players.values()) {
      player.role = null;
      player.isAlive = true;
      player.isHost = player.id === this.store.hostId;
    }

    this.store.state = 'lobby';
    this.store.roundNumber = 0;
    this.store.phase = null;
    this.store.phaseStartedAt = null;
    this.store.winner = null;
    this.store.clearVotes();
    this.store.clearNightActions();

    this.io.to(this.store.roomCode).emit('game:playAgain', {
      players: this.store.getPublicPlayers(),
      hostId: this.store.hostId,
      playerCount: this.store.players.size,
    });
    this.broadcastVoicePermissions();

    return { success: true };
  }

  getState(forSocketId = null) {
    const state = this.store.getPublicState(forSocketId);
    state.phase = this.store.phase ? this.store.getPhaseState(this.phases.duration) : null;
    return state;
  }

  destroy() {
    this.destroyed = true;
    this.phases.destroy();
  }
}


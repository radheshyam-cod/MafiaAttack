import { Player } from './Player.js';

/**
 * Pure data store for a single game instance.
 *
 * Holds ALL authoritative game state:
 * - Room metadata
 * - Players with roles and status
 * - Current phase and round
 * - Votes and night actions
 * - Winner state
 *
 * This class has NO reference to Socket.IO or any I/O.
 * It exposes read-only access via getters and mutation via
 * controlled methods that validate invariants internally.
 */
export class GameStore {
  constructor(roomCode) {
    /** @type {string} */
    this.roomCode = roomCode;

    /** @type {Map<string, Player>} playerId → Player */
    this.players = new Map();

    /** @type {string|null} ID of the host player */
    this.hostId = null;

    /** @type {string} 'lobby' | 'playing' | 'ended' */
    this.state = 'lobby';

    /** @type {number} Current round number (increments each night) */
    this.roundNumber = 0;

    /** @type {string|null} Current phase name: null | 'night' | 'morning' | 'day' | 'voting' */
    this.phase = null;

    /** @type {number|null} Timestamp when current phase started */
    this.phaseStartedAt = null;

    /** @type {Map<string, string>} voterId → targetId (voting phase) */
    this.votes = new Map();

    /** @type {Set<string>} Player IDs who have voted */
    this.votedPlayers = new Set();

    /** @type {number} Current voting round (increments on tie re-votes) */
    this.votingRound = 0;

    /** @type {string[]|null} Player IDs eligible to be voted on (null = all alive, set = tied players) */
    this.votableTargets = null;

    /** @type {Map<string, string>} mafiaPlayerId → targetId (night kills) */
    this.mafiaKills = new Map();

    /** @type {string|null} Final mafia kill target chosen by the server */
    this.mafiaTarget = null;

    /** @type {string[]} Player IDs protected by the Doctor */
    this.doctorProtected = [];



    /** @type {object|null} Results from the most recent night */
    this.nightResult = null;

    /** @type {object|null} Detective investigation result for the morning reveal */
    this.detectiveResult = null;

    /** @type {object|null} { team: string, message: string } */
    this.winner = null;

    /** @type {number} When the game was created */
    this.createdAt = Date.now();
  }

  // ── Player Management ──────────────────────────────────────

  /**
   * Add a player to the lobby.
   * @param {string} id
   * @param {string} name
   * @param {string} socketId
   * @returns {Player}
   * @throws {Error} If game is full
   */
  addPlayer(id, name, socketId) {
    if (this.players.size >= 12) {
      throw new Error('Game is full (max 12 players).');
    }

    const player = new Player(id, name, socketId);
    this.players.set(id, player);

    if (this.players.size === 1) {
      player.isHost = true;
      this.hostId = id;
    }

    return player;
  }

  /**
   * Remove a player from the game.
   * @param {string} playerId
   */
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    this.players.delete(playerId);

    // Transfer host if needed
    if (player.isHost && this.players.size > 0) {
      const newHost = this.players.values().next().value;
      newHost.isHost = true;
      this.hostId = newHost.id;
    }
  }

  /**
   * Find a player by their socket ID.
   * @param {string} socketId
   * @returns {Player|null}
   */
  getPlayerBySocket(socketId) {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) {
        return player;
      }
    }
    return null;
  }

  /**
   * Update a player's socket ID (for reconnection).
   * @param {string} playerId
   * @param {string} socketId
   */
  updateSocketId(playerId, socketId) {
    const player = this.players.get(playerId);
    if (player) {
      player.socketId = socketId;
    }
  }

  /**
   * Get all alive players.
   * @returns {Player[]}
   */
  getAlivePlayers() {
    return Array.from(this.players.values()).filter(p => p.isAlive);
  }

  /**
   * Get the number of alive players.
   * @returns {number}
   */
  getAliveCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.isAlive) count++;
    }
    return count;
  }

  /**
   * Get alive mafia players.
   * @returns {Player[]}
   */
  getAliveMafia() {
    return this.getAlivePlayers().filter(p => p.role && p.role.team === 'mafia');
  }

  /**
   * Get alive village players.
   * @returns {Player[]}
   */
  getAliveVillage() {
    return this.getAlivePlayers().filter(p => !p.role || p.role.team !== 'mafia');
  }

  /**
   * Find a player by their role name (e.g., 'Doctor', 'Detective').
   * @param {string} roleName
   * @returns {Player|null}
   */
  findPlayerByRole(roleName) {
    for (const player of this.players.values()) {
      if (player.role && player.role.name === roleName) {
        return player;
      }
    }
    return null;
  }

  // ── Phase Management ───────────────────────────────────────

  /**
   * Transition to a new phase.
   * @param {string} phaseName
   */
  setPhase(phaseName) {
    this.phase = phaseName;
    this.phaseStartedAt = Date.now();
  }

  /**
   * Get the current phase state for clients.
   * @param {number} duration - Phase duration in ms
   * @returns {object}
   */
  getPhaseState(duration) {
    return {
      name: this.phase,
      startedAt: this.phaseStartedAt,
      timeRemaining: duration > 0
        ? Math.max(0, duration - (Date.now() - this.phaseStartedAt))
        : -1,
    };
  }

  // ── Voting ─────────────────────────────────────────────────

  /**
   * Record a vote.
   * @param {string} voterId
   * @param {string} targetId
   * @returns {boolean} Whether the vote was recorded
   */
  castVote(voterId, targetId) {
    if (this.votedPlayers.has(voterId)) return false;
    this.votes.set(voterId, targetId);
    this.votedPlayers.add(voterId);
    return true;
  }

  /**
   * Clear all votes (for new voting round).
   */
  clearVotes() {
    this.votes = new Map();
    this.votedPlayers = new Set();
    this.votingRound = 0;
    this.votableTargets = null;
  }

  /**
   * Set the list of eligible targets for this voting round.
   * Null means all alive players can be voted on.
   * A non-null array means only those players can be voted on (tie-break round).
   * @param {string[]|null} targetIds
   */
  setVotableTargets(targetIds) {
    this.votableTargets = targetIds;
  }

  /**
   * Check if a target is eligible to be voted on in the current round.
   * @param {string} targetId
   * @returns {boolean}
   */
  isVotableTarget(targetId) {
    if (!this.votableTargets) return true; // all alive players eligible
    return this.votableTargets.includes(targetId);
  }

  /**
   * Get the vote count for each target.
   * @returns {Map<string, number>} targetId → vote count
   */
  getVoteCounts() {
    const counts = new Map();
    for (const targetId of this.votes.values()) {
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    return counts;
  }

  /**
   * Determine who has the most votes.
   * On a tie, returns the list of tied player IDs so a re-vote can be held.
   * @returns {{ eliminatedId: string|null, isTie: boolean, tiedIds: string[] }}
   */
  resolveVotes() {
    const counts = this.getVoteCounts();
    if (counts.size === 0) {
      return { eliminatedId: null, isTie: false, tiedIds: [] };
    }

    let maxVotes = 0;
    let eliminatedId = null;
    let tiedIds = [];

    for (const [targetId, count] of counts) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = targetId;
        tiedIds = [targetId];
      } else if (count === maxVotes) {
        tiedIds.push(targetId);
      }
    }

    const isTie = tiedIds.length > 1;

    return { eliminatedId: isTie ? null : eliminatedId, isTie, tiedIds };
  }

  /**
   * Check if all alive players have voted in the current round.
   * @returns {boolean}
   */
  isVotingComplete() {
    const onlineAliveCount = this.getAlivePlayers().filter(p => p.status === 'online').length;
    return this.votes.size >= onlineAliveCount;
  }

  /**
   * Increment the voting round counter.
   */
  incrementVotingRound() {
    this.votingRound++;
  }

  /**
   * Get the current voting round.
   * @returns {number}
   */
  getVotingRound() {
    return this.votingRound;
  }

  // ── Night Actions ──────────────────────────────────────────

  /**
   * Record a mafia kill vote.
   * @param {string} mafiaPlayerId
   * @param {string} targetId
   */
  addMafiaKill(mafiaPlayerId, targetId) {
    this.mafiaKills.set(mafiaPlayerId, targetId);
  }

  /**
   * Record a doctor protection.
   * @param {string} targetId
   */
  addDoctorProtection(targetId) {
    this.doctorProtected.push(targetId);
  }

  /**
   * Store the Detective's investigation result for the morning reveal.
   * @param {object} result - { targetId, targetName, alignment }
   */
  setDetectiveResult(result) {
    this.detectiveResult = result;
  }

  /**
   * Get the Detective's investigation result.
   * @returns {object|null}
   */
  getDetectiveResult() {
    return this.detectiveResult;
  }

  /**
   * Clear all night action data.
   */
  clearNightActions() {
    this.mafiaKills = new Map();
    this.mafiaTarget = null;
    this.doctorProtected = [];
    this.nightResult = null;
    this.detectiveResult = null;
  }

  /**
   * Resolve night actions and determine who dies.
   * Eliminates the target if not protected by the Doctor.
   * @returns {object} { killed: string|null, message: string }
   */
  resolveNightActions() {
    const selectedTarget = this.mafiaTarget || this._resolveMafiaVote();

    if (!selectedTarget) {
      return { killed: null, message: 'The night was peaceful...' };
    }

    // Check doctor protection
    const isProtected = this.doctorProtected.includes(selectedTarget);
    const killed = isProtected ? null : selectedTarget;

    if (killed) {
      const victim = this.players.get(killed);
      if (victim) {
        victim.eliminate();
      }
    }

    this.nightResult = {
      killed,
      protected: isProtected,
      message: isProtected
        ? 'Someone was attacked but saved by the Doctor!'
        : 'Someone was eliminated during the night.',
    };

    return this.nightResult;
  }

  /**
   * Tally mafia kill votes and pick a target.
   * Majority wins; ties are broken randomly among the top candidates.
   * If no votes were cast, a random alive non-mafia player is chosen.
   * @returns {string|null} chosen target player ID
   */
  _resolveMafiaVote() {
    const counts = new Map();
    for (const targetId of this.mafiaKills.values()) {
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    if (counts.size === 0) {
      const eligible = this.getAlivePlayers().filter(p => !p.role || p.role.team !== 'mafia');
      return eligible.length ? eligible[Math.floor(Math.random() * eligible.length)].id : null;
    }
    let max = 0;
    const top = [];
    for (const [targetId, count] of counts) {
      if (count > max) { max = count; top.length = 0; top.push(targetId); }
      else if (count === max) top.push(targetId);
    }
    return top[Math.floor(Math.random() * top.length)];
  }

  // ── Win Condition ──────────────────────────────────────────

  /**
   * Build full game statistics for the end screen.
   * @returns {object} Game stats
   */
  getGameStats() {
    const aliveMafia = this.getAliveMafia();
    const aliveVillage = this.getAliveVillage();
    const totalPlayers = this.players.size;
    const aliveCount = this.getAliveCount();
    const deadCount = totalPlayers - aliveCount;

    return {
      roundsPlayed: this.roundNumber,
      totalPlayers,
      aliveCount,
      deadCount,
      aliveMafia: aliveMafia.length,
      aliveVillage: aliveVillage.length,
    };
  }

  /**
   * Get all players with their roles revealed (for game over screen).
   * @returns {object[]}
   */
  getAllPlayersWithRoles() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive,
      role: p.role ? { name: p.role.name, icon: p.role.icon, team: p.role.team } : null,
      isHost: p.isHost,
    }));
  }

  /**
   * Check if either team has won.
   * @returns {object|null} { team: string, message: string } or null
   */
  checkWinCondition() {
    const aliveMafia = this.getAliveMafia();
    const aliveVillage = this.getAliveVillage();

    // Mafia wins when they equal or outnumber village
    if (aliveMafia.length >= aliveVillage.length && aliveMafia.length > 0) {
      this.winner = {
        team: 'mafia',
        message: 'The Mafia has taken over the town! Mafia wins! 🎭',
      };
      return this.winner;
    }

    // Village wins when all mafia eliminated
    if (aliveMafia.length === 0) {
      this.winner = {
        team: 'village',
        message: 'The town has eliminated all Mafia! Village wins! 🏆',
      };
      return this.winner;
    }

    return null;
  }

  // ── Serialization ──────────────────────────────────────────

  /**
   * Get public player list. Optionally reveal role for a specific player.
   * @param {string|null} forSocketId - If provided, reveals role for the matching player
   * @returns {object[]}
   */
  getPublicPlayers(forSocketId = null) {
    return Array.from(this.players.values()).map(p => {
      const revealRole = forSocketId && p.socketId === forSocketId;
      return p.toJSON(revealRole);
    });
  }

  /**
   * Get full public game state (no private role info).
   * @param {string|null} forSocketId
   * @returns {object}
   */
  getPublicState(forSocketId = null) {
    return {
      roomCode: this.roomCode,
      state: this.state,
      phase: this.phase,
      roundNumber: this.roundNumber,
      hostId: this.hostId,
      playerCount: this.players.size,
      players: this.getPublicPlayers(forSocketId),
    };
  }
}

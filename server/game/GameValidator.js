/**
 * Pure validation layer for Shadow Mafia.
 *
 * Every method in this class is a pure function that validates
 * a specific operation. Returns { valid: true } or
 * { valid: false, error: string }.
 *
 * The server NEVER trusts client data. All inputs go through
 * this validator before reaching the GameStore.
 */
export class GameValidator {

  /**
   * Validate a player name.
   * @param {string} name
   * @returns {{ valid: boolean, error?: string }}
   */
  static validateName(name) {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: 'Name is required.' };
    }
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 20) {
      return { valid: false, error: 'Name must be between 1 and 20 characters.' };
    }
    
    // Simple HTML sanitization
    const sanitized = trimmed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
      
    return { valid: true, clean: sanitized };
  }

  /**
   * Validate a room code (6-digit numeric).
   * @param {string} code
   * @returns {{ valid: boolean, error?: string, clean?: string }}
   */
  static validateRoomCode(code) {
    if (!code || typeof code !== 'string') {
      return { valid: false, error: 'Room code is required.' };
    }
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      return { valid: false, error: 'Room code must be a 6-digit number.' };
    }
    return { valid: true, clean: digits };
  }

  /**
   * Validate that a game exists and is in the correct state for the operation.
   * @param {import('./GameStore.js').GameStore|null} store
   * @param {string} expectedState - 'lobby' | 'playing'
   * @returns {{ valid: boolean, error?: string }}
   */
  static validateGameState(store, expectedState) {
    if (!store) {
      return { valid: false, error: 'Room not found.' };
    }
    if (store.state !== expectedState) {
      const messages = {
        lobby: 'Game is already in progress.',
        playing: 'Game is not in progress.',
      };
      return { valid: false, error: messages[expectedState] || 'Invalid game state.' };
    }
    return { valid: true };
  }

  /**
   * Validate that a player exists and is the host.
   * @param {import('./GameStore.js').GameStore} store
   * @param {string} socketId
   * @returns {{ valid: boolean, error?: string, player?: import('./Player.js').Player }}
   */
  static validateHost(store, socketId) {
    const player = store.getPlayerBySocket(socketId);
    if (!player) {
      return { valid: false, error: 'Player not found.' };
    }
    if (!player.isHost) {
      return { valid: false, error: 'Only the host can perform this action.' };
    }
    return { valid: true, player };
  }

  /**
   * Validate that a player exists in the store.
   * @param {import('./GameStore.js').GameStore} store
   * @param {string} socketId
   * @returns {{ valid: boolean, error?: string, player?: import('./Player.js').Player }}
   */
  static validatePlayer(store, socketId) {
    const player = store.getPlayerBySocket(socketId);
    if (!player) {
      return { valid: false, error: 'Player not found.' };
    }
    return { valid: true, player };
  }

  /**
   * Validate that a player ID exists and is alive.
   * @param {import('./GameStore.js').GameStore} store
   * @param {string} playerId
   * @returns {{ valid: boolean, error?: string, target?: import('./Player.js').Player }}
   */
  static validateAlivePlayer(store, playerId) {
    const target = store.players.get(playerId);
    if (!target) {
      return { valid: false, error: 'Target player not found.' };
    }
    if (!target.isAlive) {
      return { valid: false, error: 'Target is already dead.' };
    }
    return { valid: true, target };
  }

  /**
   * Validate night action input.
   * Also validates that the action matches the current sequential night step.
   * @param {import('./GameStore.js').GameStore} store
   * @param {import('./Player.js').Player} player
   * @param {string} actionType - 'mafia_kill' | 'detective_investigate' | 'doctor_protect'
   * @param {string|null} targetId
   * @returns {{ valid: boolean, error?: string, target?: import('./Player.js').Player }}
   */
  static validateNightAction(store, player, actionType, targetId) {
    // Must be playing
    if (store.state !== 'playing') {
      return { valid: false, error: 'Game is not in progress.' };
    }

    // Must be night phase
    if (store.phase !== 'night') {
      return { valid: false, error: 'It is not night time.' };
    }

    // Must be alive
    if (!player.isAlive) {
      return { valid: false, error: 'Dead players cannot act.' };
    }

    // Must have a role with night action
    if (!player.role || !player.role.hasNightAction) {
      return { valid: false, error: 'You have no night action.' };
    }

    // Validate action type matches role
    const roleActionMap = {
      mafia_kill: 'Mafia',
      detective_investigate: 'Detective',
      doctor_protect: 'Doctor',
    };

    // Map action types to their night step
    const actionStepMap = {
      mafia_kill: 'mafia',
      doctor_protect: 'doctor',
      detective_investigate: 'detective',
    };

    const expectedRole = roleActionMap[actionType];
    if (!expectedRole) {
      return { valid: false, error: 'Invalid action type.' };
    }
    if (player.role.name !== expectedRole) {
      return { valid: false, error: `Only ${expectedRole} can perform this action.` };
    }

    // Validate target
    if (!targetId) {
      return { valid: false, error: 'No target selected.' };
    }

    const target = store.players.get(targetId);
    if (!target) {
      return { valid: false, error: 'Invalid target.' };
    }
    if (!target.isAlive) {
      return { valid: false, error: 'Target is already dead.' };
    }

    // Role-specific checks
    if (actionType === 'mafia_kill') {
      if (targetId === player.id) {
        return { valid: false, error: 'You cannot target yourself.' };
      }
      if (target.role && target.role.team === 'mafia') {
        return { valid: false, error: 'You cannot target another Mafia member.' };
      }
      if (store.mafiaKills.has(player.id)) {
        return { valid: false, error: 'You have already chosen someone to eliminate tonight.' };
      }
    }

    if (actionType === 'doctor_protect' && store.doctorProtected.length > 0) {
      return { valid: false, error: 'You have already chosen someone to protect tonight.' };
    }
    
    if (actionType === 'detective_investigate' && store.getDetectiveResult() !== null) {
      return { valid: false, error: 'You have already investigated someone tonight.' };
    }

    return { valid: true, target };
  }

  /**
   * Validate a vote cast during the voting phase.
   * @param {import('./GameStore.js').GameStore} store
   * @param {import('./Player.js').Player} voter
   * @param {string} targetId
   * @returns {{ valid: boolean, error?: string, target?: import('./Player.js').Player }}
   */
  static validateVote(store, voter, targetId) {
    // Must be playing
    if (store.state !== 'playing') {
      return { valid: false, error: 'Game is not in progress.' };
    }

    // Must be voting phase
    if (store.phase !== 'voting') {
      return { valid: false, error: 'It is not voting time.' };
    }

    // Must be alive
    if (!voter.isAlive) {
      return { valid: false, error: 'Dead players cannot vote.' };
    }

    // Must not have already voted
    if (store.votedPlayers.has(voter.id)) {
      return { valid: false, error: 'You have already voted.' };
    }

    // Must not vote for self
    if (targetId === voter.id) {
      return { valid: false, error: 'You cannot vote for yourself.' };
    }

    // Validate target exists and is alive
    const target = store.players.get(targetId);
    if (!target) {
      return { valid: false, error: 'Invalid target.' };
    }
    if (!target.isAlive) {
      return { valid: false, error: 'Target is already dead.' };
    }

    // In tie-breaker rounds, only allow voting for tied players
    if (!store.isVotableTarget(targetId)) {
      return { valid: false, error: 'You can only vote for the tied players in this round.' };
    }

    return { valid: true, target };
  }

  /**
   * Validate a chat message.
   * @param {import('./GameStore.js').GameStore} store
   * @param {import('./Player.js').Player} player
   * @param {string} message
   * @returns {{ valid: boolean, error?: string }}
   */
  static validateChat(store, player, message) {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { valid: false, error: 'Message is empty.' };
    }

    const trimmed = message.trim();
    if (trimmed.length > 500) {
      return { valid: false, error: 'Message is too long (max 500 characters).' };
    }

    if (store.state !== 'playing') {
      return { valid: false, error: 'Game is not in progress.' };
    }

    if (store.phase !== 'day') {
      return { valid: false, error: 'Chat is only available during the day phase.' };
    }

    if (!player.isAlive) {
      return { valid: false, error: 'Dead players cannot chat.' };
    }

    // Sanitize HTML
    const sanitized = trimmed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    return { valid: true, clean: sanitized };
  }

  /**
   * Validate game start conditions.
   * @param {import('./GameStore.js').GameStore} store
   * @returns {{ valid: boolean, error?: string }}
   */
  static validateGameStart(store) {
    if (store.state !== 'lobby') {
      return { valid: false, error: 'Game has already started.' };
    }
    if (store.players.size < 5) {
      return { valid: false, error: `Need at least 5 players to start (${store.players.size}/5).` };
    }
    if (store.players.size > 12) {
      return { valid: false, error: 'Too many players (max 12).' };
    }
    return { valid: true };
  }
}

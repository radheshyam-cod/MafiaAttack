/**
 * Represents a player connected to a game.
 */
export class Player {
  constructor(id, name, socketId) {
    this.id = id;
    this.name = name;
    this.socketId = socketId;
    this.role = null;
    this.isAlive = true;
    this.isHost = false;
    this.isReady = false;
    this.joinedAt = Date.now();
  }

  /**
   * Assign a role to this player.
   * @param {import('./roles/Role.js').Role} role
   */
  assignRole(role) {
    this.role = role;
  }

  /**
   * Mark the player as eliminated.
   */
  eliminate() {
    this.isAlive = false;
  }

  /**
   * Check if the player is on the mafia team.
   * @returns {boolean}
   */
  isMafia() {
    return this.role && this.role.team === 'mafia';
  }

  /**
   * Check if the player is on the village team.
   * @returns {boolean}
   */
  isVillager() {
    return this.role && this.role.team === 'village';
  }

  /**
   * Serialize player data for the client.
   * Excludes secret role info unless specified.
   * @param {boolean} revealRole - Whether to include role details
   * @returns {object}
   */
  toJSON(revealRole = false) {
    const data = {
      id: this.id,
      name: this.name,
      isAlive: this.isAlive,
      isHost: this.isHost,
      isReady: this.isReady,
    };

    if (revealRole && this.role) {
      data.role = this.role.toJSON();
      data.team = this.role.getAlignment();
    }

    return data;
  }
}

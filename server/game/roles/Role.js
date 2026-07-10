/**
 * Base Role class that all game roles extend.
 * Each role defines its team, night action behavior, and display properties.
 */
export class Role {
  /**
   * @param {object} options
   * @param {string} options.name - Display name of the role
   * @param {string} options.team - 'mafia' | 'village'
   * @param {string} options.description - Description shown to the player
   * @param {string} options.icon - Emoji icon for the role
   * @param {boolean} options.hasNightAction - Whether this role acts at night
   * @param {boolean} options.canVote - Whether this role can vote during voting phase
   */
  constructor({ name, team, description, icon, hasNightAction = false, canVote = true }) {
    this.name = name;
    this.team = team;
    this.description = description;
    this.icon = icon;
    this.hasNightAction = hasNightAction;
    this.canVote = canVote;
  }

  /**
   * Get the alignment (team) of this role for reveal purposes.
   * @returns {string}
   */
  getAlignment() {
    return this.team;
  }

  /**
   * Serialize role data for client (public info only).
   */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      icon: this.icon,
      hasNightAction: this.hasNightAction,
    };
  }
}

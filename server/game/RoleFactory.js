import { Villager } from './roles/Villager.js';
import { Mafia } from './roles/Mafia.js';
import { Detective } from './roles/Detective.js';
import { Doctor } from './roles/Doctor.js';

/**
 * Pure role distribution factory.
 *
 * Distributions (5–12 players):
 *
 *   5: 1 Mafia, 1 Doctor, 1 Detective, 2 Villagers
 *   6: 1 Mafia, 1 Doctor, 1 Detective, 3 Villagers
 *   7: 2 Mafia, 1 Doctor, 1 Detective, 3 Villagers
 *   8: 2 Mafia, 1 Doctor, 1 Detective, 4 Villagers
 *   9: 2 Mafia, 1 Doctor, 1 Detective, 5 Villagers
 *  10: 3 Mafia, 1 Doctor, 1 Detective, 5 Villagers
 *  11: 3 Mafia, 1 Doctor, 1 Detective, 6 Villagers
 *  12: 3 Mafia, 1 Doctor, 1 Detective, 7 Villagers
 *
 * The server is the sole authority for assignment.
 * Never expose another player's role to the client.
 */
export class RoleFactory {

  /**
   * Determine the number of Mafia for a given player count.
   * @param {number} totalPlayers
   * @returns {number}
   */
  static getMafiaCount(totalPlayers) {
    if (totalPlayers <= 6) return 1;
    if (totalPlayers <= 9) return 2;
    return 3;
  }

  /**
   * Assign roles to all players in the store using a Fisher-Yates shuffle.
   * Players are shuffled first, then roles are shuffled and assigned,
   * ensuring truly random distribution.
   *
   * @param {import('./GameStore.js').GameStore} store
   */
  static assignRoles(store) {
    const players = Array.from(store.players.values());
    const total = players.length;

    // Fisher-Yates shuffle players for unbiased ordering
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }

    const mafiaCount = this.getMafiaCount(total);

    // Build ordered role list
    const roles = [];
    for (let i = 0; i < mafiaCount; i++) roles.push(new Mafia());
    roles.push(new Doctor());
    roles.push(new Detective());
    while (roles.length < total) {
      roles.push(new Villager());
    }

    // Fisher-Yates shuffle roles for unbiased assignment
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    // Assign roles to shuffled players
    for (let i = 0; i < players.length; i++) {
      players[i].assignRole(roles[i]);
    }
  }
}

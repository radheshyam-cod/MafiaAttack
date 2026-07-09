import { Role } from './Role.js';

export class Villager extends Role {
  constructor() {
    super({
      name: 'Villager',
      team: 'village',
      description: 'A loyal townsperson. You have no special abilities but your vote matters.',
      icon: '👤',
      hasNightAction: false,
      canVote: true,
    });
  }
}

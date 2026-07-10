import { Role } from './Role.js';

export class Mafia extends Role {
  constructor() {
    super({
      name: 'Mafia',
      team: 'mafia',
      description: 'You are part of the Mafia. At night, you and your allies choose a victim to eliminate.',
      icon: '🔪',
      hasNightAction: true,
      canVote: true,
    });
  }
}

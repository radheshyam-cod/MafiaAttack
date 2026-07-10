import { Role } from './Role.js';

export class Doctor extends Role {
  constructor() {
    super({
      name: 'Doctor',
      team: 'village',
      description: 'A skilled healer. Each night, you may protect one player from being eliminated.',
      icon: '💉',
      hasNightAction: true,
      canVote: true,
    });
  }
}

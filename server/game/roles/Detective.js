import { Role } from './Role.js';

export class Detective extends Role {
  constructor() {
    super({
      name: 'Detective',
      team: 'village',
      description: 'A sharp-eyed investigator. Each night, you may investigate one player to learn their true alignment.',
      icon: '🔍',
      hasNightAction: true,
      canVote: true,
    });
  }
}

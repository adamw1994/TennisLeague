import { Migration001Platform } from './migrations/Migration001Platform';
import { Migration002Mutations } from './migrations/Migration002Mutations';
import { Migration003Players } from './migrations/Migration003Players';
import { Migration004LeaguesMatches } from './migrations/Migration004LeaguesMatches';
import { Migration005Scores } from './migrations/Migration005Scores';
import { Migration006Elo } from './migrations/Migration006Elo';

export const migrations = [
  Migration001Platform,
  Migration002Mutations,
  Migration003Players,
  Migration004LeaguesMatches,
  Migration005Scores,
  Migration006Elo,
];

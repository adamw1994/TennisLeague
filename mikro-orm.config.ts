import { readFileSync } from 'node:fs';
import { defineConfig } from '@mikro-orm/postgresql';
import {
  ApplicationSettingSchema,
  RateLimitBucketSchema,
  RequestTokenSchema,
} from './src/db/entities';
import { SportSchema } from './src/db/sport.entity';
import { PlayerAvatarSchema } from './src/modules/players/avatar.entity';
import { PlayerSchema } from './src/modules/players/player.entity';
import { LeagueSchema } from './src/modules/leagues/league.entity';
import { LeaguePlayerSchema } from './src/modules/leagues/membership.entity';
import {
  LeagueTeamPlayerSchema,
  LeagueTeamSchema,
} from './src/modules/leagues/team.entity';
import {
  MatchSchema,
  MatchSidePlayerSchema,
  MatchSideSchema,
} from './src/modules/matches/match.entity';
import { MatchRevisionSchema } from './src/modules/matches/revision.entity';
import {
  EloPublicationSchema,
  EloRatingEventSchema,
  EloRatingSchema,
} from './src/modules/elo/publication.entity';
import { EloRecalculationJobSchema } from './src/modules/elo/job.entity';
import {
  TennisMatchRuleSchema,
  TennisSetSchema,
} from './src/modules/tennis/score.entity';
import { migrations } from './src/db/migrations';

export function createOrmConfig(clientUrl: string, schema?: string) {
  const sslMode = process.env.DATABASE_SSL_MODE?.toLowerCase();
  const sslRootCert = process.env.PGSSLROOTCERT;
  const ssl = sslMode && sslMode !== 'disable'
    ? {
        rejectUnauthorized: sslMode !== 'require-insecure',
        ...(sslRootCert ? { ca: readFileSync(sslRootCert, 'utf8') } : {}),
      }
    : undefined;
  return defineConfig({
    clientUrl,
    driverOptions: schema || ssl
      ? {
          ...(schema ? { options: `-c search_path=${schema}` } : {}),
          ...(ssl ? { ssl } : {}),
        }
      : undefined,
    pool: { max: 10 },
    entities: [
      SportSchema,
      RequestTokenSchema,
      ApplicationSettingSchema,
      RateLimitBucketSchema,
      PlayerSchema,
      PlayerAvatarSchema,
      LeagueSchema,
      LeaguePlayerSchema,
      LeagueTeamSchema,
      LeagueTeamPlayerSchema,
      MatchSchema,
      MatchSideSchema,
      MatchSidePlayerSchema,
      TennisMatchRuleSchema,
      TennisSetSchema,
      MatchRevisionSchema,
      EloPublicationSchema,
      EloRatingSchema,
      EloRatingEventSchema,
      EloRecalculationJobSchema,
    ],
    schema,
    migrations: {
      migrationsList: migrations,
      schema,
      snapshot: false,
    },
    schemaGenerator: {
      ignoreRoutines: true,
    },
  });
}

export default createOrmConfig(
  process.env.DATABASE_URL ?? 'postgresql://127.0.0.1/low_on_legs',
);

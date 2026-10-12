import { defineEntity, p } from '@mikro-orm/postgresql';

export { SportSchema } from './sport.entity';
export { PlayerAvatarSchema } from '@/modules/players/avatar.entity';
export { PlayerSchema } from '@/modules/players/player.entity';
export { LeagueSchema } from '@/modules/leagues/league.entity';
export { LeaguePlayerSchema } from '@/modules/leagues/membership.entity';
export {
  LeagueTeamPlayerSchema,
  LeagueTeamSchema,
} from '@/modules/leagues/team.entity';
export {
  MatchSchema,
  MatchSidePlayerSchema,
  MatchSideSchema,
} from '@/modules/matches/match.entity';
export { MatchRevisionSchema } from '@/modules/matches/revision.entity';
export {
  EloPublicationSchema,
  EloRatingEventSchema,
  EloRatingSchema,
} from '@/modules/elo/publication.entity';
export { EloRecalculationJobSchema } from '@/modules/elo/job.entity';
export {
  TennisMatchRuleSchema,
  TennisSetSchema,
} from '@/modules/tennis/score.entity';

export const RequestTokenSchema = defineEntity({
  name: 'RequestToken',
  tableName: 'request_tokens',
  properties: {
    id: p.uuid().primary(),
    operation: p.text(),
    token: p.text(),
    payloadHash: p.text(),
    response: p.json<unknown>().columnType('jsonb').nullable(),
  },
  uniques: [
    {
      name: 'request_tokens_operation_token_unique',
      properties: ['operation', 'token'],
    },
  ],
});

export class RequestToken extends RequestTokenSchema.class {}

RequestTokenSchema.setClass(RequestToken);

export const ApplicationSettingSchema = defineEntity({
  name: 'ApplicationSetting',
  tableName: 'application_settings',
  properties: {
    key: p.text().primary(),
    value: p.integer().check('"value" > 0'),
  },
});

export class ApplicationSetting extends ApplicationSettingSchema.class {}

ApplicationSettingSchema.setClass(ApplicationSetting);

export const RateLimitBucketSchema = defineEntity({
  name: 'RateLimitBucket',
  tableName: 'rate_limit_buckets',
  properties: {
    key: p.text().primary(),
    operation: p.text().primary(),
    windowStart: p.datetime().columnType('timestamptz').primary(),
    count: p.integer().check('"count" > 0'),
  },
  indexes: [
    {
      name: 'rate_limit_buckets_window_start_index',
      properties: ['windowStart'],
    },
  ],
});

export class RateLimitBucket extends RateLimitBucketSchema.class {}

RateLimitBucketSchema.setClass(RateLimitBucket);

import { defineEntity, p } from '@mikro-orm/postgresql';
import type { TennisScore } from '@/modules/tennis/types';
import { MatchSchema } from './match.entity';

export interface MatchRevisionSnapshot {
  matchId: string;
  leagueId: string;
  version: number;
  status: 'COMPLETED';
  resultRecordedAt: string;
  deletedAt: string | null;
  eloKSnapshot: number | null;
  sides: Array<{
    sideNumber: 1 | 2;
    teamId: string | null;
    playerIds: string[];
  }>;
  score: TennisScore;
}

export const MatchRevisionSchema = defineEntity({
  name: 'MatchRevision',
  tableName: 'match_revisions',
  properties: {
    id: p.uuid().primary(),
    match: p
      .manyToOne(MatchSchema)
      .joinColumn('match_id')
      .foreignKeyName('match_revisions_match_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    version: p.integer().check('"version" > 0'),
    changedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    snapshot: p.json<MatchRevisionSnapshot>().columnType('jsonb'),
  },
  uniques: [
    {
      name: 'match_revisions_match_id_version_unique',
      properties: ['match', 'version'],
    },
  ],
});

export class MatchRevision extends MatchRevisionSchema.class {}

MatchRevisionSchema.setClass(MatchRevision);

import { defineEntity, p } from '@mikro-orm/postgresql';
import { LeagueSchema } from '@/modules/leagues/league.entity';

export const EloRecalculationJobSchema = defineEntity({
  name: 'EloRecalculationJob',
  tableName: 'elo_recalculation_jobs',
  properties: {
    id: p.uuid().primary(),
    league: p
      .manyToOne(LeagueSchema)
      .joinColumn('league_id')
      .foreignKeyName('elo_recalculation_jobs_league_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    requestedRevision: p.bigint('string').check('"requested_revision" >= 0'),
    status: p.text().default('PENDING').check(`"status" in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')`),
    claimToken: p.uuid().nullable(),
    leaseUntil: p.datetime().columnType('timestamptz').nullable(),
    attempts: p.integer().default(0).check('"attempts" >= 0'),
    availableAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    startedAt: p.datetime().columnType('timestamptz').nullable(),
    finishedAt: p.datetime().columnType('timestamptz').nullable(),
    lastErrorCode: p.text().nullable(),
    createdAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    updatedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
  },
  uniques: [
    {
      name: 'elo_recalculation_jobs_active_league_unique',
      properties: ['league'],
      where: `"status" in ('PENDING', 'RUNNING')`,
    },
  ],
  indexes: [
    {
      name: 'elo_recalculation_jobs_status_available_index',
      properties: ['status', 'availableAt', 'id'],
    },
  ],
});

export class EloRecalculationJob extends EloRecalculationJobSchema.class {}

EloRecalculationJobSchema.setClass(EloRecalculationJob);

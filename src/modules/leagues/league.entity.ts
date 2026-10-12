import { defineEntity, p } from '@mikro-orm/postgresql';
import { SportSchema } from '@/db/sport.entity';

export const LeagueSchema = defineEntity({
  name: 'League',
  tableName: 'leagues',
  properties: {
    id: p.uuid().primary(),
    sport: p
      .manyToOne(SportSchema)
      .joinColumn('sport_id')
      .foreignKeyName('leagues_sport_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    kind: p.text().check(`"kind" in ('CLASSIC', 'ELO_INFINITE')`),
    gameMode: p.text().check(`"game_mode" in ('SINGLES', 'DOUBLES')`),
    name: p
      .text()
      .check('((char_length(name) >= 1) AND (char_length(name) <= 120))'),
    hasReturnLegs: p.boolean().nullable(),
    eloK: p.integer().nullable(),
    inputRevision: p.bigint('string').default('0').check('"input_revision" >= 0'),
    publishedRevision: p.bigint('string').default('0').check('"published_revision" >= 0'),
    publishedPublicationId: p.uuid().nullable(),
    eloState: p.text().nullable(),
    lastResultRecordedAt: p.datetime().columnType('timestamptz').nullable(),
    status: p.text().default('ACTIVE').check(`"status" in ('ACTIVE', 'COMPLETED')`),
    version: p.integer().default(1).check('"version" > 0'),
    createdAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    updatedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    deletedAt: p.datetime().columnType('timestamptz').nullable(),
  },
  checks: [
    {
      name: 'leagues_configuration_check',
      expression: `(((kind = 'CLASSIC'::text) AND (has_return_legs IS NOT NULL) AND (elo_k IS NULL))
        OR ((kind = 'ELO_INFINITE'::text) AND (has_return_legs IS NULL)
        AND ((elo_k >= 10) AND (elo_k <= 60))))`,
    },
    {
      name: 'leagues_elo_state_check',
      expression: `(
        (kind = 'CLASSIC' and elo_state is null and published_publication_id is null)
        or
        (kind = 'ELO_INFINITE' and elo_state is not null
          and elo_state in ('CURRENT', 'RECALCULATING', 'FAILED'))
      )`,
    },
  ],
  indexes: [
    {
      name: 'leagues_active_kind_status_index',
      properties: ['kind', 'status', 'createdAt', 'id'],
      where: 'deleted_at is null',
    },
  ],
});

export class League extends LeagueSchema.class {}

LeagueSchema.setClass(League);

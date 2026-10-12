import { defineEntity, p } from '@mikro-orm/postgresql';
import { LeagueSchema } from '@/modules/leagues/league.entity';
import { MatchRevisionSchema } from '@/modules/matches/revision.entity';
import { PlayerSchema } from '@/modules/players/player.entity';

export const EloPublicationSchema = defineEntity({
  name: 'EloPublication',
  tableName: 'elo_publications',
  properties: {
    id: p.uuid().primary(),
    league: p
      .manyToOne(LeagueSchema)
      .joinColumn('league_id')
      .foreignKeyName('elo_publications_league_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    revision: p.bigint('string').check('"revision" >= 0'),
    createdAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
  },
  uniques: [
    {
      name: 'elo_publications_league_id_revision_unique',
      properties: ['league', 'revision'],
    },
  ],
});

export class EloPublication extends EloPublicationSchema.class {}

EloPublicationSchema.setClass(EloPublication);

export const EloRatingSchema = defineEntity({
  name: 'EloRating',
  tableName: 'elo_ratings',
  properties: {
    publication: p
      .manyToOne(EloPublicationSchema)
      .joinColumn('publication_id')
      .primary()
      .foreignKeyName('elo_ratings_publication_id_foreign')
      .updateRule('cascade')
      .deleteRule('cascade'),
    player: p
      .manyToOne(PlayerSchema)
      .joinColumn('player_id')
      .primary()
      .foreignKeyName('elo_ratings_player_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    rating: p.integer().check('"rating" >= 500'),
    played: p.integer().check('"played" >= 0'),
    lastDelta: p.integer().nullable(),
  },
});

export class EloRating extends EloRatingSchema.class {}

EloRatingSchema.setClass(EloRating);

export const EloRatingEventSchema = defineEntity({
  name: 'EloRatingEvent',
  tableName: 'elo_rating_events',
  properties: {
    publication: p
      .manyToOne(EloPublicationSchema)
      .joinColumn('publication_id')
      .primary()
      .foreignKeyName('elo_rating_events_publication_id_foreign')
      .updateRule('cascade')
      .deleteRule('cascade'),
    matchId: p.uuid().primary(),
    matchVersion: p.integer().check('"match_version" > 0'),
    revision: p
      .manyToOne(MatchRevisionSchema)
      .joinColumns('match_id', 'match_version')
      .referencedColumnNames('match_id', 'version')
      .columnTypes('uuid', 'integer')
      .ownColumns()
      .foreignKeyName('elo_rating_events_revision_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    player: p
      .manyToOne(PlayerSchema)
      .joinColumn('player_id')
      .primary()
      .foreignKeyName('elo_rating_events_player_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    ratingBefore: p.integer().check('"rating_before" >= 500'),
    expectedScore: p
      .decimal('number')
      .check('(("expected_score" >= 0) AND ("expected_score" <= 1))'),
    actualScore: p.integer().check('"actual_score" in (0, 1)'),
    kFactor: p.integer().check('(("k_factor" >= 10) AND ("k_factor" <= 60))'),
    calculatedDelta: p.integer(),
    appliedDelta: p.integer(),
    ratingAfter: p.integer().check('"rating_after" >= 500'),
  },
  indexes: [
    {
      name: 'elo_rating_events_player_match_index',
      properties: ['publication', 'player', 'matchId'],
    },
  ],
});

export class EloRatingEvent extends EloRatingEventSchema.class {}

EloRatingEventSchema.setClass(EloRatingEvent);

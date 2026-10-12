import { defineEntity, p } from '@mikro-orm/postgresql';
import { MatchSchema } from '@/modules/matches/match.entity';

export const TennisMatchRuleSchema = defineEntity({
  name: 'TennisMatchRule',
  tableName: 'tennis_match_rules',
  properties: {
    match: p
      .oneToOne(MatchSchema)
      .owner()
      .primary()
      .joinColumn('match_id')
      .foreignKeyName('tennis_match_rules_match_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    openingSetFormat: p
      .text()
      .check(`"opening_set_format" in ('FAST4', 'NORMAL')`),
    decidingSetFormat: p
      .text()
      .nullable()
      .check(
        `"deciding_set_format" is null or "deciding_set_format" in ('FAST4', 'NORMAL', 'SUPER_TIE_BREAK')`,
      ),
  },
});

export class TennisMatchRule extends TennisMatchRuleSchema.class {}

TennisMatchRuleSchema.setClass(TennisMatchRule);

export const TennisSetSchema = defineEntity({
  name: 'TennisSetRecord',
  tableName: 'tennis_sets',
  properties: {
    id: p.uuid().primary(),
    match: p
      .manyToOne(MatchSchema)
      .joinColumn('match_id')
      .foreignKeyName('tennis_sets_match_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    setOrder: p
      .integer()
      .check('((set_order >= 1) AND (set_order <= 3))'),
    kind: p
      .text()
      .check(`"kind" in ('GAME_SET', 'SUPER_TIE_BREAK')`),
    side1Score: p
      .integer()
      .fieldName('side_1_score')
      .check('"side_1_score" >= 0'),
    side2Score: p
      .integer()
      .fieldName('side_2_score')
      .check('"side_2_score" >= 0'),
  },
  uniques: [
    {
      name: 'tennis_sets_match_id_set_order_unique',
      properties: ['match', 'setOrder'],
    },
  ],
});

export class TennisSetRecord extends TennisSetSchema.class {}

TennisSetSchema.setClass(TennisSetRecord);

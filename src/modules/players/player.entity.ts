import { defineEntity, p } from '@mikro-orm/postgresql';

export const PlayerSchema = defineEntity({
  name: 'Player',
  tableName: 'players',
  properties: {
    id: p.uuid().primary(),
    firstName: p.text(),
    lastName: p.text(),
    nickname: p.text(),
    nicknameKey: p
      .text()
      .generated('(normalize_nickname("nickname")) stored')
      .unique('players_nickname_key_unique'),
    version: p.integer().default(1).check('"version" > 0'),
    createdAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    updatedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    deletedAt: p.datetime().columnType('timestamptz').nullable(),
  },
  indexes: [
    {
      name: 'players_active_nickname_index',
      properties: ['nicknameKey'],
      where: 'deleted_at is null',
    },
    {
      name: 'players_active_name_index',
      properties: ['lastName', 'firstName', 'id'],
      where: 'deleted_at is null',
    },
  ],
});

export class Player extends PlayerSchema.class {}

PlayerSchema.setClass(Player);

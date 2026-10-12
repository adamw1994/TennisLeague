import { defineEntity, p } from '@mikro-orm/postgresql';
import { PlayerSchema } from './player.entity';

export const PlayerAvatarSchema = defineEntity({
  name: 'PlayerAvatar',
  tableName: 'player_avatars',
  properties: {
    player: p
      .oneToOne(PlayerSchema)
      .owner()
      .primary()
      .fieldName('player_id')
      .deleteRule('cascade'),
    bytes: p.blob().columnType('bytea'),
    mimeType: p.text(),
    updatedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
  },
});

export class PlayerAvatar extends PlayerAvatarSchema.class {}

PlayerAvatarSchema.setClass(PlayerAvatar);

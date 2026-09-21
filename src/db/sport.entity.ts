import { defineEntity, p } from '@mikro-orm/postgresql';

export const SportSchema = defineEntity({
  name: 'Sport',
  tableName: 'sports',
  properties: {
    id: p.uuid().primary(),
    code: p.text().unique().check(`"code" in ('TENNIS')`),
    name: p.text(),
  },
});

export class Sport extends SportSchema.class {}

SportSchema.setClass(Sport);

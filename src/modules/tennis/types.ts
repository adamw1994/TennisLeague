import type { Side } from '@/shared/contracts';

export type Format = 'FAST4' | 'NORMAL';

export type TennisSet = {
  order: number;
  kind: 'GAME_SET' | 'SUPER_TIE_BREAK';
  sideA: number;
  sideB: number;
};

export type TennisScore = {
  openingSetFormat: Format;
  decidingSetFormat: Format | 'SUPER_TIE_BREAK' | null;
  sets: TennisSet[];
};

export type TennisProjection = {
  winner: Side;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  superTieBreaksA: number;
  superTieBreaksB: number;
};

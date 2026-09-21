import type { EntityManager } from '@mikro-orm/postgresql';
import { IsolationLevel } from '@mikro-orm/core';
import { z } from 'zod';
import type { Id } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';

export interface RankingRowDto {
  playerId: Id;
  label: string;
  deleted: boolean;
  place: number;
  rating: number;
  played: number;
  lastDelta: number | null;
}

export interface RankingDto {
  inputRevision: string;
  publishedRevision: string;
  state: 'CURRENT' | 'RECALCULATING' | 'FAILED';
  rows: RankingRowDto[];
}

export interface EloStatusDto {
  inputRevision: string;
  publishedRevision: string;
  state: RankingDto['state'];
}

interface RankingRow {
  input_revision: string;
  published_revision: string;
  elo_state: RankingDto['state'];
  player_id: string;
  nickname: string;
  deleted: boolean;
  rating: number;
  played: number;
  last_delta: number | null;
}

export async function getEloRanking(
  em: EntityManager,
  leagueId: Id,
): Promise<RankingDto> {
  const parsed = z.uuid().safeParse(leagueId);
  if (!parsed.success) throw new DomainError('LEAGUE_NOT_FOUND');
  const rows = await em.transactional(async tx => {
    const connection = tx.getConnection();
    const transaction = tx.getTransactionContext();
    const [league] = await connection.execute<
      Array<{
        kind: string;
        input_revision: string;
        published_revision: string;
        elo_state: RankingDto['state'];
        published_publication_id: string | null;
      }>
    >(
      `select kind, input_revision, published_revision, elo_state,
              published_publication_id
         from leagues where id = ? and deleted_at is null`,
      [parsed.data],
      'all',
      transaction,
    );
    if (!league) throw new DomainError('LEAGUE_NOT_FOUND');
    if (league.kind !== 'ELO_INFINITE') throw new DomainError('FORBIDDEN_OPERATION');
    if (!league.published_publication_id) {
      throw new DomainError('ELO_RECALCULATION_FAILED');
    }
    const ratingRows = await connection.execute<RankingRow[]>(
      `select r.player_id, p.nickname, (p.deleted_at is not null) as deleted,
              r.rating, r.played, r.last_delta
         from elo_ratings r
         join players p on p.id = r.player_id
        where r.publication_id = ?
        order by r.rating desc, p.nickname_key, p.id`,
      [league.published_publication_id],
      'all',
      transaction,
    );
    if (ratingRows.length === 0) throw new DomainError('ELO_RECALCULATION_FAILED');
    return ratingRows.map(row => ({
      ...row,
      input_revision: String(league.input_revision),
      published_revision: String(league.published_revision),
      elo_state: league.elo_state,
    }));
  }, { isolationLevel: IsolationLevel.REPEATABLE_READ });

  let previousRating: number | undefined;
  let previousPlace = 0;
  const ranked = rows.map((row, index) => {
    const place = previousRating === row.rating ? previousPlace : index + 1;
    previousRating = row.rating;
    previousPlace = place;
    return {
      playerId: row.player_id,
      label: row.nickname,
      deleted: row.deleted,
      place,
      rating: row.rating,
      played: row.played,
      lastDelta: row.last_delta,
    };
  });
  const first = rows[0]!;
  return {
    inputRevision: String(first.input_revision),
    publishedRevision: String(first.published_revision),
    state: first.elo_state,
    rows: ranked,
  };
}

export async function getEloStatus(
  em: EntityManager,
  leagueId: Id,
): Promise<EloStatusDto> {
  const parsed = z.uuid().safeParse(leagueId);
  if (!parsed.success) throw new DomainError('LEAGUE_NOT_FOUND');
  const [row] = await em.getConnection().execute<
    Array<{
      kind: string;
      input_revision: string;
      published_revision: string;
      elo_state: EloStatusDto['state'];
    }>
  >(
    `select kind, input_revision, published_revision, elo_state
       from leagues where id = ? and deleted_at is null`,
    [parsed.data],
  );
  if (!row) throw new DomainError('LEAGUE_NOT_FOUND');
  if (row.kind !== 'ELO_INFINITE') throw new DomainError('FORBIDDEN_OPERATION');
  return {
    inputRevision: String(row.input_revision),
    publishedRevision: String(row.published_revision),
    state: row.elo_state,
  };
}

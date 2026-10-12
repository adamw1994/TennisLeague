import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createEloMatchAction,
  recordClassicResultAction,
} from '@/app/matches/actions';
import { ScoreForm } from '@/components/ScoreForm';
import { withDb } from '@/db/orm';
import { getLeague, listLeagueMatches } from '@/modules/leagues/queries';
import { getMatch } from '@/modules/matches/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export default async function AddResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ matchId?: string }>;
}) {
  const { leagueId } = await params;
  const { matchId } = await searchParams;
  let pendingMatches;
  let league;
  try {
    ({ league, pendingMatches } = await withDb(async em => ({
      league: await getLeague(em, leagueId),
      pendingMatches: (await listLeagueMatches(em, leagueId)).filter(
        match => match.status === 'PENDING',
      ),
    })));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND') notFound();
    throw error;
  }

  if (league.kind === 'ELO_INFINITE') {
    return (
      <section className="content-stack score-page">
        <div>
          <h2>Dodaj mecz Elo</h2>
          <p className="muted">
            Wybierz {league.mode === 'SINGLES' ? 'dwóch graczy' : 'czterech graczy i strony'} oraz wpisz wynik.
          </p>
        </div>
        <ScoreForm
          action={createEloMatchAction}
          gameMode={league.mode}
          leagueId={league.id}
          mode="record"
          participants={league.participants
            .filter(player => !player.deleted)
            .map(player => ({ id: player.id, label: player.nickname }))}
        />
      </section>
    );
  }

  if (!matchId) {
    return (
      <section className="content-stack">
        <div>
          <h2>Wybierz mecz</h2>
          <p className="muted">Możesz wpisać wynik z dowolnej kolejki.</p>
        </div>
        {pendingMatches.length === 0 ? (
          <div className="empty-state">
            <h2>Wszystkie wyniki są zapisane</h2>
          </div>
        ) : (
          <ul className="simple-list">
            {pendingMatches.map(match => (
              <li className="card result-choice" key={match.id}>
                <span>
                  Kolejka {match.round} · {match.leg === 1 ? 'mecz' : 'rewanż'}
                </span>
                <strong>{match.sideA} — {match.sideB}</strong>
                <Link className="button secondary" href={`?matchId=${match.id}`}>
                  Wpisz wynik
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  let match;
  try {
    match = await withDb(em => getMatch(em, leagueId, matchId));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'MATCH_NOT_FOUND') notFound();
    throw error;
  }
  if (match.status !== 'PENDING') notFound();

  return (
    <section className="content-stack score-page">
      <div>
        <h2>Wpisz wynik</h2>
        <p className="muted">Kolejka {match.round} · {match.leg === 1 ? 'mecz' : 'rewanż'}</p>
      </div>
      <ScoreForm
        action={recordClassicResultAction}
        leagueId={leagueId}
        matchId={match.id}
        mode="record"
        sideA={match.sides[0].label}
        sideB={match.sides[1].label}
        version={match.version}
      />
    </section>
  );
}

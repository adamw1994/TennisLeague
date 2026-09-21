import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withDb } from '@/db/orm';
import { getLeague } from '@/modules/leagues/queries';
import { getLeagueOverview } from '@/modules/statistics/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  let data;
  try {
    data = await withDb(async em => ({
      league: await getLeague(em, leagueId),
      overview: await getLeagueOverview(em, leagueId),
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND') notFound();
    throw error;
  }
  const { league, overview } = data;

  return (
    <div className="content-stack">
      <section className="stats-grid" aria-label="Podsumowanie ligi">
        <article className="card stat-card"><strong>{overview.participantCount}</strong><span>Gracze</span></article>
        <article className="card stat-card"><strong>{overview.matchCount}</strong><span>Wszystkie mecze</span></article>
        <article className="card stat-card"><strong>{overview.completedMatchCount}</strong><span>Zakończone</span></article>
        <article className="card stat-card"><strong>{overview.remainingMatchCount}</strong><span>Pozostałe</span></article>
        {overview.kind === 'CLASSIC' ? <article className="card stat-card"><strong>{overview.completionPercentage}%</strong><span>Realizacja terminarza</span></article> : <article className="card stat-card"><strong>{league.eloK}</strong><span>Współczynnik K</span></article>}
      </section>

      <section aria-labelledby="league-members-heading">
        <h2 id="league-members-heading">{league.teams.length > 0 ? 'Stałe pary' : 'Uczestnicy'}</h2>
        <ul className="simple-list">
          {league.teams.length > 0 ? league.teams.map(team => (
            <li className="card" key={team.id}><strong>{team.displayName}</strong><span className="muted">{team.players.map(player => player.nickname).join(' / ')}</span></li>
          )) : league.participants.map(player => (
            <li className="card member-row" key={player.id}><Link href={`/players/${player.id}`}>{player.nickname}</Link>{player.deleted ? <span className="muted">— gracz usunięty</span> : null}</li>
          ))}
        </ul>
      </section>

      <section className="card league-next-actions" aria-labelledby="league-actions-heading">
        <h2 id="league-actions-heading">Następny krok</h2>
        <div className="button-row">
          <Link className="button" href={`/leagues/${league.id}/matches`}>{league.kind === 'CLASSIC' ? 'Przejdź do spotkań' : 'Otwórz mecze'}</Link>
          {league.kind === 'CLASSIC' ? <Link className="button secondary" href={`/leagues/${league.id}/table`}>Zobacz tabelę</Link> : <Link className="button secondary" href={`/leagues/${league.id}/ranking`}>Zobacz ranking</Link>}
        </div>
      </section>
    </div>
  );
}

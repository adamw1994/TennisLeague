import Link from 'next/link';
import { withDb } from '@/db/orm';
import { listRecentResults } from '@/modules/statistics/queries';
import { listLeagues } from '@/modules/leagues/queries';

export const dynamic = 'force-dynamic';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default async function Home() {
  const { leagues, results } = await withDb(async em => {
    const leaguePage = await listLeagues(em, { status: 'ACTIVE' });
    return {
      leagues: leaguePage.items.slice(0, 6),
      results: await listRecentResults(em),
    };
  });

  return (
    <main className="home-page">
      <section className="hero-card">
        <p className="eyebrow">Amatorskie ligi sportowe</p>
        <h1>Low on Legs</h1>
        <p className="lead">Zapisuj mecze, śledź wyniki i buduj wspólną historię sportowych spotkań.</p>
        <div className="button-row">
          <Link className="button" href="/players/new">Dodaj gracza</Link>
          <Link className="button secondary" href="/leagues/new">Utwórz ligę</Link>
        </div>
      </section>

      <section className="home-section" aria-labelledby="active-leagues-heading">
        <div className="section-heading">
          <div><p className="eyebrow">Wspólna gra</p><h2 id="active-leagues-heading">Aktywne ligi</h2></div>
          <Link href="/leagues">Zobacz wszystkie</Link>
        </div>
        {leagues.length === 0 ? (
          <div className="empty-state"><p>Brak aktywnych lig.</p><Link href="/leagues/new">Utwórz pierwszą ligę</Link></div>
        ) : (
          <ul className="league-list">
            {leagues.map(league => (
              <li className="card league-card" key={league.id}>
                <div>
                  <span className="status-chip">Aktywna</span>
                  <h3><Link href={`/leagues/${league.id}`}>{league.name}</Link></h3>
                  <p className="muted">{league.kind === 'CLASSIC' ? 'Klasyczna' : 'Nieskończona Elo'} · {league.mode === 'SINGLES' ? 'Singiel' : 'Debel'}</p>
                </div>
                <div className="league-card-meta"><strong>{league.participantCount}</strong><span>graczy</span><strong>{league.completedMatchCount}/{league.matchCount}</strong><span>meczów</span></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-section" aria-labelledby="recent-results-heading">
        <div className="section-heading">
          <div><p className="eyebrow">Historia</p><h2 id="recent-results-heading">Ostatnie wyniki</h2></div>
          <Link href="/leagues">Przejdź do lig</Link>
        </div>
        {results.length === 0 ? (
          <div className="empty-state"><p>Brak rozegranych meczów.</p></div>
        ) : (
          <ol className="match-list">
            {results.map(result => (
              <li className="card recent-result" key={`${result.leagueId}-${result.id}`}>
                <div><Link href={`/leagues/${result.leagueId}`}>{result.leagueName}</Link><time dateTime={result.recordedAt}>{formatDate(result.recordedAt)}</time></div>
                <strong>{result.sideA} <span aria-hidden="true">—</span> {result.sideB}</strong>
                <span className="status-chip">{result.projection.setsA}:{result.projection.setsB}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

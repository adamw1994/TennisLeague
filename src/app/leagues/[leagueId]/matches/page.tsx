import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pagination } from '@/components/Pagination';
import { withDb } from '@/db/orm';
import { getLeague, listLeagueMatches, type LeagueMatchDto } from '@/modules/leagues/queries';
import { DomainError } from '@/shared/errors';

export default async function LeagueMatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ cursor?: string; status?: string; round?: string }>;
}) {
  const { leagueId } = await params;
  const filters = await searchParams;
  const status = filters.status === 'PENDING' || filters.status === 'COMPLETED' ? filters.status : undefined;
  const round = filters.round && /^\d+$/.test(filters.round) ? Number(filters.round) : undefined;
  let league: Awaited<ReturnType<typeof getLeague>>;
  let page: { items: LeagueMatchDto[]; nextCursor: string | null };
  try {
    ({ league, page } = await withDb(async em => ({
      league: await getLeague(em, leagueId),
      page: await listLeagueMatches(em, { leagueId, cursor: filters.cursor, status, round }),
    })));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND') notFound();
    throw error;
  }

  const matches = page.items;
  return (
    <section className="content-stack">
      <div>
        <h2>{league.kind === 'CLASSIC' ? 'Terminarz i historia' : 'Historia meczów'}</h2>
        <p className="muted">
          {league.kind === 'CLASSIC'
            ? 'Spotkania są uporządkowane według kolejki i rewanżu.'
            : 'Mecze są dopisywane na bieżąco i wpływają na ranking tej ligi.'}
        </p>
      </div>
      <nav className="filter-row" aria-label="Filtr meczów">
        <Link aria-current={!status ? 'page' : undefined} href={`/leagues/${leagueId}/matches`}>Wszystkie</Link>
        <Link aria-current={status === 'PENDING' ? 'page' : undefined} href={`/leagues/${leagueId}/matches?status=PENDING`}>Nadchodzące</Link>
        <Link aria-current={status === 'COMPLETED' ? 'page' : undefined} href={`/leagues/${leagueId}/matches?status=COMPLETED`}>Rozegrane</Link>
      </nav>
      <form className="round-filter" method="get">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <label htmlFor="match-round">Kolejka</label>
        <input id="match-round" min="1" name="round" type="number" defaultValue={round ?? ''} />
        <button type="submit">Filtruj</button>
        {round ? <Link className="button secondary" href={`/leagues/${leagueId}/matches${status ? `?status=${status}` : ''}`}>Wyczyść</Link> : null}
      </form>
      {matches.length === 0 ? (
        <div className="empty-state">
          <h2>Brak meczów</h2>
          <p>Dodaj pierwszy rozegrany mecz.</p>
        </div>
      ) : (
        <ol className="match-list">
          {matches.map(match => (
            <li className="card match-row" key={match.id}>
              <span className="round-label">
                {match.round === null
                  ? 'Mecz Elo'
                  : `Kolejka ${match.round} · ${match.leg === 1 ? 'mecz' : 'rewanż'}`}
              </span>
              <strong>{match.sideA}</strong>
              <span aria-hidden="true">—</span>
              <strong>{match.sideB}</strong>
              <span className="status-chip">
                {match.status === 'PENDING' ? 'Do rozegrania' : 'Rozegrany'}
              </span>
              {match.leagueKind === 'ELO_INFINITE' && match.status === 'COMPLETED' ? (
                <span className="status-chip calculation-chip">
                  {match.calculationStatus === 'CURRENT'
                    ? 'Elo aktualne'
                    : match.calculationStatus === 'STALE'
                      ? `Elo: wersja ${match.calculationMatchVersion}`
                      : 'Elo: oczekuje'}
                </span>
              ) : null}
              <Link
                href={
                  match.status === 'PENDING'
                    ? `/leagues/${leagueId}/add-result?matchId=${match.id}`
                    : `/leagues/${leagueId}/matches/${match.id}`
                }
              >
                {match.status === 'PENDING' ? 'Wpisz wynik' : 'Szczegóły'}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        href={`/leagues/${leagueId}/matches${status || round ? '?' : ''}${status ? `status=${status}` : ''}${status && round ? '&' : ''}${round ? `round=${round}` : ''}`}
        nextCursor={page.nextCursor}
      />
    </section>
  );
}

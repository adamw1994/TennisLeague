import Link from 'next/link';
import { Pagination } from '@/components/Pagination';
import { withDb } from '@/db/orm';
import { listLeagues } from '@/modules/leagues/queries';
import type { LeagueKind } from '@/shared/contracts';

export const dynamic = 'force-dynamic';

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; cursor?: string }>;
}) {
  const { kind: rawKind, status: rawStatus, cursor } = await searchParams;
  const kind: LeagueKind | undefined =
    rawKind === 'CLASSIC' || rawKind === 'ELO_INFINITE' ? rawKind : undefined;
  const status = rawStatus === 'ACTIVE' || rawStatus === 'COMPLETED' ? rawStatus : undefined;
  const page = await withDb(em => listLeagues(em, { kind, status, cursor }));
  const leagues = page.items;

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Rozgrywki</p>
          <h1>Ligi</h1>
        </div>
        <Link className="button" href="/leagues/new">
          Utwórz ligę
        </Link>
      </header>
      <nav className="filter-row" aria-label="Filtr rodzaju ligi">
        <Link aria-current={!kind && !status ? 'page' : undefined} href="/leagues">
          Wszystkie
        </Link>
        <Link aria-current={kind === 'CLASSIC' ? 'page' : undefined} href="/leagues?kind=CLASSIC">
          Klasyczne
        </Link>
        <Link
          aria-current={kind === 'ELO_INFINITE' && !status ? 'page' : undefined}
          href="/leagues?kind=ELO_INFINITE"
        >
          Elo
        </Link>
        <Link aria-current={status === 'ACTIVE' ? 'page' : undefined} href="/leagues?status=ACTIVE">Aktywne</Link>
        <Link aria-current={status === 'COMPLETED' ? 'page' : undefined} href="/leagues?status=COMPLETED">Zakończone</Link>
      </nav>
      {leagues.length === 0 ? (
        <section className="empty-state">
          <h2>Brak lig w tym widoku</h2>
          <p>Utwórz pierwszą ligę i wybierz jej uczestników.</p>
        </section>
      ) : (
        <ul className="league-list">
          {leagues.map(league => {
            const progress = league.matchCount
              ? Math.round((league.completedMatchCount / league.matchCount) * 100)
              : 0;
            return (
              <li className="card league-card" key={league.id}>
                <div>
                  <span className="status-chip">
                    {league.kind === 'ELO_INFINITE' && league.eloState === 'RECALCULATING'
                      ? 'Przeliczanie Elo'
                      : league.kind === 'ELO_INFINITE' && league.eloState === 'FAILED'
                        ? 'Elo wymaga ponowienia'
                        : league.status === 'ACTIVE' ? 'Aktywna' : 'Zakończona'}
                  </span>
                  <h2>
                    <Link href={`/leagues/${league.id}`}>{league.name}</Link>
                  </h2>
                  <p className="muted">
                    {league.kind === 'CLASSIC' ? 'Klasyczna' : 'Nieskończona Elo'} ·{' '}
                    {league.mode === 'SINGLES' ? 'Singiel' : 'Debel'}
                  </p>
                </div>
                <div className="league-card-meta">
                  <strong>{league.participantCount}</strong>
                  <span>graczy</span>
                  <strong>{league.kind === 'CLASSIC' ? `${progress}%` : 'Elo'}</strong>
                  <span>{league.kind === 'CLASSIC' ? 'rozegrane' : `K = ${league.eloK}`}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination
        href={`/leagues${kind ? `?kind=${kind}` : ''}${kind && status ? '&' : !kind && status ? '?' : ''}${status ? `status=${status}` : ''}`}
        nextCursor={page.nextCursor}
      />
    </main>
  );
}

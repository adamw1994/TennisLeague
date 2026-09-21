import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withDb } from '@/db/orm';
import { getLeague } from '@/modules/leagues/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export default async function LeagueLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  let league;
  try {
    league = await withDb(em => getLeague(em, leagueId));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND') notFound();
    throw error;
  }

  return (
    <main>
      <Link className="back-link" href="/leagues">
        ← Wróć do lig
      </Link>
      <header className="league-header">
        <div>
          <p className="eyebrow">
            {league.kind === 'CLASSIC' ? 'Liga klasyczna' : 'Liga nieskończona Elo'}
          </p>
          <h1>{league.name}</h1>
          <p className="lead">
            {league.mode === 'SINGLES' ? 'Singiel' : 'Debel'} ·{' '}
            {league.participantCount} graczy
          </p>
        </div>
        <span className="status-chip">
          {league.status === 'ACTIVE' ? 'Aktywna' : 'Zakończona'}
        </span>
      </header>
      <nav className="league-tabs" aria-label="Widoki ligi">
        <Link href={`/leagues/${league.id}`}>Podsumowanie</Link>
        <Link href={`/leagues/${league.id}/matches`}>
          {league.kind === 'CLASSIC' ? 'Terminarz' : 'Mecze'}
        </Link>
        {league.kind === 'CLASSIC' ? (
          <>
            <Link href={`/leagues/${league.id}/table`}>Tabela</Link>
            <Link href={`/leagues/${league.id}/add-result`}>Dodaj wynik</Link>
          </>
        ) : (
          <>
            <Link href={`/leagues/${league.id}/ranking`}>Ranking</Link>
            <Link href={`/leagues/${league.id}/add-result`}>Dodaj mecz</Link>
          </>
        )}
        <Link href={`/leagues/${league.id}/settings`}>Ustawienia</Link>
      </nav>
      {children}
    </main>
  );
}

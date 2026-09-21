import { notFound } from 'next/navigation';
import { Classification } from '@/components/Classification';
import { withDb } from '@/db/orm';
import { getClassicStandings } from '@/modules/matches/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export default async function LeagueTablePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  let rows;
  try {
    rows = await withDb(em => getClassicStandings(em, leagueId));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND') notFound();
    throw error;
  }
  return (
    <section className="content-stack">
      <div>
        <h2>Tabela</h2>
        <p className="muted">5/0 za 2:0, 4/2 za 2:1.</p>
      </div>
      <Classification rows={rows} />
    </section>
  );
}

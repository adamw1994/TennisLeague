import { notFound } from 'next/navigation';
import { withDb } from '@/db/orm';
import { getEloRanking } from '@/modules/elo/queries';
import { EloStatus } from '@/components/EloStatus';
import { Classification } from '@/components/Classification';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export default async function EloRankingPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  let ranking;
  try {
    ranking = await withDb(em => getEloRanking(em, leagueId));
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === 'LEAGUE_NOT_FOUND' || error.code === 'FORBIDDEN_OPERATION')
    ) {
      notFound();
    }
    throw error;
  }
  return (
    <section className="content-stack">
      <div>
        <h2>Ranking Elo</h2>
      </div>
      <EloStatus
        inputRevision={ranking.inputRevision}
        leagueId={leagueId}
        publishedRevision={ranking.publishedRevision}
        state={ranking.state}
      />
      <Classification rows={ranking.rows} variant="elo" />
    </section>
  );
}

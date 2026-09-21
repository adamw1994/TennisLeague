import { notFound } from 'next/navigation';
import { correctClassicResultAction, correctEloMatchAction } from '@/app/matches/actions';
import { ScoreForm } from '@/components/ScoreForm';
import { withDb } from '@/db/orm';
import { getMatch } from '@/modules/matches/queries';
import { getLeague } from '@/modules/leagues/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export default async function EditMatchPage({
  params,
}: {
  params: Promise<{ leagueId: string; matchId: string }>;
}) {
  const { leagueId, matchId } = await params;
  let match;
  let league;
  try {
    ({ match, league } = await withDb(async em => ({
      match: await getMatch(em, leagueId, matchId),
      league: await getLeague(em, leagueId),
    })));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'MATCH_NOT_FOUND') notFound();
    throw error;
  }
  if (!match.score || match.status !== 'COMPLETED') notFound();
  const elo = match.leagueKind === 'ELO_INFINITE';
  return (
    <section className="content-stack score-page">
      <div>
        <h2>{elo ? 'Popraw mecz Elo' : 'Popraw wynik'}</h2>
        <p className="muted">
          {elo
            ? 'Możesz zmienić strony i wynik. Poprzednia wersja pozostanie w historii, a ranking zostanie przeliczony.'
            : 'Strony meczu pozostają bez zmian. Poprzednia wersja zostanie zachowana.'}
        </p>
      </div>
      <ScoreForm
        action={elo ? correctEloMatchAction : correctClassicResultAction}
        gameMode={elo ? league.mode : undefined}
        initialScore={match.score}
        initialSides={elo ? [match.sides[0].playerIds, match.sides[1].playerIds] : undefined}
        leagueId={leagueId}
        matchId={match.id}
        mode="correct"
        participants={elo
          ? league.participants.map(player => ({
              id: player.id,
              label: player.nickname + (player.deleted ? ' — usunięty' : ''),
            }))
          : undefined}
        sideA={elo ? undefined : match.sides[0].label}
        sideB={elo ? undefined : match.sides[1].label}
        version={match.version}
      />
    </section>
  );
}

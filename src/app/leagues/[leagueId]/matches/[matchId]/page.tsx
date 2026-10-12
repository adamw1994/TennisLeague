import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteEloMatchAction } from '@/app/matches/actions';
import { ConfirmMatchDelete } from '@/components/ConfirmMatchDelete';
import { EloStatus } from '@/components/EloStatus';
import { withDb } from '@/db/orm';
import { getMatch } from '@/modules/matches/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  dateStyle: 'short',
  timeStyle: 'short',
});

export default async function MatchPage({
  params,
}: {
  params: Promise<{ leagueId: string; matchId: string }>;
}) {
  const { leagueId, matchId } = await params;
  let match;
  try {
    match = await withDb(em => getMatch(em, leagueId, matchId));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'MATCH_NOT_FOUND') notFound();
    throw error;
  }
  return (
    <section className="content-stack match-detail">
      <div>
        <p className="eyebrow">
          {match.round === null
            ? 'Mecz Elo'
            : `Kolejka ${match.round} · ${match.leg === 1 ? 'mecz' : 'rewanż'}`}
        </p>
        <h2>{match.sides[0].label} — {match.sides[1].label}</h2>
      </div>
      {match.eloStatus ? (
        <EloStatus
          inputRevision={match.eloStatus.inputRevision}
          leagueId={leagueId}
          publishedRevision={match.eloStatus.publishedRevision}
          state={match.eloStatus.state}
        />
      ) : null}
      {match.score && match.projection ? (
        <>
          <div className="card score-summary">
            <strong>{match.projection.setsA}:{match.projection.setsB}</strong>
            <span>w setach</span>
            <strong>{match.projection.gamesA}:{match.projection.gamesB}</strong>
            <span>w gemach</span>
          </div>
          <ol className="set-list">
            {match.score.sets.map(set => (
              <li className="card" key={set.order}>
                <span>Set {set.order}{set.kind === 'SUPER_TIE_BREAK' ? ' · super tie-break' : ''}</span>
                <strong>{set.sideA}:{set.sideB}</strong>
              </li>
            ))}
          </ol>
          <p className="muted">
            Wynik zapisano {dateFormatter.format(new Date(match.resultRecordedAt!))}
          </p>
          <div className="button-row">
            <Link className="button" href={`/leagues/${leagueId}/matches/${match.id}/edit`}>
              Popraw wynik
            </Link>
            {match.leagueKind === 'ELO_INFINITE' ? (
              <ConfirmMatchDelete
                action={deleteEloMatchAction}
                leagueId={leagueId}
                matchId={match.id}
                version={match.version}
              />
            ) : null}
          </div>
          {match.leagueKind === 'ELO_INFINITE' ? (
            <section className="card calculation-notice" aria-live="polite">
              {match.calculationStatus === 'CURRENT' ? (
                <>
                  <strong>Obliczenia Elo dotyczą bieżącej wersji meczu.</strong>
                  <span>{match.eloEvents.length} zdarzeń ratingowych zapisano w publikacji.</span>
                </>
              ) : match.calculationStatus === 'STALE' ? (
                <>
                  <strong>Wynik jest aktualny, ale obliczenia Elo są nieaktualne.</strong>
                  <span>
                    Ostatnie zdarzenia dotyczą wersji meczu {match.calculationMatchVersion}.
                    Liczby nie są pokazywane dla nowego składu.
                  </span>
                </>
              ) : (
                <>
                  <strong>Oczekiwanie na przeliczenie Elo.</strong>
                  <span>Wynik meczu jest zapisany; ranking pokaże go po publikacji workera.</span>
                </>
              )}
            </section>
          ) : null}
        </>
      ) : (
        <div className="empty-state">
          <h2>Wynik nie został jeszcze wpisany</h2>
          <Link className="button" href={`/leagues/${leagueId}/add-result?matchId=${match.id}`}>
            Wpisz wynik
          </Link>
        </div>
      )}
    </section>
  );
}

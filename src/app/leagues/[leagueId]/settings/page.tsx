import { notFound } from 'next/navigation';
import {
  deleteLeagueAction,
  joinEloLeagueAction,
  updateLeagueAction,
} from '@/app/leagues/actions';
import { ConfirmLeagueDelete } from '@/components/ConfirmLeagueDelete';
import { EloMemberForm } from '@/components/EloMemberForm';
import { LeagueSettingsForm } from '@/components/LeagueSettingsForm';
import { withDb } from '@/db/orm';
import { getLeague } from '@/modules/leagues/queries';
import { listPlayers, type PlayerDto } from '@/modules/players/queries';
import { DomainError } from '@/shared/errors';

export default async function LeagueSettingsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  let league;
  let players: PlayerDto[] = [];
  try {
    ({ league, players } = await withDb(async em => {
      const currentLeague = await getLeague(em, leagueId);
      const allPlayers: PlayerDto[] = [];
      let cursor: string | undefined;
      do {
        const page = await listPlayers(em, cursor);
        allPlayers.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { league: currentLeague, players: allPlayers };
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND') notFound();
    throw error;
  }

  return (
    <div className="form-stack settings-stack">
      <LeagueSettingsForm
        action={updateLeagueAction}
        eloK={league.eloK}
        id={league.id}
        name={league.name}
        version={league.version}
      />
      {league.kind === 'ELO_INFINITE' ? (
        <EloMemberForm
          action={joinEloLeagueAction}
          leagueId={league.id}
          players={players
            .filter(player => !league.participants.some(member => member.id === player.id))
            .map(player => ({ id: player.id, label: player.nickname }))}
        />
      ) : null}
      <section className="card form-card danger-zone">
        <h2>Strefa niebezpieczna</h2>
        <p>
          Usunięcie ukrywa ligę i wszystkie jej mecze, ale nie kasuje danych
          historycznych.
        </p>
        <ConfirmLeagueDelete
          action={deleteLeagueAction}
          id={league.id}
          matchCount={league.matchCount}
          version={league.version}
        />
      </section>
    </div>
  );
}

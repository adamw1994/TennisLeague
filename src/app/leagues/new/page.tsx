import Link from 'next/link';
import { createLeagueAction } from '@/app/leagues/actions';
import { LeagueForm } from '@/components/LeagueForm';
import { withDb } from '@/db/orm';
import { listPlayers, type PlayerDto } from '@/modules/players/queries';

export const dynamic = 'force-dynamic';

async function allPlayers(): Promise<PlayerDto[]> {
  return withDb(async em => {
    const result: PlayerDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPlayers(em, cursor);
      result.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return result;
  });
}

export default async function NewLeaguePage() {
  const players = await allPlayers();
  return (
    <main className="narrow-page league-form-page">
      <Link className="back-link" href="/leagues">
        ← Wróć do lig
      </Link>
      <p className="eyebrow">Nowe rozgrywki</p>
      <h1>Utwórz ligę</h1>
      <p className="lead">
        Najpierw skonfiguruj format i uczestników, potem sprawdź podsumowanie.
      </p>
      <LeagueForm
        action={createLeagueAction}
        players={players.map(player => ({
          id: player.id,
          nickname: player.nickname,
          firstName: player.firstName,
          lastName: player.lastName,
        }))}
      />
    </main>
  );
}

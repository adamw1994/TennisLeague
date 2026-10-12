import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlayerForm } from '@/components/PlayerForm';
import { withDb } from '@/db/orm';
import { getPlayer } from '@/modules/players/queries';
import { DomainError } from '@/shared/errors';
import { updatePlayerAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditPlayerPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  let player;
  try {
    player = await withDb(em => getPlayer(em, playerId));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'PLAYER_NOT_FOUND') notFound();
    throw error;
  }
  return (
    <main className="narrow-page">
      <Link className="back-link" href={`/players/${player.id}`}>
        ← Wróć do profilu
      </Link>
      <p className="eyebrow">Profil gracza</p>
      <h1>Edytuj dane</h1>
      <PlayerForm
        action={updatePlayerAction}
        initialValues={player}
        mode="edit"
      />
    </main>
  );
}

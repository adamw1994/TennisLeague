import Link from 'next/link';
import { PlayerForm } from '@/components/PlayerForm';
import { createPlayerAction } from '../actions';

export default function NewPlayerPage() {
  return (
    <main className="narrow-page">
      <Link className="back-link" href="/players">
        ← Wróć do graczy
      </Link>
      <p className="eyebrow">Nowy profil</p>
      <h1>Dodaj gracza</h1>
      <p className="lead">Awatar jest opcjonalny — możesz dodać go później.</p>
      <PlayerForm action={createPlayerAction} mode="create" />
    </main>
  );
}

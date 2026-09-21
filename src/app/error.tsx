'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-page">
      <section className="empty-state" role="alert">
        <p className="eyebrow">Coś poszło nie tak</p>
        <h1>Nie udało się wczytać widoku</h1>
        <p>Spróbuj ponownie. Jeśli problem się powtarza, sprawdź połączenie z bazą danych.</p>
        <button type="button" onClick={reset}>Spróbuj ponownie</button>
      </section>
    </main>
  );
}

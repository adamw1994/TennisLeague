import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="error-page">
      <section className="empty-state">
        <p className="eyebrow">404</p>
        <h1>Nie znaleziono zasobu</h1>
        <p>Ten gracz, liga albo mecz nie istnieje lub został usunięty.</p>
        <Link className="button" href="/">Wróć na stronę główną</Link>
      </section>
    </main>
  );
}

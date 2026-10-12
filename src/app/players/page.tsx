import Link from 'next/link';
import { Pagination } from '@/components/Pagination';
import { withDb } from '@/db/orm';
import { listPlayers } from '@/modules/players/queries';

export const dynamic = 'force-dynamic';

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; search?: string }>;
}) {
  const { cursor, search } = await searchParams;
  const page = await withDb(em => listPlayers(em, { cursor, search }));
  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Kartoteka</p>
          <h1>Gracze</h1>
        </div>
        <Link className="button" href="/players/new">
          Dodaj gracza
        </Link>
      </header>
      <form className="search-form" method="get" role="search">
        <label htmlFor="player-search">Szukaj gracza</label>
        <div className="search-row">
          <input id="player-search" name="search" defaultValue={search ?? ''} placeholder="Pseudonim lub nazwisko" />
          <button type="submit">Szukaj</button>
          {search ? <Link className="button secondary" href="/players">Wyczyść</Link> : null}
        </div>
      </form>
      {page.items.length === 0 ? (
        <section className="empty-state">
          <h2>Jeszcze nikogo tu nie ma</h2>
          <p>Dodaj pierwszego gracza, aby zacząć układać ligę.</p>
        </section>
      ) : (
        <ul className="player-list">
          {page.items.map(player => (
            <li className="card player-row" key={player.id}>
              {player.avatarVersion ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="avatar small-avatar"
                  height={56}
                  src={`/api/players/${player.id}/avatar?v=${player.avatarVersion}`}
                  width={56}
                />
              ) : (
                <span aria-hidden="true" className="avatar-placeholder small-avatar">
                  {player.firstName[0]}
                  {player.lastName[0]}
                </span>
              )}
              <div>
                <Link href={`/players/${player.id}`}>{player.nickname}</Link>
                <p className="muted">
                  {player.firstName} {player.lastName}
                </p>
              </div>
              <span className="row-meta">{player.leagueCount} lig</span>
            </li>
          ))}
        </ul>
      )}
      <Pagination href={search ? `/players?search=${encodeURIComponent(search)}` : '/players'} nextCursor={page.nextCursor} />
    </main>
  );
}

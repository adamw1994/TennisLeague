import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { withDb } from '@/db/orm';
import { getPlayer } from '@/modules/players/queries';
import {
  getPlayerRatings,
  getPlayerStatistics,
  listPlayerLeagues,
  listPlayerMatches,
  type StatisticsMode,
} from '@/modules/statistics/queries';
import type { PlayerStats } from '@/modules/statistics/player';
import { DomainError } from '@/shared/errors';
import { deletePlayerAction } from '../actions';

export const dynamic = 'force-dynamic';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function StatValue({ label, value }: { label: string; value: number | string }) {
  return <div className="stat-line"><dt>{label}</dt><dd>{value}</dd></div>;
}

function StatsPanel({ stats }: { stats: PlayerStats }) {
  return (
    <section className="card stats-panel" aria-labelledby="statistics-heading">
      <h2 id="statistics-heading">Statystyki</h2>
      {stats.played === 0 ? <p className="muted">Brak rozegranych meczów</p> : null}
      <dl className="stats-list">
        <StatValue label="Mecze" value={stats.played} />
        <StatValue label="Wygrane" value={stats.won} />
        <StatValue label="Przegrane" value={stats.lost} />
        <StatValue label="Procent zwycięstw" value={stats.winPercentage === null ? '—' : `${stats.winPercentage}%`} />
        <StatValue label="Sety wygrane : przegrane" value={`${stats.setsFor}:${stats.setsAgainst}`} />
        <StatValue label="Bilans setów" value={stats.setsDiff} />
        <StatValue label="Gemy wygrane : przegrane" value={`${stats.gamesFor}:${stats.gamesAgainst}`} />
        <StatValue label="Bilans gemów" value={stats.gamesDiff} />
        <StatValue label="Super tie-breaki" value={`${stats.superTieBreaksWon}:${stats.superTieBreaksLost}`} />
        <StatValue label="Bilans super tie-breaków" value={stats.superTieBreaksDiff} />
      </dl>
    </section>
  );
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ mode?: string; leagueId?: string }>;
}) {
  const { playerId } = await params;
  const filters = await searchParams;
  const mode: StatisticsMode = filters.mode === 'DOUBLES' ? 'DOUBLES' : 'SINGLES';
  let data;
  try {
    data = await withDb(async em => {
      const player = await getPlayer(em, playerId, true);
      const leagues = await listPlayerLeagues(em, playerId, mode);
      const selectedLeagueId = filters.leagueId && leagues.some(league => league.id === filters.leagueId)
        ? filters.leagueId
        : undefined;
      const [stats, history, ratings] = await Promise.all([
        getPlayerStatistics(em, { playerId, mode, leagueId: selectedLeagueId }),
        listPlayerMatches(em, { playerId, mode, leagueId: selectedLeagueId }),
        getPlayerRatings(em, playerId),
      ]);
      return { player, leagues, selectedLeagueId, stats, history, ratings };
    });
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'PLAYER_NOT_FOUND' || error.code === 'VALIDATION')) notFound();
    throw error;
  }
  const { player, leagues, selectedLeagueId, stats, history, ratings } = data;

  return (
    <main>
      <Link className="back-link" href="/players">← Wróć do graczy</Link>
      <section className="profile-header">
        {player.avatarVersion ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`Awatar: ${player.nickname}`} className="avatar profile-avatar" height={180} src={`/api/players/${player.id}/avatar?v=${player.avatarVersion}`} width={180} />
        ) : (
          <span aria-hidden="true" className="avatar-placeholder profile-avatar">{player.firstName[0]}{player.lastName[0]}</span>
        )}
        <div>
          <p className="eyebrow">Profil gracza{player.deletedAt ? ' · usunięty' : ''}</p>
          <h1>{player.nickname}</h1>
          <p className="lead">{player.firstName} {player.lastName}</p>
          {player.deletedAt ? <p className="warning-box">Ten gracz jest usunięty, ale jego historia wyników pozostaje dostępna.</p> : null}
        </div>
      </section>
      <section className="stats-grid" aria-label="Podsumowanie gracza">
        <article className="card stat-card"><strong>{player.leagueCount}</strong><span>Aktywne ligi</span></article>
        <article className="card stat-card"><strong>{player.matchCount}</strong><span>Mecze w ligach</span></article>
      </section>
      <div className="button-row profile-actions">
        {!player.deletedAt ? <Link className="button" href={`/players/${player.id}/edit`}>Edytuj profil</Link> : null}
        {!player.deletedAt ? <ConfirmDelete action={deletePlayerAction} id={player.id} leagueCount={player.leagueCount} matchCount={player.matchCount} version={player.version} /> : null}
      </div>

      <section className="profile-section" aria-labelledby="mode-heading">
        <div className="section-heading"><div><p className="eyebrow">Forma</p><h2 id="mode-heading">Wyniki</h2></div></div>
        <nav className="filter-row" aria-label="Tryb gry profilu">
          <Link aria-current={mode === 'SINGLES' ? 'page' : undefined} href={`/players/${player.id}?mode=SINGLES`}>Singiel</Link>
          <Link aria-current={mode === 'DOUBLES' ? 'page' : undefined} href={`/players/${player.id}?mode=DOUBLES`}>Debel</Link>
        </nav>
        <form className="filter-form" method="get">
          <input type="hidden" name="mode" value={mode} />
          <label htmlFor="player-league-filter">Liga</label>
          <select id="player-league-filter" name="leagueId" defaultValue={selectedLeagueId ?? ''}>
            <option value="">Wszystkie aktywne ligi</option>
            {leagues.map(league => <option key={league.id} value={league.id}>{league.name}</option>)}
          </select>
          <button type="submit">Filtruj</button>
        </form>
        <StatsPanel stats={stats} />
      </section>

      <section className="profile-section" aria-labelledby="history-heading">
        <h2 id="history-heading">Historia meczów</h2>
        {history.length === 0 ? <p className="empty-state">Brak rozegranych meczów</p> : (
          <ol className="match-list">
            {history.map(match => (
              <li className="card history-row" key={match.id}>
                <div><Link href={`/leagues/${match.leagueId}/matches/${match.id}`}>{match.leagueName}</Link><time dateTime={match.recordedAt}>{formatDate(match.recordedAt)}</time></div>
                <strong>{match.projection.setsA}:{match.projection.setsB}</strong>
                <span>{match.sides[0].join(' / ')} — {match.sides[1].join(' / ')}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="profile-section" aria-labelledby="ratings-heading">
        <h2 id="ratings-heading">Rankingi Elo według ligi</h2>
        {ratings.length === 0 ? <p className="muted">Brak rankingów Elo.</p> : (
          <div className="table-scroll"><table className="classification-table"><caption className="sr-only">Rankingi Elo gracza</caption><thead><tr><th scope="col">Liga</th><th scope="col">Elo</th><th scope="col">Mecze</th><th scope="col">Ostatnia zmiana</th></tr></thead><tbody>{ratings.map(rating => <tr key={rating.leagueId}><th scope="row" data-label="Liga"><Link href={`/leagues/${rating.leagueId}/ranking`}>{rating.leagueName}</Link></th><td data-label="Elo">{rating.rating}</td><td data-label="Mecze">{rating.played}</td><td data-label="Ostatnia zmiana">{rating.lastDelta === null ? '—' : rating.lastDelta > 0 ? `+${rating.lastDelta}` : rating.lastDelta}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </main>
  );
}

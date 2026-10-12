import type { Standing } from '@/modules/standings/calculate';

interface EloClassificationRow {
  playerId: string;
  label: string;
  deleted: boolean;
  place: number;
  rating: number;
  played: number;
  lastDelta: number | null;
}

export function Classification({
  rows,
  variant = 'classic',
}: {
  rows: Standing[] | EloClassificationRow[];
  variant?: 'classic' | 'elo';
}) {
  if (variant === 'elo') {
    const eloRows = rows as EloClassificationRow[];
    return (
      <div className="table-scroll">
        <table className="classification-table">
          <caption className="sr-only">Ranking Elo</caption>
          <thead>
            <tr>
              <th scope="col">Miejsce</th>
              <th scope="col">Gracz</th>
              <th scope="col">Elo</th>
              <th scope="col">Mecze</th>
              <th scope="col">Ostatnia zmiana</th>
            </tr>
          </thead>
          <tbody>
            {eloRows.map(row => (
              <tr key={row.playerId}>
                <td data-label="Miejsce">{row.place}</td>
                <th data-label="Gracz" scope="row">
                  {row.label}{row.deleted ? ' — usunięty' : ''}
                </th>
                <td data-label="Elo">{row.rating}</td>
                <td data-label="Mecze">{row.played}</td>
                <td data-label="Ostatnia zmiana">
                  {row.lastDelta === null ? '—' : row.lastDelta > 0 ? `+${row.lastDelta}` : row.lastDelta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const classicRows = rows as Standing[];
  return (
    <div className="table-scroll">
      <table className="classification-table">
        <caption className="sr-only">Tabela ligi klasycznej</caption>
        <thead>
          <tr>
            <th scope="col">Miejsce</th>
            <th scope="col">Gracz / para</th>
            <th scope="col">M</th>
            <th scope="col">W</th>
            <th scope="col">P</th>
            <th scope="col">Pkt</th>
            <th scope="col">Sety</th>
            <th scope="col">Bilans setów</th>
            <th scope="col">Gemy</th>
            <th scope="col">Bilans gemów</th>
          </tr>
        </thead>
        <tbody>
          {classicRows.map(row => (
            <tr key={row.id}>
              <td data-label="Miejsce">{row.place}</td>
              <th data-label="Gracz / para" scope="row">{row.label}</th>
              <td data-label="Mecze">{row.played}</td>
              <td data-label="Wygrane">{row.won}</td>
              <td data-label="Porażki">{row.lost}</td>
              <td data-label="Punkty"><strong>{row.points}</strong></td>
              <td data-label="Sety">{row.setsFor}:{row.setsAgainst}</td>
              <td data-label="Bilans setów">{row.setsFor - row.setsAgainst}</td>
              <td data-label="Gemy">{row.gamesFor}:{row.gamesAgainst}</td>
              <td data-label="Bilans gemów">{row.gamesFor - row.gamesAgainst}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

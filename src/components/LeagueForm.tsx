'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeagueFormState } from '@/app/leagues/actions';
import type { LeagueInput } from '@/modules/leagues/commands';

interface PlayerOption {
  id: string;
  nickname: string;
  firstName: string;
  lastName: string;
}

interface LeagueFormProps {
  action: (
    state: LeagueFormState,
    formData: FormData,
  ) => Promise<LeagueFormState>;
  players: PlayerOption[];
}

const initialState: LeagueFormState = { status: 'idle' };

export function LeagueForm({ action, players }: LeagueFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [step, setStep] = useState<'configuration' | 'summary'>('configuration');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LeagueInput['kind']>('CLASSIC');
  const [mode, setMode] = useState<LeagueInput['mode']>('SINGLES');
  const [selected, setSelected] = useState<string[]>([]);
  const [hasReturnLegs, setHasReturnLegs] = useState(false);
  const [eloK, setEloK] = useState(32);
  const lastSubmitted = useRef<string | null>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const storageKey = 'low-on-legs:create-league-token';
  const playerById = useMemo(
    () => new Map(players.map(player => [player.id, player])),
    [players],
  );
  const teams = useMemo<[string, string][]>(() => {
    if (kind !== 'CLASSIC' || mode !== 'DOUBLES') return [];
    const result: [string, string][] = [];
    for (let index = 0; index + 1 < selected.length; index += 2) {
      result.push([selected[index]!, selected[index + 1]!]);
    }
    return result;
  }, [kind, mode, selected]);
  const payload: LeagueInput = {
    name,
    kind,
    mode,
    playerIds: selected,
    teams,
    hasReturnLegs: kind === 'CLASSIC' ? hasReturnLegs : null,
    eloK: kind === 'ELO_INFINITE' ? eloK : null,
  };
  const serializedPayload = JSON.stringify(payload);
  const sideCount = mode === 'DOUBLES' && kind === 'CLASSIC' ? teams.length : selected.length;
  const matchCount =
    kind === 'CLASSIC'
      ? (sideCount * (sideCount - 1) * (hasReturnLegs ? 2 : 1)) / 2
      : 0;
  const minimum = mode === 'SINGLES' ? 2 : 4;
  const configurationValid =
    name.trim().length > 0 &&
    name.trim().length <= 120 &&
    selected.length >= minimum &&
    new Set(selected).size === selected.length &&
    (kind !== 'CLASSIC' || mode !== 'DOUBLES' || selected.length % 2 === 0) &&
    matchCount <= 5_000;

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    const value = saved || crypto.randomUUID();
    sessionStorage.setItem(storageKey, value);
    if (tokenInput.current) tokenInput.current.value = value;
  }, []);

  useEffect(() => {
    if (lastSubmitted.current && lastSubmitted.current !== serializedPayload) {
      const next = crypto.randomUUID();
      sessionStorage.setItem(storageKey, next);
      if (tokenInput.current) tokenInput.current.value = next;
      lastSubmitted.current = null;
    }
  }, [serializedPayload]);

  useEffect(() => {
    if (state.status !== 'success' || !state.href) return;
    sessionStorage.removeItem(storageKey);
    router.push(state.href);
    router.refresh();
  }, [router, state]);

  function togglePlayer(id: string) {
    setSelected(current =>
      current.includes(id)
        ? current.filter(playerId => playerId !== id)
        : [...current, id],
    );
  }

  return (
    <div className="form-stack">
      <input form="create-league-form" name="token" ref={tokenInput} type="hidden" />
      {step === 'configuration' ? (
        <section className="card form-card" aria-labelledby="league-configuration-title">
          <h2 id="league-configuration-title">1. Konfiguracja</h2>
          <label>
            Nazwa ligi
            <input
              maxLength={120}
              onChange={event => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <div className="form-grid">
            <label>
              Rodzaj ligi
              <select
                onChange={event => setKind(event.target.value as LeagueInput['kind'])}
                value={kind}
              >
                <option value="CLASSIC">Klasyczna — terminarz</option>
                <option value="ELO_INFINITE">Nieskończona — Elo</option>
              </select>
            </label>
            <label>
              Tryb gry
              <select
                onChange={event => setMode(event.target.value as LeagueInput['mode'])}
                value={mode}
              >
                <option value="SINGLES">Singiel</option>
                <option value="DOUBLES">Debel</option>
              </select>
            </label>
          </div>
          {kind === 'CLASSIC' ? (
            <label className="check-row">
              <input
                checked={hasReturnLegs}
                onChange={event => setHasReturnLegs(event.target.checked)}
                type="checkbox"
              />
              Mecz i rewanż
            </label>
          ) : (
            <label>
              Współczynnik K (10–60)
              <input
                max={60}
                min={10}
                onChange={event => setEloK(Number(event.target.value))}
                type="number"
                value={eloK}
              />
            </label>
          )}

          <fieldset>
            <legend>Gracze</legend>
            <p className="muted">
              Wybierz co najmniej {minimum}.{' '}
              {kind === 'CLASSIC' && mode === 'DOUBLES'
                ? 'Kolejność wyboru wyznacza stałe pary.'
                : ''}
            </p>
            {players.length === 0 ? (
              <p>Najpierw dodaj graczy w kartotece.</p>
            ) : (
              <div className="choice-grid">
                {players.map(player => (
                  <label className="check-card" key={player.id}>
                    <input
                      checked={selected.includes(player.id)}
                      onChange={() => togglePlayer(player.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{player.nickname}</strong>
                      <small>
                        {player.firstName} {player.lastName}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {kind === 'CLASSIC' && mode === 'DOUBLES' && selected.length > 0 ? (
            <div className="pair-preview">
              <h3>Stałe pary</h3>
              <ol>
                {teams.map(([first, second]) => (
                  <li key={`${first}:${second}`}>
                    {playerById.get(first)?.nickname} / {playerById.get(second)?.nickname}
                  </li>
                ))}
              </ol>
              {selected.length % 2 ? (
                <p className="field-error" role="alert">
                  Ostatni wybrany gracz nie ma partnera.
                </p>
              ) : null}
            </div>
          ) : null}
          {matchCount > 5_000 ? (
            <p className="field-error" role="alert">
              Terminarz może zawierać maksymalnie 5000 meczów.
            </p>
          ) : null}
          <button
            disabled={!configurationValid}
            onClick={() => setStep('summary')}
            type="button"
          >
            Przejdź do podsumowania
          </button>
        </section>
      ) : (
        <form
          action={formAction}
          className="card form-card"
          id="create-league-form"
          onSubmit={() => {
            lastSubmitted.current = serializedPayload;
          }}
        >
          <h2>2. Podsumowanie</h2>
          <input name="payload" type="hidden" value={serializedPayload} />
          <dl className="summary-list">
            <div>
              <dt>Nazwa</dt>
              <dd>{name.trim()}</dd>
            </div>
            <div>
              <dt>Rodzaj</dt>
              <dd>{kind === 'CLASSIC' ? 'Klasyczna' : 'Nieskończona Elo'}</dd>
            </div>
            <div>
              <dt>Tryb</dt>
              <dd>{mode === 'SINGLES' ? 'Singiel' : 'Debel'}</dd>
            </div>
            <div>
              <dt>Gracze</dt>
              <dd>{selected.length}</dd>
            </div>
            <div>
              <dt>Mecze na start</dt>
              <dd>{matchCount}</dd>
            </div>
          </dl>
          <p className="warning-box">
            Po utworzeniu nie będzie można zmienić rodzaju ani trybu ligi.
            {kind === 'CLASSIC'
              ? ' Uczestnicy, stałe pary i rewanże zostaną zamrożone, a liga od razu otrzyma kompletny terminarz.'
              : ' Do ligi Elo będzie można później dodawać kolejnych uczestników.'}
          </p>
          {state.status === 'error' ? (
            <div className="error-message" role="alert">
              <p>{state.message}</p>
              {state.fields
                ? Object.values(state.fields).map(message => <p key={message}>{message}</p>)
                : null}
            </div>
          ) : null}
          <div className="button-row">
            <button
              className="secondary"
              disabled={pending}
              onClick={() => setStep('configuration')}
              type="button"
            >
              Wróć do konfiguracji
            </button>
            <button disabled={pending} type="submit">
              {pending ? 'Tworzenie…' : 'Utwórz ligę'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

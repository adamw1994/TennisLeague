'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScoreFormState } from '@/app/matches/actions';
import type { Format, TennisScore } from '@/modules/tennis/types';
import type { Mode, Sides } from '@/shared/contracts';

interface ParticipantOption {
  id: string;
  label: string;
}

interface ScoreFormProps {
  action: (
    state: ScoreFormState,
    formData: FormData,
  ) => Promise<ScoreFormState>;
  leagueId: string;
  matchId?: string;
  version?: number;
  sideA?: string;
  sideB?: string;
  initialScore?: TennisScore | null;
  initialSides?: Sides;
  participants?: ParticipantOption[];
  gameMode?: Mode;
  mode: 'record' | 'correct';
}

const initialState: ScoreFormState = { status: 'idle' };

function isFinished(format: Format, sideA: number, sideB: number): boolean {
  const high = Math.max(sideA, sideB);
  const low = Math.min(sideA, sideB);
  if (format === 'FAST4') return high === 4 && low <= 3;
  return (high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6));
}

function initialSet(score: TennisScore | null | undefined, index: number) {
  return {
    sideA: score?.sets[index]?.sideA ?? 0,
    sideB: score?.sets[index]?.sideB ?? 0,
  };
}

export function ScoreForm(props: ScoreFormProps) {
  const participants = props.participants;
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const [openingFormat, setOpeningFormat] = useState<Format>(
    props.initialScore?.openingSetFormat ?? 'FAST4',
  );
  const [decidingFormat, setDecidingFormat] = useState<
    Format | 'SUPER_TIE_BREAK'
  >(props.initialScore?.decidingSetFormat ?? 'SUPER_TIE_BREAK');
  const [sets, setSets] = useState(() => [
    initialSet(props.initialScore, 0),
    initialSet(props.initialScore, 1),
    initialSet(props.initialScore, 2),
  ]);
  const sideSize = props.gameMode === 'DOUBLES' ? 2 : 1;
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>(() => {
    if (props.initialSides) return [...props.initialSides[0], ...props.initialSides[1]];
    return participants?.slice(0, sideSize * 2).map(player => player.id) ?? [];
  });
  const tokenInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const participantById = useMemo(
    () => new Map(participants?.map(player => [player.id, player.label]) ?? []),
    [participants],
  );
  const selectedSides: Sides = [
    selectedPlayers.slice(0, sideSize),
    selectedPlayers.slice(sideSize, sideSize * 2),
  ];
  const uniqueSelection =
    selectedPlayers.length === sideSize * 2 &&
    new Set(selectedPlayers).size === selectedPlayers.length;
  const sideALabel = props.sideA ?? selectedSides[0].map(id => participantById.get(id)).join(' / ');
  const sideBLabel = props.sideB ?? selectedSides[1].map(id => participantById.get(id)).join(' / ');
  const needsThird = useMemo(() => {
    const first = sets[0]!;
    const second = sets[1]!;
    if (
      !isFinished(openingFormat, first.sideA, first.sideB) ||
      !isFinished(openingFormat, second.sideA, second.sideB)
    ) {
      return false;
    }
    return (first.sideA > first.sideB) !== (second.sideA > second.sideB);
  }, [openingFormat, sets]);
  const score: TennisScore = {
    openingSetFormat: openingFormat,
    decidingSetFormat: needsThird ? decidingFormat : null,
    sets: [
      { order: 1, kind: 'GAME_SET', ...sets[0]! },
      { order: 2, kind: 'GAME_SET', ...sets[1]! },
      ...(needsThird
        ? [
            {
              order: 3,
              kind:
                decidingFormat === 'SUPER_TIE_BREAK'
                  ? ('SUPER_TIE_BREAK' as const)
                  : ('GAME_SET' as const),
              ...sets[2]!,
            },
          ]
        : []),
    ],
  };

  useEffect(() => {
    if (state.status !== 'success' || !state.href) return;
    router.push(state.href);
    router.refresh();
  }, [router, state]);

  useEffect(() => {
    if (!participants || !tokenInput.current) return;
    tokenInput.current.value = crypto.randomUUID();
  }, [participants]);

  function updateSet(index: number, side: 'sideA' | 'sideB', value: number) {
    setSets(current =>
      current.map((set, setIndex) =>
        setIndex === index ? { ...set, [side]: value } : set,
      ),
    );
  }

  return (
    <form action={formAction} className="card form-card score-form">
      <input name="leagueId" type="hidden" value={props.leagueId} />
      {props.matchId ? <input name="matchId" type="hidden" value={props.matchId} /> : null}
      {props.version !== undefined ? (
        <input name="expectedVersion" type="hidden" value={props.version} />
      ) : null}
      {participants ? (
        <>
          <input name="sides" type="hidden" value={JSON.stringify(selectedSides)} />
          <input name="token" ref={tokenInput} type="hidden" />
          <fieldset>
            <legend>Uczestnicy meczu</legend>
            <div className="form-grid">
              {Array.from({ length: sideSize * 2 }, (_, index) => {
                const side = index < sideSize ? 'A' : 'B';
                const position = (index % sideSize) + 1;
                return (
                  <label key={`${side}-${position}`}>
                    Strona {side} — gracz {position}
                    <select
                      onChange={event =>
                        setSelectedPlayers(current =>
                          current.map((id, playerIndex) =>
                            playerIndex === index ? event.target.value : id,
                          ),
                        )
                      }
                      value={selectedPlayers[index] ?? ''}
                    >
                      <option disabled value="">Wybierz gracza</option>
                      {participants.map(player => (
                        <option key={player.id} value={player.id}>{player.label}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            {!uniqueSelection ? (
              <p className="field-error" role="alert">
                Każdy gracz może wystąpić w meczu tylko raz.
              </p>
            ) : null}
          </fieldset>
        </>
      ) : null}
      <input name="score" type="hidden" value={JSON.stringify(score)} />
      <div className="versus-heading">
        <strong>{sideALabel}</strong>
        <span>kontra</span>
        <strong>{sideBLabel}</strong>
      </div>
      <label>
        Format pierwszych dwóch setów
        <select
          onChange={event => setOpeningFormat(event.target.value as Format)}
          value={openingFormat}
        >
          <option value="FAST4">Fast4 — set do 4 gemów</option>
          <option value="NORMAL">Normalny — set do 6 gemów</option>
        </select>
      </label>
      {[0, 1].map(index => (
        <fieldset className="set-row" key={index}>
          <legend>Set {index + 1}</legend>
          <label>
            {sideALabel}
            <input
              inputMode="numeric"
              min={0}
              onChange={event => updateSet(index, 'sideA', Number(event.target.value))}
              type="number"
              value={sets[index]!.sideA}
            />
          </label>
          <label>
            {sideBLabel}
            <input
              inputMode="numeric"
              min={0}
              onChange={event => updateSet(index, 'sideB', Number(event.target.value))}
              type="number"
              value={sets[index]!.sideB}
            />
          </label>
        </fieldset>
      ))}
      {needsThird ? (
        <>
          <label>
            Format decydującego seta
            <select
              onChange={event =>
                setDecidingFormat(
                  event.target.value as Format | 'SUPER_TIE_BREAK',
                )
              }
              value={decidingFormat}
            >
              <option value="SUPER_TIE_BREAK">Super tie-break</option>
              <option value="FAST4">Fast4</option>
              <option value="NORMAL">Normalny</option>
            </select>
          </label>
          <fieldset className="set-row">
            <legend>Set 3</legend>
            <label>
              {sideALabel}
              <input
                inputMode="numeric"
                min={0}
                onChange={event => updateSet(2, 'sideA', Number(event.target.value))}
                type="number"
                value={sets[2]!.sideA}
              />
            </label>
            <label>
              {sideBLabel}
              <input
                inputMode="numeric"
                min={0}
                onChange={event => updateSet(2, 'sideB', Number(event.target.value))}
                type="number"
                value={sets[2]!.sideB}
              />
            </label>
          </fieldset>
        </>
      ) : null}
      {state.status === 'error' ? (
        <div className="error-message" role="alert">
          <p>{state.message}</p>
          {state.fields
            ? Object.values(state.fields).map(message => <p key={message}>{message}</p>)
            : null}
          {state.code === 'VERSION_CONFLICT' ? (
            <button type="button" onClick={() => window.location.reload()}>
              Odśwież dane
            </button>
          ) : null}
        </div>
      ) : null}
      <button disabled={pending || (participants !== undefined && !uniqueSelection)} type="submit">
        {pending
          ? 'Zapisywanie…'
          : props.mode === 'record'
            ? 'Zapisz wynik'
            : 'Zapisz poprawkę'}
      </button>
    </form>
  );
}

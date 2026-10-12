'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { LeagueFormState } from '@/app/leagues/actions';

interface EloMemberFormProps {
  action: (
    state: LeagueFormState,
    formData: FormData,
  ) => Promise<LeagueFormState>;
  leagueId: string;
  players: Array<{ id: string; label: string }>;
}

const initialState: LeagueFormState = { status: 'idle' };

export function EloMemberForm(props: EloMemberFormProps) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const token = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (token.current) token.current.value = crypto.randomUUID();
  }, []);

  useEffect(() => {
    if (state.status !== 'success') return;
    if (token.current) token.current.value = crypto.randomUUID();
    router.refresh();
  }, [router, state.status]);

  if (props.players.length === 0) {
    return <p className="muted">Wszyscy aktywni gracze należą już do tej ligi.</p>;
  }

  return (
    <form action={formAction} className="card form-card">
      <h2>Dodaj uczestnika Elo</h2>
      <p className="muted">Nowy gracz zacznie z ratingiem 1000.</p>
      <input name="leagueId" type="hidden" value={props.leagueId} />
      <input name="token" ref={token} type="hidden" />
      <label>
        Gracz
        <select name="playerId" required>
          {props.players.map(player => (
            <option key={player.id} value={player.id}>{player.label}</option>
          ))}
        </select>
      </label>
      {state.status === 'error' ? <p className="field-error" role="alert">{state.message}</p> : null}
      {state.status === 'success' ? <p role="status">Gracz dołączył do ligi.</p> : null}
      <button disabled={pending} type="submit">
        {pending ? 'Dodawanie…' : 'Dodaj gracza'}
      </button>
    </form>
  );
}

'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { LeagueFormState } from '@/app/leagues/actions';

interface LeagueSettingsFormProps {
  action: (
    state: LeagueFormState,
    formData: FormData,
  ) => Promise<LeagueFormState>;
  id: string;
  version: number;
  name: string;
  eloK: number | null;
}

const initialState: LeagueFormState = { status: 'idle' };

export function LeagueSettingsForm(props: LeagueSettingsFormProps) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== 'success') return;
    router.refresh();
  }, [router, state.status]);

  return (
    <form action={formAction} className="card form-card">
      <h2>Dane ligi</h2>
      <input name="id" type="hidden" value={props.id} />
      <input name="expectedVersion" type="hidden" value={props.version} />
      <label>
        Nazwa ligi
        <input defaultValue={props.name} maxLength={120} name="name" required />
      </label>
      {props.eloK === null ? (
        <input name="eloK" type="hidden" value="" />
      ) : (
        <label>
          Współczynnik K (10–60)
          <input
            defaultValue={props.eloK}
            max={60}
            min={10}
            name="eloK"
            type="number"
          />
        </label>
      )}
      {state.status === 'error' ? (
        <div className="error-message" role="alert">
          <p>{state.message}</p>
          {state.code === 'VERSION_CONFLICT' ? (
            <button type="button" onClick={() => window.location.reload()}>
              Odśwież dane
            </button>
          ) : null}
        </div>
      ) : null}
      {state.status === 'success' ? <p role="status">Zmiany zapisano.</p> : null}
      <button disabled={pending} type="submit">
        {pending ? 'Zapisywanie…' : 'Zapisz ustawienia'}
      </button>
    </form>
  );
}

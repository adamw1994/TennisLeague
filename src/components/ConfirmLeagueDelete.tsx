'use client';

import { useActionState, useRef } from 'react';
import type { DeleteLeagueState } from '@/app/leagues/actions';

interface ConfirmLeagueDeleteProps {
  action: (
    state: DeleteLeagueState,
    formData: FormData,
  ) => Promise<DeleteLeagueState>;
  id: string;
  version: number;
  matchCount: number;
}

const initialState: DeleteLeagueState = { status: 'idle' };

export function ConfirmLeagueDelete(props: ConfirmLeagueDeleteProps) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="danger secondary" onClick={() => dialog.current?.showModal()}>
        Usuń ligę
      </button>
      <dialog aria-labelledby="delete-league-title" ref={dialog}>
        <form action={formAction} className="dialog-card">
          <input name="id" type="hidden" value={props.id} />
          <input name="expectedVersion" type="hidden" value={props.version} />
          <h2 id="delete-league-title">Usunąć ligę?</h2>
          <p>
            Liga i jej {props.matchCount} {props.matchCount === 1 ? 'mecz' : 'meczów'}
            {' '}znikną z publicznych widoków. Dane historyczne pozostaną w bazie.
          </p>
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
          <div className="button-row">
            <button className="secondary" onClick={() => dialog.current?.close()} type="button">
              Anuluj
            </button>
            <button className="danger" disabled={pending} type="submit">
              {pending ? 'Usuwanie…' : 'Potwierdź usunięcie'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

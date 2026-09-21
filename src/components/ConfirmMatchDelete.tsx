'use client';

import { useActionState, useRef } from 'react';
import type { DeleteMatchState } from '@/app/matches/actions';

interface ConfirmMatchDeleteProps {
  action: (
    state: DeleteMatchState,
    formData: FormData,
  ) => Promise<DeleteMatchState>;
  leagueId: string;
  matchId: string;
  version: number;
}

const initialState: DeleteMatchState = { status: 'idle' };

export function ConfirmMatchDelete(props: ConfirmMatchDeleteProps) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="danger secondary" onClick={() => dialog.current?.showModal()} type="button">
        Usuń mecz
      </button>
      <dialog aria-labelledby="delete-match-title" ref={dialog}>
        <form action={formAction} className="dialog-card">
          <input name="leagueId" type="hidden" value={props.leagueId} />
          <input name="matchId" type="hidden" value={props.matchId} />
          <input name="expectedVersion" type="hidden" value={props.version} />
          <h2 id="delete-match-title">Usunąć mecz?</h2>
          <p>
            Mecz zniknie z bieżących widoków, a ranking zostanie przeliczony bez tego wyniku.
            Historia wersji pozostanie zachowana.
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


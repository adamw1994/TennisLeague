'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { DeletePlayerState } from '@/app/players/actions';

interface ConfirmDeleteProps {
  action: (
    state: DeletePlayerState,
    formData: FormData,
  ) => Promise<DeletePlayerState>;
  id: string;
  version: number;
  leagueCount?: number;
  matchCount?: number;
}

const initialState: DeletePlayerState = { status: 'idle' };

export function ConfirmDelete({
  action,
  id,
  version,
  leagueCount = 0,
  matchCount = 0,
}: ConfirmDeleteProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'success' && state.href) {
      dialog.current?.close();
      router.push(state.href);
      router.refresh();
    }
  }, [router, state]);

  return (
    <>
      <button className="danger secondary" onClick={() => dialog.current?.showModal()}>
        Usuń gracza
      </button>
      <dialog aria-labelledby="delete-player-title" ref={dialog}>
        <form action={formAction} className="dialog-card">
          <input name="id" type="hidden" value={id} />
          <input name="expectedVersion" type="hidden" value={version} />
          <h2 id="delete-player-title">Usunąć gracza?</h2>
          <p>Profil zniknie z listy, ale historia i pseudonim pozostaną zachowane.</p>
          {(leagueCount > 0 || matchCount > 0) && (
            <p>
              Gracz pozostanie widoczny historycznie w {leagueCount}{' '}
              {leagueCount === 1 ? 'lidze' : 'ligach'} i {matchCount}{' '}
              {matchCount === 1 ? 'meczu' : 'meczach'}.
            </p>
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
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
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

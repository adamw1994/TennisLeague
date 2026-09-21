'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlayerFormState } from '@/app/players/actions';
import { FieldError } from './FieldError';

interface PlayerValues {
  id?: string;
  version?: number;
  firstName: string;
  lastName: string;
  nickname: string;
}

interface PlayerFormProps {
  action: (
    state: PlayerFormState,
    formData: FormData,
  ) => Promise<PlayerFormState>;
  mode: 'create' | 'edit';
  initialValues?: PlayerValues;
}

const initialState: PlayerFormState = { status: 'idle' };

export function PlayerForm({ action, mode, initialValues }: PlayerFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [version, setVersion] = useState(initialValues?.version ?? 0);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadErrorCode, setUploadErrorCode] = useState('');
  const [uploading, setUploading] = useState(false);
  const [formValues, setFormValues] = useState(() => ({
    firstName: initialValues?.firstName ?? '',
    lastName: initialValues?.lastName ?? '',
    nickname: initialValues?.nickname ?? '',
  }));
  const lastSubmitted = useRef<string | null>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const storageKey = 'low-on-legs:create-player-token';

  useEffect(() => {
    if (mode !== 'create') return;
    const saved = sessionStorage.getItem(storageKey);
    const value = saved || crypto.randomUUID();
    sessionStorage.setItem(storageKey, value);
    if (tokenInput.current) tokenInput.current.value = value;
  }, [mode]);

  useEffect(() => {
    if (state.status !== 'success' || !state.href) return;
    if (mode === 'create') sessionStorage.removeItem(storageKey);
    router.push(state.href);
    router.refresh();
  }, [mode, router, state]);

  function fingerprint(form: HTMLFormElement): string {
    const data = new FormData(form);
    return JSON.stringify([
      data.get('firstName'),
      data.get('lastName'),
      data.get('nickname'),
    ]);
  }

  function handleInput(event: React.FormEvent<HTMLFormElement>) {
    if (mode !== 'create' || lastSubmitted.current === null) return;
    if (fingerprint(event.currentTarget) !== lastSubmitted.current) {
      const nextToken = crypto.randomUUID();
      sessionStorage.setItem(storageKey, nextToken);
      if (tokenInput.current) tokenInput.current.value = nextToken;
      lastSubmitted.current = null;
    }
  }

  async function uploadAvatar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('avatar');
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      setUploadMessage('Wybierz plik obrazu.');
      return;
    }
    setUploading(true);
    setUploadMessage('');
    setUploadErrorCode('');
    const body = new FormData();
    body.set('avatar', input.files[0]);
    body.set('expectedVersion', String(version));
    try {
      const response = await fetch(`/api/players/${initialValues?.id}/avatar`, {
        method: 'POST',
        body,
      });
      const result = (await response.json()) as {
        ok: boolean;
        value?: { version: number };
        code?: string;
        message?: string;
      };
      if (result.ok && result.value) {
        setVersion(result.value.version);
        form.reset();
        setUploadErrorCode('');
        setUploadMessage('Awatar zapisano.');
        router.refresh();
      } else {
        setUploadErrorCode(result.code ?? '');
        setUploadMessage(result.message ?? 'Nie udało się zapisać awatara.');
      }
    } catch {
      setUploadErrorCode('');
      setUploadMessage('Nie udało się potwierdzić zapisu. Spróbuj ponownie.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="form-stack">
      <form
        action={formAction}
        className="card form-card"
        onInput={handleInput}
        onSubmit={event => {
          lastSubmitted.current = fingerprint(event.currentTarget);
        }}
      >
        {mode === 'create' ? <input name="token" ref={tokenInput} type="hidden" /> : null}
        {mode === 'edit' ? (
          <>
            <input name="id" type="hidden" value={initialValues?.id} />
            <input name="expectedVersion" type="hidden" value={version} />
          </>
        ) : null}
        <label>
          Imię
          <input
            aria-describedby={state.fields?.firstName ? 'firstName-error' : undefined}
            maxLength={80}
            name="firstName"
            onChange={event =>
              setFormValues(current => ({ ...current, firstName: event.target.value }))
            }
            required
            value={formValues.firstName}
          />
        </label>
        <FieldError id="firstName-error" message={state.fields?.firstName} />
        <label>
          Nazwisko
          <input
            aria-describedby={state.fields?.lastName ? 'lastName-error' : undefined}
            maxLength={80}
            name="lastName"
            onChange={event =>
              setFormValues(current => ({ ...current, lastName: event.target.value }))
            }
            required
            value={formValues.lastName}
          />
        </label>
        <FieldError id="lastName-error" message={state.fields?.lastName} />
        <label>
          Pseudonim
          <input
            aria-describedby={state.fields?.nickname ? 'nickname-error' : undefined}
            maxLength={40}
            name="nickname"
            onChange={event =>
              setFormValues(current => ({ ...current, nickname: event.target.value }))
            }
            required
            value={formValues.nickname}
          />
        </label>
        <FieldError id="nickname-error" message={state.fields?.nickname} />
        {state.status === 'error' ? (
          <div className="form-message error-message" role="alert">
            <p>{state.message}</p>
            {state.code === 'VERSION_CONFLICT' ? (
              <button type="button" onClick={() => window.location.reload()}>
                Odśwież dane
              </button>
            ) : null}
          </div>
        ) : null}
        <button disabled={pending} type="submit">
          {pending ? 'Zapisywanie…' : mode === 'create' ? 'Dodaj gracza' : 'Zapisz dane'}
        </button>
      </form>

      {mode === 'edit' ? (
        <form className="card form-card" onSubmit={uploadAvatar}>
          <h2>Awatar</h2>
          <p className="muted">JPEG, PNG lub WebP, maksymalnie 5 MB.</p>
          <label>
            Plik awatara
            <input accept="image/jpeg,image/png,image/webp" name="avatar" type="file" />
          </label>
          {uploadMessage ? (
            <div
              className={`form-message ${uploadErrorCode ? 'error-message' : ''}`}
              role={uploadErrorCode ? 'alert' : 'status'}
            >
              <p>{uploadMessage}</p>
              {uploadErrorCode === 'VERSION_CONFLICT' ? (
                <button type="button" onClick={() => window.location.reload()}>
                  Odśwież dane
                </button>
              ) : null}
            </div>
          ) : null}
          <button disabled={uploading} type="submit">
            {uploading ? 'Wysyłanie…' : 'Zapisz awatar'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

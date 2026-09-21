'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EloStatusDto } from '@/modules/elo/queries';

interface EloStatusProps extends EloStatusDto {
  leagueId: string;
}

export function EloStatus({ leagueId, ...initial }: EloStatusProps) {
  const router = useRouter();
  const card = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<EloStatusDto>(initial);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const element = card.current;
    if (!element) return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const poll = async () => {
      if (stopped || !visible || inFlight.current) return;
      inFlight.current = true;
      const request = new AbortController();
      controller.current = request;
      try {
        const response = await fetch(`/api/leagues/${leagueId}/elo-status`, {
          cache: 'no-store',
          signal: request.signal,
        });
        if (!response.ok) return;
        const next = (await response.json()) as EloStatusDto;
        const previous = statusRef.current;
        const changed =
          next.inputRevision !== previous.inputRevision ||
          next.publishedRevision !== previous.publishedRevision ||
          next.state !== previous.state;
        statusRef.current = next;
        setStatus(next);
        if (changed) router.refresh();
      } catch {
        // A transient network error leaves the last complete ranking visible.
      } finally {
        inFlight.current = false;
        controller.current = null;
        if (!stopped && visible) {
          const delay = statusRef.current.state === 'FAILED' ? 10_000 : 2_000;
          timer = setTimeout(() => void poll(), delay);
        }
      }
    };

    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible && !timer) void poll();
      if (!visible && timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!visible) controller.current?.abort();
    });
    observer.observe(element);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.current?.abort();
      observer.disconnect();
    };
  }, [leagueId, router]);

  const message =
    status.state === 'CURRENT'
      ? 'Ranking aktualny'
      : status.state === 'FAILED'
        ? 'Nie udało się przeliczyć rankingu. Pokazujemy ostatni kompletny ranking.'
        : 'Trwa przeliczanie. Pokazujemy ostatni kompletny ranking.';

  return (
    <aside ref={card} className="card elo-status" role="status" aria-live="polite">
      <strong>{message}</strong>
      <span>
        Rewizja wyników: {status.inputRevision} · opublikowano: {status.publishedRevision}
      </span>
    </aside>
  );
}

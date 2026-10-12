export function createBarrier(participants: number): () => Promise<void> {
  if (!Number.isInteger(participants) || participants < 1) {
    throw new RangeError('participants must be a positive integer');
  }

  let arrived = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived === participants) {
      release?.();
    }
    await ready;
  };
}

export interface TestBarrier {
  reached: Promise<void>;
  release(): void;
  wait(): Promise<void>;
}

/** A deterministic single worker pause point for concurrency tests. */
export function barrier(): TestBarrier {
  let signalReached!: () => void;
  let signalRelease!: () => void;
  const reached = new Promise<void>(resolve => {
    signalReached = resolve;
  });
  const released = new Promise<void>(resolve => {
    signalRelease = resolve;
  });
  return {
    reached,
    release: () => signalRelease(),
    wait: async () => {
      signalReached();
      await released;
    },
  };
}

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrm } from '@/db/orm';
import { writeWorkerHealth } from './health';
import { runOnce } from './run-once';

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));

export async function runWorker(): Promise<void> {
  const orm = await getOrm();
  const pollMs = Math.max(100, Number(process.env.ELO_WORKER_POLL_MS ?? 1000));
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const health = setInterval(() => {
    void writeWorkerHealth().catch(() => undefined);
  }, 5_000);
  try {
    while (!stopping) {
      await writeWorkerHealth();
      const processed = await runOnce(orm);
      if (!processed) await sleep(pollMs);
    }
  } finally {
    clearInterval(health);
    await orm.close(true);
  }
}

const entrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (entrypoint) {
  void runWorker().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

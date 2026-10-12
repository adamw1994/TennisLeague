import { readFile, unlink } from 'node:fs/promises';
import { kill } from 'node:process';

const workerPidFile = '/tmp/low-on-legs-e2e-worker.pid';

export default async function globalTeardown(): Promise<void> {
  try {
    const pid = Number(await readFile(workerPidFile, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM');
      } catch {
        kill(pid, 'SIGTERM');
      }
    }
  } catch {
    // The worker may already have exited after an E2E failure.
  } finally {
    await unlink(workerPidFile).catch(() => undefined);
  }
}

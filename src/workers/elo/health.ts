import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function healthPath(): string {
  return process.env.ELO_WORKER_HEALTH_FILE ?? '/tmp/elo-worker-health';
}

export async function writeWorkerHealth(now = new Date()): Promise<void> {
  const path = healthPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${now.toISOString()}\n`, 'utf8');
}

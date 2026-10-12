import { spawn } from 'node:child_process';
import { access, unlink, writeFile } from 'node:fs/promises';
import { MikroORM } from '@mikro-orm/postgresql';
import { createOrmConfig } from '../../mikro-orm.config';
import { seedAcceptance } from '../support/fixtures';

const workerHealthFile = '/tmp/low-on-legs-e2e-worker-health';
const workerPidFile = '/tmp/low-on-legs-e2e-worker.pid';

export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL is required');
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!databaseName.endsWith('_e2e_test')) {
    throw new Error('E2E_DATABASE_URL database name must end with _e2e_test');
  }

  const orm = await MikroORM.init(createOrmConfig(databaseUrl));
  try {
    await orm.em.getConnection().execute('drop schema public cascade');
    await orm.em.getConnection().execute('create schema public');
    await orm.migrator.up();
    await orm.em.getConnection().execute(
      `update application_settings
          set value = 1000
        where key in (
          'rate_limit.default',
          'rate_limit.create_league',
          'rate_limit.upload_avatar',
          'rate_limit.correct_elo',
          'rate_limit.global'
        )`,
    );
    await seedAcceptance(orm.em.fork());
  } finally {
    await orm.close(true);
  }

  await unlink(workerHealthFile).catch(() => undefined);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const worker = spawn(npmCommand, ['run', 'worker:elo'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      APP_ORIGIN: 'http://127.0.0.1:3100',
      CLIENT_KEY_HMAC_SECRET: 'e2e-only-client-key-secret',
      ELO_WORKER_HEALTH_FILE: workerHealthFile,
      ELO_WORKER_POLL_MS: '100',
    },
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  await writeFile(workerPidFile, String(worker.pid ?? ''), 'utf8');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await access(workerHealthFile);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  worker.kill('SIGTERM');
  throw new Error('E2E Elo worker did not become healthy.');
}

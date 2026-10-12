import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityManager } from '@mikro-orm/postgresql';
import { getOrm } from '@/db/orm';
import type { Id, Versioned } from '@/shared/contracts';
import {
  restoreLeague,
  restoreMatch,
  restoreMatchRevision,
  restorePlayer,
} from '@/modules/recovery/commands';

export { restoreLeague, restoreMatch, restoreMatchRevision, restorePlayer };

type RecoveryMode = 'restore-match' | 'restore-match-revision' | 'restore-league' | 'restore-player';

interface Options {
  mode: RecoveryMode;
  id: Id;
  expectedVersion: number;
  sourceVersion?: number;
  apply: boolean;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseOptions(): Options {
  const mode = option('--mode') as RecoveryMode | undefined;
  const id = option('--id');
  const expectedVersion = Number(option('--expected-version'));
  const sourceRaw = option('--source-version');
  const sourceVersion = sourceRaw === undefined ? undefined : Number(sourceRaw);
  if (
    !mode ||
    !['restore-match', 'restore-match-revision', 'restore-league', 'restore-player'].includes(mode) ||
    !id ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion <= 0 ||
    (mode === 'restore-match-revision' && (!Number.isInteger(sourceVersion) || sourceVersion! <= 0))
  ) {
    throw new Error(
      'Użycie: recover --mode <restore-match|restore-match-revision|restore-league|restore-player> --id <uuid> --expected-version <n> [--source-version <n>] [--apply]',
    );
  }
  return {
    mode,
    id,
    expectedVersion,
    ...(sourceVersion === undefined ? {} : { sourceVersion }),
    apply: process.argv.includes('--apply'),
  };
}

async function execute(em: EntityManager, options: Options): Promise<unknown> {
  const command: Versioned & { sourceVersion?: number } = {
    id: options.id,
    expectedVersion: options.expectedVersion,
    ...(options.sourceVersion === undefined ? {} : { sourceVersion: options.sourceVersion }),
  };
  if (!options.apply) {
    return {
      ok: true,
      dryRun: true,
      mode: options.mode,
      id: options.id,
      expectedVersion: options.expectedVersion,
      ...(options.sourceVersion === undefined ? {} : { sourceVersion: options.sourceVersion }),
    };
  }
  switch (options.mode) {
    case 'restore-match':
      return restoreMatch(em, command);
    case 'restore-match-revision':
      return restoreMatchRevision(em, command as Versioned & { sourceVersion: number });
    case 'restore-league':
      return restoreLeague(em, command);
    case 'restore-player':
      return restorePlayer(em, command);
  }
}

async function run(): Promise<void> {
  const options = parseOptions();
  const orm = await getOrm();
  try {
    const result = await execute(orm.em.fork(), options);
    console.log(JSON.stringify(result));
  } finally {
    await orm.close(true);
  }
}

const entrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (entrypoint) {
  void run().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

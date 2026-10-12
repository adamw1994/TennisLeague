## Task 1: Uruchamialny fundament z PostgreSQL

**Files:** Utwórz pliki narzędziowe z mapy, src/app/layout.tsx, page.tsx, globals.css, src/app/api/health/route.ts, pliki src/db/, Migration001Platform.ts, compose.test.yaml, tests/support/database.ts, fixtures.ts, barrier.ts, tests/integration/platform.test.ts.
**Interfaces:** Produkuje getOrm(): Promise<MikroORM>, withDb<T>(fn: (em: EntityManager) => Promise<T>): Promise<T>, migrate(): Promise<void>, withTestDb<T>(fn: (em: EntityManager) => Promise<T>): Promise<T>.

- [ ] Sprawdź Node/npm/Docker/Git; Git w tym środowisku jest pod C:/Program Files/Git/cmd/git.exe. Wybierz Node 24 i utwórz package.json ręcznie, zachowując docs/. Zainstaluj poniższe pakiety, wszystkie MikroORM w identycznej wersji poprawkowej. Jest to setup, przed testem wymagającym runnera.
~~~powershell
npm install --save-exact next@16 react react-dom @mikro-orm/core@7.2 @mikro-orm/postgresql@7.2 @mikro-orm/migrations@7.2 zod sharp
npm install --save-dev --save-exact typescript @types/node @types/react @types/react-dom @mikro-orm/cli@7.2 vitest @playwright/test eslint eslint-config-next@16 tsx
~~~
- [ ] Skonfiguruj strict, alias @/* → src/*, Node runtime, dynamiczne strony czytające bazę i skrypty:
~~~json
{
  "dev": "next dev",
  "build": "next build && tsc -p tsconfig.worker.json",
  "start": "next start",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "playwright test",
  "db:migrate": "tsx src/db/migrate.ts",
  "worker": "tsx src/workers/elo/main.ts",
  "benchmark": "tsx scripts/benchmark.ts"
}
~~~
tsconfig.worker.json dodać przy workerze; do tego czasu build jest next build. Nie dodawać nieistniejących entrypointów do wymaganych sprawdzeń.
- [ ] Dodaj poniższy test po przygotowaniu testowego PostgreSQL. withTestDb tworzy losowy schemat, migruje go i usuwa wyłącznie ten schemat po teście; twardo wymaga TEST_DATABASE_URL z nazwą bazy kończącą się _test. Każdy równoległy test ma własny schemat, wszystkie połączenia danego testu ten sam search_path.
~~~ts
import { expect, test } from 'vitest';
import { withTestDb } from '../support/database';

test('migracje są powtarzalne i sport TENNIS istnieje raz', async () => {
  await withTestDb(async em => {
    const rows = await em.getConnection().execute(
      "select code from sports where code = 'TENNIS'"
    );
    expect(rows).toEqual([{ code: 'TENNIS' }]);
  });
});
~~~
- [ ] Uruchom npm run test:integration -- tests/integration/platform.test.ts; oczekuj błędu braku tabeli przed migracją. Następnie dodaj migrację sports(id UUID PK, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL) i seed TENNIS w tej samej migracji.
- [ ] Zaimplementuj ORM jako cache Promise inicjalizacji, z usunięciem odrzuconej obietnicy z cache; bez migracji przy inicjalizacji. Jawnie importuj encje i migracje, jawne tableName, defineEntity; withDb tworzy fork EntityManager. Health wykonuje SELECT 1 i zwraca 503 przy niedostępnej bazie, bez szczegółów połączenia.
~~~ts
export async function withDb<T>(
  fn: (em: EntityManager) => Promise<T>
): Promise<T> {
  const orm = await getOrm();
  return fn(orm.em.fork());
}
~~~
- [ ] Potwierdź powtórne uruchomienie migracji bez zmian, health 200/503, dwa niezależne konteksty ORM oraz produkcyjny build bez aktywnego połączenia w czasie kompilacji.
- [ ] Uruchom typecheck, lint, test platformy i build; przejrzyj lockfile oraz diff. Commit: chore: bootstrap application and database.

**Odbiór:** Strona startowa działa, schemat migruje się od zera, brak sekretów w repo. Na tym etapie brak funkcji biznesowych jest zamierzony.

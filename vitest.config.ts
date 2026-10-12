import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // MikroORM encje są współdzielonymi obiektami metadanych. Osobne pliki
    // integracyjne nadal używają izolowanych schematów, ale nie inicjalizują
    // równolegle generatora schematu z inną wartością search_path.
    fileParallelism: false,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});

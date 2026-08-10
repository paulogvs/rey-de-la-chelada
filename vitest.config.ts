import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,js}'],
    exclude: ['tests/e2e/**'],
    // F1 (2026-08-10): las suites de integración que bootean server real
    // superaban el hookTimeout por defecto (10s) bajo carga paralela de 60
    // archivos → 2 suites fallaban intermitentemente ("Hook timed out").
    // Subido a 60s → gatillos estables incluso en pool paralelo.
    hookTimeout: 60000,
    testTimeout: 60000,
    // F1: pool forks aísla cada archivo → evita contaminación de DB_PATH
    // entre tests de integración que bootean servidores reales.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/core/engine/**', 'server/**'],
    },
  },
});

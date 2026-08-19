import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e — tests de navegador real para los flujos críticos.
 *
 * - webServer auto-levanta el server Express (sirve dist/) en un puerto
 *   aislado (3200) con una DB de test propia (data/test-e2e.db), para no
 *   tocar la DB de PROD ni el puerto 3002.
 * - Requiere `npm run build` previo (el script `test:e2e` ya lo encadena).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:3200/health',
    timeout: 60000,
    reuseExistingServer: false,
    env: {
      PORT: '3200',
      DB_PATH: 'data/test-e2e.db',
    },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-pixel7', use: { ...devices['Pixel 7'] } },
  ],
});

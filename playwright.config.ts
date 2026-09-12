import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/**
 * Fluxos de ponta a ponta (docs/ROADMAP.md, critério da E6). Cada cenário cria a
 * própria oficina pela API, então os testes não dependem de banco preparado —
 * mas rodam contra o banco de DESENVOLVIMENTO, pelo servidor de `npm run dev`.
 */
export default defineConfig({
  testDir: './e2e',
  // um fluxo por vez: o servidor de dev é um só, e o teste é de fluxo, não de carga
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'painel',
      testMatch: /painel\.spec\.ts$/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } },
    },
    {
      // o cliente abre o link no celular: é o único jeito que interessa provar
      name: 'cliente',
      testMatch: /cliente\.spec\.ts$/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

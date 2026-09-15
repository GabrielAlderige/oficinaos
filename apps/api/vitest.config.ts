import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15_000,
    // o beforeAll dos fluxos cria várias contas, e o hash de senha é caro de
    // propósito: com a suíte inteira em paralelo, 30 s não bastavam (E12)
    hookTimeout: 60_000,
  },
});

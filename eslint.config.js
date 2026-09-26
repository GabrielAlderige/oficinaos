import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // a landing é Astro: quem confere os `.astro` é o `astro check`, no
    // typecheck do próprio workspace
    ignores: ['**/dist/**', '**/node_modules/**', '**/src/db/migrations/**', '.secrets/**', 'apps/landing/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // o service worker roda no navegador, mas fora do bundle (public/sw.js)
    files: [
      'apps/api/**/*.ts',
      'packages/**/*.ts',
      'e2e/**/*.ts',
      '**/*.config.{ts,js}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // roda no Node, mas o que está dentro de page.evaluate roda no navegador
    files: ['apps/web/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);

// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * A landing (docs/ARCHITECTURE.md §2, D21). Astro por um motivo só: ela
 * precisa de SEO e de abrir instantaneamente, e uma SPA React entrega HTML
 * vazio para o Google. O build sai HTML estático, sem JavaScript de runtime.
 */
export default defineConfig({
  site: 'https://oficinaos.com.br',
  vite: { plugins: [tailwindcss()] },
  build: { inlineStylesheets: 'always' },
});

import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * `/orcamento/<token>` é uma URL bonita servida por uma ENTRADA própria. Em
 * produção quem reescreve é o proxy/CDN; em dev, este plugin faz o mesmo, senão
 * o Vite entregaria o index.html do painel.
 */
const publicQuoteEntry = (): Plugin => ({
  name: 'oficinaos-orcamento-entry',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/orcamento/')) req.url = '/orcamento.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), publicQuoteEntry()],
  build: {
    rollupOptions: {
      /**
       * Duas entradas: o painel e a página do cliente. Separadas de propósito —
       * o orçamento abre no celular do cliente, muitas vezes em 3G, e não pode
       * carregar o painel junto (ARCHITECTURE §8.2: menos de 100 KB de JS).
       */
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        orcamento: resolve(import.meta.dirname, 'orcamento.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // em dev o painel e a API ficam na mesma origem: sem CORS, cookies funcionam
    proxy: { '/api': { target: 'http://127.0.0.1:3333' } },
  },
});

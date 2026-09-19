import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * `/orcamento/<token>` (cliente) e `/cotacao/<token>` (fornecedor) são URLs
 * bonitas servidas por ENTRADAS próprias. Em produção quem reescreve é o
 * proxy/CDN; em dev, este plugin faz o mesmo, senão o Vite entregaria o
 * index.html do painel. A barra final importa: `/cotacoes/...` é do painel.
 */
const publicEntries = (): Plugin => ({
  name: 'oficinaos-public-entries',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/orcamento/')) req.url = '/orcamento.html';
      else if (req.url?.startsWith('/cotacao/')) req.url = '/cotacao.html';
      else if (req.url?.startsWith('/avaliacao/')) req.url = '/avaliacao.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), publicEntries()],
  build: {
    rollupOptions: {
      /**
       * Quatro entradas: o painel, a página do orçamento, a do fornecedor e a
       * da avaliação.
       * Separadas de propósito — as públicas abrem no celular, muitas vezes em
       * 3G, e não podem carregar o painel junto (ARCHITECTURE §8.2: menos de
       * 100 KB de JS).
       */
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        orcamento: resolve(import.meta.dirname, 'orcamento.html'),
        cotacao: resolve(import.meta.dirname, 'cotacao.html'),
        avaliacao: resolve(import.meta.dirname, 'avaliacao.html'),
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

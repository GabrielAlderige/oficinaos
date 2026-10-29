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
      else if (req.url?.startsWith('/acompanhar/')) req.url = '/acompanhar.html';
      else if (req.url?.startsWith('/pesquisa/')) req.url = '/pesquisa.html';
      else if (req.url?.startsWith('/cliente/')) req.url = '/cliente.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), publicEntries()],
  build: {
    rollupOptions: {
      /**
       * Seis entradas: o painel, a página do orçamento, a do fornecedor, a de
       * acompanhamento do veículo, a pesquisa de satisfação (E49) e o app do
       * cliente (E50).
       * Separadas de propósito — as públicas abrem no celular, muitas vezes em
       * 3G, e não podem carregar o painel junto (ARCHITECTURE §8.2: menos de
       * 100 KB de JS).
       */
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        orcamento: resolve(import.meta.dirname, 'orcamento.html'),
        cotacao: resolve(import.meta.dirname, 'cotacao.html'),
        acompanhar: resolve(import.meta.dirname, 'acompanhar.html'),
        pesquisa: resolve(import.meta.dirname, 'pesquisa.html'),
        cliente: resolve(import.meta.dirname, 'cliente.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // em dev o painel e a API ficam na mesma origem: sem CORS, cookies funcionam
    proxy: { '/api': { target: 'http://127.0.0.1:3333' } },
  },
  /**
   * `vite preview` serve o build de PRODUÇÃO — é o único jeito de exercitar o
   * service worker e a instalação do app (E24) na máquina, porque em dev ele
   * nem se registra. Precisa do mesmo proxy, senão a API some.
   */
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3333' } },
  },
});

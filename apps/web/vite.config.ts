import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // em dev o painel e a API ficam na mesma origem: sem CORS, cookies funcionam
    proxy: { '/api': { target: 'http://127.0.0.1:3333' } },
  },
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    migrate: 'scripts/migrate.ts',
    // preparar o banco (roles, privilégios, esquema da fila) também é código
    // de produção: o servidor novo não pode depender de um script que só roda
    // com TypeScript instalado
    'db-setup': 'scripts/db-setup.ts',
    // publicar o curso de Tutoriais no servidor novo (DEPLOY.md §6.2)
    'seed-tutoriais': 'scripts/seed-tutoriais.ts',
    // a oficina de demonstração do servidor, para as reuniões de venda (DEMO_DOMINIO e DEMO_SENHA próprios)
    'seed-demo': 'scripts/seed-demo.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // o pacote compartilhado é TypeScript puro: entra no bundle
  noExternal: ['@oficinaos/shared'],
});

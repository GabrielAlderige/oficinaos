/**
 * Prepara o PostgreSQL local: roles, bancos de dev e de teste, extensões e
 * privilégios. Roda como superusuário (DATABASE_ADMIN_URL) e é idempotente:
 * pode rodar de novo a qualquer momento, inclusive para trocar senhas.
 *
 *   oficinaos_owner  dona das tabelas; roda as migrations
 *   oficinaos_app    runtime da API; NOBYPASSRLS; só lê e escreve dados
 */
import pg from 'pg';
import { loadEnv } from '../src/config/load-env';

loadEnv();

function required(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} no .env (veja .env.example)`);
  return new URL(value);
}

/**
 * Em produção não existe banco de teste: `--prod` (ou NODE_ENV=production)
 * prepara só o banco que a oficina usa. É o mesmo script de propósito — a
 * preparação do servidor de verdade não pode ser um caminho que ninguém
 * nunca rodou.
 */
const somenteProducao = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

const admin = required('DATABASE_ADMIN_URL');
const app = required('DATABASE_URL');
const owner = required('DATABASE_OWNER_URL');
const testApp = somenteProducao ? null : required('TEST_DATABASE_URL');

const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const dbName = (url: URL) => decodeURIComponent(url.pathname.slice(1));
const user = (url: URL) => decodeURIComponent(url.username);
const password = (url: URL) => decodeURIComponent(url.password);

async function withClient<T>(url: URL, database: string, fn: (c: pg.Client) => Promise<T>) {
  const target = new URL(url);
  target.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureRole(c: pg.Client, url: URL) {
  const name = user(url);
  const { rowCount } = await c.query('select 1 from pg_roles where rolname = $1', [name]);
  const verb = rowCount ? 'ALTER' : 'CREATE';
  await c.query(
    `${verb} ROLE ${ident(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${literal(password(url))}`,
  );
  console.log(`  role ${name}: ${rowCount ? 'atualizada' : 'criada'}`);
}

async function ensureDatabase(c: pg.Client, name: string) {
  const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [name]);
  if (rowCount) {
    await c.query(`ALTER DATABASE ${ident(name)} OWNER TO ${ident(user(owner))}`);
    console.log(`  banco ${name}: já existia`);
    return;
  }
  // UTF-8 com ordenação ICU pt-BR (acentos ordenam certo), independente do locale do Windows
  await c.query(
    `CREATE DATABASE ${ident(name)} OWNER ${ident(user(owner))} ENCODING 'UTF8' TEMPLATE template0 ` +
      `LOCALE_PROVIDER icu ICU_LOCALE 'pt-BR' LOCALE 'C'`,
  );
  console.log(`  banco ${name}: criado`);
}

async function configureDatabase(name: string) {
  await withClient(admin, name, async (c) => {
    for (const ext of ['pg_trgm', 'unaccent', 'citext']) {
      await c.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    const appRole = ident(user(app));
    const ownerRole = ident(user(owner));
    await c.query(`REVOKE ALL ON DATABASE ${ident(name)} FROM PUBLIC`);
    await c.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(name)} TO ${appRole}, ${ownerRole}`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
    // tudo o que a dona criar daqui para frente já nasce acessível à aplicação
    await c.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`,
    );
    await c.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${appRole}`,
    );
    /**
     * Esquema da fila de jobs (E21). O pg-boss cria e migra as próprias
     * tabelas, então ele precisa de CREATE — mas SÓ aqui dentro: o `public`,
     * onde moram os dados da oficina, continua fechado para a aplicação.
     */
    await c.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${ownerRole}`);
    await c.query(`GRANT USAGE, CREATE ON SCHEMA pgboss TO ${appRole}`);
    console.log(`  banco ${name}: extensões e privilégios ok`);
  });
}

if (testApp && user(testApp) !== user(app)) {
  throw new Error('TEST_DATABASE_URL deve usar a mesma role de DATABASE_URL');
}

console.log(`Preparando o PostgreSQL${somenteProducao ? ' (produção)' : ''}…`);
const databases = testApp ? [dbName(app), dbName(testApp)] : [dbName(app)];
await withClient(admin, 'postgres', async (c) => {
  await ensureRole(c, owner);
  await ensureRole(c, app);
  for (const name of databases) await ensureDatabase(c, name);
});
for (const name of databases) await configureDatabase(name);
console.log('Pronto. Próximo passo: npm run db:migrate');

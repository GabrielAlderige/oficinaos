# OficinaOS

Plataforma SaaS de gestão para oficinas mecânicas brasileiras de pequeno e médio
porte. Clientes, veículos, agenda, ordens de serviço, orçamento digital com
aprovação pelo celular, peças e estoque num fluxo só, em vez de WhatsApp, papel e
planilha.

O diferencial inicial é um fluxo:

**orçamento → link → cliente aprova pelo celular → a OS muda sozinha para aprovada.**

## Status

**MVP 1, etapa E1 (fundação).** Monorepo, banco com isolamento por oficina (RLS),
API com tratamento de erros e segurança básica, e o painel ligado à API. Ainda não
há login nem telas de negócio (etapa E2 em diante, ver [ROADMAP](docs/ROADMAP.md)).

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Decisões técnicas, pastas, multi-tenant, autenticação, permissões, fluxos, regras de orçamento e estoque, segurança, riscos |
| [docs/DATABASE.md](docs/DATABASE.md) | Convenções, isolamento por RLS, ERD, tabelas, índices, seeds |
| [docs/API.md](docs/API.md) | Convenções REST, erros, rate limits, endpoints por fase |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Etapas do MVP 1 com critério de pronto, MVP 2, V3, integrações, planos |

## Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query |
| Back-end | Node.js, TypeScript, Fastify 5, Zod 4, Drizzle ORM |
| Banco | PostgreSQL 17 com Row Level Security |
| Compartilhado | `packages/shared`: schemas Zod, enums, regras de cálculo usadas por front e back |
| Testes | Vitest com Postgres real de teste |

## Rodando localmente (Windows, macOS ou Linux)

### Pré-requisitos

- **Node.js 22.12+** (desenvolvido com o 24)
- **PostgreSQL 17** rodando em `localhost:5432`, com a senha do superusuário `postgres` à mão

### Primeira vez

```bash
npm install
cp .env.example .env        # no PowerShell: Copy-Item .env.example .env
```

No `.env`, preencha:

- `DATABASE_ADMIN_URL` com a senha do superusuário do Postgres. Ela é usada **só** pelo `db:setup`.
- As senhas das roles `oficinaos_app` e `oficinaos_owner`. Invente senhas fortes; o
  `db:setup` cria as roles com elas. A mesma senha se repete nas URLs de dev e de teste.

```bash
npm run db:setup            # roles, bancos oficinaos_dev e oficinaos_test, extensões, privilégios
npm run db:migrate          # tabelas + isolamento por oficina (RLS)
```

### Dia a dia

```bash
npm run dev                 # API em http://127.0.0.1:3333 e painel em http://localhost:5173
```

### Verificação completa

```bash
npm run check               # typecheck + lint + testes + build
```

Os testes da API rodam contra o banco **`oficinaos_test`**, que tem os dados
**apagados** a cada execução. O banco de desenvolvimento nunca é tocado.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) e painel (Vite) juntos |
| `npm run build` | Build de produção: `apps/api/dist` (tsup) e `apps/web/dist` (Vite) |
| `npm run typecheck` | TypeScript em todos os pacotes |
| `npm run lint` | ESLint no monorepo |
| `npm run test` | Vitest: `packages/shared` + `apps/api` (com banco de teste) |
| `npm run check` | Tudo acima, em sequência |
| `npm run db:setup` | Prepara o Postgres local (idempotente; roda de novo para trocar senhas) |
| `npm run db:generate` | Gera a migration SQL a partir de mudanças no schema Drizzle |
| `npm run db:migrate` | Aplica as migrations no banco de dev (`-- --test` para o de teste) |

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `NODE_ENV` | `development`, `test` ou `production` |
| `LOG_LEVEL` | Nível do log da API (`info` por padrão) |
| `API_HOST` / `API_PORT` | Onde a API escuta (`127.0.0.1:3333`) |
| `WEB_ORIGINS` | Origens do painel liberadas no CORS, separadas por vírgula |
| `DATABASE_ADMIN_URL` | Superusuário do Postgres. **Só** para o `db:setup` |
| `DATABASE_URL` | Runtime da API: role `oficinaos_app`, sujeita ao RLS |
| `DATABASE_OWNER_URL` | Dona das tabelas: roda as migrations |
| `TEST_DATABASE_URL` / `TEST_DATABASE_OWNER_URL` | O mesmo, no banco de teste |

A API valida o ambiente no boot. Faltou ou errou uma variável, ela não sobe e
diz qual é. O `.env` nunca vai para o git.

## Estrutura

```text
apps/api        API REST (Fastify + Drizzle): src/modules/<domínio>, scripts/, test/
apps/web        Painel (React + Vite): src/features/<domínio>, src/lib, src/styles
packages/shared Contratos e regras compartilhadas (Zod, enums, cálculos)
docs/           Arquitetura, banco, API, roadmap
```

A estrutura completa e a regra de dependência entre camadas estão em
[ARCHITECTURE.md §3](docs/ARCHITECTURE.md#3-estrutura-de-pastas).

## Roadmap resumido

- **MVP 1:** contas e equipe, multi-tenant, clientes, veículos, catálogo, estoque
  básico, OS, orçamento com link público e aprovação, pagamento simples, agenda,
  WhatsApp com mensagem pronta, dashboard.
- **MVP 2:** fornecedores, cotação por link, pesquisa e comparação de peças,
  compras, financeiro, relatórios, pós-venda, avaliações, CRM, landing page.
- **V3:** nota fiscal, pagamentos, assinatura, WhatsApp oficial, automações,
  marketplace, IA, app mobile.

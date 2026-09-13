# OficinaOS

Plataforma SaaS de gestão para oficinas mecânicas brasileiras de pequeno e médio
porte. Clientes, veículos, agenda, ordens de serviço, orçamento digital com
aprovação pelo celular, peças e estoque num fluxo só, em vez de WhatsApp, papel e
planilha.

O diferencial inicial é um fluxo:

**orçamento → link → cliente aprova pelo celular → a OS muda sozinha para aprovada.**

## Status

**MVP 1, etapas E1 a E7 concluídas.** Sobre a fundação da E1 (monorepo, banco com
isolamento por oficina via RLS, API com erros padronizados e segurança básica),
a E2 trouxe:

- cadastro da oficina em 5 campos, com 14 dias de teste;
- login com sessão rotativa e detecção de token roubado;
- recuperação de senha, sessões por aparelho e troca de oficina;
- convites com link para WhatsApp e papéis com permissões aplicadas pela API;
- dados da oficina com horário de funcionamento;
- painel com menu lateral, tema escuro e layout de celular.

A E3 trouxe clientes e veículos:

- cadastro com CPF/CNPJ (inclusive o CNPJ alfanumérico) e WhatsApp;
- placa antiga e Mercosul tratadas como o mesmo carro, com aviso de placa
  repetida enquanto se digita;
- busca global (Ctrl+K) por placa, nome, telefone ou documento;
- quilometragem com histórico de leituras e troca de dono registrada;
- contato mascarado para o mecânico.

A E4 trouxe o catálogo e o estoque:

- serviços com preço fixo ou por hora técnica (valor da hora × tempo padrão) e
  intervalo de manutenção ("a cada 10.000 km ou 12 meses");
- peças com código do fabricante, categoria e em que carro servem, com busca por
  palavra: "pastilha gol 2012" acha a peça pela aplicação;
- entrada e ajuste de contagem com **custo médio móvel** e livro-razão imutável
  (correção é movimento novo, nunca edição de lançamento);
- estoque mínimo com alerta no início do painel, e custo escondido de quem não
  tem permissão para ver custo;
- hora técnica e margem padrão em Configurações › Preços e estoque.

A E5 trouxe a ordem de serviço:

- **Nova OS numa tela só**: acha o cliente (ou cadastra ali), escolhe o carro em
  cartões, relato e km, itens do catálogo — e abre;
- itens com **total ao vivo**: a API recalcula tudo pelo `pricing.ts` e ignora
  qualquer total enviado pela tela;
- desconto em R$ ou %, com **limite por papel** (o atendente para no limite da
  oficina; o gerente não tem limite);
- **máquina de status** com ações explícitas por permissão, timeline de tudo o
  que aconteceu com o carro, e `version` para duas pessoas editando a mesma OS;
- **check-in** com checklist, combustível, km, avarias, acessórios e **fotos
  comprimidas no aparelho**, guardadas com URL assinada de validade curta;
- **página de impressão** da OS, com assinatura do cliente.

A E6 trouxe o orçamento com link e aprovação pelo celular — o diferencial do
produto:

- **orçamento congelado**: enviar tira uma cópia imutável dos itens e guarda um
  `contentHash`; o que o cliente vê não muda mais, e mexer na OS gera versão nova;
- **link público** com token de 32 bytes: o cliente abre no celular, sem login, e
  vê necessários × recomendados, fotos por item e o total;
- **aprovação parcial**: dá para desmarcar o recomendado e aprovar só o
  necessário — o item obrigatório não pode ser desmarcado;
- **a prova**: uma linha imutável por orçamento com quem autorizou, quando, por
  qual canal, o IP e o hash da versão aprovada. Aprovar duas vezes devolve a
  mesma resposta; aprovar uma versão já substituída ou vencida é recusado;
- **reserva de estoque na aprovação**, sem travar o cliente quando falta peça:
  reserva o que há e sinaliza o que falta;
- **aprovação manual** (telefone ou balcão) com o mesmo peso do link, mudando só
  a prova: fica registrado quem da equipe anotou;
- **o link antigo leva à versão nova**, sem o cliente pedir nada;
- **sino de avisos** no painel e **lista de orçamentos** por situação, mostrando
  quem abriu e quem ainda não respondeu;
- página do cliente em **pacote próprio de 73,6 kB gzip** (teto de 100 kB),
  sem o Zod do painel.

A E7 fechou o ciclo do carro — execução, entrega e dinheiro:

- **baixa de estoque na finalização**: a reserva vira saída no livro-razão, o
  item fica "baixado" e finalizar de novo (depois de reabrir) não tira a peça
  duas vezes;
- **faltar peça não trava a entrega**: o saldo fica negativo e registrado, em vez
  de impedir o dono de fechar a OS — travar aqui faria a oficina trabalhar por
  fora do sistema;
- só sai do estoque o que foi **aprovado** e é **da prateleira**: peça do cliente
  e peça a comprar não mexem no saldo;
- **pagamento**: registro por forma (Pix, dinheiro, cartão, boleto,
  transferência), parcial ou total, com cancelamento que **reabre o saldo e
  mantém o histórico** — nada é apagado. `paid_cents` e a situação da OS saem
  sempre da soma dos lançamentos confirmados, nunca de um valor vindo da tela;
- receber **acima do saldo é recusado** (crédito a favor do cliente é MVP 2);
- **entregar devendo é permitido** (o fiado existe), mas pede confirmação
  mostrando quanto falta;
- **"veículo pronto" pelo WhatsApp**: mensagem pronta com o saldo em aberto, que
  a pessoa revisa e envia, registrada no histórico de comunicação e na timeline
  do carro;
- correção que veio junto: o link `wa.me` era montado com o telefone já em E.164
  mais um "55" na frente (link que não abria), e o do orçamento apontava para o
  número **da própria oficina** em vez do cliente.

| Etapa do MVP 1 | Situação |
|---|---|
| E1. Fundação (monorepo, banco com RLS, API base) | ✅ 10/09/2026 |
| E2. Contas e equipe | ✅ 11/09/2026 |
| E3. Clientes e veículos | ✅ 11/09/2026 |
| E4. Catálogo de serviços e peças, estoque básico | ✅ 11/09/2026 |
| E5. Ordem de serviço | ✅ 11/09/2026 |
| E6. Orçamento com link e aprovação pelo celular | ✅ 12/09/2026 |
| E7. Execução, entrega e pagamento | ✅ 12/09/2026 |
| E8. Agenda | próxima |
| E9. Dashboard e acabamento | — |

Toda etapa só fecha com `npm run check` verde. Além disso:
- as proteções principais são quebradas de propósito, para provar que os
  testes pegam a falha;
- o fluxo é conferido num navegador (claro, escuro e celular).

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Decisões técnicas, pastas, multi-tenant, autenticação, permissões, fluxos, regras de orçamento e estoque, segurança, riscos |
| [docs/DATABASE.md](docs/DATABASE.md) | Convenções, isolamento por RLS, ERD, tabelas, índices, seeds |
| [docs/API.md](docs/API.md) | Convenções REST, erros, rate limits, endpoints por fase |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Etapas do MVP 1 com critério de pronto, MVP 2, V3, integrações, planos |

## Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, Radix UI (componentes próprios no estilo shadcn) |
| Back-end | Node.js, TypeScript, Fastify 5, Zod 4, Drizzle ORM, argon2id, JWT (jose) |
| Banco | PostgreSQL 17 com Row Level Security |
| Compartilhado | `packages/shared`: schemas Zod, enums, permissões, validação de CPF/CNPJ/placa/telefone, usados por front e back |
| Testes | Vitest com Postgres real de teste (34 arquivos, 302 testes) e Playwright em `e2e/` para os fluxos de ponta a ponta: o cliente aprovando num celular de 390 px, e no painel o envio do orçamento, o caixa e a entrega |

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
- `JWT_SECRET`: pelo menos 32 caracteres aleatórios.

```bash
npm run db:setup            # roles, bancos oficinaos_dev e oficinaos_test, extensões, privilégios
npm run db:migrate          # tabelas + isolamento por oficina (RLS)
```

### Dia a dia

```bash
npm run dev                 # API em http://127.0.0.1:3333 e painel em http://localhost:5173
```

Ainda não há envio real de e-mail: com `EMAIL_DRIVER=console`, o link de
redefinição de senha e o de convite **aparecem no terminal da API**. O link de
convite também aparece na tela, pronto para mandar pelo WhatsApp.

### Verificação completa

```bash
npm run check               # typecheck + lint + testes + build
```

Os testes da API rodam contra o banco **`oficinaos_test`**, que é **recriado a
partir das migrations** a cada execução. Isso prova que as migrations sobem do
zero. O banco de desenvolvimento nunca é tocado. Os testes rodam com o log da
API silencioso; `TEST_LOG_LEVEL=error npm run test` mostra os erros.

Os fluxos de ponta a ponta ficam **fora** do `check`, porque precisam de
navegador e do servidor no ar:

```bash
npm run e2e                 # Playwright: a oficina enviando e o cliente aprovando
npm run e2e:ui              # o mesmo, com a interface do Playwright para depurar
```

Se não houver `npm run dev` no ar, o Playwright sobe um. Ele usa o banco de
**desenvolvimento**, e cada cenário cria a própria oficina, com e-mail e placa
únicos — rodar de novo não suja a execução anterior. As capturas de conferência
ficam em `e2e/screenshots/`, fora do git.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) e painel (Vite) juntos |
| `npm run build` | Build de produção: `apps/api/dist` (tsup) e `apps/web/dist` (Vite) |
| `npm run typecheck` | TypeScript em todos os pacotes |
| `npm run lint` | ESLint no monorepo |
| `npm run test` | Vitest: `packages/shared` + `apps/api` (com banco de teste) |
| `npm run check` | Tudo acima, em sequência |
| `npm run e2e` | Playwright: fluxo do painel e fluxo do cliente, ponta a ponta (fora do `check`) |
| `npm run db:setup` | Prepara o Postgres local (idempotente; roda de novo para trocar senhas) |
| `npm run db:generate` | Gera a migration SQL a partir de mudanças no schema Drizzle |
| `npm run db:migrate` | Aplica as migrations no banco de dev (`-- --test` para o de teste) |

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `NODE_ENV` | `development`, `test` ou `production` |
| `LOG_LEVEL` | Nível do log da API (`info` por padrão) |
| `API_HOST` / `API_PORT` | Onde a API escuta (`127.0.0.1:3333`) |
| `WEB_ORIGINS` | Origens do painel liberadas no CORS, separadas por vírgula. Rotas que usam o cookie de sessão exigem Origin desta lista |
| `APP_URL` | Endereço público do painel: base dos links de redefinição de senha e de convite |
| `JWT_SECRET` | Assina o token de acesso (HS256). Pelo menos 32 caracteres. Nunca vai para o front |
| `EMAIL_DRIVER` | `console` (dev: imprime no terminal da API) ou `memory` (testes) |
| `STORAGE_DRIVER` | Anexos e fotos: `disk` (dev: grava em `storage/`, servido pela própria API com URL assinada) ou `memory` (testes) |
| `STORAGE_DIR` | Pasta do driver `disk`, relativa à raiz. Fora do git |
| `UPLOAD_MAX_BYTES` | Teto por arquivo (padrão 10 MB). O painel comprime a foto no aparelho antes de enviar |
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
e2e/            Fluxos de ponta a ponta (Playwright): painel e página do cliente
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

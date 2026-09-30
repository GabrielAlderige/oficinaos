# OficinaOS

Plataforma SaaS de gestão para oficinas mecânicas brasileiras de pequeno e médio
porte. Clientes, veículos, agenda, ordens de serviço, orçamento digital com
aprovação pelo celular, peças, estoque, financeiro e nota fiscal num fluxo só —
em vez de WhatsApp, papel e planilha.

O diferencial inicial é um fluxo:

**orçamento → link → cliente aprova pelo celular → a OS muda sozinha para aprovada.**

---

## Status

**MVP 1, MVP 2 e V3 entregues: E1 a E41.** O sistema faz o dia inteiro de uma
oficina — da placa na recepção ao dinheiro no caixa e à nota de serviço.

O que ainda **não** é real, e está rotulado como tal dentro do produto:

| Área | Situação hoje |
|---|---|
| Nota fiscal de serviço | **Simulador**. Nada é enviado a prefeitura nenhuma, não se gera XML nem PDF. Toda tela carimba "simulação". Vira real quando o emissor for contratado |
| Pagamento online (Pix/boleto/cartão por gateway) | **Simulador** por padrão. O driver do **Asaas** está escrito e testado em contrato, mas nunca foi exercitado contra a API real — falta a conta |
| Assinatura do SaaS | Roda no mesmo simulador: nenhuma assinatura é criada em gateway nenhum |
| Deploy em servidor | `Dockerfile`, `docker-compose.yml`, `Caddyfile`, backup e restore estão escritos e documentados, mas **os containers nunca foram construídos** — não há Docker na máquina de desenvolvimento |
| Pesquisa de peças por provedor externo | Provider **falso**, desligado por padrão (`PARTS_SEARCH_MOCK`). Toda oferta dele vem marcada como demonstração |

O **Pix na hora** é exceção: é Pix de verdade, sem gateway. O BR Code é montado
pelo padrão do Banco Central e conferido no teste **contra o exemplo oficial do
manual do BCB, byte a byte**. A conciliação é manual, e a tela diz isso ao lado
do QR Code.

---

## O que o sistema faz

**Recepção e carro.** Cliente com CPF/CNPJ (inclusive o CNPJ alfanumérico),
placa antiga e Mercosul tratadas como o mesmo carro, busca global por placa,
nome, telefone ou documento (Ctrl+K), quilometragem com histórico e troca de
dono registrada.

**Ordem de serviço.** Nova OS numa tela só a partir da placa. A OS tem três abas
(Serviço · Dinheiro · Histórico), trilha de quatro degraus dizendo qual é o
próximo passo, total ao vivo recalculado pela API, desconto com limite por
papel, total digitável (a diferença vira desconto ou acréscimo), mecânico
escolhido na própria OS, check-in com checklist e fotos comprimidas no aparelho,
e check-out com assinatura na tela. A OS aberta se atualiza sozinha a cada 5 s,
porque mecânico e atendente mexem nela ao mesmo tempo.

**Orçamento com aprovação pelo celular.** Enviar congela uma cópia imutável dos
itens com `contentHash`; o cliente abre um link público sem login e vê
necessários × recomendados com foto por item; pode aprovar só o necessário. Cada
aprovação vira uma linha imutável com quem autorizou, quando, por qual canal, o
IP e o hash da versão. Aprovar duas vezes devolve a mesma resposta; aprovar
versão substituída ou vencida é recusado. A aprovação reserva o estoque.

**Execução, entrega e caixa.** Baixa de estoque na finalização (append-only, sem
tirar peça duas vezes), pagamento por forma com cancelamento que reabre o saldo
sem apagar histórico, entrega devendo permitida mas confirmada, "veículo pronto"
pelo WhatsApp, comissão do mecânico em três níveis (serviço, mecânico, oficina)
que é ganha **conforme o cliente paga**.

**Compra da peça.** Fornecedores, cotação por link que o fornecedor responde sem
login (sem ver placa, cliente nem o preço do concorrente), comparação lado a
lado, pedido, recebimento total ou parcial com frete rateado no custo médio, e
devolução que corrige sem editar lançamento.

**Dinheiro.** Contas a receber e a pagar, baixa, parcelamento, fluxo de caixa,
lucro estimado, dez relatórios com exportação CSV que abre e **soma** no Excel em
português, e nota fiscal de serviço a partir da OS finalizada.

**Ficha do carro.** Digita o carro e vê óleo, fluidos, pneu e torque de roda —
com a **fonte** de cada valor (manual do fabricante, ano e página). Está no menu
sem exigir permissão, porque o mecânico usa tanto quanto o dono, e também abre
**de dentro da OS**, já com o carro daquele serviço escrito na busca.

> **292 fichas publicadas, 1.905 especificações, 10 marcas** — Toyota, Fiat,
> Chevrolet, Honda, Volkswagen, Renault, Nissan, Hyundai, Kia e Jeep. Cada valor
> carrega manual, ano e página. Sem fonte, a oficina lê "Sem fonte — confirme
> antes de aplicar".

**Tutoriais.** Uma aba com vídeos curtos por funcionalidade, agrupados na
ordem do dia de trabalho, com marcação de "já assisti" **por pessoa** — o dono
ter visto não esconde a aula do mecânico. Fica no menu sem exigir permissão:
quem mais precisa de tutorial é quem chegou agora. As aulas são cadastradas na
área da plataforma; aula sem vídeo fica em rascunho e não aparece para a
oficina.

**No celular.** O sistema instala como aplicativo (PWA) e o mecânico tem a tela
dele — "Minhas OS", com cronômetro no topo e um botão por carro. Nenhum dado da
oficina vai para o cache.

**WhatsApp.** Sempre pelos canais oficiais. Sem conectar nada, a mensagem sai
pelo `wa.me` com o texto pronto para revisar. Conectando a WhatsApp Business
Platform **com a credencial da própria oficina**, a conversa acontece dentro do
sistema, com a janela de 24 h explicada na tela. Nenhuma biblioteca não oficial,
em nenhum ponto. Pós-venda nunca sai sozinho: o modelo aparece escrito e espera
o botão.

**Automações.** Quatro rotinas diárias (fila de pós-venda, lembrete de
agendamento, orçamento sem resposta e resumo do dia por e-mail), cada oficina na
hora dela, com tela para ligar, desligar e rodar agora. Nenhuma delas manda
mensagem para o cliente — ela deixa pronto.

---

## Etapas entregues

### MVP 1 — a oficina trabalha dentro do sistema

| Etapa | Situação |
|---|---|
| E1. Fundação (monorepo, banco com RLS, API base) | ✅ 10/09/2026 |
| E2. Contas e equipe | ✅ 11/09/2026 |
| E3. Clientes e veículos | ✅ 11/09/2026 |
| E4. Catálogo de serviços e peças, estoque básico | ✅ 11/09/2026 |
| E5. Ordem de serviço | ✅ 11/09/2026 |
| E6. Orçamento com link e aprovação pelo celular | ✅ 12/09/2026 |
| E7. Execução, entrega e pagamento | ✅ 12/09/2026 |
| E8. Agenda | ✅ 13/09/2026 |
| E9. Dashboard e acabamento | ✅ 13/09/2026 |

### MVP 2 — comprar melhor e fechar o caixa

| Etapa | Situação |
|---|---|
| E10. Fornecedores | ✅ 14/09/2026 |
| E11. Cotação por link com fornecedores | ✅ 14/09/2026 |
| E12. Compras | ✅ 14/09/2026 |
| E13. Financeiro | ✅ 18/09/2026 |
| E14. Pesquisa de peças e melhor preço | ✅ 18/09/2026 |
| E15. Relatórios e produtividade | ✅ 18/09/2026 |
| E16. Pós-venda, avaliações e CRM | ✅ 18/09/2026 |
| E17. Landing, importação de CSV e acompanhamento | ✅ 19/09/2026 |

### V3 — integrações, escala e uso real

| Etapa | Situação |
|---|---|
| E18. Nota fiscal de serviço | ✅ 20/09/2026 |
| E19. Pagamentos online | ✅ 20/09/2026 |
| E20. Assinatura do SaaS | ✅ 21/09/2026 |
| E21. Jobs e automações diárias | ✅ 21/09/2026 |
| E22. WhatsApp oficial e conversa no sistema | ✅ 24/09/2026 |
| E23. Enxugar o painel | ✅ 25/09/2026 |
| E24. O aplicativo no celular (PWA) | ✅ 25/09/2026 |
| E25. O painel que se lê de relance | ✅ 26/09/2026 |
| E26. Comissão do mecânico | ✅ 26/09/2026 |
| E27. Pacotes de serviço | ✅ 27/09/2026 |
| E28. Assinatura e foto na entrega | ✅ 27/09/2026 |
| E29. Confirmação de e-mail no cadastro | ✅ 27/09/2026 |
| E30. A OS que se usa no balcão | ✅ 27/09/2026 |
| E31. Ficha do carro | ✅ 27/09/2026 |
| E32. Pix na hora (BR Code do BCB) | ✅ 27/09/2026 |
| E33. Terminar a OS sem adivinhar | ✅ 27/09/2026 |
| E34. Etapa nenhuma fica presa | ✅ 28/09/2026 |
| E35. A ficha diz de onde veio | ✅ 28/09/2026 |
| E36. Ficha do carro tem aba própria | ✅ 28/09/2026 |
| E37. Consultar a ficha de dentro da OS | ✅ 28/09/2026 |
| E38. Planos Turbo, Supercharger e Nitro | ✅ 28/09/2026 |
| E39. Tutoriais em vídeo | ✅ 29/09/2026 |
| E40. Os planos valem de verdade | ✅ 29/09/2026 |
| E41. Pronto para publicar: IP real, carência do teste e área da plataforma | ✅ 29/09/2026 |

O detalhe de cada etapa, com o critério de pronto e o que ficou de fora, está em
[docs/ROADMAP.md](docs/ROADMAP.md). As decisões técnicas e de produto (D1 a D79),
com a alternativa descartada e o porquê, estão em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Planos

Três estágios de preparação de motor, porque quem compra é dono de oficina e a
ordem se explica sozinha. O anual é 10 meses pelo preço de 12.

| Plano | Mensal | Anual | Para quem |
|---|---|---|---|
| **Turbo** | R$ 149 | R$ 1.490 | Até 3 usuários, 150 OS/mês e 5 GB. A oficina trabalhando inteira: OS, orçamento por link, Pix, agenda, estoque, ficha do carro, financeiro (a receber e caixa), assinatura na entrega e o app no celular |
| **Supercharger** | R$ 279 | R$ 2.790 | Até 8 usuários, OS ilimitada, 25 GB. Tudo do Turbo + o que faz entender a oficina: comissão do mecânico, relatórios e pacotes de serviço |
| **Nitro** | R$ 499 | R$ 4.990 | Usuários ilimitados, 100 GB. Tudo do Supercharger + o sistema trabalhando sozinho: WhatsApp oficial, automações diárias e a pesquisa de peças por carro |

**Os planos valem de verdade** (E40): a API barra por funcionalidade, as rotas
declaram `config.feature`, e um teste compara a coluna `features` do banco com
`PLAN_FEATURE_MATRIX` no código — tela prometendo o que a API recusa é pior do
que não prometer. Multi-filial, papéis customizados, API pública, fornecedores
e compras **não estão em plano nenhum**: aparecem numa lista separada de "em
desenvolvimento", porque ainda não existem.

O teste é de 14 dias no **Nitro**, o plano mais alto, sem cartão, com mais 7 dias de carência depois de vencer (D78) — quem termina
os 14 dias sem ter visto pesquisa de peças, WhatsApp oficial e automações não
paga por elas. O preço saiu de uma conta de
custo real por oficina (**R$ 55 com 20 oficinas, R$ 17 com 100**) — a margem não
é o gargalo em escala nenhuma; o gargalo é custo de aquisição e churn. A conta
inteira está na decisão **D71** do ARCHITECTURE.

---

## Como isso é verificado

Toda etapa só fecha com `npm run check` verde. Além disso:

- as proteções principais são **quebradas de propósito**, para provar que o
  teste pega a falha — se a mutação passa, o teste não cobre nada;
- o fluxo é conferido **num navegador de verdade**, em claro, escuro e celular
  de 390 px;
- os fluxos de ponta a ponta rodam no Playwright, com **auditoria de
  acessibilidade** (axe-core, WCAG 2.1 AA) sobre o painel **cheio de dados** —
  tela vazia passa fácil e não prova nada.

| Camada | Números |
|---|---|
| Testes de unidade e de API | **860 testes em 81 arquivos**, verdes, contra um Postgres de teste recriado a cada execução |
| Ponta a ponta | 24 cenários Playwright, do painel no desktop ao cliente aprovando num celular |
| Banco | 64 migrations aplicadas em ordem, com isolamento por oficina (RLS forçado) |

---

## Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, Radix UI (componentes próprios no estilo shadcn) |
| Back-end | Node.js, TypeScript, Fastify 5, Zod 4, Drizzle ORM, argon2id, JWT (jose), pg-boss |
| Banco | PostgreSQL 17 com Row Level Security forçado por oficina |
| Compartilhado | `packages/shared`: schemas Zod, enums, permissões, cálculo de preço, BR Code do Pix, validação de CPF/CNPJ/placa/telefone — usados por front e back |
| Landing | Astro (HTML estático) |
| Testes | Vitest com Postgres real + Playwright |

Sem biblioteca de calendário (a agenda é componente próprio, porque as prontas
desenham no relógio do aparelho e não no fuso da oficina) e sem biblioteca de
gráfico (os do painel são SVG próprio, ~1 kB).

---

## Rodando localmente (Windows, macOS ou Linux)

### Pré-requisitos

- **Node.js 22.12+** (desenvolvido com o 24)
- **PostgreSQL 17** rodando em `localhost:5432`, com a senha do superusuário
  `postgres` à mão

### Primeira vez

```bash
npm install
cp .env.example .env        # no PowerShell: Copy-Item .env.example .env
```

No `.env`, preencha:

- `DATABASE_ADMIN_URL` com a senha do superusuário do Postgres. Ela é usada
  **só** pelo `db:setup`.
- As senhas das roles `oficinaos_app` e `oficinaos_owner`. Invente senhas
  fortes; o `db:setup` cria as roles com elas. A mesma senha se repete nas URLs
  de dev e de teste.
- `JWT_SECRET`: pelo menos 32 caracteres aleatórios.

```bash
npm run db:setup            # roles, bancos oficinaos_dev e oficinaos_test, extensões, privilégios
npm run db:migrate          # tabelas + isolamento por oficina (RLS)
```

### Oficina de demonstração (recomendado)

```bash
npm run db:seed:demo        # cria a "Oficina Demonstração" com um mês de movimento
```

Entre com **`demo@oficinaos.dev`** / **`demonstracao2026`**. A equipe usa a mesma
senha (`admin@`, `manager@`, `mechanic@`, `attendant@`, `finance@oficinaos.dev`),
o que serve para ver o painel com os olhos de cada papel — o mecânico, por
exemplo, não enxerga valor nenhum.

São 10 clientes, 15 veículos, 5 fornecedores ligados às peças, 20 ordens de
serviço em todos os status, orçamentos aprovados, recusados e parados,
pagamentos, agendamentos e estoque. Tudo é criado **pela própria API**, então
passa pelas mesmas regras da tela; só as datas são espalhadas pelos últimos 30
dias depois, senão o painel mostraria tudo num dia só. Os dados são
**obviamente fictícios** (CPF e CNPJ da faixa `9000…`, telefones
`(11) 90000-00xx`, e-mails `@exemplo.invalido`).

```bash
npm run db:seed:demo -- --reset          # apaga a oficina de demonstração
npm run db:seed:demo -- --reset --seed   # apaga e cria de novo, do zero
```

### Dia a dia

```bash
npm run dev                 # API em http://127.0.0.1:3333 e painel em http://localhost:5173
```

Com `EMAIL_DRIVER=console`, o link de redefinição de senha, o de convite e o de
confirmação de e-mail **aparecem no terminal da API**. O link de convite também
aparece na tela, pronto para mandar pelo WhatsApp.

### Verificação completa

```bash
npm run check               # typecheck + lint + testes + build
```

Os testes da API rodam contra o banco **`oficinaos_test`**, **recriado a partir
das migrations** a cada execução — o que prova que elas sobem do zero. O banco
de desenvolvimento nunca é tocado. Para ver os erros da API durante os testes:
`TEST_LOG_LEVEL=error npm run test`.

Os fluxos de ponta a ponta ficam **fora** do `check`, porque precisam de
navegador e do servidor no ar:

```bash
npm run e2e                 # Playwright: painel e celular do cliente, ponta a ponta
npm run e2e:ui              # o mesmo, com a interface do Playwright para depurar
```

Se não houver `npm run dev` no ar, o Playwright sobe um. Ele usa o banco de
**desenvolvimento**, e cada cenário cria a própria oficina, com e-mail e placa
únicos — rodar de novo não suja a execução anterior. As capturas de conferência
ficam em `e2e/screenshots/`, fora do git.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) e painel (Vite) juntos |
| `npm run build` | Build de produção: `apps/api/dist` (tsup), `apps/web/dist` (Vite) e `apps/landing/dist` (Astro) |
| `npm run typecheck` | TypeScript em todos os pacotes |
| `npm run lint` | ESLint no monorepo |
| `npm run test` | Vitest: `packages/shared` + `apps/api` (com banco de teste) |
| `npm run check` | Tudo acima, em sequência |
| `npm run dev:landing` | Só a landing (Astro), em http://localhost:4321 |
| `npm run e2e` | Playwright: fluxo do painel e fluxo do cliente (fora do `check`) |
| `npm run pwa:check` | Confere manifesto, ícones e service worker no build de produção |
| `npm run db:setup` | Prepara o Postgres local (idempotente; roda de novo para trocar senhas) |
| `npm run db:generate` | Gera a migration SQL a partir de mudanças no schema Drizzle |
| `npm run db:migrate` | Aplica as migrations no banco de dev (`-- --test` para o de teste) |
| `npm run db:seed:demo` | Cria a oficina de demonstração (`-- --reset` apaga, `-- --reset --seed` recria) |

---

## Publicar

Um servidor, três containers (Postgres, API e Caddy) e um domínio. O passo a
passo — servidor, DNS, segredos, backup e como voltar atrás — está em
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

```sh
cp deploy/.env.example .env      # no servidor, com os segredos gerados
docker compose build
docker compose up -d db
docker compose --profile ferramentas run --rm migrate
docker compose up -d
```

O que foi testado aqui: build de produção dos três apps, `dist/migrate.js`
aplicando as migrations e `dist/server.js` em `NODE_ENV=production` respondendo
`/health`, `/ready` e um cadastro completo. **Os containers ainda não foram
construídos** — não há Docker nesta máquina, e isso está dito no topo do guia.

---

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `NODE_ENV` | `development`, `test` ou `production` |
| `LOG_LEVEL` | Nível do log da API (`info` por padrão) |
| `API_HOST` / `API_PORT` | Onde a API escuta (`127.0.0.1:3333`) |
| `WEB_ORIGINS` | Origens do painel liberadas no CORS, separadas por vírgula. Rotas que usam o cookie de sessão exigem Origin desta lista |
| `APP_URL` | Endereço público do painel: base dos links de redefinição de senha, convite e confirmação de e-mail |
| `JWT_SECRET` | Assina o token de acesso (HS256). Pelo menos 32 caracteres. Nunca vai para o front |
| `EMAIL_DRIVER` | `console` (dev: imprime no terminal da API), `memory` (testes) ou `smtp` (produção) |
| `SMTP_URL` / `EMAIL_FROM` | O provedor de e-mail e o remetente, quando `EMAIL_DRIVER=smtp` |
| `JOBS_ENABLED` | Liga o trabalhador de fundo das automações diárias (`true` por padrão; `false` nos testes) |
| `PAYMENT_GATEWAY` | `simulador` (padrão, não cobra ninguém) ou `asaas` — que exige `ASAAS_API_KEY`, `ASAAS_BASE_URL` e `ASAAS_WEBHOOK_TOKEN` |
| `FISCAL_DRIVER` | Emissor da nota de serviço; hoje só `simulador`, que não emite documento fiscal |
| `PARTS_SEARCH_MOCK` | Liga o provider FALSO da pesquisa de peças (`false` por padrão). Toda oferta dele vem marcada como demonstração |
| `STORAGE_DRIVER` | Anexos e fotos: `disk` (dev: grava em `storage/`, servido pela própria API com URL assinada) ou `memory` (testes) |
| `STORAGE_DIR` | Pasta do driver `disk`, relativa à raiz. Fora do git |
| `UPLOAD_MAX_BYTES` | Teto por arquivo (padrão 10 MB). O painel comprime a foto no aparelho antes de enviar |
| `DATABASE_ADMIN_URL` | Superusuário do Postgres. **Só** para o `db:setup` |
| `DATABASE_URL` | Runtime da API: role `oficinaos_app`, sujeita ao RLS |
| `DATABASE_OWNER_URL` | Dona das tabelas: roda as migrations e instala a fila de jobs |
| `TEST_DATABASE_URL` / `TEST_DATABASE_OWNER_URL` | O mesmo, no banco de teste |

A API valida o ambiente no boot. Faltou ou errou uma variável, ela não sobe e
diz qual é. O `.env` **nunca** vai para o git, e as fotos enviadas pela oficina
também não.

---

## Estrutura

```text
apps/api        API REST (Fastify + Drizzle): src/modules/<domínio>, scripts/, test/
apps/web        Painel (React + Vite): src/features/<domínio>, src/lib, src/styles
                + as páginas públicas (orçamento, cotação, avaliação, acompanhamento) em src/public
apps/landing    Landing institucional (Astro, HTML estático)
packages/shared Contratos e regras compartilhadas (Zod, enums, cálculos, Pix)
e2e/            Fluxos de ponta a ponta (Playwright): painel e página do cliente
deploy/         Caddyfile, .env de exemplo, backup e restore
docs/           Arquitetura, banco, API, roadmap, deploy
```

A regra de dependência entre camadas está em
[ARCHITECTURE.md §3](docs/ARCHITECTURE.md#3-estrutura-de-pastas).

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Decisões D1–D79 com a alternativa descartada, pastas, multi-tenant, autenticação, permissões, fluxos, segurança, riscos |
| [docs/DATABASE.md](docs/DATABASE.md) | Convenções, isolamento por RLS, ERD, tabelas, índices, seeds |
| [docs/API.md](docs/API.md) | Convenções REST, erros, rate limits, endpoints por fase |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Etapas E1–E41 com critério de pronto, integrações futuras, métricas |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Servidor, DNS, segredos, backup, restore e rollback |

---

## O que vem depois

Consulta veicular por placa e catálogo de peças licenciado (Fraga/SUIV são por
cotação — por isso a ficha do carro é preenchida por nós e vira ativo próprio),
backoffice de plataforma, multi-filial, API pública, IA assistida no diagnóstico
e marketplace de peças.

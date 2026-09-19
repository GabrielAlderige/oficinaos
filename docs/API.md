# OficinaOS — API REST

> Fase 0: contrato planejado. O OpenAPI gerado dos schemas Zod (`/api/v1/docs`,
> só em desenvolvimento) passa a ser a referência quando existir.

---

## 1. Convenções

| Tema | Regra |
|---|---|
| Base | `/api/v1` |
| Formato | JSON, `camelCase` |
| Autenticação | `Authorization: Bearer <access token>`; refresh por cookie httpOnly em `/api/v1/auth/*` |
| Oficina (tenant) | **Sempre do token.** Nunca por URL, query, body ou header. Troca por `POST /auth/switch-organization` |
| Dinheiro | Inteiro em centavos, campo terminado em `Cents` (`totalCents: 124000`) |
| Percentual | Basis points, terminado em `Bps` (`discountBps: 1000` = 10%) |
| Quantidade | Número com até 3 casas (`4.5`) |
| Data/hora | ISO 8601 em UTC (`2026-09-10T13:00:00Z`); datas puras em `YYYY-MM-DD` |
| Listas | `?page=1&pageSize=25` (máx. 100) → `{ "data": [...], "meta": { "page": 1, "pageSize": 25, "total": 87 } }` |
| Feeds (timeline, atividades) | `?cursor=…&limit=50` → `{ "data": [...], "meta": { "nextCursor": "…" } }` |
| Filtros e ordenação | `?status=APPROVED,IN_PROGRESS&q=abc&sort=-openedAt` |
| Recurso único | `{ "data": { ... } }` |
| Ações | Transições de estado são **ações explícitas** (`POST /work-orders/{id}/start`), não um `PATCH status`. Cada ação tem sua permissão, suas validações e sua entrada na auditoria |
| Concorrência | Edição de OS e de item envia `version`; versão velha → `409 VERSION_CONFLICT` |
| Idempotência | Header `Idempotency-Key` aceito (e recomendado) em criar OS, enviar orçamento, aprovar/recusar e registrar pagamento |
| Versionamento | Mudança incompatível → `/api/v2`. Campos novos são aditivos |

### 1.1 Erros (RFC 9457, `application/problem+json`)

```json
{
  "type": "urn:oficinaos:error:work-order-invalid-transition",
  "title": "Transição de status inválida",
  "status": 409,
  "code": "WORK_ORDER_INVALID_TRANSITION",
  "detail": "Uma OS entregue não pode voltar para execução.",
  "errors": [{ "path": "items.2.quantity", "message": "Deve ser maior que zero" }],
  "requestId": "01J9…"
}
```

| Status | Quando |
|---|---|
| 400 | Falha de schema (Zod), com `errors[]` por campo |
| 401 | Sem token, token expirado ou sessão revogada |
| 403 | Sem permissão (`FORBIDDEN`), desconto acima do limite (`DISCOUNT_ABOVE_LIMIT`) ou recurso fora do plano (`PLAN_FEATURE_REQUIRED`, `PLAN_LIMIT_REACHED`) |
| 404 | Não existe **ou pertence a outra oficina** (nunca 403 nesse caso) |
| 409 | Conflito de estado ou versão (`WORK_ORDER_INVALID_TRANSITION`, `VERSION_CONFLICT`, `QUOTE_SUPERSEDED`, `QUOTE_ALREADY_DECIDED`) |
| 410 | Link público expirado ou revogado (`QUOTE_EXPIRED`) |
| 422 | Regra de negócio (`CPF_INVALID`, `PLATE_ALREADY_REGISTERED`, `APPOINTMENT_CONFLICT` com a lista de conflitos) |
| 429 | Rate limit, com `Retry-After` |

O `code` é estável e é o que o front usa para decidir a mensagem; o `title` é
legível, para logs e desenvolvedores.

### 1.2 Rate limits iniciais

| Rota | Limite |
|---|---|
| `POST /auth/login` | 5/min por IP+e-mail, com atraso crescente |
| `POST /auth/forgot-password` | 3/hora por e-mail, 10/hora por IP |
| `GET /public/quotes/{token}` | 60/min por IP |
| `POST /public/quotes/{token}/*` | 10/min por IP |
| Autenticadas | 300/min por usuário |

---

## 2. Endpoints

Legenda de fase: **1** = MVP 1 · **2** = MVP 2 · **3** = V3.

### Autenticação — `/auth`

| Método | Rota | Descrição | Fase |
|---|---|---|---|
| POST | `/auth/signup` | Cria usuário + oficina + membership OWNER + assinatura em trial; devolve tokens | 1 |
| POST | `/auth/login` | E-mail e senha → access token (body) + refresh (cookie) | 1 |
| POST | `/auth/refresh` | Rotaciona o refresh token; devolve novo access token. Sem cookie: **204** (visitante, não erro). Cookie inválido ou reusado: 401 | 1 |
| GET | `/auth/invitations/{token}` | Prévia do convite (oficina, papel, se já existe conta) para a página de aceite | 1 |
| POST | `/auth/logout` | Revoga a sessão atual | 1 |
| POST | `/auth/forgot-password` | Envia link de redefinição (resposta sempre igual) | 1 |
| POST | `/auth/reset-password` | Token + nova senha; encerra todas as sessões | 1 |
| GET | `/auth/me` | Usuário, oficina ativa, papel, permissões, plano, oficinas disponíveis | 1 |
| GET | `/auth/sessions` | Sessões ativas do usuário | 1 |
| DELETE | `/auth/sessions/{id}` | Encerra uma sessão | 1 |
| POST | `/auth/switch-organization` | Emite tokens para outra oficina do usuário | 1 |
| POST | `/auth/accept-invite` | Aceita um convite (cria conta ou vincula) | 1 |
| POST | `/auth/verify-email` | Confirma o e-mail | 1 |

### Oficina e equipe — `/organization`, `/members`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/organization` | autenticado | 1 |
| PATCH | `/organization` | `organization:manage` | 1 |
| GET / PATCH | `/organization/settings` (validade, garantia, margem, hora técnica, limites de desconto, checklist) | `organization:manage` | 1 |
| GET | `/organization/onboarding` (checklist de configuração) | autenticado | 1 |
| GET | `/members?role=MECHANIC` | autenticado | 1 |
| POST | `/members/invitations` | `team:manage` | 1 |
| DELETE | `/members/invitations/{id}` | `team:manage` | 1 |
| PATCH | `/members/{id}` (papel, ativo, cor na agenda) | `team:manage`; a **própria cor** dispensa | 1 |
| DELETE | `/members/{id}` | `team:manage` | 1 |

Ninguém rebaixa nem remove o último OWNER.

### Clientes — `/customers`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/customers?q=&page=` | `customers:read` | 1 |
| POST | `/customers` | `customers:write` | 1 |
| GET | `/customers/{id}` (contato mascarado sem `customers:view_contact`; total gasto e última visita entram com a OS, na E5) | `customers:read` | 1 |
| PATCH | `/customers/{id}` | `customers:write` | 1 |
| DELETE | `/customers/{id}` (soft delete) | `customers:delete` | 1 |
| GET | `/customers/{id}/vehicles` | `customers:read` | 1 |
| GET | `/customers/{id}/timeline?cursor=` (OS, orçamentos, pagamentos, agendamentos, mensagens) | `customers:read` | 1 (E5, com a OS) |
| POST | `/customers/{id}/anonymize` (LGPD) | `organization:manage` | 2 |
| POST | `/customers/import` (CSV) | `customers:write` | 2 |

### Veículos — `/vehicles`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/vehicles?q=&customerId=&page=` | `customers:read` | 1 |
| GET | `/vehicles/lookup?plate=ABC1234` (busca instantânea; aceita antiga e Mercosul) | `customers:read` | 1 |
| POST | `/vehicles` | `vehicles:write` | 1 |
| GET | `/vehicles/{id}` (com alertas: "última troca de óleo há 8.000 km") | `customers:read` | 1 |
| PATCH | `/vehicles/{id}` | `vehicles:write` | 1 |
| DELETE | `/vehicles/{id}` | `vehicles:delete` | 1 |
| GET | `/vehicles/{id}/history?cursor=` (serviços, peças, km, custos) | `customers:read` | 1 (E5, com a OS) |
| POST | `/vehicles/{id}/transfer` (troca de dono, mantém histórico) | `vehicles:write` | 1 |
| GET | `/vehicles/{id}/odometer-readings` | `customers:read` | 1 |

### Agenda — `/appointments`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/appointments?from=&to=&mechanicId=&customerId=&vehicleId=&status=` | `appointments:read` | 1 |
| GET | `/appointments/conflicts?mechanicId=&startsAt=&endsAt=&excludeId=` | `appointments:read` | 1 |
| GET | `/appointments/{id}` | `appointments:read` | 1 |
| POST | `/appointments` (devolve 422 `APPOINTMENT_CONFLICT` salvo `force: true`) | `appointments:write` | 1 |
| PATCH | `/appointments/{id}` (reagendar, inclusive por arrastar e soltar) | `appointments:write` | 1 |
| POST | `/appointments/{id}/confirm` · `/complete` · `/cancel` (com motivo) · `/no-show` | `appointments:write` | 1 |
| POST | `/appointments/{id}/check-in` → cria a OS com o check-in, e o agendamento passa a `IN_PROGRESS` | `work_orders:write` | 1 |
| POST | `/appointments/{id}/confirmation` → mensagem pronta + link `wa.me`, com o envio registrado | `appointments:write` | 1 (E8) |

### Ordens de serviço — `/work-orders`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/work-orders?status=&q=&mechanicId=&from=&to=&page=` | `work_orders:read` | 1 |
| GET | `/work-orders/board` (contagem por status, para o quadro) | `work_orders:read` | 1 |
| POST | `/work-orders` (cliente, veículo, km, relato; aceita itens iniciais) | `work_orders:write` | 1 |
| GET | `/work-orders/{number}` (agregado: OS + itens + orçamento atual + totais) | `work_orders:read` | 1 |
| PATCH | `/work-orders/{id}` (km, relato, diagnóstico, observações, responsáveis, previsão, desconto geral; com `version`) | `work_orders:write` (+ `:discount`) | 1 |
| POST | `/work-orders/{id}/items` | `work_orders:write` | 1 |
| PATCH | `/work-orders/{id}/items/{itemId}` | `work_orders:write` (+ `:edit_approved` se aprovado) | 1 |
| DELETE | `/work-orders/{id}/items/{itemId}` | `work_orders:write` | 1 |
| PUT | `/work-orders/{id}/items/order` (reordenar) | `work_orders:write` | 1 |
| POST | `/work-orders/{id}/inspections` (check-in/check-out) | `work_orders:write` | 1 |
| POST | `/work-orders/{id}/start-diagnosis` · `/finish-diagnosis` · `/start` · `/wait-parts` · `/complete` | `work_orders:change_status` | 1 |
| POST | `/work-orders/{id}/deliver` (avisa se houver saldo em aberto) | `work_orders:change_status` | 1 |
| POST | `/work-orders/{id}/cancel` (motivo obrigatório) | `work_orders:cancel` | 1 |
| POST | `/work-orders/{id}/reopen` | `work_orders:reopen` | 1 |
| GET | `/work-orders/{id}/timeline?cursor=` | `work_orders:read` | 1 |
| POST | `/work-orders/{id}/notes` | `work_orders:write` | 1 |
| GET | `/work-orders/{id}/attachments` | `work_orders:read` | 1 |
| POST | `/work-orders/{id}/quotes` (congela os itens em rascunho e gera o link) | `quotes:send` | 1 |
| POST | `/work-orders/{id}/quick-approve` (orçamento + aprovação presencial em um passo) | `quotes:record_manual_approval` | 1 |
| GET / POST | `/work-orders/{id}/payments` | `work_orders:read` / `payments:record` | 1 |
| GET | `/work-orders/{id}/print` (dados para a página de impressão) | `work_orders:read` | 1 |
| POST | `/work-orders/{id}/items/{itemId}/timer` (iniciar/parar: tempo real) | `work_orders:write` | 2 |

### Orçamentos — `/quotes`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/quotes?status=&page=` (pipeline: enviados, visualizados, aprovados…) | `work_orders:read` | 1 |
| GET | `/quotes/{id}` | `work_orders:read` | 1 |
| POST | `/quotes/{id}/share` (registra o canal; devolve o link wa.me com a mensagem pronta) | `quotes:send` | 1 |
| POST | `/quotes/{id}/revoke` | `quotes:send` | 1 |
| POST | `/quotes/{id}/extend` (nova validade) | `quotes:send` | 1 |
| POST | `/quotes/{id}/manual-decision` (telefone, presencial, WhatsApp) | `quotes:record_manual_approval` | 1 |

### Público (sem login) — `/public`

| Método | Rota | Descrição | Fase |
|---|---|---|---|
| GET | `/public/quotes/{token}` | Orçamento para o cliente; registra a visualização. Versão substituída → `{ "redirectToken": "…" }` | 1 |
| POST | `/public/quotes/{token}/approve` | `{ approvedItemIds, signerName, accepted: true, contentHash }` + `Idempotency-Key` | 1 |
| POST | `/public/quotes/{token}/reject` | `{ reason? }` | 1 |
| POST | `/public/quotes/{token}/questions` | `{ message }` → notifica a oficina | 1 |
| GET / POST | `/public/reviews/{token}` | Avaliação de 1 a 5 estrelas + comentário | 2 |
| GET | `/public/supplier-quotes/{token}` | Página do fornecedor (E11): peças, carro sem placa (chassi só se a oficina marcou), a resposta DELE. Token errado, substituído ou de fornecedor tirado da lista → 404. 60/min | 2 |
| POST | `/public/supplier-quotes/{token}/responses` | `{ contentHash, responderName, shippingCents?, notes?, items[{ requestItemId, availability, unitPriceCents, brand?, leadTimeDays?, notes? }] }` — toda peça exatamente uma vez; cada envio é uma versão nova e imutável. Encerrada/vencida/cancelada → 422 `SUPPLIER_QUOTE_CLOSED`; hash diferente → 409 `SUPPLIER_QUOTE_OUTDATED`. 10/min | 2 |
| GET | `/public/work-orders/{token}/status` | "Acompanhe seu veículo" | 2 |

### Catálogo — `/services`, `/parts`, `/part-categories`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/services?q=&page=` | `catalog:read` | 1 |
| POST / PATCH / DELETE | `/services[/{id}]` | `catalog:write` | 1 |
| GET | `/parts?q=&categoryId=&supplierId=&stock=attention&page=` (custo só com `parts:view_cost`; `supplierId` = peças que o têm como preferido, E10) | `catalog:read` | 1 |
| POST / PATCH / DELETE | `/parts[/{id}]` (aceita `preferredSupplierId`: fornecedor ativo da oficina, senão 400) | `catalog:write` | 1 |
| GET / POST / DELETE | `/parts/{id}/applications[/{appId}]` | `catalog:read` / `catalog:write` | 1 |
| GET | `/parts/{id}/availability` (em estoque, reservado, disponível, OS que reservaram) | `inventory:read` | 1 |
| GET / POST / PATCH | `/part-categories[/{id}]` | `catalog:read` / `catalog:write` | 1 |
| POST | `/parts/import` (CSV) | `catalog:write` | 2 |

### Fornecedores — `/suppliers` (MVP 2, E10)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/suppliers?q=&category=&page=` (busca por nome, razão social, vendedor, CNPJ ou telefone; `category` ignora maiúscula e acento) | `suppliers:read` | 2 |
| GET | `/suppliers/{id}` (com `preferredPartCount`) | `suppliers:read` | 2 |
| POST | `/suppliers` (só `name` é obrigatório; CNPJ repetido na oficina → 409 `SUPPLIER_DOCUMENT_TAKEN`) | `suppliers:write` | 2 |
| PATCH | `/suppliers/{id}` (sem padrões: o que não vem não é apagado) | `suppliers:write` | 2 |
| DELETE | `/suppliers/{id}` (soft delete; as peças que o tinham como preferido ficam sem preferido, e o CNPJ volta a poder ser usado) | `suppliers:write` | 2 |
| GET | `/suppliers/{id}/history` → `{ quotes, purchases }`: cotações enviadas a ele (respondeu ou não) e pedidos; `purchases` vem `null` para quem não tem `purchases:read` | `suppliers:read` | 2 |

Dono, admin e gerente escrevem; atendente e financeiro leem; o mecânico não vê
fornecedor. Não há contato mascarado como no cliente: quem enxerga fornecedor é
justamente quem precisa ligar para ele.

### Cotação com fornecedores — `/supplier-quotes` (MVP 2, E11)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| POST | `/supplier-quotes` `{ workOrderId, workOrderItemIds, supplierIds, includeVin?, message?, expiresInHours? }` → `{ quote, links[] }`. Só peças da própria OS (400), fornecedores ativos da oficina (400), OS entregue/cancelada → 422. O conteúdo que o fornecedor vê sai do banco; o link sai em texto só aqui e o banco guarda o sha256 | `supplier_quotes:send` | 2 |
| GET | `/supplier-quotes/{id}` — quadro: itens, convites (abriu? respondeu? quantas versões), última resposta de cada um, mais barata/mais rápida, totais. **Sem `parts:view_cost` (atendente): `pricesHidden: true`, preço, frete, totais e "mais barata" vêm vazios** | `suppliers:read` | 2 |
| GET | `/work-orders/{id}/supplier-quotes` | `suppliers:read` | 2 |
| POST | `/supplier-quotes/{id}/invites/{inviteId}/reissue` → link novo; o anterior deixa de abrir na hora. Só com a cotação aberta e no prazo | `supplier_quotes:send` | 2 |
| POST | `/supplier-quotes/{id}/cancel` `{ reason }`. Cancelar a OS cancela as cotações abertas dela | `supplier_quotes:send` | 2 |
| POST | `/supplier-quotes/{id}/award` `{ awards[{ requestItemId, responseItemId }] }` — só oferta válida da ÚLTIMA versão e da mesma peça (400). A primeira escolha encerra a cotação e grava todos os preços válidos em `part_price_history`; o custo vai para o item da OS só se ele ainda é rascunho; o preço de venda não muda | `supplier_quotes:award` | 2 |

Atendente pede cotação e acompanha quem respondeu, mas não vê preço (é custo) nem
escolhe; dono, admin e gerente fazem tudo. A resposta do fornecedor entra na
timeline da OS e no sino de quem pode pedir cotação, sempre sem valores.

### Compras — `/purchase-orders` (MVP 2, E12)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/purchase-orders?status=open\|all\|DRAFT\|…&supplierId=&q=&page=` (`q` = número ou nome do fornecedor, sem acento) | `purchases:read` | 2 |
| POST | `/purchase-orders` `{ supplierId, expectedOn?, shippingCents?, notes?, items[{ partId, quantity, unitCostCents, workOrderItemId? }] }` → rascunho. Nome e código da linha saem do cadastro. Peça da OS: tem de ser peça, a mesma do pedido, não trazida pelo cliente, de OS em andamento, ainda não baixada e fora de outro pedido vivo (400 com o motivo) | `purchases:write` | 2 |
| PATCH | `/purchase-orders/{id}` `{ version, … }` — só rascunho (422 `PURCHASE_ORDER_STATE`); versão velha → 409 `PURCHASE_ORDER_VERSION_CONFLICT`; linhas vindas da cotação continuam ligadas à escolha | `purchases:write` | 2 |
| POST | `/purchase-orders/{id}/order` `{ version, expectedOn? }` → `{ order, message, whatsappUrl }`: congela as linhas, avisa a timeline das OS (`PURCHASE_ORDERED`) e devolve a mensagem para o fornecedor | `purchases:write` | 2 |
| POST | `/purchase-orders/{id}/receipts` `{ clientRequestId, invoiceNumber?, notes?, shippingCents?, items[{ purchaseOrderItemId, quantity, unitCostCents }] }` → 201. Entrada `PURCHASE_IN` pelo custo da nota + frete rateado pelo valor; custo médio e último custo recalculados; preço sem frete no histórico; peça de OS vira "do estoque" e, aprovada, é reservada (até o disponível); timeline `PURCHASE_RECEIVED` + aviso. Mais do que falta → 400; a mesma `clientRequestId` devolve o resultado do primeiro envio; de outro pedido → 409 | `purchases:write` | 2 |
| POST | `/purchase-orders/{id}/returns` `{ clientRequestId, reason, items[{ purchaseOrderItemId, quantity }] }` → 201. Saída `SUPPLIER_RETURN` pelo custo médio das entradas daquela linha (receber e devolver volta o médio ao de antes); desfaz a reserva da OS e avisa; o que voltou passa a faltar. Mais do que chegou → 400 | `purchases:write` | 2 |
| POST | `/purchase-orders/{id}/cancel` `{ reason }` — só rascunho ou pedido sem nada recebido | `purchases:write` | 2 |
| POST | `/purchase-orders/{id}/close` `{ reason }` — "o resto não vem": com parte recebida, fecha como recebido | `purchases:write` | 2 |
| POST | `/purchase-orders/from-quote` `{ supplierQuoteRequestId }` → 201 `{ orders, skipped }`: um rascunho por fornecedor com as escolhas da cotação, pelo preço e frete respondidos; escolha já pedida, peça sem cadastro ou fornecedor fora da lista ficam em `skipped`. Nada a pedir → 422 | `purchases:write` | 2 |
| GET | `/purchase-orders/suggestions` → grupos por fornecedor preferido: peças abaixo do mínimo (mínimo − disponível − o que já vem) e peças que OS em andamento esperam sem pedido | `purchases:read` | 2 |
| GET | `/purchase-orders/{id}` (linhas com o que falta, recebimentos e devoluções) · `GET /work-orders/{id}/purchases` | `purchases:read` | 2 |
| GET | `/parts/{id}/price-history` (cotado e pago, com a cotação ou o pedido de origem) | `parts:view_cost` | 2 |

Situações: `DRAFT → ORDERED → PARTIAL → RECEIVED`, `CANCELED`. O que falta numa
linha é **pedido − (recebido − devolvido)**: devolver a peça errada reabre a
espera pela certa. Dono, admin e gerente compram; o financeiro consulta;
atendente e mecânico não veem compras (é custo). Na cotação (E11), trocar uma
escolha que já virou pedido vivo → 422 `SUPPLIER_QUOTE_ORDERED`.

### Financeiro — `/finance` (MVP 2, E13)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/finance/entries?direction=RECEIVABLE\|PAYABLE&filter=open\|overdue\|due_soon\|paid\|canceled\|all&q=&categoryId=&customerId=&supplierId=&from=&to=&page=` → `{{ data, meta, summary }}`. `situation` já vem com **vencida** resolvida pelo dia de hoje na oficina; o resumo traz em aberto, vencido, vence em 7 dias e o recebido/pago no mês | `finance:read` | 2 |
| POST | `/finance/entries` `{{ direction, categoryId, description, amountCents, dueDate, customerId?, supplierId?, notes?, installments? }}` → 201 `{{ data: [parcelas] }}`. Com `installments > 1` nasce o carnê inteiro: mensal, sem perder centavo (a sobra vai para a primeira) | `finance:write` | 2 |
| GET | `/finance/entries/{{id}}` → lançamento + baixas | `finance:read` | 2 |
| PATCH | `/finance/entries/{{id}}` — descrição, categoria, vencimento, observação e valor. Valor de conta de OS → 422 `FINANCE_ENTRY_MIRRORED` (ele vem da OS); abaixo do já baixado → 422 `FINANCE_EXCEEDS_BALANCE` | `finance:write` | 2 |
| POST | `/finance/entries/{{id}}/settlements` `{{ clientRequestId, amountCents, method, paidAt?, notes? }}` → 201. **Conta de OS: a baixa é o pagamento do caixa** (vai para `payments`, a OS fica com o `payment_status` certo e as parcelas quitam da mais velha para a mais nova). Acima do saldo → 422; a mesma `clientRequestId` devolve o estado atual, sem baixar de novo | `finance:write` | 2 |
| POST | `/finance/settlements/{{id}}/cancel` `{{ reason }}` — a baixa vira `CANCELED` e o saldo volta. Baixa que é pagamento de OS se estorna na ficha da OS | `finance:write` | 2 |
| POST | `/finance/entries/{{id}}/installments` `{{ installments, firstDueDate? }}` → 201: o lançamento vira a parcela 1 e as outras nascem mensais. Numa conta de OS o que já foi pago é redistribuído | `finance:write` | 2 |
| POST | `/finance/entries/{{id}}/cancel` `{{ reason }}` — com baixa confirmada → 422 `FINANCE_ENTRY_STATE` | `finance:write` | 2 |
| GET | `/finance/cash-flow?period=&from=&to=&step=day\|week\|month` → baldes com entrou/saiu/acumulado no fuso da oficina, mais o **previsto** (o que ainda vence no período) | `finance:read` | 2 |
| GET | `/finance/profit?period=&from=&to=` → faturado − custo das peças usadas − despesas pagas (a categoria "Peças" fica fora da despesa: já entrou pelo custo da peça), com a margem em basis points | `finance:read` | 2 |
| GET/POST/PATCH/DELETE | `/finance/categories[/{{id}}]` — as nove do sistema nascem com a oficina; dá para renomear, não para apagar; categoria em uso não se apaga (422 `FINANCE_CATEGORY_IN_USE`) | `finance:read` / `finance:write` | 2 |

**A conta a receber espelha a OS.** Ela nasce ao finalizar (valor = o que o
cliente aprovou), acompanha qualquer mudança de total, morre com a OS cancelada
e é baixada pelo caixa da E7 — "recebido" é um número só no sistema inteiro. A
conta a pagar nasce de cada **nota recebida** (itens + frete) e encolhe na
devolução ao fornecedor, pelo custo com que a peça entrou.

### Pesquisa de peças — `/parts-search` (MVP 2, E14)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| POST | `/parts-search` `{{ q, vehicleId?, providers? }}` → `{{ queryId, markupBps, offers, providers }}`. É POST porque **grava**: a busca e as ofertas ficam com `fetchedAt`, e é isso que explica o custo de uma peça meses depois. Cada oferta já vem com o total (peça + frete), o preço sugerido pela margem da oficina, a diferença para a mais barata e os selos | `parts:view_cost` | 2 |
| GET | `/parts-search/{{id}}` → a mesma busca, como foi gravada | `parts:view_cost` | 2 |
| POST | `/parts-search/offers/{{id}}/add-to-work-order` `{{ workOrderId, quantity, unitPriceCents?, isOptional? }}` → 201 com a OS. Sem preço, vale o sugerido (custo + margem); oferta do estoque entra como "do estoque", as outras como "comprar". Oferta sem estoque → 422 | `work_orders:write` | 2 |
| GET | `/suppliers/{{id}}/price-list?q=&page=` | `parts:view_cost` | 2 |
| POST | `/suppliers/{{id}}/price-list` `{{ csv, replace? }}` → 201 `{{ imported, updated, removed, skipped, problems }}`. Aceita `;` ou `,`, com ou sem BOM, e acha as colunas pelo nome sem acento (código, descrição, marca, preço, unidade). Linha ruim **não derruba o arquivo**: volta em `problems` com o número da linha e o motivo. `replace` troca a lista inteira | `suppliers:write` | 2 |

**Os providers** (ARCHITECTURE §12) são três: `internal` (estoque da oficina,
pelo custo médio, prazo zero), `price_list` (a planilha importada do
fornecedor) e `rfq` (o que os fornecedores responderam nas cotações da E11).
Um provider que falha vira "indisponível" em `providers[]` e não derruba a
busca. O provider `mock` existe para desenvolver a tela e vem **desligado**
(`PARTS_SEARCH_MOCK=true` liga); tudo dele vem com `isMock`, que a interface
mostra como "dados de demonstração". Marketplace entra quando houver API
oficial e termos que permitam — scraping, nunca.

**Os selos**: 🏆 menor preço + frete (empate vai para quem entrega antes), ⚡
menor prazo (o estoque tem prazo zero) e ⭐ custo-benefício, que soma ao total
**2% do preço por dia de espera** — a regra aparece escrita na tela.

### Relatórios — `/reports` (MVP 2, E15)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/reports` → a lista dos dez relatórios, cada um com a pergunta que responde | `reports:read` | 2 |
| GET | `/reports/{{key}}?period=&from=&to=&limit=&format=json\|csv` — `key` é `revenue`, `profit`, `services`, `parts`, `customers`, `vehicles`, `mechanics`, `approval`, `inventory` ou `suppliers`. A resposta traz **colunas + linhas + totais + uma frase de leitura**: a tela desenha qualquer relatório com o mesmo componente. Com `format=csv` vem o arquivo pronto para o Excel em português (BOM, `;`, dinheiro como número com vírgula) | `reports:read` | 2 |

O `profit` é o mesmo lucro do financeiro (E13), com a mesma regra — dois
números diferentes para "lucro" seria o pior resultado possível. O `inventory`
é a posição de **agora**, não do período.

### Produtividade — cronômetro do item de serviço (MVP 2, E15)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| POST | `/work-orders/{{id}}/items/{{itemId}}/timer/start` → a OS. Só em item de SERVIÇO e em OS que não foi entregue nem cancelada. **Uma volta aberta por pessoa em toda a oficina**: começar em outro item para o anterior sozinho | `work_orders:change_status` | 2 |
| POST | `/work-orders/{{id}}/items/{{itemId}}/timer/stop` → a OS, com os minutos somados ao item. Minuto arredondado para cima, mínimo de 1 | `work_orders:change_status` | 2 |

Cada volta é uma linha (`work_order_item_timers`): o almoço, a peça que não
chegou, o dia seguinte. O tempo do item é a SOMA das voltas, e o item da OS
devolve `actualMinutes`, `timerStartedAt` e `timerMechanicName`.

### Pós-venda, avaliações e funil — `/follow-ups`, `/reviews`, `/leads` (MVP 2, E16)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/follow-ups?filter=today\|week\|done\|all&type=` → a fila do dia, **recalculada na hora**: OS entregue há 7 dias, revisão vencendo (pelo km ou pelos meses do serviço, o que vier primeiro) e cliente sem voltar há 6 meses. Cada item já traz a mensagem escrita e o link `wa.me` | `customers:view_contact` | 2 |
| POST | `/follow-ups/{{id}}/done` `{{ outcome? }}` · `/follow-ups/{{id}}/skip` — sai da fila e fica no histórico | `customers:write` | 2 |
| POST | `/work-orders/{{id}}/review-invite` → `{{ publicUrl, message, whatsappUrl }}`. Só com o carro **entregue** (422 antes disso); reenviar gera um link novo e mata o anterior | `quotes:send` | 2 |
| GET | `/public/reviews/{{token}}` · POST com `{{ rating, comment? }}` — a página do cliente, sem login. Responder duas vezes → 409 | pública (limite por IP) | 2 |
| GET | `/reviews/summary` → média, total, distribuição por nota, convites sem resposta e as últimas com comentário | `dashboard:view` | 2 |
| GET | `/leads?q=` → o funil inteiro, por etapa, com valor em aberto e taxa de conversão | `customers:view_contact` | 2 |
| POST | `/leads` · PATCH `/leads/{{id}}` — nome, telefone, origem, carro, o que precisa e valor estimado | `customers:write` | 2 |
| POST | `/leads/{{id}}/stage` `{{ stage, lostReason? }}` — **perder exige motivo** (422 sem ele) | `customers:write` | 2 |
| POST | `/leads/{{id}}/convert` `{{ customerId? }}` — fecha e vira cliente; sem `customerId`, cria o cadastro com o nome e o telefone do lead. Duas vezes → 409 | `customers:write` | 2 |

**Nada é enviado sozinho.** A fila escreve a mensagem e abre o WhatsApp; quem
aperta enviar é uma pessoa — é o que o briefing pede e o que dá para fazer sem
API oficial. **O convite de avaliação vai para todos** os clientes com OS
entregue, não só para quem parece satisfeito: filtrar é contra as políticas do
Google e não é honesto. A taxa de conversão do funil é sobre o que já foi
DECIDIDO (ganhos ÷ (ganhos + perdidos)) — lead novo não conta como perda.

### Plataforma — importação e acompanhamento (MVP 2, E17)

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/imports` → o que cada importação aceita (colunas obrigatórias e opcionais) | `customers:read` | 2 |
| POST | `/imports/customers` · `/imports/vehicles` · `/imports/parts` `{{ csv, dryRun }}` → `{{ total, created, updated, skipped, problems, preview }}`. **`dryRun` é o padrão**: a conferência roda a importação inteira numa transação e a desfaz — não grava nem auditoria. Linha ruim volta com o número da linha e o motivo; o arquivo inteiro não é recusado. Cliente com o mesmo CPF/CNPJ e peça com o mesmo SKU são ATUALIZADOS, não duplicados; o veículo acha o dono pelo documento, pelo telefone ou pelo nome exato. Teto de 5.000 linhas por vez | `customers:write` (peças: `catalog:write`) | 2 |
| POST | `/work-orders/{{id}}/tracking-link` → `{{ publicUrl, message, whatsappUrl }}`. O token nasce na primeira vez e não muda: o cliente guarda o link | `quotes:send` | 2 |
| GET | `/public/tracking/{{token}}` → em que passo o carro está, previsão, o que foi aprovado e quanto falta pagar. Sem login, sem custo de peça e sem observação interna | pública (limite por IP) | 2 |

### Estoque — `/inventory`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/inventory/movements?partId=&type=&from=&to=&cursor=` | `inventory:read` | 1 |
| POST | `/inventory/movements` (entrada manual, ajuste, devolução; motivo obrigatório no ajuste) | `inventory:adjust` | 1 |
| GET | `/inventory/alerts` (abaixo do mínimo, negativo) | `inventory:read` | 1 |
| POST | `/inventory/counts` (inventário/contagem) | `inventory:adjust` | 2 |

### Comunicação e notificações

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/message-templates` | autenticado | 1 |
| PUT | `/message-templates/{key}` | `organization:manage` | 1 |
| POST | `/messages/whatsapp-link` (`{ templateKey, customerId, workOrderId? }` → URL wa.me + registro) | autenticado | 1 |
| GET | `/messages?customerId=&cursor=` | `customers:read` | 1 |
| GET | `/notifications?unread=true&cursor=` | autenticado | 1 |
| POST | `/notifications/{id}/read` · `/notifications/read-all` | autenticado | 1 |
| GET | `/notifications/stream` (SSE) | autenticado | 2 |

### Uploads — `/uploads`

| Método | Rota | Descrição | Fase |
|---|---|---|---|
| POST | `/uploads` | `{ workOrderId?, inspectionId?, kind, mimeType, sizeBytes }` → `{ attachmentId, uploadUrl }` | 1 |
| POST | `/uploads/{id}/complete` | Confere o objeto e marca como pronto | 1 |
| PATCH | `/attachments/{id}` | Legenda, visível para o cliente | 1 |
| DELETE | `/attachments/{id}` | Soft delete | 1 |

### Busca, dashboard e auditoria

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/search?q=ABC1234` → `{ customers, vehicles, workOrders, quotes }` (máx. 5 de cada) | autenticado (filtrado por permissão) | 1 |
| GET | `/dashboard/summary?period=today\|week\|month\|custom&from=&to=` | `dashboard:view`; **sem `:view_financial` os campos de dinheiro vêm `null`** (nunca zero) | 1 |
| GET | `/dashboard/attention` ("Atenção necessária": grupos com contagem, os primeiros itens e o caminho no painel) | `dashboard:view` | 1 |
| GET | `/dashboard/charts?metric=revenue\|work_orders\|avg_ticket\|approval_rate\|new_customers&period=` | `dashboard:view`; as séries de dinheiro vêm **vazias** sem `:view_financial` | 1 |
| GET | `/activity-logs?entityType=&entityId=&actorId=&cursor=` | `audit:read` | 1 |

### MVP 2

| Grupo | Rotas principais |
|---|---|
| Cotação com fornecedores | `POST /supplier-quote-requests` (cria e gera links), `GET /supplier-quote-requests/{id}` (respostas lado a lado), `POST /supplier-quote-requests/{id}/award` (escolhe → gera pedido) |
| Pesquisa de peças ✅ E14 | Ver a seção **Pesquisa de peças** acima |
| Compras ✅ E12 | Ver a seção **Compras** acima |
| Financeiro ✅ E13 | Ver a seção **Financeiro** acima |
| Relatórios ✅ E15 | Ver a seção **Relatórios** acima |
| Pós-venda ✅ E16 | Ver a seção **Pós-venda, avaliações e funil** acima |
| Avaliações ✅ E16 | Idem |
| CRM ✅ E16 | Idem |
| Backoffice | `/platform/organizations`, `/platform/organizations/{id}/impersonate` (auditado) |

### V3

| Grupo | Rotas principais |
|---|---|
| Assinatura | `GET /billing/subscription`, `POST /billing/checkout`, `POST /billing/change-plan`, `POST /billing/cancel` |
| Pagamentos | `POST /work-orders/{id}/charges` (Pix, cartão, boleto via gateway), `POST /webhooks/payments/{provider}` |
| WhatsApp oficial | `POST /webhooks/whatsapp`, `POST /messages/send` |
| Fiscal | `POST /work-orders/{id}/invoices`, `GET /fiscal-documents` |
| Integrações | `GET/POST/DELETE /integrations[/{provider}]` |

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
| PATCH | `/members/{id}` (papel, ativo, cor na agenda) | `team:manage` | 1 |
| DELETE | `/members/{id}` | `team:manage` | 1 |

Ninguém rebaixa nem remove o último OWNER.

### Clientes — `/customers`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/customers?q=&page=` | `customers:read` | 1 |
| POST | `/customers` | `customers:write` | 1 |
| GET | `/customers/{id}` (com resumo: total gasto, última visita, próxima manutenção) | `customers:read` | 1 |
| PATCH | `/customers/{id}` | `customers:write` | 1 |
| DELETE | `/customers/{id}` (soft delete) | `customers:delete` | 1 |
| GET | `/customers/{id}/vehicles` | `customers:read` | 1 |
| GET | `/customers/{id}/timeline?cursor=` (OS, orçamentos, pagamentos, agendamentos, mensagens) | `customers:read` | 1 |
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
| GET | `/vehicles/{id}/history?cursor=` (serviços, peças, km, custos) | `customers:read` | 1 |
| POST | `/vehicles/{id}/transfer` (troca de dono, mantém histórico) | `vehicles:write` | 1 |
| GET | `/vehicles/{id}/odometer-readings` | `customers:read` | 1 |

### Agenda — `/appointments`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/appointments?from=&to=&mechanicId=&status=` | `appointments:read` | 1 |
| GET | `/appointments/conflicts?mechanicId=&startsAt=&endsAt=&excludeId=` | `appointments:read` | 1 |
| POST | `/appointments` (devolve 422 `APPOINTMENT_CONFLICT` salvo `force: true`) | `appointments:write` | 1 |
| PATCH | `/appointments/{id}` (reagendar, inclusive por arrastar e soltar) | `appointments:write` | 1 |
| POST | `/appointments/{id}/confirm` · `/cancel` · `/no-show` | `appointments:write` | 1 |
| POST | `/appointments/{id}/check-in` → cria a OS com o check-in, e o agendamento passa a `IN_PROGRESS` | `work_orders:write` | 1 |

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
| GET / POST | `/public/supplier-quotes/{token}` | Fornecedor responde a cotação (preço, marca, prazo) | 2 |
| GET | `/public/work-orders/{token}/status` | "Acompanhe seu veículo" | 2 |

### Catálogo — `/services`, `/parts`, `/part-categories`

| Método | Rota | Permissão | Fase |
|---|---|---|---|
| GET | `/services?q=&page=` | `catalog:read` | 1 |
| POST / PATCH / DELETE | `/services[/{id}]` | `catalog:write` | 1 |
| GET | `/parts?q=&categoryId=&lowStock=true&page=` (custo só com `parts:view_cost`) | `catalog:read` | 1 |
| POST / PATCH / DELETE | `/parts[/{id}]` | `catalog:write` | 1 |
| GET / POST / DELETE | `/parts/{id}/applications[/{appId}]` | `catalog:read` / `catalog:write` | 1 |
| GET | `/parts/{id}/availability` (em estoque, reservado, disponível, OS que reservaram) | `inventory:read` | 1 |
| GET / POST / PATCH | `/part-categories[/{id}]` | `catalog:read` / `catalog:write` | 1 |
| POST | `/parts/import` (CSV) | `catalog:write` | 2 |

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
| GET | `/dashboard/summary?period=today\|week\|month\|custom&from=&to=` | `dashboard:view` (valores com `:view_financial`) | 1 |
| GET | `/dashboard/attention` ("Atenção necessária") | `dashboard:view` | 1 |
| GET | `/dashboard/charts?metric=revenue\|work_orders\|avg_ticket\|approval_rate\|new_customers&period=` | `dashboard:view_financial` | 1 |
| GET | `/activity-logs?entityType=&entityId=&actorId=&cursor=` | `audit:read` | 1 |

### MVP 2

| Grupo | Rotas principais |
|---|---|
| Fornecedores | `GET/POST/PATCH/DELETE /suppliers[/{id}]`, `GET /suppliers/{id}/history` (compras, preços, prazo) |
| Cotação com fornecedores | `POST /supplier-quote-requests` (cria e gera links), `GET /supplier-quote-requests/{id}` (respostas lado a lado), `POST /supplier-quote-requests/{id}/award` (escolhe → gera pedido) |
| Pesquisa de peças | `POST /parts-search` (`{ query, vehicleId?, providers? }` → ofertas por provider, com `isMock` e `fetchedAt`), `GET /parts-search/{queryId}/compare` (melhor preço, mais rápida, custo-benefício), `POST /parts-search/offers/{offerId}/add-to-work-order` (com margem) |
| Compras | `GET/POST/PATCH /purchase-orders[/{id}]`, `POST /purchase-orders/{id}/request` · `/order` · `/cancel`, `POST /purchase-orders/{id}/receipts` (recebimento total ou parcial → estoque e custo médio) |
| Financeiro | `GET/POST/PATCH /finance/entries`, `POST /finance/entries/{id}/settle`, `GET /finance/summary`, `GET /finance/cash-flow`, `GET/POST /finance/categories` |
| Relatórios | `GET /reports/{revenue\|profit\|services\|parts\|customers\|vehicles\|mechanics\|avg-ticket\|approval\|inventory\|suppliers}?from=&to=` + exportação CSV |
| Pós-venda | `GET /follow-ups?due=today` (fila do dia), `POST /follow-ups/{id}/done` · `/skip` |
| Avaliações | `GET /reviews`, `GET /reviews/summary` |
| CRM | `GET /crm/pipeline`, `GET/POST/PATCH /leads[/{id}]` |
| Backoffice | `/platform/organizations`, `/platform/organizations/{id}/impersonate` (auditado) |

### V3

| Grupo | Rotas principais |
|---|---|
| Assinatura | `GET /billing/subscription`, `POST /billing/checkout`, `POST /billing/change-plan`, `POST /billing/cancel` |
| Pagamentos | `POST /work-orders/{id}/charges` (Pix, cartão, boleto via gateway), `POST /webhooks/payments/{provider}` |
| WhatsApp oficial | `POST /webhooks/whatsapp`, `POST /messages/send` |
| Fiscal | `POST /work-orders/{id}/invoices`, `GET /fiscal-documents` |
| Integrações | `GET/POST/DELETE /integrations[/{provider}]` |

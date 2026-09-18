# OficinaOS — Roadmap

> Ordem de construção, critério de pronto de cada etapa, integrações futuras e
> hipóteses comerciais. As fases seguem o briefing; os ajustes estão marcados com **[ajuste]**
> e têm o motivo ao lado.

---

## MVP 1: a oficina trabalha dentro do sistema ✅ concluído em 13/09/2026

**Objetivo:** o dono cadastra cliente e veículo, abre a OS, orça, manda o link
pelo WhatsApp, o cliente aprova pelo celular e a OS muda sozinha para aprovada.
Tudo o que está no MVP 1 existe para esse fluxo funcionar e ser usado todo dia.

Cada etapa termina com **typecheck, lint, testes e build passando** e o fluxo
**verificado rodando no navegador**, com frontend e backend integrados. Nada de
tela sem backend por trás.

| Etapa | Entrega | Pronto quando |
|---|---|---|
| **E1. Fundação** ✅ 10/09 | Monorepo (api, web, shared); docker-compose (Postgres, MinIO, Mailpit); env validado; Drizzle + migrations + **roles e RLS**; Fastify com erros problem+json, logs, request-id, helmet, CORS e rate limit; shell do web (Vite, Tailwind, tokens claro/escuro, router, TanStack Query); scripts da raiz | `npm run dev` sobe tudo; `/ready` responde; o teste de guarda do RLS passa; o CI local roda typecheck, lint, test e build |
| **E2. Contas e equipe** ✅ 11/09 | Cadastro (cria oficina, dono e trial), login, refresh rotativo, logout, esqueci/redefinir senha (e-mail no Mailpit), sessões, troca de oficina, convites, papéis, guard de permissão; telas de entrar/criar conta/redefinir, layout do painel (sidebar, topo, breadcrumbs), equipe e dados da oficina | Testes de auth (inclusive reuso de refresh token), de **isolamento entre oficinas** e de permissão por papel passam |
| **E3. Clientes e veículos** ✅ 11/09 | CRUD com validação de CPF/CNPJ, placa (antiga ↔ Mercosul) e telefone; busca por placa instantânea; página do cliente (veículos, resumo, timeline) e do veículo (histórico, km); busca global `⌘K` | Digitar `ABC1234` acha o carro cadastrado como `ABC1C34`; o cliente de outra oficina dá 404 |
| **E4. Catálogo e estoque básico** ✅ 11/09 | Serviços (preço fixo ou hora técnica, intervalo de manutenção), peças, categorias, aplicações; entrada manual, ajuste, movimentações, custo médio, mínimo e alertas | Testes de custo médio e de saldo passam; ajuste sem motivo é recusado |
| **E5. Ordem de serviço** ✅ 11/09 | Assistente **+ Nova OS**; página da OS (itens com total ao vivo, desconto com limite por papel, diagnóstico, observações, responsáveis, previsão); máquina de status; timeline; check-in com checklist, combustível, km, avarias e **fotos** comprimidas no aparelho; página de impressão | Testes de cálculo (parcial, desconto, arredondamento) e de transições passam; OS criada em ≤ 6 interações a partir da placa |
| **E6. Orçamento e aprovação (prioridade absoluta)** ✅ 12/09 | Snapshot versionado; link público; página mobile com necessários × recomendados, fotos por item, confirmação explícita, recusa e pergunta; visualização registrada; notificação na oficina; aprovação manual e presencial; orçamento complementar; link antigo leva à versão nova; **reserva de estoque na aprovação**; botão **Enviar pelo WhatsApp** com mensagem pronta; lista de orçamentos por situação; sino de avisos no painel | **E2E Playwright dos 11 passos** do briefing, com a aprovação num viewport de celular; testes de aprovação dupla, versão velha, expirada e parcial. **Cumprido**: os quatro casos estão na suíte da API, e os fluxos viraram Playwright TS em `e2e/` — a oficina enviando no desktop e o cliente aprovando num celular de 390 px, com `npm run e2e` |
| **E7. Execução, entrega e pagamento** ✅ 12/09 | Iniciar, aguardar peça e finalizar (com **baixa de estoque**); **registro simples de pagamento** **[ajuste]**; entrega com aviso de saldo em aberto; "veículo pronto" pelo WhatsApp com registro na timeline; garantia impressa (já vinha da E5) | Teste de baixa (inclusive estoque insuficiente → negativo + alerta); `payment_status` correto em pagamento parcial. **Cumprido**, com uma ressalva: o saldo fica negativo e é registrado (no evento da baixa e na ficha da peça), mas o painel **"Atenção necessária"** que mostra isso para a oficina é da E9 |
| **E8. Agenda** ✅ 13/09 | Dia, semana e mês; coluna por mecânico; arrastar e soltar; aviso de conflito com "confirmar mesmo assim"; status; **check-in a partir do agendamento cria a OS**; confirmação pelo WhatsApp | Conflito detectado em sobreposição parcial; o fuso da oficina é respeitado. **Cumprido**: a sobreposição é meio-aberta (encostar não é conflito) e sai como **aviso** com quem colide, não como impedimento; o fuso vem de `organizations` e há teste de API (oficina em Manaus) e de navegador (aparelho em Kiritimati). A grade virou componente próprio — **D28 revisa a D20** |
| **E9. Dashboard e acabamento** ✅ 13/09 | Indicadores e gráficos do MVP (abaixo); **Atenção necessária**; checklist de configuração da oficina **[ajuste]**; seed de demonstração e conta demo; estados vazios, skeletons, responsividade revisada; README com instalação real | Conta demo navegável do login à aprovação; auditoria de acessibilidade básica; README executável do zero. **Cumprido**: `npm run db:seed:demo` cria a Oficina Demonstração (20 OS em todos os status, um usuário por papel) pela própria API; a auditoria com axe-core (WCAG 2.1 AA) roda no e2e sobre o painel **cheio**, sem regra desligada; o README ganhou a conta demo e teve dois comandos corrigidos. **Faturado e recebido são contas separadas**, e quem não tem `dashboard:view_financial` recebe `null` — nunca zero |

### Dashboard do MVP 1

- **Indicadores:** faturamento do período (duas leituras: *faturado* = OS finalizadas;
  *recebido* = pagamentos), OS abertas por status, aguardando aprovação, veículos
  na oficina, agendamentos de hoje, serviços concluídos, ticket médio, veículos
  atendidos, taxa de aprovação (em quantidade e em valor), peças e serviços mais usados.
- **Gráficos:** faturamento, quantidade de OS, ticket médio, taxa de aprovação,
  novos clientes.
- **Atenção necessária:** orçamentos aguardando aprovação (e os **não visualizados
  há mais de 24 h**), veículos com previsão de entrega vencida, peças abaixo do
  mínimo ou negativas, OS finalizadas e não entregues há mais de 2 dias, entregues
  com saldo em aberto, agendamentos de hoje não confirmados.
- Ficam para o MVP 2 (dependem de financeiro e pós-venda): contas vencidas, clientes
  que não voltam há 6 meses e retorno de clientes.

### Ajustes propostos ao MVP 1

| Ajuste | Motivo |
|---|---|
| **Registro simples de pagamento** (forma, valor, parcelas) entra no MVP 1 | Sem ele, "faturamento" no dashboard é chute e a OS termina sem saber se foi paga. Custa pouco: uma tabela e um formulário. O financeiro completo continua no MVP 2 |
| **Aprovação parcial** (item a item, com itens "recomendados") entra no MVP 1 | É o que mais aumenta a aprovação: o cliente aprova o freio e deixa a suspensão para o mês que vem, em vez de recusar tudo |
| **Aprovação manual e presencial** entra no MVP 1 | Metade dos clientes vai responder "pode fazer" no WhatsApp; o sistema tem que aceitar a realidade e registrar quem autorizou |
| **Onboarding curto** no lugar dos 9 passos | Cadastro = nome, e-mail, senha, nome da oficina e WhatsApp, e a pessoa já entra no painel. Logo, CNPJ, endereço, horário, equipe e primeiro cliente viram um **checklist de configuração** no dashboard, com progresso. Nove telas antes de ver o produto derrubam a ativação; o checklist chega ao mesmo resultado sem bloquear |
| **Landing page** vai para o MVP 2 | Não faz parte do fluxo operacional; entra antes da primeira venda |

### Fora do MVP 1 (de propósito)

Fornecedores, pesquisa e comparação de peças, compras, financeiro completo,
relatórios, pós-venda, avaliações, CRM, vídeos no check-in, PDF gerado no
servidor, tempo real por SSE, importação CSV, cobrança da assinatura, WhatsApp
por API, gateway de pagamento, nota fiscal e IA.

---

## MVP 2: comprar melhor e fechar o caixa

### Ordem de construção

Começou em 14/09/2026 pela **cadeia da peça**, que se sustenta em cima de si
mesma: cotação precisa de fornecedor, pedido de compra nasce da cotação, conta a
pagar nasce da compra, e lucro precisa das duas pontas.

| Etapa | Entrega | Pronto quando |
|---|---|---|
| **E10. Fornecedores** ✅ 14/09 | Cadastro com categorias, prazo e nota; busca e filtro por categoria; ficha com as peças que a oficina compra dele; fornecedor preferido na peça | Isolamento entre oficinas e permissão por papel testados; tirar da lista não quebra a peça. **Cumprido**, com 11/11 mutações pegas |
| **E11. Cotação por link** ✅ 14/09 | Da OS, pedir preço a vários fornecedores por WhatsApp; página pública para o fornecedor responder; respostas lado a lado; escolher alimenta o histórico de preço | Fornecedor não vê placa, cliente nem o preço do outro; atendente não vê preço; link só como hash, reenviar mata o anterior; escolha só da última versão; custo só em item rascunho. **Cumprido**: 30 testes (API + banco), 25/25 mutações pegas, e2e no painel e no celular com auditoria de acessibilidade |
| **E12. Compras** ✅ 14/09 | Pedido, recebimento total ou parcial, entrada no estoque com custo médio | Peça da OS entra no estoque e fica reservada para ela; frete rateado no custo; recebimento errado se corrige com devolução (append-only); clique duplo não dá entrada duas vezes; trava do pedido provada com duas transações; escolha da cotação vira um pedido só; sugestão de compra e históricos no fornecedor e na peça. **Cumprido**: 71 testes novos (banco, API, regras; suíte em 509), 60/60 mutações pegas, 4 cenários e2e (fluxo completo, cotação, sugestão, celular e escuro com auditoria) |
| **E13. Financeiro** ✅ 18/09 | Contas a receber e a pagar, baixa, parcelamento, fluxo de caixa e lucro estimado | A conta da OS espelha a OS (valor e pagamento); a nota da compra vira conta a pagar e a devolução abate; baixa não passa do saldo nem acontece duas vezes; "vencida" calculada no fuso da oficina; dinheiro é de gerente/financeiro para cima. **Cumprido**: 35 testes novos (17 de regra pura, 18 de API), `npm run check` verde e as telas conferidas no navegador — foi ali que apareceu o custo das peças dividido por mil |

### Blocos

| Bloco | Entrega |
|---|---|
| **Fornecedores** ✅ E10 | Cadastro, categorias, histórico de compras, preços, prazo e avaliação. O histórico de compras e preços é preenchido pela E11 e pela E12 |
| **Cotação com fornecedores por link** *(recomendado como fonte principal de preço)* | A oficina escolhe as peças da OS e 3 fornecedores; cada um recebe um link (WhatsApp) e responde preço, marca e prazo numa página pública; as respostas aparecem lado a lado; escolher gera o pedido de compra. É o que a oficina já faz hoje por WhatsApp, só que organizado. Legal, sem scraping, com preço real |
| **Pesquisar Peças** | Busca por nome, código, fabricante, veículo e aplicação sobre os providers: estoque interno, catálogo e listas de preço de fornecedores (importação CSV), respostas de cotação, marketplaces **só onde houver API oficial e os termos permitirem**, e o mock rotulado para desenvolvimento |
| **Melhor preço** | Comparador com 🏆 melhor preço (produto + frete), ⚡ entrega mais rápida e ⭐ custo-benefício (regra explicada na tela); margem configurável; preço sugerido editável; "adicionar à OS" |
| **Compras** | Pedido (rascunho → solicitado → pedido → parcial → recebido / cancelado); recebimento atualiza estoque e custo médio; sugestão de compra a partir do estoque mínimo e das OS aguardando peça; reserva automática ao receber |
| **Financeiro** ✅ E13 | Contas a receber (geradas pela OS, com parcelas e "fiado") e a pagar (geradas pela compra ou avulsas), categorias, baixa, vencidas, fluxo de caixa, lucro estimado (receita − custo das peças − despesas) |
| **Relatórios** | Faturamento, lucro estimado, serviços, peças, clientes, veículos, mecânicos, ticket médio, aprovação, estoque e fornecedores, com filtros de período e exportação CSV |
| **Produtividade** | Cronômetro por item de serviço (estimado × real), OS por mecânico, concluídos |
| **Pós-venda assistido** | Fila diária de contatos ("7 dias depois", "revisão vencendo", "sem voltar há 6 meses") com a mensagem pronta; um toque abre o WhatsApp. Automação sem API, com uma pessoa enviando |
| **Avaliações** | Link de 1 a 5 estrelas depois da entrega; média e total no dashboard; convite para avaliar no Google **para todos os clientes**, não só os satisfeitos (as políticas do Google proíbem pedir avaliação só a quem gostou) |
| **CRM** | Pipeline (novo lead → contato → orçamento → aguardando → aprovado → concluído / perdido) com valor potencial e taxa de conversão |
| **Plataforma** | Landing page (Astro), importação CSV (clientes, veículos, peças), jobs com pg-boss, SSE, PDF no servidor, vídeo no check-in, "acompanhe seu veículo", backoffice de suporte, e-mails de notificação |

---

## V3: integrações e escala

| Bloco | Entrega |
|---|---|
| **Nota fiscal** | NFS-e (serviço) e NF-e/NFC-e (peças) por emissor terceirizado. **Recomendo antecipar para logo depois do MVP 2**: é bloqueio de venda para boa parte das oficinas |
| **Pagamentos** | Pix (QR Code e copia e cola), cartão e boleto por gateway; **link de pagamento dentro do orçamento aprovado**; conciliação por webhook |
| **Assinatura do SaaS** | Cobrança recorrente, trial, upgrade, downgrade, cancelamento e bloqueio por inadimplência, usando a estrutura de planos que já existe |
| **WhatsApp oficial** | WhatsApp Business Platform (direto ou por provedor autorizado): envio automático, confirmação de entrega e leitura, respostas voltando para o sistema |
| **Automações** | Lembretes por tempo e km, confirmação de agendamento, orçamento sem resposta, aniversário de revisão |
| **Consulta veicular** | Dados do veículo pela placa, **só por provedor licenciado** |
| **Marketplace** | Diretório global de fornecedores, pedido e pagamento pela plataforma, comissão |
| **IA** | Diagnóstico assistido, sugestão de peças e serviços, previsão de manutenção e demanda, recomendação de preço, redação de mensagens. Sempre como sugestão, com a IA desligável |
| **Produto** | PWA com leitura offline → app para mecânico (Expo/React Native); multi-filial e estoque por local; papéis customizados; API pública e webhooks para parceiros; exportação contábil |

---

## Integrações externas futuras

| Área | Para quê | Candidatos (validar preço, termos e cobertura na hora) | Fase | Observação |
|---|---|---|---|---|
| E-mail transacional | Redefinir senha, convites, avisos | Amazon SES, Resend, Postmark | 1 | Em dev: Mailpit ou console |
| Object storage | Fotos, logos, documentos | Cloudflare R2, AWS S3 (região São Paulo) | 1 | Em dev: MinIO ou disco local |
| CEP e CNPJ | Preencher endereço e dados da oficina | ViaCEP, BrasilAPI | 1 | Dados públicos; sempre com preenchimento manual como alternativa |
| WhatsApp (link) | Enviar orçamento e avisos | `wa.me` | 1 | Sem custo; depende de a pessoa tocar "enviar" |
| Monitoramento | Erros e desempenho | Sentry | 1 | A partir do primeiro deploy |
| Preço de peças: fornecedores | Cotação e listas de preço | Cotação por link (própria), CSV/planilha, integração B2B com distribuidores sob parceria | 2 | A fonte mais realista e 100% legítima |
| Preço de peças: marketplaces | Referência de preço de varejo | Mercado Livre (API oficial com app registrado; houve restrições recentes no acesso à busca pública), Amazon (API de afiliados, que exige conta com vendas qualificadas e tem regras de exibição de preço), Shopee (sem API pública geral de busca para terceiros) | 2–3 | Implementar só o que os termos permitirem, e documentar essa verificação por provider |
| Catálogo de aplicação | Qual peça serve em qual carro | Catálogos licenciados do setor (ex.: TecAlliance/TecDoc, a validar a cobertura da frota brasileira) e catálogos dos próprios fabricantes | 3 | Resolve o risco de peça errada; tem custo de licença |
| Tabela FIPE | Marca, modelo e versão padronizados | Fundação FIPE (não há API oficial pública; avaliar fonte licenciada) | 2–3 | No MVP 1, marca e modelo são texto com autocomplete de uma lista interna |
| Consulta por placa | Preencher o veículo | Provedores licenciados de dados veiculares | 3 | Dado de proprietário é pessoal (LGPD); nunca fonte não autorizada |
| Fiscal | NFS-e, NF-e, NFC-e | Focus NFe, NFE.io, PlugNotas, eNotas | 3 (antecipar) | Nunca emissor próprio |
| Pagamentos | Pix, cartão, boleto | Asaas, Mercado Pago, Pagar.me, Efí, Stripe | 3 | Um provider atrás de `PaymentProvider` |
| Cobrança do SaaS | Assinatura | Asaas, Stripe, Iugu | 3 | Pode ser o mesmo dos pagamentos |
| WhatsApp (API) | Envio automático e respostas | WhatsApp Business Platform (Meta) direto ou provedor autorizado | 3 | Cobrança por mensagem de template; templates aprovados pela Meta |
| Google | Avaliações | Link de avaliação do Perfil da Empresa (MVP 2, sem API); Business Profile API (V3) | 2–3 | Convidar todos os clientes, sem filtrar |
| Agenda externa | Sincronizar agenda | Google Calendar | 3 | Opcional |
| IA | Recursos assistidos | Claude API (Anthropic) | 3 | Provider opcional; a V1 não depende |

---

## Planos (hipótese a validar, não decisão)

| | Starter | Professional | Business |
|---|---|---|---|
| Preço | R$ 99/mês | R$ 199/mês | R$ 399/mês |
| Usuários | 3 | 8 | ilimitados |
| OS por mês | 150 | ilimitadas | ilimitadas |
| Armazenamento de fotos | 5 GB | 25 GB | 100 GB |
| Orçamento digital, agenda, estoque | ✓ | ✓ | ✓ |
| Fornecedores, cotação, compras, financeiro, relatórios | — | ✓ | ✓ |
| Pesquisa de peças e comparador | — | ✓ | ✓ |
| Pós-venda e automações, WhatsApp oficial (V3) | — | — | ✓ |
| Multi-filial, papéis customizados, API (V3) | — | — | ✓ |

Os limites moram em `plans.limits`/`plans.features` e em
`packages/shared/entitlements.ts`. Mudar um plano é mudar dado, não código. Os
números acima são ponto de partida para conversar com oficinas reais antes de
publicar.

---

## Métricas que dizem se o produto funciona

| Métrica | Por que importa |
|---|---|
| Tempo do cadastro ao **primeiro orçamento enviado** | Ativação. Meta: no mesmo dia |
| % de oficinas que enviam **3 orçamentos na primeira semana** | Hábito formado |
| **Taxa de aprovação** de orçamentos (quantidade e valor) | É o valor financeiro que o produto promete |
| **Tempo até a aprovação** (envio → decisão) | O link tem que ser mais rápido que o telefonema |
| % de orçamentos **visualizados** | Se o cliente não abre, o problema é a mensagem ou o canal |
| OS por semana por oficina ativa | Uso real, não cadastro abandonado |
| Retenção mensal de oficinas pagantes | É o que faz um SaaS existir |

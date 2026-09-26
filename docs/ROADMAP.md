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
| **E8. Agenda** ✅ 13/09 | Dia, semana e mês; coluna por mecânico; arrastar e soltar; aviso de conflito com "confirmar mesmo assim"; status; **check-in a partir do agendamento cria a OS**; confirmação pelo WhatsApp | Conflito detectado em sobreposição parcial; o fuso da oficina é respeitado. **Cumprido**: a sobreposição é meio-aberta (encostar não é conflito) e sai como **aviso** com quem colide, não como impedimento; o fuso vem de `organizations` e há teste de API (oficina em Manaus) e de navegador (aparelho em Kiritimati). A grade virou componente próprio — **D28 revisa a D20**. Em **19/09** fechou a lacuna que tinha ficado: dá para remarcar **pelo teclado** (espaço pega, setas andam de 15 min e entre colunas, Enter solta, Esc devolve), com o horário anunciado em voz alta a cada passo |
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
| **E17. Plataforma** ✅ 19/09 (parcial, ver abaixo) | Landing em Astro, importação de CSV (clientes, veículos, peças) e "acompanhe seu veículo" | A landing sai como HTML estático, sem promessa que o produto não cumpre; a importação confere antes de gravar e explica cada linha recusada; o acompanhamento abre sem login e não mostra custo. **Cumprido**: 10 testes novos de API, 1 cenário e2e, telas conferidas no navegador |
| **E16. Pós-venda, avaliações e CRM** ✅ 18/09 | Fila diária de contatos com mensagem pronta, avaliação por link público com convite ao Google, e funil de leads | A fila se monta sozinha e não duplica; o convite só existe com o carro entregue e a nota entra uma vez só; o funil cobra motivo de perda e vira cliente ao fechar. **Cumprido**: 22 testes novos (12 de regra pura, 10 de API), 1 cenário e2e com a página do cliente no celular, telas conferidas no navegador |
| **E15. Relatórios e produtividade** ✅ 18/09 | Dez relatórios com filtro de período e exportação CSV; cronômetro por item de serviço (estimado × real) | O CSV abre e SOMA no Excel em português; o lucro do relatório é o mesmo do financeiro; o cronômetro tem uma volta aberta por pessoa e arredonda o minuto para cima. **Cumprido**: 21 testes novos (9 de regra pura, 12 de API), 1 cenário e2e, telas conferidas no navegador |
| **E14. Pesquisa de peças e melhor preço** ✅ 18/09 | Busca sobre estoque, listas de preço importadas e cotações respondidas; comparador com os três selos; importação de CSV do fornecedor; "adicionar à OS" com a margem | Cada provider traz o que é dele e um que falha não derruba a busca; a planilha torta importa o que dá e diz o que recusou, com a linha; o comparador ordena pelo custo total e explica cada selo na tela; a oferta vira item da OS pelo preço com margem. **Cumprido**: 30 testes novos (19 de regra pura, 11 de API), 1 cenário e2e, telas conferidas no navegador |
| **E13. Financeiro** ✅ 18/09 | Contas a receber e a pagar, baixa, parcelamento, fluxo de caixa e lucro estimado | A conta da OS espelha a OS (valor e pagamento); a nota da compra vira conta a pagar e a devolução abate; baixa não passa do saldo nem acontece duas vezes; "vencida" calculada no fuso da oficina; dinheiro é de gerente/financeiro para cima. **Cumprido**: 35 testes novos (17 de regra pura, 18 de API), `npm run check` verde e as telas conferidas no navegador — foi ali que apareceu o custo das peças dividido por mil |

### Blocos

| Bloco | Entrega |
|---|---|
| **Fornecedores** ✅ E10 | Cadastro, categorias, histórico de compras, preços, prazo e avaliação. O histórico de compras e preços é preenchido pela E11 e pela E12 |
| **Cotação com fornecedores por link** *(recomendado como fonte principal de preço)* | A oficina escolhe as peças da OS e 3 fornecedores; cada um recebe um link (WhatsApp) e responde preço, marca e prazo numa página pública; as respostas aparecem lado a lado; escolher gera o pedido de compra. É o que a oficina já faz hoje por WhatsApp, só que organizado. Legal, sem scraping, com preço real |
| **Pesquisar Peças** ✅ E14 | Busca por nome, código, fabricante, veículo e aplicação sobre os providers: estoque interno, catálogo e listas de preço de fornecedores (importação CSV), respostas de cotação, marketplaces **só onde houver API oficial e os termos permitirem**, e o mock rotulado para desenvolvimento |
| **Melhor preço** ✅ E14 | Comparador com 🏆 melhor preço (produto + frete), ⚡ entrega mais rápida e ⭐ custo-benefício (regra explicada na tela); margem configurável; preço sugerido editável; "adicionar à OS" |
| **Compras** | Pedido (rascunho → solicitado → pedido → parcial → recebido / cancelado); recebimento atualiza estoque e custo médio; sugestão de compra a partir do estoque mínimo e das OS aguardando peça; reserva automática ao receber |
| **Financeiro** ✅ E13 | Contas a receber (geradas pela OS, com parcelas e "fiado") e a pagar (geradas pela compra ou avulsas), categorias, baixa, vencidas, fluxo de caixa, lucro estimado (receita − custo das peças − despesas) |
| **Relatórios** ✅ E15 | Faturamento, lucro estimado, serviços, peças, clientes, veículos, mecânicos, ticket médio, aprovação, estoque e fornecedores, com filtros de período e exportação CSV |
| **Produtividade** ✅ E15 | Cronômetro por item de serviço (estimado × real), OS por mecânico, concluídos |
| **Pós-venda assistido** ✅ E16 | Fila diária de contatos ("7 dias depois", "revisão vencendo", "sem voltar há 6 meses") com a mensagem pronta; um toque abre o WhatsApp. Automação sem API, com uma pessoa enviando |
| **Avaliações** ✅ E16 | Link de 1 a 5 estrelas depois da entrega; média e total no dashboard; convite para avaliar no Google **para todos os clientes**, não só os satisfeitos (as políticas do Google proíbem pedir avaliação só a quem gostou) |
| **CRM** ✅ E16 | Pipeline (novo lead → contato → orçamento → aguardando → aprovado → concluído / perdido) com valor potencial e taxa de conversão |
| **Plataforma** — parcial na E17 | ✅ **Landing** (Astro, `apps/landing`), ✅ **importação CSV** (clientes, veículos, peças, com conferência antes de gravar) e ✅ **"acompanhe seu veículo"** (link público com o passo do carro). **Continuam abertos, com motivo**: jobs com pg-boss (a fila do pós-venda já se resolve na abertura da tela, e sem deploy não há cron para configurar), SSE (o polling de 20 s resolve; LISTEN/NOTIFY entra com a segunda instância), PDF no servidor (a página de impressão já imprime; o Chromium headless pesa ~300 MB no deploy), vídeo no check-in (custo de storage antes da primeira venda), backoffice de suporte (precisa de conta de plataforma, que é V3) e e-mails de notificação (o driver real é decisão de deploy — hoje é `console`) |

### Acabamento depois da E17 (19/09)

Três pontas que ficaram soltas no MVP 2, todas pedidas depois de rodar o
produto de verdade:

| Ajuste | O que mudou |
|---|---|
| **OS cancelada não fica "aguardando resposta"** | Cancelar a OS revoga o orçamento aberto (`REVOKED`, com motivo e data): ele some da fila de espera em vez de ficar cobrando resposta de um serviço que não vai acontecer |
| **Devolução automática ao estoque** | Tirar a peça da OS reaberta, ou reduzir a quantidade, devolve ao estoque com movimento `CUSTOMER_RETURN` pelo custo com que ela saiu — e aparece na timeline. Item que já tem **tempo apontado** não é excluído: a API explica (409 `ITEM_HAS_TIME_LOGGED`) em vez de apagar trabalho que alguém fez (**D36**) |
| **Agenda pelo teclado** | Remarcar sem mouse, com aviso falado a cada passo (fecha a lacuna de acessibilidade da E8) |

No caminho, dois bugs próprios apareceram e foram corrigidos: remover item já
enviado em orçamento dava **500** (chave estrangeira do `quote_items`), e o
limite de 300 requisições/min derrubava um cenário diferente do e2e a cada
rodada — fora de produção o teto passou a ser 5.000, porque ali tudo sai do
mesmo IP.

### Publicar (22/09)

O deploy saiu antes da E22, como ele pediu: `Dockerfile` (API e Caddy com o
painel, as páginas públicas e a landing), `docker-compose.yml` (Postgres, API,
web), `deploy/Caddyfile` com TLS automático e as URLs bonitas das páginas
públicas, `deploy/.env.example`, `deploy/backup.sh` e `deploy/restore.sh`, e o
passo a passo em **docs/DEPLOY.md**.

O que foi testado aqui: build de produção dos três apps, `dist/migrate.js`
aplicando as migrations e `dist/server.js` em `NODE_ENV=production`
respondendo `/health`, `/ready` e um cadastro completo. Os arquivos de
container **não** foram construídos — não há Docker nesta máquina, e isso está
dito no topo do guia.

Fecha a pendência do `docker-compose.yml`, que vinha desde a E1.

---

## V3: integrações e escala

Começou em **20/09/2026**, antes de publicar, pela ordem que ele escolheu:
nota fiscal e pagamentos primeiro.

### Etapas

| Etapa | Entrega | Pronto quando |
|---|---|---|
| **E18. Nota fiscal de serviço** ✅ 20/09 | Dados fiscais da oficina; prévia com os números e o que falta; emissão a partir da OS finalizada; cancelamento com motivo; lista das notas com o ISS | O que falta preencher aparece com o caminho para resolver, não com código de rejeição; a nota cobre só SERVIÇO e diz isso na tela; o ISS sai de dentro do preço; o mesmo POST não emite duas notas; cancelar tem permissão própria. **Cumprido**: 26 testes novos (15 de regra pura + 11 de API), 1 cenário e2e com auditoria de acessibilidade, e três mutações provadas. **O emissor é o simulador** (D37): nada é enviado a prefeitura nenhuma, não se gera XML nem PDF, e toda tela carimba "simulação" |
| **E19. Pagamentos online** ✅ 20/09 | Cobrança por Pix, boleto, cartão ou link a partir da OS; código e link para mandar no WhatsApp; conciliação automática pelo aviso do gateway; cancelamento e estorno | Não dá para cobrar duas vezes o mesmo saldo; o aviso do gateway é a única fonte do "pago" e cria pagamento no MESMO caixa do dinheiro da mão; aviso repetido não dobra a baixa; estorno desfaz a baixa e a OS volta a dever. **Cumprido**: 23 testes novos (5 de regra pura, 9 de contrato do driver Asaas, 9 de API), 1 cenário e2e com auditoria de acessibilidade, três mutações provadas. **O gateway padrão é o simulador**: não cobra ninguém. O driver do **Asaas** está escrito e testado em contrato, mas ainda não foi exercitado contra a API real — falta a conta |
| **E20. Assinatura do SaaS** ✅ 21/09 | Tela de plano com uso contra os limites, assinar, trocar de plano, cancelar e voltar atrás; renovação e atraso pelo aviso do gateway; bloqueio por inadimplência | O bloqueio trava a ESCRITA e nunca a leitura, nem a porta de pagar; cancelar deixa trabalhar até o fim do período pago; atraso dá 7 dias de carência antes de cortar; o aviso repetido não conta duas vezes. **Cumprido**: 19 testes novos (10 de regra pura, 9 de API), 2 cenários e2e com auditoria de acessibilidade, duas mutações provadas. **A cobrança roda no simulador**: nenhuma assinatura é criada em gateway nenhum |
| **E21. Jobs e automações** ✅ 21/09 | pg-boss no próprio Postgres; quatro automações diárias (fila de pós-venda, lembrete de agendamento, orçamento sem resposta e resumo do dia por e-mail), com tela para ligar, desligar, escolher a hora e **rodar agora**; driver de e-mail SMTP | Nenhuma automação manda mensagem para o cliente — ela deixa pronto; cada oficina roda na hora DELA, uma vez por dia; rodar duas vezes não duplica nada; dia sem pendência não vira e-mail; toda execução vira registro, inclusive o erro. **Cumprido**: 20 testes novos (9 de regra pura, 11 de API), 1 cenário e2e com auditoria de acessibilidade, duas mutações provadas. A fila é instalada pela DONA do banco: a role que atende requisição não ganhou poder de criar tabela |
| **E22. WhatsApp oficial e conversa** ✅ 24/09 | WhatsApp Business Platform com a credencial **da própria oficina** (token cifrado, nunca devolvido); conversa dentro do sistema, com a janela de 24 h explicada na tela; catálogo de 8 modelos com o texto pronto para colar na Meta; envio automático só para mensagem de utilidade; webhook com assinatura conferida trazendo resposta, entrega e leitura | Sem conectar nada, tudo continua como antes: a mensagem sai pelo `wa.me` com o texto pronto. Pós-venda **nunca** sai sozinho: o modelo aparece escrito e espera o botão. **Cumprido**: 61 testes novos (16 de regra pura e do contrato do driver, 6 do segredo cifrado, 29 de API, 10 do provedor), 1 cenário e2e com duas auditorias de acessibilidade, oito mutações provadas. Nenhuma biblioteca não oficial, em nenhum ponto |
| **E23. Enxugar o painel** ✅ 25/09 | Menu em quatro blocos; fornecedores, compras, contas a pagar, avaliações internas e pesquisa de preço fora do painel; sugestão de compra virou a aba **Recomendações de pedido** em Peças e estoque; relatório virou **botão no topo** que abre por cima; avaliação passou a ser **no Google**; despesa se lança no fluxo de caixa; atalhos na tela inicial | O menu cabe na tela sem rolar; nada que sumiu deixou buraco: o histórico continua no banco, a entrada de peça com custo mantém o custo médio, e a despesa continua entrando no caixa (senão o lucro estimado seria mentira). **Cumprido**: suíte inteira verde, 3 cenários e2e reescritos, auditoria de acessibilidade nas telas novas |
| **E24. O aplicativo no celular** ✅ 25/09 | O sistema **instala** no celular (PWA: manifesto, service worker, ícones, tela cheia); barra de atalhos embaixo; **"Minhas OS"** para o mecânico (carros dele, cronômetro no topo, um botão por carro); tela larga demais avisa que fica melhor no computador, sem bloquear; o mecânico entra e já cai na tela dele | O mecânico faz o dia inteiro pelo telefone sem abrir menu: 2 cenários de celular (390 px) com auditoria de acessibilidade, e `npm run pwa:check` provando manifesto, ícones e service worker no build de produção. **Nenhum dado da oficina vai para o cache** (D55) |
| **E25 em diante** | Consulta veicular e catálogo licenciado; backoffice de plataforma; tempo real e PWA; multi-filial; API pública; IA assistida; marketplace | (a definir na etapa) |

### Blocos

| Bloco | Entrega |
|---|---|
| **Nota fiscal** — parcial na E18 | ✅ **NFS-e (serviço)** com emissor atrás de driver. **Falta a nota de PEÇA** (NF-e/NFC-e): exige NCM, CFOP, CST/CSOSN e origem em todo o catálogo, e nem toda oficina precisa — vira etapa quando houver oficina que precise. Emitir de verdade depende de contratar emissor e cadastrar o certificado A1 lá |
| **Pagamentos** — parcial na E19 | ✅ Cobrança por Pix, boleto, cartão e link, com conciliação por webhook e estorno. **Falta**: ligar o Asaas de verdade (conta + chave de sandbox) e o link de pagamento dentro da página pública do orçamento aprovado |
| **Assinatura do SaaS** ✅ E20 | Cobrança recorrente, trial, upgrade, downgrade, cancelamento e bloqueio por inadimplência. Falta só ligar o gateway de verdade (a mesma conta do Asaas da E19) e cadastrar o preço ANUAL dos planos, que hoje é nulo — sem preço cadastrado, o ciclo anual não é oferecido |
| **WhatsApp oficial** ✅ E22 | WhatsApp Business Platform com a conta **de cada oficina**: envio pela API, confirmação de entrega e leitura, respostas voltando para a conversa dentro do sistema, e envio automático para mensagem de utilidade. **Falta**: exercitar o driver contra a API real (depende de uma conta conectada na Meta) e a aprovação dos modelos, que é trabalho de cada oficina no painel dela |
| **Automações** ✅ E21 | Fila de pós-venda (tempo e km), lembrete de agendamento, orçamento sem resposta e resumo diário por e-mail. O envio ao cliente sai pelo `wa.me` com uma pessoa apertando enviar; com o canal oficial conectado (E22), mensagem de **utilidade** pode sair sozinha, se a oficina ligar |
| **Consulta veicular** | Dados do veículo pela placa, **só por provedor licenciado** |
| **Marketplace** | Diretório global de fornecedores, pedido e pagamento pela plataforma, comissão |
| **IA** | Diagnóstico assistido, sugestão de peças e serviços, previsão de manutenção e demanda, recomendação de preço, redação de mensagens. Sempre como sugestão, com a IA desligável |
| **Produto** | PWA com leitura offline → app para mecânico (Expo/React Native); multi-filial e estoque por local; papéis customizados; API pública e webhooks para parceiros; exportação contábil |

### WhatsApp oficial e conversa (24/09)

Ele pediu três coisas, e elas mandaram no desenho: **cada oficina traz as
próprias credenciais**, **só mensagem de serviço pode ser automática** e a
**conversa acontece dentro do OficinaOS**.

O que isso significou na prática:

- **A conta é da oficina** (D49). Ela cria o app na Meta e cola `phone_number_id`,
  token e app secret. Antes de guardar, a API **usa** a credencial (pergunta à
  Meta qual é o número): credencial errada não vira canal "conectado". O token
  vai cifrado para o banco (AES-256-GCM, `SECRETS_KEY` no ambiente) e a tela só
  vê os quatro últimos caracteres. Desconectar **apaga** as credenciais.
- **A janela de 24 h na tela** (D50). Dentro dela, conversa normal; fora, só
  modelo aprovado. A frase que explica isso sai da mesma função pura que a API
  usa para aceitar ou recusar — a tela não promete o que a API nega.
- **Pós-venda espera o botão** (D51). O modelo aparece escrito, com o nome e o
  carro do cliente, e a mensagem só existe depois do clique. Automático existe
  só para orçamento enviado, veículo pronto e confirmação de agendamento.
- **O aviso da Meta entra pela assinatura do corpo cru** (D52), com um parser
  próprio no plugin do webhook para o corpo não ser remontado.
- **O que já existia passou a usar o canal.** "Veículo pronto" e "orçamento
  enviado" saem pelo servidor quando há canal conectado (a resposta diz `via`),
  e **finalizar a OS avisa o cliente sozinho** se a oficina ligou o automático
  para "veículo pronto". A Meta fora do ar não impede a OS de ser finalizada: a
  falha fica registrada na conversa, com o motivo.

Honestidade sobre o que **não** está provado: o driver `cloud-api` foi escrito a
partir da documentação da Graph API v21 e ainda **não falou com a Meta de
verdade** — falta uma conta conectada. O que os testes provam é o contrato (um
servidor local responde no lugar dela): o formato do envio de texto e de modelo,
o token no header, a tradução do que volta, a recusa legível e a assinatura do
aviso.

Sem conectar nada, nada mudou para quem já usa: a mensagem continua saindo pelo
link do WhatsApp, com o texto pronto — e agora fica registrada na conversa.

### Enxugar o painel (25/09)

Ele usou o sistema e disse: "tá muito cheio, quero deixar mais fácil a
utilização". O que saiu, e por quê:

| Saiu | Para onde foi |
|---|---|
| **Fornecedores**, **Compras**, **A pagar** | Apagados do painel, a pedido dele. O que a compra fazia pelo estoque (entrar peça com custo) já existia em **Entrada de estoque**; o que ela fazia pelo caixa virou **Lançar despesa**, dentro do fluxo de caixa |
| **Sugestão de compra** | Virou a aba **Recomendações de pedido**, dentro de Peças e estoque, com "copiar lista" para colar no WhatsApp do fornecedor |
| **Relatórios** | Botão no topo, abre por cima de qualquer tela e devolve a pessoa ao lugar onde estava |
| **Conversas** | Ganhou a tela inteira (a página não rola, quem rola é o fio), lista com avatar e busca, separador de dia, e **respostas prontas** agrupadas pela etapa do atendimento: um toque escreve no campo, e quem manda continua sendo a pessoa |
| **Avaliações** | O convite da OS entregue leva ao **Google** da oficina (link cadastrado em Configurações → Oficina). A página de avaliação própria e a tela de notas saíram |
| **Pesquisar preço** | Saiu junto: as duas fontes de preço (lista do fornecedor e cotação respondida) vinham da área de compras |

O que **não** saiu: nada do banco. Fornecedores, pedidos de compra, cotações e
as avaliações já respondidas continuam gravados, e as rotas da API continuam
testadas — `/purchase-orders/suggestions` é o que alimenta a aba nova.

Duas consequências que ficam registradas: a **cotação por link com
fornecedores** (E11) perdeu a porta de entrada no painel, porque dependia do
cadastro de fornecedores (a página do fornecedor e a API seguem de pé); e a
**lista de preço em CSV** deixou de ter onde ser importada, pelo mesmo motivo.

### O aplicativo no celular (25/09)

Ele pediu: "quero que crie um aplicativo mobile… o acesso de funcionário
precisa estar 10 no celular, visando que funcionário usa celular na oficina e
não computador". Escolha dele: **PWA instalável**, e o mecânico com as OS
dele, cronômetro, fotos e quilometragem.

- **Instala mesmo**: manifesto, ícones gerados a partir da marca, service
  worker e tela cheia. No Android o próprio Chrome oferece instalar; no iPhone
  o convite ensina o caminho do Safari. `npm run pwa:check -w @oficinaos/web`
  sobe o build de produção num servidor local e confere que tudo responde.
- **Minhas OS**: uma requisição (`/work-orders/my-day`), cronômetro correndo no
  topo com o botão de parar, e **um** botão por carro — a próxima ação do
  serviço, na ordem em que ele acontece. Alvos de 44–56 px.
- **Barra embaixo** no lugar do menu: Minhas OS · Agenda · OS · Mais para o
  mecânico; Início · Agenda · OS · Conversas · Mais para quem administra.
- **"Fica melhor no computador"**: financeiro, nota fiscal, importação,
  configuração fiscal e conexão do WhatsApp avisam — e abrem assim mesmo se a
  pessoa insistir. Bloquear seria decidir pela oficina numa hora em que só ela
  sabe se dá.
- **O que o cache guarda**: os arquivos do aplicativo, e nada da oficina (D55).

---

## Integrações externas futuras

| Área | Para quê | Candidatos (validar preço, termos e cobertura na hora) | Fase | Observação |
|---|---|---|---|---|
| E-mail transacional | Redefinir senha, convites, avisos | Amazon SES, Resend, Postmark | 1 | Em dev: Mailpit ou console |
| Object storage | Fotos, logos, documentos | Cloudflare R2, AWS S3 (região São Paulo) | 1 | Em dev: MinIO ou disco local |
| CEP ✅ (19/09) | Preencher endereço da oficina e do cliente | **BrasilAPI**, com **ViaCEP** de reserva | 1 | Consulta do NAVEGADOR: é dado público, a API não precisa ser intermediária, e uma fonte fora do ar nunca derruba o cadastro. Todo campo continua editável. CNPJ ainda não |
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

# OficinaOS — publicar

> Um servidor, três containers (banco, API, web) e um domínio. Do zero ao
> painel no ar em mais ou menos uma hora, contando a propagação do DNS.
>
> **O que foi testado, e o que não foi.** O que roda dentro do container já
> foi exercitado fora dele nesta máquina: o build de produção dos três apps, o
> `dist/migrate.js` aplicando as migrations, e o `dist/server.js` de pé em
> `NODE_ENV=production` respondendo `/health`, `/ready` e um cadastro completo
> (senha com Argon2 e tudo). **O que não foi testado são os arquivos de
> container** — não há Docker nesta máquina, então o primeiro
> `docker compose build` é também o primeiro teste deles. O §7 diz o que olhar
> se algum passo falhar.

---

## 1. O que você precisa antes

| Item | Para quê | Custo aproximado |
|---|---|---|
| Um VPS Linux (2 vCPU, 4 GB de RAM, 40 GB de disco) | roda tudo | R$ 30 a R$ 80 por mês |
| Um domínio | endereço do painel e dos links que o cliente abre | R$ 40 a R$ 60 por ano (`.com.br`) |
| Conta de e-mail transacional (SMTP) | redefinir senha, convite, resumo do dia | grátis até alguns milhares por mês |
| Conta no Asaas *(opcional)* | cobrar Pix/boleto e a assinatura | por transação |
| Emissor de NFS-e *(opcional)* | emitir nota de serviço | R$ 30 a R$ 100 por mês |

4 GB de RAM é o suficiente para o Postgres, a API e o Caddy com folga para
umas dezenas de oficinas. O gargalo, quando vier, é o banco — e o caminho é
aumentar a máquina antes de separar serviços.

---

## 2. O servidor

Ubuntu 24.04 LTS. Como root, na primeira conexão:

```sh
# 1) um usuário que não é root, com sudo
adduser --disabled-password --gecos '' oficinaos
usermod -aG sudo oficinaos
mkdir -p /home/oficinaos/.ssh
cp ~/.ssh/authorized_keys /home/oficinaos/.ssh/
chown -R oficinaos:oficinaos /home/oficinaos/.ssh
chmod 700 /home/oficinaos/.ssh

# 2) só SSH por chave, sem root direto
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# 3) firewall: só SSH, HTTP e HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# 4) Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker oficinaos

# 5) atualizações de segurança sozinhas
apt-get install -y unattended-upgrades
```

Reconecte como `oficinaos` daqui para frente.

---

## 3. O DNS

No painel do seu registrador, dois registros **A** apontando para o IP do VPS:

| Nome | Tipo | Valor |
|---|---|---|
| `app` | A | o IP do servidor |
| `@` (ou `www`) | A | o mesmo IP |

`app.seudominio.com.br` é o painel — e é o endereço que aparece nos links que
o cliente recebe por WhatsApp. O domínio raiz serve a landing.

Espere o DNS responder antes de subir (o certificado depende disso):

```sh
dig +short app.seudominio.com.br
```

---

## 4. O código e o `.env`

```sh
sudo mkdir -p /opt/oficinaos && sudo chown oficinaos:oficinaos /opt/oficinaos
git clone https://github.com/GabrielAlderige/oficinaos.git /opt/oficinaos
cd /opt/oficinaos

cp deploy/.env.example .env
chmod 600 .env

# gere os segredos (nunca escolha "na mão")
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
echo "APP_DB_PASSWORD=$(openssl rand -hex 32)"
echo "OWNER_DB_PASSWORD=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -base64 48)"
# cifra o token do WhatsApp de cada oficina (E22); precisa ter 32 bytes
echo "SECRETS_KEY=$(openssl rand -base64 32)"

nano .env   # cole os valores e preencha domínios e SMTP
```

**Preencha `RESPONSAVEL_DOC`** com o CPF (ou CNPJ) de quem responde pelo
serviço, só os números. Ele aparece nas páginas `/termos` e `/privacidade` do
site, e o build do `web` **para** sem ele: termo sem identificação do
fornecedor não vale. Fica no `.env`, e não no código, porque o repositório é
público. Trocou (de CPF para CNPJ, por exemplo)? `docker compose build web &&
docker compose up -d web`.

**Confira que o `.env` tem `TRUST_PROXY=uniquelocal`.** O compose já põe esse
valor por padrão, e ele é o que faz a API enxergar o IP real de cada oficina
atrás do Caddy. Sem ele, todas chegam com o IP do contêiner do proxy: o limite
de 300 requisições por minuto vira um balde compartilhado por **todos** os seus
clientes, a tela de Sessões ativas mostra sempre o mesmo endereço, e o IP
gravado como prova de aprovação do orçamento deixa de provar qualquer coisa.

O `.env` fica **só no servidor**: ele não entra no git (o `.gitignore` e o
`.dockerignore` barram), e não entra no backup junto com os dados — guarde-o
no seu gerenciador de senhas.

---

## 5. Subir

```sh
cd /opt/oficinaos

# 1) construir as duas imagens (demora alguns minutos na primeira vez)
docker compose build

# 2) banco de pé
docker compose up -d db

# 3) roles, privilégios, migrations e a fila de jobs — um tiro só
docker compose --profile ferramentas run --rm migrate

# 4) o resto
docker compose up -d

# 5) olhar
docker compose ps
docker compose logs -f api
```

No log da API, a linha que confirma o trabalhador de fundo:

```
automações: trabalhador no ar (de hora em hora)
```

Abra `https://app.seudominio.com.br`. O Caddy pega o certificado sozinho na
primeira visita (leva alguns segundos).

---

## 6. A primeira oficina

O cadastro é público — é assim que um SaaS funciona. Crie a sua conta pelo
próprio painel, em **Criar conta**, e ela nasce com 14 dias de teste no plano
**Nitro**, o mais alto (E40): o teste mostra o produto inteiro, inclusive
pesquisa de peças, WhatsApp oficial e automações. Ao assinar um plano menor, a
oficina perde o que não estiver nele — e a tela diz em qual plano cada coisa
mora, com o caminho para subir.

Depois, dentro do painel:

1. **Configurações → Oficina**: CNPJ, endereço, horário e WhatsApp (isso
   aparece no orçamento que o cliente abre).
2. **Configurações → Plano**: assine quando o gateway estiver ligado (§8).
3. **Configurações → Automações**: escolha a hora em que o sistema monta a
   fila do dia.
4. **Configurações → Equipe**: convide quem trabalha com você.
5. **No celular da equipe**: abra `https://app.<seu-domínio>` no telefone e
   instale o aplicativo — no Android o Chrome oferece "Instalar aplicativo"; no
   iPhone é Safari → Compartilhar → "Adicionar à Tela de Início". O mecânico
   entra e já cai em **Minhas OS**. Só funciona com HTTPS, que o Caddy já
   resolve.
6. **Configurações → WhatsApp** (opcional): conecte a conta oficial da oficina.
   Sem isso o sistema já funciona — as mensagens saem pelo link do WhatsApp,
   com o texto pronto. Conectar serve para o sistema enviar sozinho e para as
   respostas do cliente chegarem na tela **Conversas**. Precisa de
   `SECRETS_KEY` no `.env` do servidor (§3): é a chave que cifra o token da
   oficina no banco.

> **Guarde a `SECRETS_KEY` junto do backup.** Restaurar o banco sem ela deixa
> ilegível o que foi guardado, e cada oficina precisa conectar o WhatsApp de
> novo. Gere com `openssl rand -base64 32`.

> A oficina de demonstração (`npm run db:seed:demo`) só existe em
> desenvolvimento, de propósito: dado inventado não nasce junto com dado real
> no servidor de quem trabalha.

> **O WhatsApp do site.** A landing usa um número fixo no código
> (`apps/landing/src/pages/index.astro`, constante `WHATSAPP`). Hoje é o
> pessoal; quando a empresa tiver o dela, troque ali e reconstrua a imagem
> `web` — é uma linha.

### 6.1 Virar administrador da plataforma

A marca é da CONTA, não da oficina, e só se liga uma vez, direto no banco:

```sh
docker compose exec -T db psql -U postgres -d oficinaos -c   "update users set is_platform_admin = true where email = 'voce@seudominio.com.br';"
```

Depois disso aparecem três telas que a oficina nunca vê:

| Tela | Para quê |
|---|---|
| `/plataforma/interessados` | quem preencheu o formulário do site, e o botão que **baixa a planilha** do remarketing |
| `/plataforma/oficinas` | todas as oficinas, com a situação da assinatura, e **estender o teste** com motivo registrado |
| `/plataforma/catalogo` | preencher a ficha do carro que as oficinas pedem |
| `/plataforma/tutoriais` | cadastrar as aulas em vídeo |

> **Estender o teste é a tela que evita SQL em produção.** Um piloto com preço
> de fundador precisa de 60 ou 90 dias em vez de 14; os dias contam a partir de
> hoje e o motivo fica na trilha da oficina.

### 6.2 Publicar o curso de Tutoriais

As 24 aulas em vídeo (uns 24 minutos, 163 MB) **não moram no git**. Elas vão
para a pasta `tutoriais/` ao lado do `docker-compose.yml`, e o Caddy serve em
`https://app.<seu-domínio>/tutoriais/`.

```sh
# da sua máquina: manda os 24 MP4 para o servidor
scp -r tutoriais/ oficinaos@IP-DO-SERVIDOR:/opt/oficinaos/tutoriais/

# no servidor: recria o web (para montar a pasta) e publica as aulas
sudo chown oficinaos:oficinaos tutoriais   # o Docker cria a pasta como root
docker compose up -d web
# pelo `migrate`: só ele tem a senha de dona do banco (DATABASE_OWNER_URL)
docker compose --profile ferramentas run --rm -e APP_URL=https://app.<seu-domínio> migrate node dist/seed-tutoriais.js
```

O cadastro lê `apps/api/scripts/tutoriais-aulas.ts` e aponta cada aula para
`${TUTORIAIS_URL}/<arquivo>` (sem a variável, `${APP_URL}/tutoriais`). Pode
rodar de novo à vontade: ele só atualiza pelo `slug`. Para hospedar no YouTube
no lugar, troque as aulas em `/plataforma/tutoriais`, colando o link de cada vídeo.

---

## 7. Se algo falhar

| Sintoma | Onde olhar |
|---|---|
| `docker compose build` para no `npm ci` | versão do Node na imagem (`node:24-slim`) e `package-lock.json` desatualizado no servidor — rode `git pull` |
| API sobe e cai | `docker compose logs api`. Falta de variável obrigatória aparece com o nome dela |
| `permissão negada para banco` | o passo 3 (`migrate`) não rodou, ou rodou antes de o banco estar pronto |
| Certificado não sai | DNS ainda não propagou, ou as portas 80/443 estão fechadas no firewall do provedor |
| Painel abre, mas nada carrega | `docker compose logs web` e confira `APP_DOMAIN` e `APP_URL` — os dois precisam ser o MESMO endereço |
| Login funciona e depois desloga | `JWT_SECRET` mudou entre reinícios (ficou vazio no `.env`) |
| A Meta não aceita o webhook | o endereço precisa de HTTPS válido e público. Confira a URL e o token em **Configurações → WhatsApp** — a URL é `https://app.<seu-domínio>/api/v1/webhooks/whatsapp/<id da oficina>` |
| Conectar o WhatsApp devolve "servidor sem chave de segredos" | falta `SECRETS_KEY` no `.env`; gere com `openssl rand -base64 32` e reinicie a API |

O `/api/v1/health` responde se o processo está vivo; o `/api/v1/ready` só
responde 200 quando o banco também responde. São eles que um monitor externo
(UptimeRobot, BetterStack) deve olhar.

---

## 8. Ligar o que ainda está em simulação

O sistema sobe funcionando, mas três coisas ficam **declaradamente em
simulação** até você contratar as contas — e a tela diz isso em cada uma, com
o carimbo de simulação, para ninguém achar que emitiu nota ou recebeu dinheiro.

| O quê | Sem configurar | Depois de configurar |
|---|---|---|
| **E-mail** | o e-mail aparece só no log do servidor | redefinir senha, convite e resumo do dia chegam de verdade |
| **Cobrança e assinatura** | nenhum dinheiro se move; dá para percorrer o fluxo inteiro | Pix, boleto e cartão de verdade, e a assinatura da oficina |
| **Nota fiscal** | nada é enviado para prefeitura nenhuma | exige emissor contratado **e** um driver novo no código |

O e-mail é o único que **não é opcional**: sem ele ninguém recupera a senha.
Está no §4.

---

### 8.1 Asaas, passo a passo

O sistema tem dois usos para um gateway de pagamento:

- a **assinatura que a oficina paga para você** (E20), por `PAYMENT_GATEWAY`;
- a **cobrança que a oficina faz do cliente dela** (E19), por `CHARGES_GATEWAY`.

Com **uma conta Asaas só, a sua**, ligue apenas o primeiro. O segundo fica
`desligado` (o padrão em produção): ligado com a sua conta, o Pix e o boleto do
cliente da oficina cairiam na **sua** conta, e não na da oficina. Desligado, o
cartão "Cobrança online" some da OS e a oficina registra o que recebeu no
cartão de pagamentos, como sempre. Ele só deve ser ligado (`CHARGES_GATEWAY=asaas`)
quando existir uma conta por oficina, o que este código ainda não faz.

**Comece pelo sandbox.** É uma conta separada, com dados falsos, onde o Pix e o
boleto se comportam igual ao de produção. Passar direto para produção significa
descobrir erro de configuração com dinheiro de cliente no meio.

**1) Criar a conta e pegar a chave**

Em <https://sandbox.asaas.com> crie a conta. Depois, no menu do seu perfil,
**Integrações → Chave de API**, gere a chave e copie. Ela começa com `$aact_`.

> A chave dá acesso total à conta. Ela vai para o `.env` do servidor e para o
> seu gerenciador de senhas — nunca para o git, nunca para mensagem.

**2) Inventar o token do webhook**

Este você escolhe, não é o Asaas que dá. Ele volta em todo aviso, e é como a
API sabe que o aviso veio mesmo do Asaas:

```sh
openssl rand -base64 32
```

**3) Preencher o `.env`**

```sh
PAYMENT_GATEWAY=asaas
ASAAS_API_KEY='$aact_...'                      # a chave do passo 1, ENTRE ASPAS SIMPLES
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
ASAAS_WEBHOOK_TOKEN='...'                      # o token do passo 2
CHARGES_GATEWAY=desligado
```

> **As aspas simples não são enfeite.** A chave começa com `$`, e o Docker
> Compose lê `$aact_...` como uma variável — que não existe, então a API
> recebe a chave vazia (ou cortada) e o Asaas responde 401. Entre aspas
> simples, o valor passa literal.

A oficina precisa ter **CPF ou CNPJ** em Configurações → Oficina para assinar:
o Asaas não emite cobrança sem documento, e a API avisa isso antes de chamar.

`ASAAS_BASE_URL` é o que decide o rótulo que a tela mostra: com `sandbox` no
endereço a oficina lê **SANDBOX**; sem ele, **PRODUÇÃO**. Não existe outro
interruptor, então trocar a URL é trocar de ambiente de verdade.

```sh
docker compose up -d api
```

> Se faltar a chave ou o token, a API **não sobe** e diz qual falta. É de
> propósito: subir com `asaas` pela metade significaria cobrança falhando em
> silêncio.

**4) Apontar o webhook no painel do Asaas**

Em **Integrações → Webhooks → Adicionar**:

| Campo | Valor |
|---|---|
| URL | `https://app.seudominio.com.br/api/v1/webhooks/payments/asaas` |
| Token de autenticação | o mesmo `ASAAS_WEBHOOK_TOKEN` do `.env` |
| Versão da API | v3 |
| Eventos | todos os de **Cobrança** (`PAYMENT_*`) |
| Fila de sincronização | ativada |

Deixe a fila ativada: se a sua API estiver fora do ar por um minuto, o Asaas
reenvia em vez de perder o aviso. O reenvio é seguro — a API reconhece o aviso
repetido e não conta o pagamento duas vezes.

**5) Provar que funciona, no sandbox**

1. Crie uma oficina de teste no OficinaOS e, em **Configurações → Plano**,
   assine um plano (boleto ou Pix).
2. No painel do Asaas sandbox, em **Cobranças**, ache a cobrança da assinatura
   e use **Confirmar recebimento em dinheiro**: é o jeito de simular o
   pagamento sem pagar.
3. Volte na tela de Plano: a assinatura tem de aparecer **ativa sozinha**, sem
   você clicar em nada. Quem confirma é o webhook, nunca a tela.

Se não aparecer, olhe `docker compose logs api | grep "aviso de pagamento"`. A
linha diz se o aviso chegou e o que foi feito com ele.

**6) Virar para produção**

Só depois que o passo 5 funcionou:

```sh
ASAAS_API_KEY='$aact_...'                # chave da conta de PRODUÇÃO, entre aspas simples
ASAAS_BASE_URL=https://api.asaas.com/v3  # sem "sandbox"
```

Gere um `ASAAS_WEBHOOK_TOKEN` **novo** e cadastre o webhook de novo, na conta
de produção — são painéis separados e o do sandbox não vem junto. Reinicie a
API e confira que a tela de Plano deixou de mostrar o aviso de simulação.

> **A conta do Asaas é sua, não de cada oficina.** Por isso ela só recebe a
> assinatura. Quem recebe o dinheiro do cliente final é a oficina: pelo Pix na
> hora com a chave dela (que não passa por gateway nenhum) ou na mão, e ela dá
> baixa no cartão de pagamentos da OS.

---

### 8.2 Depois de qualquer mudança no `.env`

```sh
docker compose up -d api    # recria só a API, com a configuração nova
```

---

## 9. Backup (faça hoje, não depois)

```sh
sudo mkdir -p /var/backups/oficinaos
sudo crontab -e
# 0 3 * * * cd /opt/oficinaos && sh deploy/backup.sh >> /var/log/oficinaos-backup.log 2>&1
```

O `deploy/backup.sh` guarda o banco (`pg_dump -Fc`) e as fotos do check-in,
mantém 14 dias e tem, no fim, as duas linhas para mandar a pasta **para fora
do servidor** — descomente uma. Backup que só existe na mesma máquina morre
junto com ela.

Restaurar é `sh deploy/restore.sh <dump> <fotos.tar.gz>`. **Teste isso uma vez
num servidor de rascunho**: backup que nunca foi restaurado é esperança.

---

## 10. Atualizar a versão

```sh
cd /opt/oficinaos
git pull
docker compose build
docker compose --profile ferramentas run --rm migrate   # se houver migration nova
docker compose up -d
```

Para voltar atrás, marque a versão antes de publicar (`TAG=2026-09-22` no
`.env`) — as imagens antigas continuam no servidor e sobem de novo com o
`TAG` anterior. **Migration não volta sozinha**: se a atualização mexeu no
banco, o caminho de volta é o backup.

---

## 11. O que este deploy ainda não tem

Dito na cara, para ninguém descobrir no dia errado:

- **Sem monitoramento de erro** (Sentry): o erro aparece no log, e o log vive
  no servidor. Está no ROADMAP da Fase 1 de integrações.
- **Sem réplica e sem failover**: um servidor só. Se ele cair, o sistema cai —
  e volta com o backup.
- **Sem CDN**: os arquivos estáticos saem do próprio servidor. Para dezenas de
  oficinas, sobra.
- **Fotos no disco do servidor**, dentro do backup diário. Migrar para
  Cloudflare R2 ou S3 é trocar o driver de storage, e está previsto.
- **Sem pipeline de CI**: o teste roda na sua máquina antes do `git push`.

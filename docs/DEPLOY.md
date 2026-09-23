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
echo "POSTGRES_PASSWORD=$(openssl rand -base64 36)"
echo "APP_DB_PASSWORD=$(openssl rand -base64 36)"
echo "OWNER_DB_PASSWORD=$(openssl rand -base64 36)"
echo "JWT_SECRET=$(openssl rand -base64 48)"

nano .env   # cole os valores e preencha domínios e SMTP
```

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
Professional.

Depois, dentro do painel:

1. **Configurações → Oficina**: CNPJ, endereço, horário e WhatsApp (isso
   aparece no orçamento que o cliente abre).
2. **Configurações → Plano**: assine quando o gateway estiver ligado (§8).
3. **Configurações → Automações**: escolha a hora em que o sistema monta a
   fila do dia.
4. **Configurações → Equipe**: convide quem trabalha com você.

> A oficina de demonstração (`npm run db:seed:demo`) só existe em
> desenvolvimento, de propósito: dado inventado não nasce junto com dado real
> no servidor de quem trabalha.

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

O `/api/v1/health` responde se o processo está vivo; o `/api/v1/ready` só
responde 200 quando o banco também responde. São eles que um monitor externo
(UptimeRobot, BetterStack) deve olhar.

---

## 8. Ligar o que ainda está em simulação

O sistema sobe funcionando, mas três coisas ficam **declaradamente em
simulação** até você contratar as contas — e a tela diz isso em cada uma:

| O quê | O que fazer | Onde |
|---|---|---|
| **E-mail** | contrate SMTP (Resend, SES, Postmark), preencha `EMAIL_DRIVER=smtp` e `SMTP_URL` | `.env` |
| **Cobrança do cliente e assinatura** | crie a conta no Asaas, comece com a chave de **sandbox**: `PAYMENT_GATEWAY=asaas`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`; no painel do Asaas, aponte o webhook para `https://app.seudominio.com.br/api/v1/webhooks/payments/asaas` | `.env` |
| **Nota fiscal** | contrate um emissor de NFS-e, cadastre a oficina lá com o certificado A1, e um driver novo entra no lugar do `simulador` | `.env` + uma etapa de código |

Depois de cada mudança no `.env`:

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

#!/bin/sh
# ---------------------------------------------------------------------------
# Backup do OficinaOS: o banco e as fotos, todo dia.
#
# Rode pelo cron do servidor, como root, da pasta onde está o docker-compose:
#   0 3 * * * cd /opt/oficinaos && sh deploy/backup.sh >> /var/log/oficinaos-backup.log 2>&1
#
# Guarda 14 dias localmente. Backup que só existe no MESMO servidor não é
# backup: mande a pasta para fora (rclone, rsync, S3) — o último trecho mostra
# como, e sai comentado de propósito, porque depende da conta de vocês.
# ---------------------------------------------------------------------------
set -eu

DESTINO="${BACKUP_DIR:-/var/backups/oficinaos}"
DIAS="${BACKUP_KEEP_DAYS:-14}"
CARIMBO="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DESTINO"

echo "[$(date -Is)] backup começando"

# 1) o banco, em formato custom (restaura tabela a tabela se precisar)
docker compose exec -T db pg_dump -U postgres -d oficinaos -Fc \
  > "$DESTINO/oficinaos_$CARIMBO.dump"

# 2) as fotos do check-in e os anexos (o volume `storage` da API)
docker compose run --rm --no-deps -v "$DESTINO:/backup" api \
  tar czf "/backup/storage_$CARIMBO.tar.gz" -C /app/storage .

# 3) o .env NÃO entra aqui: ele tem os segredos, e backup de segredo junto com
#    dado é como perder os dois de uma vez. Guarde-o no seu gerenciador de senhas.

# 4) limpeza do que passou do prazo
find "$DESTINO" -name 'oficinaos_*.dump' -mtime "+$DIAS" -delete
find "$DESTINO" -name 'storage_*.tar.gz' -mtime "+$DIAS" -delete

TAMANHO="$(du -sh "$DESTINO" | cut -f1)"
echo "[$(date -Is)] backup pronto ($TAMANHO em $DESTINO)"

# 5) para fora do servidor — escolha um e descomente:
# rclone copy "$DESTINO" remoto:oficinaos-backup --max-age 25h
# rsync -az "$DESTINO/" backup@outro-servidor:/backups/oficinaos/

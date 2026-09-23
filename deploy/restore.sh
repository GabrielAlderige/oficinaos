#!/bin/sh
# ---------------------------------------------------------------------------
# Restaurar o OficinaOS a partir de um backup.
#
#   sh deploy/restore.sh /var/backups/oficinaos/oficinaos_2026-09-22_0300.dump \
#                        /var/backups/oficinaos/storage_2026-09-22_0300.tar.gz
#
# Backup que nunca foi restaurado é esperança, não backup: faça este teste uma
# vez, num servidor de rascunho, ANTES de precisar dele de verdade.
# ---------------------------------------------------------------------------
set -eu

DUMP="${1:?informe o arquivo .dump do banco}"
FOTOS="${2:-}"

echo "Isto APAGA o banco atual e coloca o do backup no lugar."
printf 'Digite RESTAURAR para continuar: '
read -r resposta
[ "$resposta" = 'RESTAURAR' ] || { echo 'cancelado'; exit 1; }

# a API para de escrever enquanto o banco volta
docker compose stop api

docker compose exec -T db psql -U postgres -d postgres -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'oficinaos'"
docker compose exec -T db dropdb -U postgres --if-exists oficinaos
docker compose exec -T db createdb -U postgres oficinaos

# o dump traz as tabelas, as roles já existem (db-setup) e são referenciadas nele
docker compose exec -T db pg_restore -U postgres -d oficinaos --no-owner --role=oficinaos_owner \
  < "$DUMP"

if [ -n "$FOTOS" ]; then
  docker compose run --rm --no-deps -v "$(dirname "$FOTOS"):/backup" api \
    sh -c "rm -rf /app/storage/* && tar xzf /backup/$(basename "$FOTOS") -C /app/storage"
fi

docker compose start api
echo 'Restaurado. Confira: docker compose logs -f api'

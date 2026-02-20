#!/usr/bin/env bash
set -euo pipefail

# Secure production-to-local database import
# Required:
#   PROD_DATABASE_URL - production Postgres URL
# Optional:
#   LOCAL_DATABASE_URL - local Postgres URL (default: postgresql://localhost/scriptures_db)

if [[ -z "${PROD_DATABASE_URL:-}" ]]; then
  echo "ERROR: PROD_DATABASE_URL is not set"
  echo "Example: export PROD_DATABASE_URL='postgresql://user:pass@host:port/db?sslmode=require'"
  exit 1
fi

LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://localhost/scriptures_db}"
BACKUP_DIR="backups"
TS="$(date +%Y%m%d_%H%M%S)"
PRE_RESET_BACKUP="${BACKUP_DIR}/scriptures_db_pre_import_${TS}.sql"
PROD_DUMP="${BACKUP_DIR}/prod_import_${TS}.sql"

mkdir -p "${BACKUP_DIR}"

echo "[1/4] Backing up local DB to ${PRE_RESET_BACKUP}"
pg_dump "${LOCAL_DATABASE_URL}" > "${PRE_RESET_BACKUP}"

PG_DUMP_BIN="pg_dump"
if [[ -x "/opt/homebrew/opt/postgresql@17/bin/pg_dump" ]]; then
  PG_DUMP_BIN="/opt/homebrew/opt/postgresql@17/bin/pg_dump"
fi

echo "[2/4] Exporting production DB with ${PG_DUMP_BIN}"
"${PG_DUMP_BIN}" "${PROD_DATABASE_URL}" > "${PROD_DUMP}"

if [[ ! -s "${PROD_DUMP}" ]]; then
  echo "ERROR: production dump is empty: ${PROD_DUMP}"
  exit 1
fi

echo "[3/4] Resetting local schema"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "[4/4] Restoring production dump into local"
psql "${LOCAL_DATABASE_URL}" < "${PROD_DUMP}"

echo "Done"
echo "Local backup: ${PRE_RESET_BACKUP}"
echo "Prod dump:    ${PROD_DUMP}"

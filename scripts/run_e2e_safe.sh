#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -n "${PLAYWRIGHT_DATABASE_URL:-}" ]]; then
  TEST_DB_URL="$PLAYWRIGHT_DATABASE_URL"
elif [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  TEST_DB_URL="$TEST_DATABASE_URL"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  TEST_DB_URL="$(python3 - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit

value = os.environ["DATABASE_URL"]
parts = urlsplit(value)
query = f"?{parts.query}" if parts.query else ""
print(urlunsplit(parts._replace(path="/test_scriptures", query=parts.query)))
PY
)"
else
  TEST_DB_URL="postgresql+psycopg2://${USER}@127.0.0.1:5432/test_scriptures"
fi

export TEST_DB_URL

DB_NAME="$(python3 - <<'PY'
import os
from urllib.parse import urlsplit

parts = urlsplit(os.environ["TEST_DB_URL"])
name = (parts.path or "").lstrip("/")
print(name)
PY
)"

if [[ -z "$DB_NAME" || ! "$DB_NAME" =~ ^test ]]; then
  echo "Refusing e2e run against non-test DB name: $DB_NAME ($TEST_DB_URL)"
  exit 1
fi

DB_URL_FOR_PSQL="${TEST_DB_URL/+psycopg2/}"
ADMIN_PSQL_URL="$(DB_URL_FOR_PSQL="$DB_URL_FOR_PSQL" python3 - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit

parts = urlsplit(os.environ["DB_URL_FOR_PSQL"])
print(urlunsplit(parts._replace(path="/postgres")))
PY
)"

DB_EXISTS="$(psql "$ADMIN_PSQL_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | tr -d '[:space:]' || true)"
if [[ "$DB_EXISTS" != "1" ]]; then
  psql "$ADMIN_PSQL_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\""
fi

# Heal known schema drift in reused local test DBs so app bootstrap can run.
psql "$DB_URL_FOR_PSQL" -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE IF EXISTS property_definitions
  ADD COLUMN IF NOT EXISTS is_deprecated BOOLEAN DEFAULT false;
UPDATE property_definitions
SET is_deprecated = false
WHERE is_deprecated IS NULL;
ALTER TABLE IF EXISTS property_definitions
  ALTER COLUMN is_deprecated SET DEFAULT false;
ALTER TABLE IF EXISTS property_definitions
  ALTER COLUMN is_deprecated SET NOT NULL;

ALTER TABLE IF EXISTS categories
  ADD COLUMN IF NOT EXISTS is_deprecated BOOLEAN DEFAULT false;
UPDATE categories
SET is_deprecated = false
WHERE is_deprecated IS NULL;
ALTER TABLE IF EXISTS categories
  ALTER COLUMN is_deprecated SET DEFAULT false;
ALTER TABLE IF EXISTS categories
  ALTER COLUMN is_deprecated SET NOT NULL;
SQL

cd "$ROOT_DIR/web"
export PLAYWRIGHT_DATABASE_URL="$TEST_DB_URL"
export PLAYWRIGHT_REUSE_EXISTING_SERVER="${PLAYWRIGHT_REUSE_EXISTING_SERVER:-0}"
export PYTHON="${PYTHON:-../.venv/bin/python}"

npx playwright test "$@"

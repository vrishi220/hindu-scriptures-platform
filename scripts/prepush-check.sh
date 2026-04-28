#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "${RUN_PREPUSH_CHECKS:-0}" != "1" && "$CURRENT_BRANCH" != "main" ]]; then
  echo "Skipping pre-push checks on branch '$CURRENT_BRANCH' (set RUN_PREPUSH_CHECKS=1 to force)."
  exit 0
fi

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$ROOT_DIR/venv/bin/python"
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python venv not found at $ROOT_DIR/.venv/bin/python or $ROOT_DIR/venv/bin/python"
  echo "Create it first: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  PREPUSH_TEST_DB_URL="$TEST_DATABASE_URL"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  PREPUSH_TEST_DB_URL="$(DATABASE_URL="$DATABASE_URL" "$PYTHON_BIN" - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit

value = os.environ["DATABASE_URL"]
parts = urlsplit(value)
print(urlunsplit(parts._replace(path="/test_scriptures")))
PY
)"
else
  PREPUSH_TEST_DB_URL="postgresql+psycopg2://${USER}@127.0.0.1:5432/test_scriptures"
fi

PREPUSH_TEST_DB_NAME="$(TEST_DATABASE_URL="$PREPUSH_TEST_DB_URL" "$PYTHON_BIN" - <<'PY'
import os
from urllib.parse import urlsplit

parts = urlsplit(os.environ["TEST_DATABASE_URL"])
print((parts.path or "").lstrip("/"))
PY
)"

if [[ -z "$PREPUSH_TEST_DB_NAME" || ! "$PREPUSH_TEST_DB_NAME" =~ ^test ]]; then
  echo "Refusing pre-push checks against non-test DB name: $PREPUSH_TEST_DB_NAME ($PREPUSH_TEST_DB_URL)"
  exit 1
fi

DB_URL_FOR_PSQL="${PREPUSH_TEST_DB_URL/+psycopg2/}"
ADMIN_PSQL_URL="$(DB_URL_FOR_PSQL="$DB_URL_FOR_PSQL" "$PYTHON_BIN" - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit

parts = urlsplit(os.environ["DB_URL_FOR_PSQL"])
print(urlunsplit(parts._replace(path="/postgres")))
PY
)"

DB_EXISTS="$(psql "$ADMIN_PSQL_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$PREPUSH_TEST_DB_NAME'" | tr -d '[:space:]' || true)"
if [[ "$DB_EXISTS" != "1" ]]; then
  psql "$ADMIN_PSQL_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$PREPUSH_TEST_DB_NAME\""
fi

export TEST_DATABASE_URL="$PREPUSH_TEST_DB_URL"

echo "[1/2] Building frontend"
(cd web && npm run build)

echo "[2/2] Running backend/frontend sanity tests"
"$PYTHON_BIN" -m pytest tests/test_backend_sanity.py tests/test_phase1_backend_integration.py tests/test_frontend_sanity.py -q

echo "✅ Pre-push checks passed"

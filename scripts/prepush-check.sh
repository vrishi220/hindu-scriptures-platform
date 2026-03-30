#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "${RUN_PREPUSH_CHECKS:-1}" != "1" ]]; then
  echo "Skipping pre-push checks on branch '$CURRENT_BRANCH' (set RUN_PREPUSH_CHECKS=1 to enable)."
  exit 0
fi

PYTHON_BIN="$ROOT_DIR/venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python venv not found at $PYTHON_BIN"
  echo "Create it first: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

echo "[1/2] Building frontend"
(cd web && npm run build)

echo "[2/2] Running backend/frontend sanity tests"
"$PYTHON_BIN" -m pytest tests/test_backend_sanity.py tests/test_phase1_backend_integration.py tests/test_frontend_sanity.py -q

echo "✅ Pre-push checks passed"

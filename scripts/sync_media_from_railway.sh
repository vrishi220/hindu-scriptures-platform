#!/usr/bin/env bash
set -euo pipefail

# Pull /data/media from a Railway service container into local ./media
#
# Prerequisites:
# - railway CLI installed and authenticated
# - linked to the correct Railway project/environment
#
# Usage:
#   ./scripts/sync_media_from_railway.sh [service-name]
#
# Example:
#   ./scripts/sync_media_from_railway.sh web

SERVICE_NAME="${1:-}"
TS="$(date +%Y%m%d_%H%M%S)"
TMP_TAR="/tmp/railway_media_${TS}.tar.gz"
BACKUP_DIR="media_backup_${TS}"

RAILWAY_BIN="${RAILWAY_BIN:-}"
if [[ -z "$RAILWAY_BIN" ]]; then
  if command -v railway >/dev/null 2>&1; then
    RAILWAY_BIN="$(command -v railway)"
  elif command -v npm >/dev/null 2>&1 && [[ -x "$(npm prefix -g)/bin/railway" ]]; then
    RAILWAY_BIN="$(npm prefix -g)/bin/railway"
  fi
fi

if [[ -z "$RAILWAY_BIN" || ! -x "$RAILWAY_BIN" ]]; then
  echo "ERROR: railway CLI not found in PATH"
  echo "Install: https://docs.railway.com/guides/cli"
  exit 1
fi

SERVICE_ARGS=()
if [[ -n "$SERVICE_NAME" ]]; then
  SERVICE_ARGS+=(--service "$SERVICE_NAME")
fi

echo "[1/5] Exporting /data/media from Railway over SSH..."
"$RAILWAY_BIN" ssh "${SERVICE_ARGS[@]}" "sh -lc '
  set -e
  if [ ! -d /data/media ]; then
    echo "ERROR: /data/media not found in container" >&2
    exit 1
  fi
  tar -C /data -czf - media
'" > "$TMP_TAR"

if [[ ! -s "$TMP_TAR" ]]; then
  echo "ERROR: Downloaded archive is empty"
  exit 1
fi

echo "[2/5] Validating archive..."
tar -tzf "$TMP_TAR" >/dev/null

echo "[3/5] Backing up current local media directory (if present)..."
if [[ -d media ]]; then
  mv media "$BACKUP_DIR"
  echo "Backup created: $BACKUP_DIR"
fi

echo "[4/5] Extracting media archive to project root..."
tar -xzf "$TMP_TAR"

echo "[5/5] Cleaning up temp file..."
rm -f "$TMP_TAR"

if [[ -d media/bank ]]; then
  echo "Done: media synced successfully"
  echo "Local media bank: media/bank"
else
  echo "WARNING: media extracted, but media/bank not found"
  echo "Check extracted structure under ./media"
fi

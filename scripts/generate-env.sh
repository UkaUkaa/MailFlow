#!/bin/sh
# Creates .env from .env.example with freshly generated secrets. Refuses to overwrite.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env already exists; not overwriting." >&2
  exit 1
fi
rand() { python3 -c "import secrets;print(secrets.token_urlsafe(32))"; }
key() { python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"; }
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand)|" \
  -e "s|^MAILFLOW_APP_PASSWORD=.*|MAILFLOW_APP_PASSWORD=$(rand)|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(rand)|" \
  -e "s|^VAULT_KEYS=.*|VAULT_KEYS=k1:$(key)|" \
  .env.example > .env
chmod 600 .env
echo "Wrote .env with generated secrets."

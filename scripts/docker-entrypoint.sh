#!/bin/sh
set -e

SCHEMA="${PRISMA_SCHEMA:-prisma/schema.prisma}"

echo "[entrypoint] pwd=$(pwd)"
echo "[entrypoint] PRISMA_SCHEMA=$SCHEMA"
echo "[entrypoint] DATABASE_URL=$DATABASE_URL"

if [ ! -f "$SCHEMA" ]; then
  echo "[entrypoint] ERROR: Prisma schema not found at $SCHEMA"
  echo "[entrypoint] /app contents:"
  ls -la /app || true
  echo "[entrypoint] /opt/prisma contents:"
  ls -la /opt/prisma || true
  exit 1
fi

./node_modules/.bin/prisma generate --schema="$SCHEMA"
./node_modules/.bin/prisma migrate deploy --schema="$SCHEMA"
exec npm run start

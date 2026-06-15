#!/bin/sh
set -e

echo "[entrypoint] pwd=$(pwd)"
echo "[entrypoint] PRISMA_SCHEMA=${PRISMA_SCHEMA:-/opt/prisma/schema.prisma}"
echo "[entrypoint] DATABASE_URL=$DATABASE_URL"

if [ ! -f "${PRISMA_SCHEMA:-/opt/prisma/schema.prisma}" ]; then
  echo "[entrypoint] ERROR: Prisma schema not found"
  ls -la /opt/prisma || true
  exit 1
fi

npm run db:generate:docker
npm run db:migrate:docker
exec npm run start

#!/bin/sh
set -e

echo "[entrypoint] pwd=$(pwd)"
echo "[entrypoint] DATABASE_URL=$DATABASE_URL"

if [ ! -f prisma/schema.prisma ]; then
  echo "[entrypoint] ERROR: prisma/schema.prisma not found"
  ls -la prisma || true
  exit 1
fi

npm run db:generate:docker
npm run db:migrate:docker
exec npm run start

FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV DATABASE_URL="file:/data/dev.sqlite"
ENV PRISMA_SCHEMA="/opt/prisma/schema.prisma"

RUN mkdir -p /data

COPY package.json package-lock.json* ./

# Install all dependencies (including dev) for the build. NODE_ENV=production
# is set only after build — otherwise Prisma/Vite installs fail.
RUN npm ci && npm cache clean --force

# Keep schema + migrations outside /app so Railway volumes cannot hide them.
COPY prisma /opt/prisma
RUN test -f /opt/prisma/schema.prisma

COPY . .

RUN npm run db:generate:docker \
  && npm run build \
  && npm prune --omit=dev

RUN chmod +x scripts/docker-entrypoint.sh

ENV NODE_ENV=production

CMD ["sh", "scripts/docker-entrypoint.sh"]

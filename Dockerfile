FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV DATABASE_URL="file:/data/dev.sqlite"

RUN mkdir -p /data

COPY package.json package-lock.json* ./

# Install all dependencies for build. NODE_ENV=production is set after build.
RUN npm ci && npm cache clean --force

COPY prisma ./prisma
RUN test -f prisma/schema.prisma

COPY . .

RUN npm run db:generate:docker \
  && npm run build \
  && npm prune --omit=dev

RUN chmod +x scripts/docker-entrypoint.sh

ENV NODE_ENV=production

CMD ["sh", "scripts/docker-entrypoint.sh"]

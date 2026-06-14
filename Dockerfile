FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/dev.sqlite"

RUN mkdir -p /data

COPY package.json package-lock.json* ./

# Install all deps for build (vite is a devDependency), then prune after.
RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build && npm prune --omit=dev

CMD ["npm", "run", "docker-start"]

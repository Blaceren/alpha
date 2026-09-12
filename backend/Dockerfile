FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

FROM builder AS production-deps
RUN npm prune --omit=dev

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=production-deps /app/package.json ./package.json
COPY --from=production-deps /app/package-lock.json ./package-lock.json
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma ./prisma

RUN mkdir -p /app/storage/uploads /data

EXPOSE 3000

CMD ["npm", "run", "start"]

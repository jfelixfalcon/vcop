# Multi-stage build for Astro Operations Center UI
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Production runner
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache kubectl helm bash && \
    mkdir -p /tmp/helm/cache /tmp/helm/config /tmp/helm/data && \
    chown -R node:node /tmp/helm

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV HELM_CACHE_HOME=/tmp/helm/cache
ENV HELM_CONFIG_HOME=/tmp/helm/config
ENV HELM_DATA_HOME=/tmp/helm/data

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]

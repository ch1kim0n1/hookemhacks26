FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy the service's package.json + shared packages
COPY services/api-gateway/package.json services/api-gateway/
COPY packages/stream-client/package.json packages/stream-client/
COPY packages/sentinel-logger/package.json packages/sentinel-logger/
# Install deps
RUN pnpm install --frozen-lockfile
# Copy source
COPY services/api-gateway/ services/api-gateway/
COPY packages/stream-client/ packages/stream-client/
COPY packages/sentinel-logger/ packages/sentinel-logger/
# Build
RUN pnpm --filter @sentinel/logger build && pnpm --filter @sentinel/stream-client build && pnpm --filter @sentinel/api-gateway build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
COPY --from=build /app/services/api-gateway/dist ./dist
COPY --from=build /app/services/api-gateway/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
USER sentinel
EXPOSE 8080 8081
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:8080/api/v1/health || exit 1
CMD ["node", "dist/index.js"]

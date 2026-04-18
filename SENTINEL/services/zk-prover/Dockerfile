FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy the service's package.json + shared package
COPY services/zk-prover/package.json services/zk-prover/
COPY packages/stream-client/package.json packages/stream-client/
# Install deps
RUN pnpm install --frozen-lockfile
# Copy source
COPY services/zk-prover/ services/zk-prover/
COPY packages/stream-client/ packages/stream-client/
# Build
RUN pnpm --filter @sentinel/stream-client build && pnpm --filter @sentinel/zk-prover build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
COPY --from=build /app/services/zk-prover/dist ./dist
COPY --from=build /app/services/zk-prover/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
USER sentinel
EXPOSE 9100
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:9100/health || exit 1
CMD ["node", "dist/index.js"]

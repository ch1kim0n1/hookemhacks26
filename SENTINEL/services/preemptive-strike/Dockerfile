FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/stream-client/package.json packages/stream-client/
COPY services/preemptive-strike/package.json services/preemptive-strike/
RUN pnpm install --frozen-lockfile
COPY services/preemptive-strike/ services/preemptive-strike/
COPY packages/stream-client/ packages/stream-client/
RUN pnpm --filter @sentinel/stream-client build && pnpm --filter @sentinel/preemptive-strike build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
COPY --from=build /app/services/preemptive-strike/dist ./dist
COPY --from=build /app/services/preemptive-strike/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
USER sentinel
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:9006/health || exit 1
CMD ["node", "dist/index.js"]

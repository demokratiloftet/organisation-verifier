FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /fixture
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY *.ts tsconfig.json ./
RUN pnpm build && pnpm prune --prod

FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532
WORKDIR /fixture
COPY --from=build /fixture/node_modules ./node_modules
COPY --from=build /fixture/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/server.js"]

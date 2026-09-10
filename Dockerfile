# Runs the @lab/server workspace directly from TypeScript source via tsx (same as
# `npm run dev -w server`) rather than through `npm run build`, since the `shared`
# workspace has no build script - it's consumed as raw TS by both tsx and Vite, and
# the root "build" script currently errors on it (missing script, pre-existing).
FROM node:22-bookworm-slim

# better-sqlite3 compiles a native addon on install; this base image has no compiler.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy just the workspace manifests first so `npm ci` is cached across source-only edits.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN npm ci

# Only the workspaces the server actually needs at runtime. client/public is included
# because mapMeta.ts reads the Tiled map straight from it (client/src is not needed).
COPY shared shared
COPY server server
COPY client/public client/public

WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]

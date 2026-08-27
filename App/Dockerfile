# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Force development mode so npm ci installs ALL deps including devDependencies.
# CI/CD systems (Coolify, GitHub Actions) often inject NODE_ENV=production at
# build time, which causes npm to silently omit devDeps — breaking the NestJS
# CLI and TypeScript compiler. This ENV is scoped to this stage only.
ENV NODE_ENV=development

# Install dependencies first (layer cache)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Install only production deps.
# argon2 requires a native addon compiled from C. Alpine uses musl libc so
# there are no prebuilt musl binaries on npm — we must compile from source.
# Adding build tools, compiling, then deleting them in ONE layer keeps the
# final image small while producing a working native binary.
COPY package*.json ./
COPY prisma ./prisma/

RUN apk add --no-cache python3 make g++ openssl && \
    npm ci --only=production && \
    npx prisma generate && \
    npm cache clean --force && \
    apk del python3 make g++
# ↑ openssl is intentionally kept after the del — the Prisma query engine
#   (linux-musl-openssl-3.0.x) links against libssl.so.3 / libcrypto.so.3
#   at runtime.  Removing it causes Prisma to fall back to the WASM engine
#   which only accepts prisma:// URLs, crashing the app immediately.

# Copy build output
COPY --from=builder /app/dist ./dist

# Storage directory (for local file uploads, mount a volume in production)
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 3000

# Run migrations then start
CMD ["sh", "-c", \
  "echo '[NGHome-API] === Starting migration ===' && \
   npx prisma migrate deploy && \
   echo '[NGHome-API] === Migration complete. Starting application ===' && \
   exec node dist/src/main"]

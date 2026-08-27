# ─── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Force development mode so npm ci installs ALL deps including devDependencies.
# Coolify (and CI systems) may inject NODE_ENV=production as a build arg which
# causes npm to silently skip devDeps — breaking the TypeScript/webpack build.
ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci

# ─── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Accept public env vars at build time so Next.js can bake them into the bundle.
# NEXT_PUBLIC_* vars are embedded in the JS bundle at compile time — they must
# be available during `npm run build`, not just at runtime.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure public/ exists — Next.js projects don't require it, but Docker's COPY
# fails if the source path is absent. Creating it here guarantees the runner
# stage COPY --from=builder /app/public ./public always succeeds.
RUN mkdir -p /app/public

# Build with standalone output (set in next.config.mjs)
RUN npm run build

# ─── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy only what Next.js standalone needs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

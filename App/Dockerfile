# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

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

# Install only production deps
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production --ignore-scripts && \
    npx prisma generate && \
    npm cache clean --force

# Copy build output
COPY --from=builder /app/dist ./dist

# Storage directory (for local file uploads, mount a volume in production)
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 3000

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]

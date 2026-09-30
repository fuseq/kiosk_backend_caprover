# ============================================
# Inmapper Kiosk Backend - Production Dockerfile
# Node.js + MongoDB Application
# ============================================

FROM node:20-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# ============================================
# Dependencies stage
# ============================================
FROM base AS deps

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# ============================================
# Production stage
# ============================================
FROM base AS production

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application files
COPY --chown=nodejs:nodejs . .

# Venue haritaları GCS'te tutulur (VENUE_ASSETS_BUCKET); Cloud Run diski
# efemeral olduğu için yerel bir storage dizini oluşturulmaz.

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Cloud Run kendi startup/liveness probe'larını yönetir; Docker HEALTHCHECK
# yok sayılır.

# Start application with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

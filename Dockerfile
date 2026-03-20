# Build stage
FROM node:20-alpine AS builder

# Install pnpm via corepack
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@latest && corepack enable

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN corepack install

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN pnpm run build

# Production stage
FROM node:20-alpine

# Install pnpm via corepack
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@latest && corepack enable

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN corepack install

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy discovery responder
COPY mcp-announce.js ./

# Copy web files
COPY web/ ./web/

# Copy example config
COPY config.example.json ./config.example.json

# Create data directory
RUN mkdir -p /app/data

# Default config path
ENV CONFIG_PATH=/app/data/config.json
ENV NODE_ENV=production

# Expose port
EXPOSE 9054

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9054/api/status || exit 1

# Run the application
CMD ["node", "dist/index.js"]

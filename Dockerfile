# Multi-stage build for optimal image size
FROM node:24-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY *.ts ./

# Build the project
RUN npm run build

# Production image
FROM node:24-slim AS production

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN useradd -r -u 1001 -g node mcpuser && \
    chown -R mcpuser:node /app

USER mcpuser

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Start server
CMD ["node", "dist/index.js"]

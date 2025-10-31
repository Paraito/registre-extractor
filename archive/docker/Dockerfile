FROM node:20-slim

# Install dependencies for Playwright and OCR (ImageMagick + poppler-utils)
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    imagemagick \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Install Playwright browsers with system dependencies (as root)
# This installs both the browser binaries AND required system dependencies
RUN npx playwright install --with-deps chromium

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Set environment
ENV NODE_ENV=production

# Create non-root user
RUN groupadd -r extractor && useradd -r -g extractor extractor

# CRITICAL FIX: Set browser path BEFORE copying to ensure consistency
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright

# Copy Playwright browsers from root cache to app directory with proper permissions
# Use -L to follow symlinks and ensure all files are copied
RUN mkdir -p /app/.cache && \
    if [ -d /root/.cache/ms-playwright ]; then \
      cp -rL /root/.cache/ms-playwright /app/.cache/ && \
      chown -R extractor:extractor /app/.cache; \
    else \
      echo "WARNING: Playwright browsers not found in /root/.cache/ms-playwright" && \
      ls -la /root/.cache/ || echo "No /root/.cache directory"; \
    fi

# Ensure app directory has correct permissions
RUN chown -R extractor:extractor /app

# Note: Downloads will use /tmp which is always writable by all users

# Switch to non-root user
USER extractor

# Verify browser installation (this will fail build if browsers aren't accessible)
RUN npx playwright install --dry-run chromium || \
    (echo "ERROR: Playwright browsers not accessible to non-root user" && exit 1)

# Start worker
CMD ["node", "dist/worker/index.js"]


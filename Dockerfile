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

# Create non-root user and set up permissions
RUN groupadd -r extractor && useradd -r -g extractor extractor

# Create downloads directory with proper permissions
RUN mkdir -p /app/downloads && \
    chmod 777 /app/downloads

# CRITICAL: Copy Playwright browsers from root cache to app directory
# This ensures the non-root user can access them
RUN mkdir -p /app/.cache && \
    cp -r /root/.cache/ms-playwright /app/.cache/ && \
    chown -R extractor:extractor /app

# Set Playwright to use the app cache directory
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright

# Switch to non-root user
USER extractor

# Start worker
CMD ["node", "dist/worker/index.js"]


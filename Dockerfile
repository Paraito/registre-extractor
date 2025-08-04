FROM node:20-slim

# Install dependencies for Playwright
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Install Playwright browsers
RUN npx playwright install chromium

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Create downloads directory
RUN mkdir -p /app/downloads

# Set environment
ENV NODE_ENV=production

# Run as non-root user
RUN groupadd -r extractor && useradd -r -g extractor extractor
RUN chown -R extractor:extractor /app
USER extractor

# Start worker
CMD ["node", "dist/worker/index.js"]
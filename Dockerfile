# tapsite — MCP server for web intelligence extraction
# Base image includes Chromium + all system dependencies for Playwright
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Install production dependencies first (layer cached until package.json changes)
COPY package*.json ./
RUN npm ci --production

# Copy source (excludes paths listed in .dockerignore)
COPY src/ src/

# Drop to the non-root user that ships with the Playwright base image
USER pwuser

# MCP servers communicate over stdio, not HTTP — no EXPOSE needed
CMD ["node", "src/mcp-server.js"]

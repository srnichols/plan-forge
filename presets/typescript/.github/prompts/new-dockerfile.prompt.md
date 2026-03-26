---
description: "Scaffold a multi-stage Dockerfile for Node.js/TypeScript with optimized layer caching, non-root user, and distroless runtime."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold a production-grade multi-stage Dockerfile for a Node.js/TypeScript application.

## Required Pattern

### Multi-Stage Dockerfile
```dockerfile
# ---- Build Stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ---- Production Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- Runtime Stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

# Security: run as non-root (node user exists in node images)
USER node

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

### .dockerignore
```
node_modules/
dist/
.env
.env.*
*.md
.git/
.gitignore
.vscode/
coverage/
Dockerfile*
.dockerignore
```

### Docker Compose (Development)
```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://postgres:postgres@db:5432/mydb
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

## Rules

- ALWAYS use multi-stage builds — separate build, deps, and runtime stages
- ALWAYS use Alpine-based images for smaller attack surface
- ALWAYS run as non-root (`USER node` in official Node images)
- ALWAYS copy `package.json`/`package-lock.json` first for layer caching
- ALWAYS use `npm ci` (not `npm install`) for reproducible builds
- ALWAYS include a HEALTHCHECK instruction
- ALWAYS create a `.dockerignore` to exclude `node_modules`, `.env`, and build artifacts
- NEVER store secrets in the image — use environment variables or mounted secrets
- Use `--ignore-scripts` to prevent arbitrary script execution during install

## Reference Files

- [Deploy patterns](../instructions/deploy.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

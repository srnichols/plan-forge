---
description: "Scaffold a multi-stage Dockerfile for .NET with optimized layer caching, non-root user, and distroless runtime."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold a production-grade multi-stage Dockerfile for a .NET application.

## Required Pattern

### Multi-Stage Dockerfile
```dockerfile
# ---- Build Stage ----
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src

# Copy csproj files first for layer caching
COPY *.sln ./
COPY src/{ProjectName}/*.csproj src/{ProjectName}/
COPY tests/{ProjectName}.Tests/*.csproj tests/{ProjectName}.Tests/
RUN dotnet restore

# Copy everything else and build
COPY . .
RUN dotnet publish src/{ProjectName}/{ProjectName}.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# ---- Runtime Stage ----
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
WORKDIR /app

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=build /app/publish .

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV DOTNET_EnableDiagnostics=0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENTRYPOINT ["dotnet", "{ProjectName}.dll"]
```

### .dockerignore
```
**/bin/
**/obj/
**/node_modules/
**/.vs/
**/.vscode/
**/Dockerfile*
**/.dockerignore
**/.git
**/.gitignore
*.md
```

### Docker Compose (Development)
```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__Default=Host=db;Database=mydb;Username=postgres;Password=postgres
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

- ALWAYS use multi-stage builds — never ship the SDK in production images
- ALWAYS use Alpine-based images for smaller attack surface and image size
- ALWAYS run as a non-root user in production
- ALWAYS copy `.csproj`/`.sln` first for layer caching before `COPY . .`
- ALWAYS include a HEALTHCHECK instruction
- ALWAYS create a `.dockerignore` to exclude build artifacts and secrets
- NEVER store secrets in the image — use environment variables or mounted secrets
- Use `--no-restore` on `dotnet publish` when restore was done separately

## Reference Files

- [Deploy patterns](../instructions/deploy-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

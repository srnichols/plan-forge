---
description: .NET deployment patterns — Docker, Kubernetes, CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml,**/k8s/**'
---

# .NET Deployment Patterns

## Docker

### Multi-stage Dockerfile
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY *.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENTRYPOINT ["dotnet", "YourApp.dll"]
```

### Docker Compose
```yaml
services:
  api:
    build: .
    ports:
      - "5000:8080"
    environment:
      - ConnectionStrings__Default=Host=db;Database=app;Username=app;Password=secret
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
```

## Build Commands

| Command | Purpose |
|---------|---------|
| `dotnet build` | Compile the solution |
| `dotnet test` | Run all tests |
| `dotnet test --filter "Category=Unit"` | Unit tests only |
| `dotnet publish -c Release` | Build for deployment |
| `docker compose up -d` | Start all services |

## Health Checks

```csharp
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString)
    .AddRedis(redisConnectionString);

app.MapHealthChecks("/health");

## See Also

- `multi-environment.instructions.md` — Per-environment configuration
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS
```

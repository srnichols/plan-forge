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
    image: postgres:18
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

## Database Migration Deployment

**Migrations MUST run before the new app version starts serving traffic.**

### Pipeline Order
```
1. Build & test ──► 2. Run migrations ──► 3. Health check ──► 4. Deploy app ──► 5. Smoke test
                         ▲                     ▲
                    Fail = abort           Fail = rollback
```

### Docker Compose (Development)
```yaml
services:
  migrate:
    build: .
    command: ["dotnet", "ef", "database", "update", "--project", "src/MyApp.Data"]
    environment:
      - ConnectionStrings__Default=Host=db;Database=app;Username=app;Password=secret
    depends_on:
      db:
        condition: service_healthy
  api:
    build: .
    depends_on:
      migrate:
        condition: service_completed_successfully   # App starts only after migration succeeds
```

### CI/CD Pipeline Step
```bash
# Generate and review idempotent SQL
dotnet ef migrations script --idempotent -o migrations.sql --project src/MyApp.Data

# Apply to target environment
dotnet ef database update --project src/MyApp.Data
```

- **NEVER** deploy app code before migrations complete
- **ALWAYS** have a rollback plan — see `database.instructions.md` for rollback procedures
- **ALWAYS** backup before applying migrations to production

## Graceful Shutdown

```csharp
// Program.cs — ASP.NET handles SIGTERM via IHostApplicationLifetime
var app = builder.Build();

app.Lifetime.ApplicationStopping.Register(() =>
{
    Log.Information("Shutting down — draining in-flight requests...");
    // Flush telemetry, close connections, complete background tasks
});

// Configure shutdown timeout (default 30s)
builder.Services.Configure<HostOptions>(opts => opts.ShutdownTimeout = TimeSpan.FromSeconds(30));
```

- **ALWAYS** handle `ApplicationStopping` to flush logs, close DB connections, and drain queues
- **NEVER** use `Environment.Exit()` — let the host manage shutdown
- Kubernetes sends SIGTERM → waits `terminationGracePeriodSeconds` → SIGKILL

## Blue-Green / Canary Deployments

### Kubernetes Rolling Update (Default)
```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0   # Zero-downtime
```

### Canary with Traffic Splitting
```yaml
# Use a service mesh (Istio/Linkerd) or ingress controller for weighted routing
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: api
            subset: stable
          weight: 90
        - destination:
            host: api
            subset: canary
          weight: 10
```

- **ALWAYS** ensure database migrations are backward-compatible for blue-green
- **ALWAYS** use health checks as deployment gates
- Roll back immediately if error rate exceeds threshold

---

## See Also

- `database.instructions.md` — Migration strategy, expand-contract, rollback procedures
- `dapr.instructions.md` — Dapr sidecar deployment, component configuration
- `multi-environment.instructions.md` — Per-environment configuration, migration config per env
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS

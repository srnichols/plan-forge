---
description: Java deployment patterns — Docker, Kubernetes, Gradle/Maven CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml,**/k8s/**'
---

# Java Deployment Patterns

## Docker

### Multi-stage Dockerfile (Gradle)
```dockerfile
FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY gradle/ gradle/
COPY gradlew build.gradle settings.gradle ./
RUN ./gradlew dependencies --no-daemon
COPY src/ src/
RUN ./gradlew bootJar --no-daemon

FROM eclipse-temurin:25-jre AS runtime
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Multi-stage Dockerfile (Maven)
```dockerfile
FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src/ src/
RUN mvn package -DskipTests

FROM eclipse-temurin:25-jre AS runtime
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Docker Compose
```yaml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/app
      - SPRING_DATASOURCE_USERNAME=app
      - SPRING_DATASOURCE_PASSWORD=secret
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

| Command (Gradle) | Command (Maven) | Purpose |
|-------------------|-----------------|---------|
| `./gradlew build` | `mvn clean install` | Compile + test |
| `./gradlew test` | `mvn test` | Run all tests |
| `./gradlew bootJar` | `mvn package` | Build JAR |
| `./gradlew bootRun` | `mvn spring-boot:run` | Start app |
| `docker compose up -d` | `docker compose up -d` | Start all services |

## Health Checks

```java
@Component
public class DatabaseHealthIndicator implements HealthIndicator {
    
    private final DataSource dataSource;

    @Override
    public Health health() {
        try (var conn = dataSource.getConnection()) {
            return Health.up().build();
        } catch (SQLException e) {
            return Health.down(e).build();
        }
    }
}
```

Spring Boot Actuator provides `/actuator/health` automatically:
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
```

## JVM Tuning for Containers

```dockerfile
ENTRYPOINT ["java", \
    "-XX:+UseG1GC", \
    "-XX:MaxRAMPercentage=75.0", \
    "-XX:+UseContainerSupport", \
    "-jar", "app.jar"]
```

## Database Migration Deployment

**Migrations MUST run before the app starts serving traffic.** Flyway runs automatically on Spring Boot startup (default behavior), or as a separate pipeline step.

### Pipeline Order
```
1. Build & test ──► 2. Run migrations ──► 3. Health check ──► 4. Deploy app ──► 5. Smoke test
                         ▲                     ▲
                    Fail = abort           Fail = rollback
```

### Option A: Spring Boot Auto-Migration (Default)
```yaml
# application.yml — Flyway runs before the app serves requests
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
```

### Option B: Separate Pipeline Step
```bash
# Validate migrations match applied state
mvn flyway:validate

# Apply pending migrations
mvn flyway:migrate -Dflyway.url=$DATABASE_URL -Dflyway.user=$DB_USER -Dflyway.password=$DB_PASSWORD

# Check status
mvn flyway:info
```

### Docker Compose (Development)
```yaml
services:
  migrate:
    build: .
    entrypoint: ["java", "-jar", "app.jar", "--spring.main.web-application-type=none"]
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/app
      - SPRING_DATASOURCE_USERNAME=app
      - SPRING_DATASOURCE_PASSWORD=secret
    depends_on:
      db:
        condition: service_healthy
  api:
    build: .
    depends_on:
      migrate:
        condition: service_completed_successfully
```

- **NEVER** deploy app code before migrations complete
- **NEVER** edit a Flyway migration that has already been applied
- **ALWAYS** have a rollback plan — see `database.instructions.md` for rollback procedures

## Graceful Shutdown

```java
// Spring Boot handles SIGTERM gracefully by default
// application.yml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

```java
@Component
public class CleanupService {

    @PreDestroy
    public void onShutdown() {
        log.info("Shutting down — flushing buffers and closing connections...");
        // Flush async logs, close external clients, drain message listeners
    }
}
```

- **ALWAYS** set `server.shutdown=graceful` in production
- **ALWAYS** use `@PreDestroy` for cleanup logic (not shutdown hooks)
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

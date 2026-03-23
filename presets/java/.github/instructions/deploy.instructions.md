---
description: Java deployment patterns — Docker, Kubernetes, Gradle/Maven CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml,**/k8s/**'
---

# Java Deployment Patterns

## Docker

### Multi-stage Dockerfile (Gradle)
```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradle/ gradle/
COPY gradlew build.gradle settings.gradle ./
RUN ./gradlew dependencies --no-daemon
COPY src/ src/
RUN ./gradlew bootJar --no-daemon

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Multi-stage Dockerfile (Maven)
```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src/ src/
RUN mvn package -DskipTests

FROM eclipse-temurin:21-jre AS runtime
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
    image: postgres:16
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

## See Also

- `dapr.instructions.md` — Dapr sidecar deployment, component configuration
- `multi-environment.instructions.md` — Per-environment configuration
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS
```

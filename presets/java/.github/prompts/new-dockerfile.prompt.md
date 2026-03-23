---
description: "Scaffold a multi-stage Dockerfile for Java/Spring Boot with Gradle/Maven, distroless runtime, and layered JARs."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold a production-grade multi-stage Dockerfile for a Java/Spring Boot application.

## Required Pattern

### Multi-Stage Dockerfile (Gradle)
```dockerfile
# ---- Build Stage ----
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Copy Gradle wrapper and config first for layer caching
COPY gradle/ gradle/
COPY gradlew build.gradle.kts settings.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

# Copy source and build
COPY src/ src/
RUN ./gradlew bootJar --no-daemon -x test

# Extract Spring Boot layers for optimized caching
RUN java -Djarmode=layertools -jar build/libs/*.jar extract --destination /extracted

# ---- Runtime Stage ----
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Copy layers in order of least to most frequently changed
COPY --from=build /extracted/dependencies/ ./
COPY --from=build /extracted/spring-boot-loader/ ./
COPY --from=build /extracted/snapshot-dependencies/ ./
COPY --from=build /extracted/application/ ./

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "org.springframework.boot.loader.launch.JarLauncher"]
```

### Multi-Stage Dockerfile (Maven)
```dockerfile
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

COPY pom.xml mvnw ./
COPY .mvn/ .mvn/
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

COPY src/ src/
RUN ./mvnw package -B -DskipTests

RUN java -Djarmode=layertools -jar target/*.jar extract --destination /extracted

FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=build /extracted/dependencies/ ./
COPY --from=build /extracted/spring-boot-loader/ ./
COPY --from=build /extracted/snapshot-dependencies/ ./
COPY --from=build /extracted/application/ ./

EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "org.springframework.boot.loader.launch.JarLauncher"]
```

### .dockerignore
```
target/
build/
.gradle/
*.md
.git/
.gitignore
.vscode/
.idea/
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
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=dev
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/mydb
      - SPRING_DATASOURCE_USERNAME=postgres
      - SPRING_DATASOURCE_PASSWORD=postgres
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

- ALWAYS use multi-stage builds — never ship the JDK in production images
- ALWAYS use Spring Boot layered JARs (`-Djarmode=layertools extract`) for optimal layer caching
- ALWAYS use JRE-only images for runtime (not JDK)
- ALWAYS run as a non-root user in production
- ALWAYS copy build config first for dependency layer caching
- ALWAYS include JVM container-aware flags (`-XX:+UseContainerSupport`, `-XX:MaxRAMPercentage`)
- ALWAYS include a HEALTHCHECK (use `/actuator/health`)
- NEVER store secrets in the image — use environment variables or mounted secrets

## Reference Files

- [Deploy patterns](../instructions/deploy-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

---
description: "Scaffold @ConfigurationProperties classes with validation, Spring profiles, and type-safe binding."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Properties

Scaffold a type-safe configuration class bound from `application.yml` using `@ConfigurationProperties`.

## Required Pattern

### Configuration Properties Class
```java
@Validated
@ConfigurationProperties(prefix = "{section-name}")
public record {SectionName}Properties(
    @NotBlank String baseUrl,
    @NotBlank String apiKey,
    @Min(1) @Max(300) int timeoutSeconds,
    @Min(0) int retryCount
) {
    public {SectionName}Properties {
        // Compact constructor for defaults
        if (timeoutSeconds == 0) timeoutSeconds = 30;
        if (retryCount == 0) retryCount = 3;
    }
}
```

### Enable Configuration Properties
```java
@Configuration
@EnableConfigurationProperties({SectionName}Properties.class)
public class {SectionName}Config {

    @Bean
    public SomeClient someClient({SectionName}Properties props) {
        return SomeClient.builder()
            .baseUrl(props.baseUrl())
            .apiKey(props.apiKey())
            .timeout(Duration.ofSeconds(props.timeoutSeconds()))
            .build();
    }
}
```

### application.yml
```yaml
{section-name}:
  base-url: https://api.example.com
  api-key: ${API_KEY:}  # From environment variable
  timeout-seconds: 30
  retry-count: 3
```

### Profile-Specific Override (application-prod.yml)
```yaml
{section-name}:
  api-key: ${API_KEY}  # Required in prod — no default
  timeout-seconds: 15
```

### Nested Configuration
```yaml
app:
  database:
    url: jdbc:postgresql://localhost:5432/mydb
    pool-size: 10
  cache:
    ttl-seconds: 300
    max-size: 1000
```
```java
@ConfigurationProperties(prefix = "app")
public record AppProperties(
    DatabaseProperties database,
    CacheProperties cache
) {
    public record DatabaseProperties(
        @NotBlank String url,
        @Min(1) int poolSize
    ) {}

    public record CacheProperties(
        @Min(1) int ttlSeconds,
        @Min(1) int maxSize
    ) {}
}
```

### Injection
```java
@Service
public class MyService {
    private final {SectionName}Properties properties;

    public MyService({SectionName}Properties properties) {
        this.properties = properties;
    }
}
```

## Rules

- ALWAYS use `@ConfigurationProperties` — never `@Value` for structured config
- ALWAYS add `@Validated` + Bean Validation annotations — fail fast on startup
- NEVER store secrets in `application.yml` — use environment variables or Vault
- Use `record` types for configuration classes (immutable)
- Use `kebab-case` for property names in YAML (Spring relaxed binding handles it)
- Use Spring profiles (`application-{profile}.yml`) for environment-specific overrides
- Keep config classes in a `config/` or `properties/` package

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)

---
description: Java security patterns — Spring Security, input validation, secrets management
applyTo: '**/*.java,**/application*.yml,**/application*.properties'
---

# Java Security Patterns

## Authentication & Authorization

### Spring Security Configuration
```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.ignoringRequestMatchers("/api/**"))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**", "/health").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
            .build();
    }
}
```

### Method-Level Security
```java
@Service
public class UserService {

    @PreAuthorize("hasRole('ADMIN') or #userId == authentication.principal.id")
    public UserDto getUser(UUID userId) { ... }
}
```

## Input Validation

### Always validate at controller boundaries
```java
// ❌ NEVER: Trust input
@PostMapping("/users")
public User createUser(@RequestBody CreateUserRequest request) { ... }

// ✅ ALWAYS: Validate with @Valid
@PostMapping("/users")
public User createUser(@Valid @RequestBody CreateUserRequest request) { ... }

// ✅ Request DTO with validation annotations
public record CreateUserRequest(
    @NotBlank(message = "Name is required")
    @Size(max = 255)
    String name,

    @NotBlank(message = "Email is required")
    @Email(message = "Invalid email format")
    String email
) {}
```

### Custom Validation
```java
@Documented
@Constraint(validatedBy = TenantIdValidator.class)
@Target({FIELD, PARAMETER})
@Retention(RUNTIME)
public @interface ValidTenantId {
    String message() default "Invalid tenant ID";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

## Secrets Management

```java
// ❌ NEVER: Hardcoded secrets
String dbPassword = "secret123";

// ✅ ALWAYS: Externalized configuration
@Value("${spring.datasource.password}")
private String dbPassword;

// ✅ BEST: Environment variables or secret manager
// application.yml:
// spring.datasource.password: ${DB_PASSWORD}
```

## SQL Injection Prevention

```java
// ❌ NEVER: String concatenation
String sql = "SELECT * FROM users WHERE id = '" + id + "'";

// ✅ ALWAYS: Parameterized
String sql = "SELECT * FROM users WHERE id = ?";
jdbcTemplate.queryForObject(sql, rowMapper, id);
```

## CORS Configuration

```java
@Configuration
public class CorsConfig {

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                    .allowedOrigins("https://yourdomain.com")
                    .allowedMethods("GET", "POST", "PUT", "DELETE")
                    .allowedHeaders("*");
            }
        };
    }
}
```

## Rate Limiting

```java
// Using Bucket4j with Spring Boot
@Configuration
public class RateLimitConfig {

    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilter() {
        var registration = new FilterRegistrationBean<RateLimitFilter>();
        registration.setFilter(new RateLimitFilter());
        registration.addUrlPatterns("/api/*");
        return registration;
    }
}

public class RateLimitFilter extends OncePerRequestFilter {
    private final Map<String, Bucket> tenantBuckets = new ConcurrentHashMap<>();

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String key = extractTenantId(request);
        Bucket bucket = tenantBuckets.computeIfAbsent(key, k ->
            Bucket.builder()
                .addLimit(Bandwidth.classic(100, Refill.intervally(100, Duration.ofMinutes(1))))
                .build());

        if (bucket.tryConsume(1)) {
            chain.doFilter(request, response);
        } else {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.getWriter().write("{\"title\":\"Too Many Requests\",\"status\":429}");
        }
    }
}
```

## Security Headers

```java
@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("X-XSS-Protection", "0");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
        response.setHeader("Strict-Transport-Security",
            "max-age=31536000; includeSubDomains");
        chain.doFilter(request, response);
    }
}

// Or via Spring Security:
// http.headers(h -> h.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'")));
```

## Common Vulnerabilities to Prevent

| Vulnerability | Prevention |
|--------------|------------|
| SQL Injection | Parameterized queries only |
| XSS | Response encoding, CSP headers |

## OWASP Top 10 (2021) Alignment

| OWASP Category | How This File Addresses It |
|----------------|----------------------------|
| A01: Broken Access Control | Spring Security filter chain, `@PreAuthorize` |
| A02: Cryptographic Failures | Externalized secrets via `${ENV_VAR}`, no hardcoded passwords |
| A03: Injection | `@Valid` + Bean Validation, parameterized `@Query` |
| A04: Insecure Design | Custom validators, record DTOs with constraints |
| A05: Security Misconfiguration | CORS allowlist, CSRF protection, OAuth2 resource server |
| A07: Identification & Auth Failures | JWT with `oauth2ResourceServer()`, method-level security |

## See Also

- `auth.instructions.md` — Spring Security, JWT/OIDC, method security, multi-tenant, API keys
- `graphql.instructions.md` — GraphQL authorization, @PreAuthorize on resolvers
- `dapr.instructions.md` — Dapr secrets management, component scoping, mTLS
- `database.instructions.md` — SQL injection prevention, parameterized queries
- `api-patterns.instructions.md` — Auth middleware, request validation
- `deploy.instructions.md` — Secrets management, TLS configuration
| CSRF | Spring Security CSRF tokens |
| Mass Assignment | Use DTOs, never bind directly to entities |
| Insecure Deserialization | Validate input types, use records |

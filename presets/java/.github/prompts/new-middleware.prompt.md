---
description: "Scaffold a Spring filter or interceptor with request/response hooks, DI support, and proper ordering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware (Filter / Interceptor)

Scaffold a Spring HTTP filter or interceptor for the request pipeline.

## Required Pattern

### OncePerRequestFilter (Recommended)
```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)  // Adjust ordering
public class {Name}Filter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger({Name}Filter.class);

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {

        // Pre-processing
        long start = System.nanoTime();

        try {
            chain.doFilter(request, response);
        } finally {
            // Post-processing (always runs)
            long duration = (System.nanoTime() - start) / 1_000_000;
            log.info("{} {} -> {} ({}ms)",
                request.getMethod(), request.getRequestURI(),
                response.getStatus(), duration);
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // Skip health/actuator endpoints
        return request.getRequestURI().startsWith("/actuator");
    }
}
```

### HandlerInterceptor (Controller-Level)
```java
@Component
public class {Name}Interceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // Before controller invocation — return false to short-circuit
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        // After response committed — cleanup resources
    }
}

// Register in WebMvcConfigurer
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new {Name}Interceptor())
            .addPathPatterns("/api/**")
            .excludePathPatterns("/actuator/**");
    }
}
```

## Registration & Ordering

```java
// Filter ordering via @Order annotation:
// HIGHEST_PRECEDENCE    → Correlation ID (outermost)
// HIGHEST_PRECEDENCE+5  → Request logging
// HIGHEST_PRECEDENCE+10 → Security headers
// 0 (default)           → Spring Security filters
// LOWEST_PRECEDENCE     → Response compression (innermost)
```

## Common Middleware Types

| Type | Pattern | Purpose |
|------|---------|---------|
| Correlation ID | `OncePerRequestFilter` | `MDC.put("correlationId", ...)` |
| Tenant Resolution | `OncePerRequestFilter` | Extract from JWT, set in `ThreadLocal` |
| Request Logging | `OncePerRequestFilter` | Log method, URI, status, duration |
| Rate Limiting | `OncePerRequestFilter` | Bucket4j per-tenant throttling |

## Rules

- Filters handle cross-cutting concerns ONLY — no business logic
- Use `OncePerRequestFilter` for most cases (guaranteed single execution)
- Use `HandlerInterceptor` when you need access to the `handler` (controller method)
- ALWAYS call `chain.doFilter()` unless intentionally short-circuiting
- Use `@Order` to control filter execution sequence
- Use `shouldNotFilter()` to skip health/actuator endpoints

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

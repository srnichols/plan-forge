---
description: Observability patterns for Java — OpenTelemetry, SLF4J/Logback, Micrometer, Actuator health checks
applyTo: '**/*Log*.java,**/*Metric*.java,**/*Health*.java,**/*Telemetry*.java,**/config/**'
---

# Java Observability Patterns

## Structured Logging

### SLF4J + Logback (Default)
```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

private static final Logger log = LoggerFactory.getLogger(OrderService.class);

// ✅ Structured parameters (MDC for context)
import org.slf4j.MDC;

MDC.put("tenantId", tenantId);
MDC.put("orderId", orderId);
log.info("Order placed");
MDC.clear();

// ✅ Parameterized messages
log.info("Order {} placed for tenant {}", orderId, tenantId);

// ❌ String concatenation (not structured)
log.info("Order " + orderId + " placed");
```

### Logback JSON Configuration
```xml
<!-- logback-spring.xml -->
<configuration>
  <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
  </appender>
  <root level="INFO">
    <appender-ref ref="JSON"/>
  </root>
</configuration>
```

## OpenTelemetry Setup

### Auto-Instrumentation (Java Agent)
```dockerfile
# Add to Dockerfile
ENV JAVA_TOOL_OPTIONS="-javaagent:/app/opentelemetry-javaagent.jar"
ENV OTEL_SERVICE_NAME=my-service
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
```

### Programmatic Setup (Spring Boot)
```java
// build.gradle
implementation 'io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter'

// application.yml
otel:
  service:
    name: my-service
  exporter:
    otlp:
      endpoint: http://otel-collector:4317
```

### Custom Traces
```java
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;

@Service
public class OrderService {
    private final Tracer tracer;

    public Order placeOrder(OrderRequest request) {
        Span span = tracer.spanBuilder("placeOrder").startSpan();
        try (var scope = span.makeCurrent()) {
            span.setAttribute("tenant.id", request.tenantId());
            Order order = orderRepository.save(request);
            span.setAttribute("order.id", order.id());
            return order;
        } catch (Exception ex) {
            span.recordException(ex);
            span.setStatus(StatusCode.ERROR);
            throw ex;
        } finally {
            span.end();
        }
    }
}
```

### Custom Metrics (Micrometer)
```java
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Timer;

@Service
public class OrderService {
    private final Counter ordersPlaced;
    private final Timer processingTimer;

    public OrderService(MeterRegistry registry) {
        this.ordersPlaced = registry.counter("orders.placed");
        this.processingTimer = registry.timer("orders.processing");
    }

    public Order process(Order order) {
        return processingTimer.record(() -> {
            ordersPlaced.increment();
            return doProcess(order);
        });
    }
}
```

## Health Checks (Spring Boot Actuator)
```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: when_authorized
      probes:
        enabled: true  # Enables /actuator/health/liveness and /readiness
  health:
    db:
      enabled: true
    redis:
      enabled: true
```

```java
// Custom health indicator
@Component
public class ExternalApiHealthIndicator extends AbstractHealthIndicator {
    @Override
    protected void doHealthCheck(Health.Builder builder) {
        // Check external dependency
        if (externalApi.isAvailable()) {
            builder.up().withDetail("api", "reachable");
        } else {
            builder.down().withDetail("api", "unreachable");
        }
    }
}
```

## Anti-Patterns

```
❌ String concatenation in log messages (use parameterized logging)
❌ Logging sensitive data (PII, tokens, passwords)
❌ Missing MDC context for tenant/correlation IDs
❌ Not enabling Actuator probes for K8s readiness/liveness
❌ High-cardinality metric tags (user IDs, full URLs)
❌ System.out.println instead of SLF4J logger
```

## See Also

- `dapr.instructions.md` — Dapr sidecar tracing, health checks, workflow observability
- `errorhandling.instructions.md` — Exception handling, correlation IDs
- `performance.instructions.md` — Profiling, metrics collection
- `deploy.instructions.md` — Health probes, Kubernetes integration
```

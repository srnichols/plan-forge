# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>  
> **Stack**: Java 25 (LTS) / Spring Boot 4.1
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Follow proper layering (no business logic in workers)
2. **TDD for Business Logic** — Red-Green-Refactor
3. **Typed Error Handling** — No empty catch blocks
4. **Thread Safety** — Prefer virtual threads (Java 25 LTS), avoid shared mutable state

---

## Background Worker Pattern

### Template: Spring @Scheduled Task

```java
@Component
public class MyScheduledWorker {

    private static final Logger log = LoggerFactory.getLogger(MyScheduledWorker.class);
    private final MyService myService;

    public MyScheduledWorker(MyService myService) {
        this.myService = myService;
    }

    @Scheduled(fixedDelay = 300_000) // 5 minutes
    public void processItems() {
        try {
            myService.processPendingItems();
        } catch (Exception e) {
            log.error("Worker iteration failed", e);
        }
    }
}
```

### Template: Spring Event Listener

```java
@Component
public class UserActivityListener {

    private static final Logger log = LoggerFactory.getLogger(UserActivityListener.class);

    @Async
    @EventListener
    public void handleUserActivity(UserActivityEvent event) {
        log.info("Processing activity: {} for user: {}", event.type(), event.userId());
        // Process event...
    }
}
```

---

## Agent Categories

| Category | Purpose | Pattern |
|----------|---------|---------|
| **Scheduled Tasks** | Periodic processing | `@Scheduled` + `ScheduledExecutorService` |
| **Event Listeners** | Async event handling | `@EventListener` + `@Async` |
| **Message Consumers** | Queue/topic processing | Spring AMQP / Kafka listener |
| **Health Monitors** | System health checks | Actuator + custom `HealthIndicator` |

---

## Communication Patterns

### Event-Driven (Spring Events)
```
User action → ApplicationEventPublisher → @EventListener processes
```

### Message Queue (RabbitMQ / Kafka)
```
Producer → Message Broker → @RabbitListener / @KafkaListener processes
```

### Request/Response (Direct)
```
Controller → Service → Repository → Database
```

---

## Quick Commands

```bash
# Run app with specific profile
./gradlew bootRun --args='--spring.profiles.active=dev'

# Run tests for workers
./gradlew test --tests "*Worker*"

# Build all
./gradlew build
```

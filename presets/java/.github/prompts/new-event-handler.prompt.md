---
description: "Scaffold domain events, Spring ApplicationEvent handlers, and @TransactionalEventListener patterns."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold domain events with Spring's ApplicationEvent and transactional event listeners.

## Required Pattern

### Domain Event
```java
public record OrderPlacedEvent(
    UUID eventId,
    Instant occurredAt,
    UUID orderId,
    UUID customerId,
    BigDecimal totalAmount
) {
    public OrderPlacedEvent(UUID orderId, UUID customerId, BigDecimal totalAmount) {
        this(UUID.randomUUID(), Instant.now(), orderId, customerId, totalAmount);
    }
}
```

### Event Handler
```java
@Component
public class OrderPlacedEventHandler {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedEventHandler.class);
    private final EmailService emailService;

    public OrderPlacedEventHandler(EmailService emailService) {
        this.emailService = emailService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(OrderPlacedEvent event) {
        log.info("Handling OrderPlaced: {}", event.orderId());
        emailService.sendOrderConfirmation(event.orderId());
    }
}
```

### Publishing Events
```java
@Service
public class OrderService {

    private final ApplicationEventPublisher publisher;
    private final OrderRepository repository;

    public OrderService(ApplicationEventPublisher publisher, OrderRepository repository) {
        this.publisher = publisher;
        this.repository = repository;
    }

    @Transactional
    public Order placeOrder(CreateOrderRequest request) {
        Order order = repository.save(toEntity(request));

        publisher.publishEvent(new OrderPlacedEvent(
            order.getId(), order.getCustomerId(), order.getTotalAmount()));

        return order;
    }
}
```

### Async Event Handler
```java
@Component
public class OrderPlacedAuditHandler {

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(OrderPlacedEvent event) {
        // Runs asynchronously after transaction commits
        auditService.recordOrderPlaced(event);
    }
}
```

### Enable Async
```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean
    public Executor taskExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("event-");
        executor.initialize();
        return executor;
    }
}
```

## Rules

- Events are immutable records — NEVER mutate after creation
- Use `@TransactionalEventListener(phase = AFTER_COMMIT)` — not `@EventListener` — for side effects
- Event handlers MUST be idempotent — the same event may be delivered more than once
- NEVER throw from event handlers — log and continue
- Use `@Async` for non-blocking handlers that can run independently
- Keep events in an `event/` package, handlers in `event/handler/`

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Messaging patterns](../instructions/messaging.instructions.md)

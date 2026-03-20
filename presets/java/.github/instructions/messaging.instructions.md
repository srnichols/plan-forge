---
description: Messaging patterns for Java — Spring AMQP, Spring Kafka, @RabbitListener, event-driven architecture
applyTo: '**/*Listener*.java,**/*Event*.java,**/*Message*.java,**/*Consumer*.java,**/*Producer*.java'
---

# Java Messaging & Pub/Sub Patterns

## Messaging Strategy

### Spring AMQP / RabbitMQ (Recommended)
```java
// Configuration
@Configuration
public class RabbitConfig {

    @Bean
    public TopicExchange eventsExchange() {
        return new TopicExchange("events");
    }

    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order-processing")
            .withArgument("x-dead-letter-exchange", "events.dlx")
            .withArgument("x-dead-letter-routing-key", "order.failed")
            .build();
    }

    @Bean
    public Binding orderBinding(Queue orderQueue, TopicExchange eventsExchange) {
        return BindingBuilder.bind(orderQueue).to(eventsExchange).with("order.*");
    }
}

// Publishing
@Service
public class OrderService {
    private final RabbitTemplate rabbitTemplate;

    public void placeOrder(Order order) {
        orderRepository.save(order);
        rabbitTemplate.convertAndSend("events", "order.placed",
            new OrderPlacedEvent(order.getId(), order.getTenantId(), Instant.now()));
    }
}

// Consuming
@Component
public class OrderEventListener {

    @RabbitListener(queues = "order-processing")
    public void handleOrderPlaced(OrderPlacedEvent event) {
        // Process event
    }
}
```

### Spring Kafka
```java
// Publishing
@Service
public class EventPublisher {
    private final KafkaTemplate<String, Object> kafka;

    public void publish(String topic, String key, Object event) {
        kafka.send(topic, key, event);
    }
}

// Consuming
@Component
public class OrderKafkaListener {

    @KafkaListener(topics = "order-events", groupId = "order-processor")
    public void handle(OrderPlacedEvent event, Acknowledgment ack) {
        processOrder(event);
        ack.acknowledge();
    }
}
```

### Spring Events (In-Process — Same JVM)
```java
// Publishing
@Service
public class OrderService {
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));
        eventPublisher.publishEvent(new OrderPlacedEvent(this, order));
        return order;
    }
}

// Consuming (async)
@Component
public class OrderAnalyticsListener {

    @Async
    @EventListener
    public void onOrderPlaced(OrderPlacedEvent event) {
        analyticsService.trackOrder(event.getOrder());
    }
}
```

## Event Schema
```java
// Always use records for immutable event payloads
public record OrderPlacedEvent(
    String orderId,
    String tenantId,
    Instant occurredAt
) {}

// Include tenantId in ALL events
```

## Scheduled Tasks
```java
@Component
public class ScheduledTasks {

    @Scheduled(cron = "0 0 8 * * *")  // 8 AM daily
    public void generateDailyReport() { ... }

    @Scheduled(fixedRate = 30_000)  // Every 30 seconds
    public void processRetryQueue() { ... }
}
```

## Dead Letter & Retry Strategy
```java
// RabbitMQ retry with Spring Retry
@Bean
public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
        ConnectionFactory cf) {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(cf);
    factory.setAdviceChain(RetryInterceptorBuilder.stateless()
        .maxAttempts(3)
        .backOffOptions(1000, 2.0, 30000)
        .build());
    return factory;
}
```

## Anti-Patterns

```
❌ @Transactional on listener methods (transaction already committed by publisher)
❌ Sending full JPA entities in events (serialize DTOs/records only)
❌ Missing tenantId in event payload (breaks multi-tenant isolation)
❌ Synchronous @EventListener for slow operations (use @Async)
❌ No dead letter queue (failed messages lost forever)
❌ No idempotency check (duplicate messages cause duplicate processing)
```

---
description: Messaging patterns for TypeScript — BullMQ, AMQP, Redis Pub/Sub, event-driven architecture
applyTo: '**/*queue*,**/*Queue*,**/*worker*,**/*Worker*,**/*event*,**/*Event*,**/*job*'
---

# TypeScript Messaging & Pub/Sub Patterns

## Messaging Strategy

### BullMQ (Redis-Backed Job Queue — Recommended)
```typescript
import { Queue, Worker, Job } from 'bullmq';
import { redis } from './lib/redis';

// Producer
const orderQueue = new Queue('order-processing', { connection: redis });

export async function placeOrder(order: Order): Promise<void> {
  await orderRepository.save(order);
  await orderQueue.add('order-placed', {
    orderId: order.id,
    tenantId: order.tenantId,
    occurredAt: new Date().toISOString(),
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

// Consumer
const worker = new Worker('order-processing', async (job: Job) => {
  const { orderId, tenantId } = job.data;
  await processOrder(orderId, tenantId);
}, {
  connection: redis,
  concurrency: 5,
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed');
});
```

### Redis Pub/Sub (Real-Time Notifications)
```typescript
import Redis from 'ioredis';

const pub = new Redis(process.env.REDIS_URL);
const sub = new Redis(process.env.REDIS_URL);

// Publish
export async function publishEvent(topic: string, payload: unknown): Promise<void> {
  await pub.publish(topic, JSON.stringify(payload));
}

// Subscribe
sub.subscribe('order-placed', 'order-completed');
sub.on('message', (channel: string, message: string) => {
  const data = JSON.parse(message);
  handleEvent(channel, data);
});
```

### AMQP (RabbitMQ)
```typescript
import amqp from 'amqplib';

const conn = await amqp.connect(process.env.AMQP_URL!);
const channel = await conn.createChannel();

// Publish
await channel.assertExchange('events', 'topic', { durable: true });
channel.publish('events', 'order.placed', Buffer.from(JSON.stringify(event)));

// Consume
await channel.assertQueue('order-processor', { durable: true });
await channel.bindQueue('order-processor', 'events', 'order.*');
channel.consume('order-processor', async (msg) => {
  if (!msg) return;
  const event = JSON.parse(msg.content.toString());
  await processEvent(event);
  channel.ack(msg);
});
```

## Event Schema
```typescript
// Always use typed events
interface OrderPlacedEvent {
  orderId: string;
  tenantId: string;
  occurredAt: string;  // ISO 8601
}

// Include tenantId in ALL events
```

## Scheduled Jobs (node-cron / BullMQ Repeatable)
```typescript
// BullMQ repeatable job
await orderQueue.add('daily-report', {}, {
  repeat: { pattern: '0 8 * * *' },  // 8 AM daily
});
```

## Dead Letter & Retry Strategy
```typescript
// BullMQ built-in retry
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
}

// Dead letter queue
const worker = new Worker('main', handler, {
  connection: redis,
  settings: { backoffStrategy: (attemptsMade) => attemptsMade * 2000 },
});
```

## Anti-Patterns

```
❌ Untyped event payloads (use interfaces, validate with Zod)
❌ Missing error handler on worker (unhandled rejections crash process)
❌ Blocking the event loop in workers (use async, offload CPU work)
❌ No idempotency check (duplicate job execution)
❌ Publishing without tenantId (breaks multi-tenant isolation)
❌ Large payloads in jobs (pass IDs, fetch data in consumer)
```

# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>  
> **Stack**: TypeScript 7 / Node.js 24 LTS / React 19.3
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Follow proper layering (no business logic in workers)
2. **TDD for Business Logic** — Red-Green-Refactor
3. **Typed Error Handling** — No unhandled promise rejections
4. **Type Safety** — No `any` types

---

## Background Worker Pattern

### Template: Node.js Worker with Graceful Shutdown

```typescript
import { parentPort } from 'worker_threads';

class MyWorker {
  private isRunning = true;
  private intervalMs = 5 * 60 * 1000; // 5 minutes

  async start(): Promise<void> {
    console.log('Worker started');
    
    while (this.isRunning) {
      try {
        await this.process();
      } catch (error) {
        console.error('Worker iteration failed:', error);
      }
      await this.sleep(this.intervalMs);
    }
  }

  async process(): Promise<void> {
    // Business logic here
  }

  stop(): void {
    this.isRunning = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const worker = new MyWorker();
worker.start();

// Graceful shutdown
process.on('SIGTERM', () => worker.stop());
process.on('SIGINT', () => worker.stop());
```

### Template: Cron Job (node-cron)

```typescript
import cron from 'node-cron';

// Run every hour
cron.schedule('0 * * * *', async () => {
  try {
    await processScheduledTask();
  } catch (error) {
    console.error('Scheduled task failed:', error);
  }
});
```

---

## Agent Categories

| Category | Purpose | Pattern |
|----------|---------|---------|
| **Background Workers** | Scheduled processing | Worker threads / cron |
| **Event Processors** | Pub/sub handling | Message broker consumers |
| **Real-Time** | Live updates | Socket.io / WebSocket |

---

## Communication Patterns

### Pub/Sub (Event-Driven)
```
User action → Event emitted → Worker consumes → State updated
```

### Request/Response (Direct)
```
Frontend → API (Express) → Service → Repository → Database
```

### Real-Time (Socket.io)
```
Server event → Socket.io emit → Connected clients
```

---

## Quick Commands

```bash
# Run worker
pnpm --filter @myapp/worker dev

# Run tests
pnpm test

# Build all
pnpm build
```

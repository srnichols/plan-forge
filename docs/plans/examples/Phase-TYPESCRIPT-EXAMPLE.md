# Phase 8: Real-Time Notifications — TypeScript Example

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 2 days (8 execution slices)  
> **Risk Level**: Medium (WebSocket + database)

---

## Overview

Add real-time notification system using Socket.io. Users receive live updates for order status changes, new messages, and system alerts. Notifications are persisted in PostgreSQL and delivered via WebSocket.

---

## Prerequisites

- [ ] Phase 7 complete (order system working)
- [ ] PostgreSQL + Prisma migrations up to date
- [ ] Socket.io server configured
- [ ] Test infrastructure (Vitest, Supertest) working

## Acceptance Criteria

- [ ] Notifications delivered in real-time via WebSocket
- [ ] Notifications persisted in database with read/unread status
- [ ] API endpoints: list, mark-read, mark-all-read
- [ ] React notification bell component with unread count badge
- [ ] Multi-tenant isolation — users only see their own notifications
- [ ] 90%+ test coverage on new code

---

## Execution Slices

### Slice 8.1 — Database: Notifications Table
**Build command**: `pnpm build`  
**Test command**: `pnpm exec vitest run`

**Tasks**:
1. Create Prisma migration: `npx prisma migrate dev --name add_notifications`
2. Model: `id`, `userId`, `tenantId`, `type`, `title`, `body`, `readAt`, `createdAt`
3. Add index on `(tenantId, userId, readAt)` for efficient queries
4. Write integration test: verify tenant isolation

```prisma
model Notification {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  tenantId  String    @map("tenant_id")
  type      String    // "order_update" | "message" | "system"
  title     String
  body      String
  readAt    DateTime? @map("read_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@index([tenantId, userId, readAt])
  @@map("notifications")
}
```

**Validation Gate**:
```bash
pnpm build                                              # zero errors
pnpm exec vitest run                                    # all pass
grep -rn "as any\|@ts-ignore" --include="*.ts" apps/    # zero hits in new files
```

**Stop Condition**: If migration fails or tenant isolation test fails → STOP.

### Slice 8.2 — Service Layer: `NotificationService`
**Build command**: `pnpm build`  
**Test command**: `pnpm exec vitest run --reporter=verbose`

**Tasks**:
1. Create `notification.service.ts` with typed interface
2. Methods: `create`, `listForUser`, `markRead`, `markAllRead`, `getUnreadCount`
3. All methods require `tenantId` parameter (multi-tenant)
4. Unit tests with mocked Prisma client

```typescript
interface NotificationService {
  create(input: CreateNotificationInput): Promise<Notification>;
  listForUser(userId: string, tenantId: string, options?: PaginationOptions): Promise<Notification[]>;
  markRead(id: string, tenantId: string): Promise<void>;
  markAllRead(userId: string, tenantId: string): Promise<void>;
  getUnreadCount(userId: string, tenantId: string): Promise<number>;
}
```

### Slice 8.3 — API Endpoints
**Tasks**:
1. `GET /api/notifications` — list with pagination
2. `PATCH /api/notifications/:id/read` — mark single as read
3. `POST /api/notifications/mark-all-read` — batch operation
4. Zod validation on all inputs
5. API integration tests with Supertest

### Slice 8.4 — WebSocket: Real-Time Delivery
**Tasks**:
1. Create Socket.io namespace `/notifications`
2. Authenticate WebSocket connections (JWT from handshake)
3. Join user to tenant-specific room: `tenant:${tenantId}:user:${userId}`
4. Emit `notification:new` event on creation
5. Integration test: verify message delivery

### Slice 8.5 — React Component: NotificationBell
**Tasks**:
1. Create `NotificationBell.tsx` with unread count badge
2. Dropdown panel showing recent notifications
3. Mark-as-read on click
4. Socket.io client hook: `useNotifications()`
5. Unit tests for component rendering

### Slice 8.6 — React Component: NotificationList Page
**Tasks**:
1. Full-page notification list with infinite scroll
2. Filter: all / unread / by type
3. "Mark all as read" button
4. Empty state for no notifications
5. Loading skeleton during fetch

---

## Rollback Plan

1. **Database**: `npx prisma migrate resolve --rolled-back add_notifications`
2. **Code**: Revert commit (single commit per slice)
3. **Config**: Remove Socket.io namespace config

---

## Anti-Pattern Checks

```bash
# Run after each slice
grep -rn "as any" --include="*.ts" apps/api/src/notifications/     # must be 0
grep -rn "@ts-ignore" --include="*.ts" apps/                       # must be 0
grep -rn "console.log" --include="*.ts" apps/api/src/              # must be 0 (use logger)
```

---

## 6 Mandatory Blocks — Verification

| # | Block | Present |
|---|-------|---------|
| 1 | Numbered execution slices with build/test commands | ✅ |
| 2 | Explicit validation gates per slice | ✅ |
| 3 | Stop conditions | ✅ |
| 4 | Rollback plan (3 tiers) | ✅ |
| 5 | Anti-pattern grep commands | ✅ |
| 6 | File-level change manifest | ⬜ (add before execution) |

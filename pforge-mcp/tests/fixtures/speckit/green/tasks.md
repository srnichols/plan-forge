# Tasks: Rate Limit Login Endpoint

| Task ID | Slice | Description | Status |
|---------|-------|-------------|--------|
| T-1     | 1     | Create `src/middleware/rateLimitLogin.ts` skeleton | pending |
| T-2     | 1     | Wire middleware to `POST /api/login` route | pending |
| T-3     | 2     | Implement Redis token-bucket get/decrement | pending |
| T-4     | 2     | Add 60 s refill timer | pending |
| T-5     | 3     | Return HTTP 429 with `Retry-After` on exhaustion | pending |
| T-6     | 4     | Emit audit log entry on every rejection | pending |
| T-7     | 5     | Add k6 load-test script | pending |
| T-8     | 5     | Verify p95 < 50 ms under load | pending |

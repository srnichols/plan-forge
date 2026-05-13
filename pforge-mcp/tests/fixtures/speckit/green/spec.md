# Rate Limit Login Endpoint

## Summary

Add a per-IP rate limit to the login endpoint to mitigate credential-stuffing attacks.

## Goals

- Block more than 10 login attempts per IP per 60 seconds
- Return HTTP 429 with a `Retry-After` header on rejection
- Emit a structured audit log entry for every rejected attempt
- Preserve existing successful-login latency under p95 = 50 ms

## User Scenarios

1. A legitimate user signs in once — request succeeds, no rate-limit headers.
2. An attacker sends 50 login attempts in 10 seconds — the 11th onward receives HTTP 429.
3. An honest user behind a NAT exceeds the limit — gets 429, sees `Retry-After: 30`, succeeds after waiting.

## Acceptance Criteria

- [ ] Per-IP token-bucket: 10 requests / 60 s window
- [ ] HTTP 429 response with `Retry-After` header
- [ ] Audit log entry on every rejection with `{ ip, timestamp, attemptCount }`
- [ ] No regression to p95 login latency

## Out of Scope

- Per-account rate limiting (separate feature)
- CAPTCHA fallback after N rejections
- IP allowlist / denylist management UI

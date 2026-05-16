# Feature Specification: Rate Limit Login Endpoint

**Feature Branch**: `001-rate-limit-login`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Add rate limiting to the login endpoint to prevent credential stuffing"

## User Scenarios & Testing

### User Story 1 - Legitimate Login (Priority: P1)

A legitimate user signs in once — request succeeds with no rate-limit headers.

**Why this priority**: Core happy path that must work before any limiting logic.

**Independent Test**: Submit a single login request and verify HTTP 200 with no 429.

**Acceptance Scenarios**:

1. **Given** a fresh IP address, **When** a single login attempt is made, **Then** the response is HTTP 200 with no rate-limit rejection.

---

### User Story 2 - Brute Force Blocked (Priority: P2)

An attacker sending more than 10 login attempts from the same IP within 60 seconds is blocked.

**Why this priority**: The primary security benefit of this feature.

**Independent Test**: Send 11+ rapid login requests from the same IP, verify the 11th returns HTTP 429 with `Retry-After` header.

**Acceptance Scenarios**:

1. **Given** an IP that has made 10 attempts within 60 s, **When** an 11th attempt is made, **Then** HTTP 429 with a valid `Retry-After` header.

---

### Edge Cases

- What happens when a legitimate user behind a NAT shares an IP with others?
- How does the system handle IPv6 addresses?

## Requirements

- Block more than 10 login attempts per IP per 60 seconds
- Return HTTP 429 with a `Retry-After` header on rejection
- Emit a structured audit log entry for every rejected attempt
- Preserve existing successful-login latency under p95 = 50 ms

## Success Criteria

- Per-IP token-bucket: 10 requests / 60 s window
- HTTP 429 response with `Retry-After` header
- Audit log entry on every rejection with `{ ip, timestamp, attemptCount }`
- No regression to p95 login latency

## Assumptions

- Per-account rate limiting is out of scope (separate feature)
- CAPTCHA fallback after N rejections is out of scope
- IP allowlist / denylist management UI is out of scope

# Rate Limit Login Endpoint

## Summary

Add a per-IP rate limit to the login endpoint to mitigate credential-stuffing attacks.

## Goals

- Block more than 10 login attempts per IP per 60 seconds
- Return HTTP 429 with a `Retry-After` header on rejection
- Emit a structured audit log entry for every rejected attempt

## Acceptance Criteria

- [ ] Per-IP token-bucket: 10 requests / 60 s window
- [ ] HTTP 429 response with `Retry-After` header

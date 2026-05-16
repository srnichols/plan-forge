# Feature Specification: Rate Limit Login Endpoint

**Feature Branch**: `001-rate-limit-login`

**Created**: 2026-05-16

**Status**: Draft

## Requirements

- Block more than 10 login attempts per IP per 60 seconds
- Return HTTP 429 with a `Retry-After` header on rejection
- Emit a structured audit log entry for every rejected attempt

## Success Criteria

- Per-IP token-bucket: 10 requests / 60 s window
- HTTP 429 response with `Retry-After` header

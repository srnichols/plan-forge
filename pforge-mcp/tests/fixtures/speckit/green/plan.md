# Implementation Plan: Rate Limit Login Endpoint

**Branch**: `001-rate-limit-login` | **Date**: 2026-05-16 | **Spec**: specs/demo-feature/spec.md

## Summary

Add a token-bucket rate limiter middleware in front of `POST /api/login`. Limiter state lives in Redis. Audit logs go to the existing `audit.log.security` channel.

## Technical Context

**Language/Version**: TypeScript (Node.js 20)

**Primary Dependencies**: Express, ioredis

**Storage**: Redis (existing dependency)

**Testing**: vitest (existing)

**Target Platform**: Linux server

**Project Type**: web-service

## Slices

1. **Middleware skeleton** — add `rateLimitLogin` middleware with no-op behaviour, wired to the login route.
2. **Token-bucket implementation** — Redis-backed bucket per IP, 10 tokens, 60 s refill window.
3. **HTTP 429 + Retry-After** — produce the documented response shape on bucket exhaustion.
4. **Audit log emission** — structured log entry on every rejection.
5. **Load test** — 1k req/s for 60 s, verify p95 latency budget intact.

## Forbidden Actions

- Do not modify the existing session middleware.
- Do not add a new database table — Redis only.
- Do not change the login response contract for successful logins.
- Do not bypass the rate limit for any IP, including internal ones (use a separate health-check endpoint instead).

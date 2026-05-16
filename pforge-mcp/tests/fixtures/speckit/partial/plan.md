# Implementation Plan: Rate Limit Login Endpoint

## Summary

Add a token-bucket rate limiter middleware in front of `POST /api/login`.

## Slices

1. **Middleware skeleton** — add `rateLimitLogin` middleware with no-op behaviour.
2. **Token-bucket implementation** — Redis-backed bucket per IP, 10 tokens, 60 s refill.

## Forbidden Actions

- Do not modify the existing session middleware.
- Do not add a new database table — Redis only.

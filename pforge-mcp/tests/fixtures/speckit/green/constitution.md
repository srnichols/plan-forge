# Project Constitution

## Core Principles

- All new code must include tests with ≥ 80% line coverage.
- No secrets in source code — use the existing secret manager.
- All HTTP endpoints must validate input at the boundary.
- Any new external dependency requires a security review before merge.
- Database migrations must be reversible.

## Commitments

- Maintain backward compatibility for the public REST API for at least one minor version.
- Respond to security-tagged issues within 24 hours.

## Boundaries

- Do not introduce a new programming language to the codebase.
- Do not depend on a paid third-party service without architecture review.

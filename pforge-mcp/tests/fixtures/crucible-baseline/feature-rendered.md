# Add export-to-CSV capability to cost report

> **Lane**: feature  
> **Source**: human  
> **Status**: finalized

## Raw Idea

Add export-to-CSV capability to cost report

## Scope Contract

**In scope**:

- pforge-mcp/cost-service.mjs
- pforge-mcp/server.mjs

**Out of scope**:

- PDF export
- email delivery

## Slices

_Slice breakdown is authored during the Plan Hardener step (Session 1, Step 2)._

> Slice template:
>
> ```
> ### Slice N — <name>
> Build command: <cmd>
> Test command:  <cmd>
> Tasks:         <list>
> Files:         <manifest>
> ```

## Validation Gates

cd pforge-mcp && npx vitest run tests/cost-csv.test.mjs

**Tests**: pforge-mcp/tests/cost-csv.test.mjs

## Stop Conditions

- Validation gate fails and root cause is not identified within 30 minutes
- A slice drifts past its declared Scope Contract
- A forbidden action (see Anti-patterns) is about to be introduced
- Token budget for this phase is exceeded by more than 25%

## Rollback

git revert HEAD && npm install

## Anti-patterns & Forbidden Actions

- no destructive migrations
- no API contract changes

## Change Manifest

- pforge-mcp/cost-service.mjs
- pforge-mcp/server.mjs

## Interview Log

1. **goal** — Users can download cost reports as CSV files
2. **scope-files** — pforge-mcp/cost-service.mjs
pforge-mcp/server.mjs
3. **out-of-scope** — PDF export, email delivery
4. **tests** — pforge-mcp/tests/cost-csv.test.mjs
5. **validation-gates** — cd pforge-mcp && npx vitest run tests/cost-csv.test.mjs
6. **forbidden-actions** — no destructive migrations, no API contract changes
7. **rollback** — git revert HEAD && npm install

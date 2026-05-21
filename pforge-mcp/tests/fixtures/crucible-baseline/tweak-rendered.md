# Fix off-by-one error in pagination helper

> **Lane**: tweak  
> **Source**: human  
> **Status**: finalized

## Raw Idea

Fix off-by-one error in pagination helper

## Scope Contract

**In scope**:

- pforge-mcp/pagination.mjs

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

cd pforge-mcp && npx vitest run tests/pagination.test.mjs

## Stop Conditions

- Validation gate fails and root cause is not identified within 30 minutes
- A slice drifts past its declared Scope Contract
- A forbidden action (see Anti-patterns) is about to be introduced
- Token budget for this phase is exceeded by more than 25%

## Rollback

git revert HEAD

## Anti-patterns & Forbidden Actions

- no schema changes
- no edits outside scope-file

## Change Manifest

- pforge-mcp/pagination.mjs

## Interview Log

1. **scope-file** — pforge-mcp/pagination.mjs
2. **validation** — cd pforge-mcp && npx vitest run tests/pagination.test.mjs
3. **forbidden-actions** — no schema changes, no edits outside scope-file
4. **rollback** — git revert HEAD

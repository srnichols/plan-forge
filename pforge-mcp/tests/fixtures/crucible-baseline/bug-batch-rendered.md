# Fix null pointer crash in plan parser when scope-files line is empty

> **Lane**: bug-batch  
> **Source**: human  
> **Status**: in-progress

## Raw Idea

Fix null pointer crash in plan parser when scope-files line is empty

## Root Cause Hypothesis

**Symptom observed**: plan-parser.mjs throws TypeError: Cannot read properties of null when scope-files answer is empty string

**Expected behavior**: parseScopeContract returns empty scope array instead of crashing

**Suspected component**: pforge-mcp/orchestrator/plan-parser.mjs handleFilesHeading (L525)

## Scope Contract

### In Scope

- pforge-mcp/orchestrator/plan-parser.mjs
- pforge-mcp/tests/plan-parser.test.mjs

### Forbidden

- do not alter the public parseScopeContract API signature
- do not change unrelated plan-parser functions

## Slices

### Slice 1 — Guard empty scope-files [scope: pforge-mcp/orchestrator/plan-parser.mjs]

Build command: npm run build
Test command:  npm run test:parser

**Files**:
- pforge-mcp/orchestrator/plan-parser.mjs

### Slice 2 — Add regression test [scope: pforge-mcp/tests/plan-parser.test.mjs]

Build command: npm run build
Test command:  npm run test:parser

**Files**:
- pforge-mcp/tests/plan-parser.test.mjs

## Validation Gates

npm run test:parser passes
no new TypeError in plan-parser.mjs

## Stop Conditions

- Validation gate fails and root cause is not identified within 30 minutes
- A slice drifts past its declared Scope Contract
- A forbidden action (see Scope Contract → Forbidden) is about to be introduced
- Token budget for this phase is exceeded by more than 25%

## Rollback

git revert the guard commit; orchestrator falls back to skipping scope-files

## Change Manifest

- pforge-mcp/orchestrator/plan-parser.mjs
- pforge-mcp/tests/plan-parser.test.mjs

## Interview Log

1. **symptom-observed** — plan-parser.mjs throws TypeError: Cannot read properties of null when scope-files answer is empty string
2. **expected-behavior** — parseScopeContract returns empty scope array instead of crashing
3. **suspected-component** — pforge-mcp/orchestrator/plan-parser.mjs handleFilesHeading (L525)
4. **scope-files** — pforge-mcp/orchestrator/plan-parser.mjs, pforge-mcp/tests/plan-parser.test.mjs
5. **slice-breakdown** — Guard empty scope-files | pforge-mcp/orchestrator/plan-parser.mjs | npm run test:parser
Add regression test | pforge-mcp/tests/plan-parser.test.mjs | npm run test:parser
6. **validation-gates** — npm run test:parser passes
no new TypeError in plan-parser.mjs
7. **forbidden-actions** — do not alter the public parseScopeContract API signature
do not change unrelated plan-parser functions
8. **rollback** — git revert the guard commit; orchestrator falls back to skipping scope-files

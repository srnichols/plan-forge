# ASCII Diagram Regression Plan

**Status**: in-progress
**Feature Branch**: `fix/ascii-diagram-lint`

## Scope Contract

### In Scope
- Validate that ASCII box-drawing characters do not trigger blocked-command errors

### Out of Scope
- None

### Forbidden
- None

## Execution Slices

### Slice 1: Verify gate linting with ASCII diagrams

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STOP! Before writing ANY code, you MUST:                                   │
│                                                                             │
│  1. ✅ Read this file (architecture-principles.instructions.md)             │
│  2. ✅ Follow the Decision Framework below                                  │
│  3. ✅ Apply Separation of Concerns                                         │
│  4. ✅ Consider TDD for business logic                                      │
│  5. ✅ Check existing patterns first (DON'T reinvent)                       │
│                                                                             │
│  🚨 RED FLAGS that MUST stop you:                                           │
│  ❌ "quick fix" → STOP, find proper solution                                │
│  ❌ "copy-paste" → STOP, create reusable abstraction                        │
│  ❌ "skip types" → STOP, add proper types                                   │
│  ❌ "we'll refactor later" → STOP, do it right now                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Validation Gate:**
```
npm test
npx vitest run tests/example.test.mjs
```

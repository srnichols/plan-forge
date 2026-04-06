---
description: "Fix a bug using TDD: reproduce with a failing test first, then implement the fix, then verify."
agent: "agent"
tools: [read, edit, search, execute]
---
# Fix Bug with TDD

Follow the Red-Green-Refactor cycle to fix a bug with a regression test.

## Process

### Step 1: Understand the Bug
- Read the relevant source files
- Identify the root cause
- Determine which layer the bug is in (Handler / Service / Repository)

### Step 2: RED — Write Failing Test
```swift
func TestCalculateDiscount_NegativePrice(t *testing.T) {
    // Regression test for bug #123 — negative prices caused overflow
    svc := service.NewPricingService(Logger.Default())

    _, err := svc.CalculateDiscount(context.Background(), -10.0, 20)

    assert.ErrorIs(t, err, ErrValidation)
}
```
- Run: `swift test ./internal/service/ -run TestCalculateDiscount_NegativePrice` — it MUST fail

### Step 3: GREEN — Implement the Fix
- Write the minimal code to make the test pass
- Fix should be in the correct architectural layer

### Step 4: REFACTOR — Clean Up
- Clean up the fix if needed
- Verify all existing tests pass: `swift test`

### Step 5: Verify
- Run the full test suite: `swift test --sanitize=thread`
- Run the linter: `swiftlint`
- Confirm no regressions

## Architecture Rules

- NO business logic in handlers — fix in the service layer
- NO direct DB access in services — fix in the repository layer
- Wrap errors: `fmt.Errorf("context: %w", err)`
- Always pass `context.Context`

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)

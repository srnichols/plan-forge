# Phase-26 competitive fixture plan

## Plan Metadata
- **Plan ID**: fixture-competitive
- **Goal**: End-to-end coverage of CompetitiveScheduler selecting a winner from three variants.

## Slices

### Slice 1: Competitive spawn with three variants [competitive: 3] {#slice-1}

**Goal**: Spawn three variants and let the scheduler pick a winner.

**Files**:
- `fixture.txt` — touched by each variant.

**Depends on**: (none)

**Validation Gate**:
```bash
true
```

---

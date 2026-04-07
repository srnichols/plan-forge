# Format Tolerance Test Plan

**Status**: in-progress
**Feature Branch**: `feature/tolerance`

## Scope Contract

### In Scope
- Test format tolerance

### Out of Scope
- Nothing

### Forbidden
- Break things

## Execution Slices

### slice 1: lowercase header

1. Task in lowercase slice

### SLICE 2: UPPERCASE HEADER [depends on: slice 1]

1. Task in uppercase slice

### Slice 3 — Em Dash Title [dep: 1] [parallel]

1. Task with em dash separator

### Slice 4 - Dash Title [needs: Slice 1, Slice 2] [parallel-safe]

1. Task with dash separator

# Portability Issues Test Plan

**Status**: in-progress
**Feature Branch**: `test/portability-lint`

## Scope Contract

### In Scope
- Test gate portability linting

### Out of Scope
- None

### Forbidden
- None

## Execution Slices

### Slice 1: Pipe to brace-group with read

**Validation Gate:**
```
echo hello | { read VAR; echo $VAR; }
```

### Slice 2: Nested double-quotes in bash -c

**Validation Gate:**
```
bash -c "node -e \"console.log('hi')\""
```

### Slice 3: Command substitution with pipe

**Validation Gate:**
```
echo $(cat file.txt | grep pattern)
```

### Slice 4: Clean portable commands

**Validation Gate:**
```
npm test
npx vitest run tests/example.test.mjs
node --version
bash -c "grep -q foo bar"
```

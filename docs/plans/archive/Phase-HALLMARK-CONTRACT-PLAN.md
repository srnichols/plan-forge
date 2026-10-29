# Phase-HALLMARK-CONTRACT: Provenance Schema in `pforge-sdk` (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-sdk/src/`) + Schemas (`pforge-sdk/schemas/`) + Tests + Docs
> **Estimated cost**: $1.50–$3.00 (3 slices, small surface, schema-and-validator heavy)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: CocoIndex-inspired memory upgrade research (May 16, 2026 chat session). The four-phase split with this phase as the architectural anchor was approved by the user on the same date.
> **Position in chain**: 1 of 6 — every downstream phase (PROVENANCE, ANVIL, LATTICE, DOCS-SWEEP, QA) consumes the schema published here.

---

## Scope Contract

### In Scope

- `pforge-sdk/schemas/hallmark-provenance.v1.json` — new JSON Schema (draft 2020-12) describing the provenance envelope every memory record carries when produced by a Plan Forge tool.
- `pforge-sdk/src/hallmark.mjs` — new module exporting:
  - `HALLMARK_SCHEMA_VERSION` constant (`"hallmark/v1"`)
  - `validateProvenance(obj)` — returns `{ ok: true } | { ok: false, errors: [...] }`. Pure function, no I/O, no throws.
  - `buildProvenance({ sourceFile, byteRange, contentHash, codeHash, toolName, toolVersion })` — convenience builder that fills `capturedAt` and `schemaVersion`.
  - `mergeProvenance(existingMetadata, provenance)` — additively merges into a `metadata` object without clobbering other keys.
- `pforge-sdk/src/index.mjs` — re-export `hallmark` surface.
- `pforge-sdk/tests/hallmark.test.mjs` — new file, conformance test suite.
- `pforge-sdk/README.md` — new "Hallmark provenance" section with the schema reference, examples, and the consumer integration recipe.
- `pforge-sdk/package.json` — version bump to `0.2.0`; declare `exports["./hallmark"]`.
- `CHANGELOG.md` (Plan-Forge root) — `[Unreleased]` entry noting the SDK bump and the new schema.

### Out of Scope

- **Any writer of provenance** — Phase-ANVIL owns the `brain.mjs` integration. This phase ships the contract only.
- **OpenBrain server-side validation** — Phase-PROVENANCE owns it; that phase imports this schema.
- **Code-index–specific fields** (`astKind`, `symbol`, `callers`) — Phase-LATTICE will publish a `hallmark/v1.1` extension. This phase ships v1 only.
- **A schema-migration framework** — v1 is the only version that exists; migration concerns enter when v1.1 ships.
- **Runtime telemetry on validator usage** — orthogonal.
- **Publishing to npm registry** — `pforge-sdk` is consumed via workspace path / git; no public publish in this phase.

### Forbidden Actions

- **Do NOT add a runtime dependency to `pforge-sdk`.** The validator must be a hand-rolled function using `typeof`, `Array.isArray`, and regex — no `ajv`, no `zod`, no `joi`. The SDK's value is staying dependency-free so consumers (Plan-Forge, OpenBrain, future apps) inherit zero transitive deps.
- **Do NOT throw from `validateProvenance`.** Always return a structured result. Throwing leaks implementation details into hot paths (every L3 write).
- **Do NOT change the on-disk shape of L2 brain files.** This phase publishes the contract; the writer migration is Phase-ANVIL's job.
- **Do NOT write to `e:\GitHub\OpenBrain`** in this phase. OpenBrain consumes the published schema in Phase-PROVENANCE.
- **Do NOT publish a release in this phase.** Plan-Forge `CHANGELOG.md` gets an `[Unreleased]` entry; the version bump happens in Phase-LATTICE Slice 10 once the whole chain is green.
- **Do NOT embed the schema as a string literal in `hallmark.mjs`.** Read it from `schemas/hallmark-provenance.v1.json` at module load. Single source of truth for both runtime validation and external consumers.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Schema dialect | RESOLVED | JSON Schema draft 2020-12 — current, well-supported, the same dialect `ajv` and Python `jsonschema` consume natively. |
| 2 | Schema version identifier | RESOLVED | Single string `"hallmark/v1"` carried in every envelope under `schemaVersion`. Future v1.1 stays compatible (additive); v2 is a hard break with its own file. |
| 3 | Hash algorithm for `contentHash` / `codeHash` | RESOLVED | `sha256:<hex>` — fixed prefix, fixed encoding. Validator enforces `^sha256:[0-9a-f]{64}$`. |
| 4 | Validator strategy | RESOLVED | Hand-rolled per Forbidden Action 1 — zero deps. Schema is loaded for the spec-of-record, not used at runtime by a generic engine. |
| 5 | `byteRange` shape | RESOLVED | `[start, endExclusive]` — two non-negative integers, `start ≤ end`. Matches `String.prototype.slice` semantics, matches CocoIndex's lineage convention. |
| 6 | `toolVersion` source | RESOLVED | Caller-supplied; Plan-Forge `brain.mjs` reads it from `VERSION` file. OpenBrain server-side will compare against its own version. |
| 7 | Required vs optional fields | RESOLVED | Required: `schemaVersion`, `toolName`, `capturedAt`. Optional: `sourceFile`, `byteRange`, `contentHash`, `codeHash`, `toolVersion`. Captures from non-source events (e.g., a quorum decision) need only the three required fields. |
| 8 | Timestamp format | RESOLVED | ISO 8601 string in UTC with `Z` suffix. Validator regex: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$`. |
| 9 | Naming of public symbols | RESOLVED | Lower-camel functions, UPPER_SNAKE constants. Importable as `import { validateProvenance, buildProvenance, mergeProvenance, HALLMARK_SCHEMA_VERSION } from "pforge-sdk/hallmark"`. |
| 10 | Test runner | RESOLVED | `node --test` already wired in `pforge-sdk/package.json` test script. No new dev deps. |

---

## Acceptance Criteria

### Schema

- **MUST**: `pforge-sdk/schemas/hallmark-provenance.v1.json` exists and parses as valid JSON.
- **MUST**: The schema declares `"$schema": "https://json-schema.org/draft/2020-12/schema"` and `"$id"` ending in `/hallmark-provenance.v1.json`.
- **MUST**: The schema defines required fields `schemaVersion`, `toolName`, `capturedAt` and the optional fields enumerated in Decision 7. No additional properties on the envelope itself.
- **MUST**: The `schemaVersion` field is a `const` literal `"hallmark/v1"`.

### Validator

- **MUST**: `validateProvenance(undefined)`, `validateProvenance(null)`, `validateProvenance("string")`, and `validateProvenance([])` all return `{ ok: false, errors: [...] }` without throwing.
- **MUST**: A well-formed envelope passes: `{ schemaVersion: "hallmark/v1", toolName: "forge_hotspot", capturedAt: "2026-05-16T07:28:45Z" }` → `{ ok: true }`.
- **MUST**: A fully-populated envelope with all optional fields passes.
- **MUST**: An envelope with `byteRange: [10, 5]` fails with an error mentioning `byteRange`.
- **MUST**: An envelope with `contentHash: "md5:abcd"` fails with an error mentioning `contentHash`.
- **MUST**: An envelope missing `toolName` fails with an error mentioning `toolName`.
- **MUST**: An envelope with `schemaVersion: "hallmark/v2"` fails (this phase ships v1 only).
- **MUST**: An envelope with extra unknown keys (e.g. `foo: 1`) fails — `additionalProperties: false`.
- **MUST**: `validateProvenance` is pure — no `process.cwd()`, no `fs`, no `Date.now()`, no module-level side effects beyond loading the schema JSON.

### Builder + merger

- **MUST**: `buildProvenance({ toolName: "forge_sweep" })` returns an object whose `schemaVersion === "hallmark/v1"` and whose `capturedAt` is a valid ISO 8601 UTC string within 1 second of `Date.now()`.
- **MUST**: `mergeProvenance({ topics: ["a"] }, prov)` returns `{ topics: ["a"], provenance: prov }` and **does not mutate** the input metadata (deep-equality check on the original object after the call).

### Package surface

- **MUST**: `pforge-sdk/package.json` exposes `"./hallmark": "./src/hallmark.mjs"` in `exports`.
- **MUST**: `pforge-sdk/src/index.mjs` re-exports the four public symbols.
- **MUST**: `pforge-sdk` declares **zero** `dependencies`. `devDependencies` stays empty (test runner is `node --test`).

### Tests

- **MUST**: `pforge-sdk/tests/hallmark.test.mjs` exists and covers every MUST under Validator + Builder + merger above.
- **MUST**: `node --test pforge-sdk/tests/hallmark.test.mjs` exits 0.

### Docs

- **MUST**: `pforge-sdk/README.md` contains a "Hallmark provenance" section with: schema location, the four public symbols with one-liner descriptions, a minimal example consumer (5–10 lines), and a forward link noting that Phase-ANVIL is the first in-tree writer.
- **MUST**: Plan-Forge root `CHANGELOG.md` has an `[Unreleased]` entry under `### Added` mentioning Hallmark v1.

---

## Execution Slices

### Slice 1: Schema file + validator + builder + merger [sequential]

**Goal**: Land the JSON Schema and the three pure functions in one slice. Surface is small enough to do atomically and small enough that splitting it would create artificial dependencies.

**Files**:
- `pforge-sdk/schemas/hallmark-provenance.v1.json` (new)
- `pforge-sdk/src/hallmark.mjs` (new)
- `pforge-sdk/src/index.mjs` (modify — add re-export)
- `pforge-sdk/package.json` (modify — bump to 0.2.0, add `exports["./hallmark"]`)

**Depends On**: nothing.

**Validation Gate**:
```bash
node -e "import('./pforge-sdk/src/hallmark.mjs').then(m=>{const r=m.validateProvenance({schemaVersion:m.HALLMARK_SCHEMA_VERSION,toolName:'x',capturedAt:'2026-05-16T07:28:45Z'});if(!r.ok)process.exit(1);console.log('ok')})"
```

---

### Slice 2: Conformance tests [sequential]

**Goal**: One test file covering every MUST under Acceptance Criteria → Validator + Builder + merger. Use `node:test` (no new deps).

**Files**:
- `pforge-sdk/tests/hallmark.test.mjs` (new)

**Depends On**: Slice 1.

**Validation Gate**:
```bash
node --test pforge-sdk/tests/hallmark.test.mjs
```

---

### Slice 3: SDK README section + Plan-Forge CHANGELOG entry [sequential]

**Goal**: Document the contract so Phase-PROVENANCE (OpenBrain) and Phase-ANVIL (Plan-Forge writers) have a single source of truth to point at.

**Files**:
- `pforge-sdk/README.md` (modify — add "Hallmark provenance" section)
- `CHANGELOG.md` (modify — add `[Unreleased]` entry)

**Depends On**: Slice 2.

**Validation Gate**:
```bash
grep -q 'Hallmark provenance' pforge-sdk/README.md && grep -q 'hallmark' CHANGELOG.md && echo ok
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Hand-rolled validator drifts from the JSON Schema | Slice 2 test loads the schema JSON and asserts the validator agrees on 8 canonical positive + negative cases. |
| Consumer ergonomics suffer from no `zod`-like type inference | The SDK is dependency-free by design (Forbidden Action 1). Consumers that want runtime types layer their own validator on top; the schema JSON is publishable to wherever they keep their types. |
| `pforge-sdk` version bump breaks a downstream import path | We are **adding** an export, not changing existing ones. The bump from 0.1.0 → 0.2.0 follows semver-additive convention. |
| Schema evolution painted into a corner by `additionalProperties: false` | This is intentional. v1.1 lands as a sibling file `hallmark-provenance.v1_1.json` with its own `schemaVersion: "hallmark/v1.1"` value. Validators accept both. Writers stamp the version they wrote against. No silent drift. |
| Test runner choice (`node:test`) under-powered | Phase scope is tiny — three pure functions. Adding `vitest` or `mocha` here would violate the zero-dep stance for trivial gain. |

---

## Definition of Done

- All three slices pass their validation gates.
- `node --test pforge-sdk/tests/hallmark.test.mjs` is green.
- `pforge-sdk/package.json` version is `0.2.0`.
- Plan-Forge `CHANGELOG.md` has the `[Unreleased]` entry.
- A `git diff` shows: 1 new schema file, 1 new module, 1 new test file, 1 modified `index.mjs`, 1 modified `package.json`, 1 modified `README.md`, 1 modified `CHANGELOG.md`. Nothing else.
- No edits to `pforge-mcp/`, `e:\GitHub\OpenBrain`, or `docs/` outside `CHANGELOG.md` (Forbidden Actions enforced).

---

## Post-Mortem

_To be filled in after execution. Capture:_
- Did the hand-rolled validator catch all 8 canonical cases on first run?
- Any consumer-side surprise from `additionalProperties: false`?
- Any pressure to add a runtime dep — and what alternative held?

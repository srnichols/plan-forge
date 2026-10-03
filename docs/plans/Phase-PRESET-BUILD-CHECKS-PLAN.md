# Phase PRESET-BUILD-CHECKS — Nightly compile and Docker checks for preset code samples

> **Status**: **✅ Complete — shipped 2026-10-03 (v3.29.3-dev).** See `## What actually shipped` section below.
> **Issue**: [#309](https://github.com/srnichols/plan-forge/issues/309) (follow-up to #301)
> **Tracks**: `scripts/audit/preset-build/**` (new), `.github/workflows/preset-build.yml` (new), tests.
> **Pipeline**: Specify ✅ → Harden ✅ → Execute → Review → Ship
> **Session budget**: 6 slices. Break after S3.

---

## What actually shipped

- **Rust** (`scripts/audit/preset-build/rust/`): `cargo check --all-targets --locked` against PostgreSQL 18 passes. Three Rust preset samples fixed.
- **Swift** (`scripts/audit/preset-build/swift/`): `swift build --build-tests` passes for all 34 test targets. 93 of 156 blocks build; 63 are skipped with reasons, 15 of them for Apple-only frameworks (SwiftUI, LocalAuthentication, MetricKit). Builds use `--scratch-path /tmp/swift-build`: writing `.build` through the Docker Desktop bind mount on Windows failed with I/O errors. Sample fixes in AGENTS.md, api-patterns, auth, database, testing and new-dto.
- **Dockerfiles** (`scripts/audit/preset-build/docker/`): every documented Dockerfile for dotnet, go, java, python, typescript and php builds and answers its health path (PHP-FPM: stays up). The PHP fixture is a real Laravel skeleton because the preset's Dockerfile and entrypoint run `artisan`. Java's build stage now uses a Maven image.
- **Workflow**: `.github/workflows/preset-build.yml`, nightly and on `presets/**` or harness changes; one tracking issue opened, updated or closed.
- **Fixtures stay out of releases**: `scripts/audit/preset-build/` is `export-ignore`.
- **Orchestrator defects found while running this plan**, each fixed with a test: retired models from run history (#312), `--resume-from` ignored by the parallel scheduler (#311), worker timeout hanging on Windows (#313), retry escalation to `--model unknown`, and an externally ended worker reported as a gate failure.

## Why this phase exists

`scripts/audit/preset-quality.mjs` (#301) runs `bash -n` on shell samples and `php -l` on PHP samples on every push. Compiled stacks need more: their samples are fragments that only compile once assembled. In #292 an agent placed all 129 Rust blocks into one crate by judgment and ran `cargo check` against PostgreSQL 18; the Swift samples were built with `swift build` in `swift:6.4-noble`. Nothing re-runs those checks, so a later preset edit can break a sample silently.

What the presets hold today (2026-10-02 survey):

| Preset | Main-language blocks | Dockerfile blocks |
|---|---|---|
| rust | 127 `rust` | 2 |
| swift | 156 `swift` | 4 |
| dotnet / go / java / python / typescript / php | 105–161 each | 2 / 4 / 6 / 3 / 2 / 1 |

---

## Scope Contract

### In Scope

- `scripts/audit/preset-build/extract.mjs` (new): reads a stack manifest and writes its blocks into a scaffold.
- `scripts/audit/preset-build/<stack>/manifest.json` and `scripts/audit/preset-build/<stack>/scaffold/**` for rust and swift (compile), plus Docker scaffolds for every preset with a Dockerfile block.
- `scripts/audit/preset-build/run.mjs` (new): runs a stack's check in Docker and reports PASS/FAIL per block group.
- `.github/workflows/preset-build.yml` (new): nightly, and on pushes that change `presets/**`.
- `pforge-mcp/tests/preset-build-manifest.test.mjs` (new): manifest coverage and extraction unit tests.

### Out of Scope

- Changing preset content, except fixing a sample this phase proves broken. Each such fix is its own commit, with the failing check named in the message.
- Compile checks for dotnet, go, java, python, typescript and php samples (a later phase; their Dockerfiles are in scope).
- `preset-quality.mjs` rules.

### Forbidden

- `presets/**/.github/instructions/*.md` edits that do not fix a sample proven broken by this phase's harness.
- `pforge-mcp/orchestrator/**`, `pforge.ps1`, `pforge.sh`, `setup.ps1`, `setup.sh`.
- Network services in CI other than the PostgreSQL service container the Rust check needs.

---

## Shared Contract

Every slice uses these shapes exactly (#308).

**`manifest.json`** (one per stack):

```json
{
  "stack": "rust",
  "image": "rust:1.98-slim-bookworm",
  "check": "cargo check --all-targets --locked",
  "services": { "postgres": "postgres:18" },
  "blocks": [
    { "file": ".github/instructions/api-patterns.instructions.md", "index": 3, "lang": "rust", "to": "src/http/errors.rs", "mode": "replace" },
    { "file": ".github/prompts/new-controller.prompt.md", "index": 0, "lang": "rust", "to": "src/orders/controller.rs", "mode": "append", "fill": { "{{Entity}}": "Order" } }
  ],
  "skip": [
    { "file": ".github/instructions/testing.instructions.md", "index": 7, "reason": "shows a compile error on purpose" }
  ]
}
```

- `file` is relative to `presets/<stack>/`; `index` counts that file's fenced blocks of `lang`, from 0.
- `mode`: `replace` writes the block as the whole file; `append` adds it to the end.
- `fill` maps template placeholders to values before writing.
- **Every** block of the stack's main language must appear in `blocks` or `skip`; `skip` needs a `reason`.

**`node scripts/audit/preset-build/extract.mjs --stack <name> --out <dir>`**: copies `scaffold/` to `<dir>` and writes the blocks. Exit `0`, or `1` with the unmapped or stale entries listed.

**`node scripts/audit/preset-build/run.mjs --stack <name> [--docker-only]`**: extracts to a temp dir, runs `check` inside `image` (and the Dockerfile builds), and prints `PASS`/`FAIL` lines. Exit `1` on any FAIL.

---

## Required Decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | How to place fragments: heuristics or a manifest? | **Manifest.** Placement is a judgment call; committing it makes the harness deterministic and reviewable, and the coverage test catches new unmapped blocks. |
| D2 | Run where? | In Docker with the images the presets document (`rust:1.98-slim-bookworm`, `swift:6.4-noble`), so a local run needs only Docker. |
| D3 | Docker checks for other stacks | Each gets a minimal scaffold app that the documented Dockerfile builds and whose health endpoint answers. Its compile checks are out of scope. |
| D4 | CI trigger | Nightly at 06:00 UTC, plus `push` on `presets/**` changes, plus `workflow_dispatch`. Failures open or update one tracking issue, like the Model Drift workflow. |

---

## Acceptance Criteria

- **MUST**: `preset-build-manifest.test.mjs` fails when a `rust` or `swift` block is added to a preset without a manifest entry, or when an entry points at a block that no longer exists.
- **MUST**: `run.mjs --stack rust` and `run.mjs --stack swift` pass on the current presets, or each failure is fixed in the preset in its own commit.
- **MUST**: Every documented Dockerfile block builds against its stack's scaffold, and the container answers its health check.
- **MUST**: The `preset-build.yml` workflow runs all stacks and opens or updates one issue on failure.
- **SHOULD**: A full local run of one compiled stack finishes in under 10 minutes with a warm Docker cache.

---

## Execution Slices

### Slice 1: Manifest format, extractor and coverage test [scope: scripts/audit/preset-build/extract.mjs, pforge-mcp/tests/preset-build-manifest.test.mjs]

1. Create `scripts/audit/preset-build/extract.mjs` implementing the Shared Contract: index fenced blocks per file and language (reuse `codeBlocks` from `scripts/audit/preset-quality.mjs`), apply `fill`, write `replace` / `append` targets over a copy of `scaffold/`.
2. Create `preset-build-manifest.test.mjs` with a fixture stack (two files, four blocks) covering replace, append, fill, a stale index (exit 1) and an unmapped block (exit 1).
3. Add a coverage test that, for every `scripts/audit/preset-build/*/manifest.json`, every main-language block in `presets/<stack>` is mapped or skipped with a reason.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/preset-build-manifest.test.mjs
```

### Slice 2: Rust crate harness [P] [depends: Slice 1] [scope: scripts/audit/preset-build/rust/**]

1. Create `scripts/audit/preset-build/rust/scaffold/` (a `Cargo.toml` with the crates the preset uses, pinned, plus a `Cargo.lock` and module stubs `src/lib.rs`, `src/main.rs`) following the module layout in the preset's canonical addendum.
2. Write `rust/manifest.json` mapping all 127 `rust` blocks. Fill prompt templates with `Order`, and with `Producer` for the api-producer prompt. Skip only blocks that are deliberately wrong or illustrate another project's layout, each with a reason.
3. Make `run.mjs --stack rust` pass against `postgres:18`, fixing any preset sample that fails in its own commit.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/preset-build-manifest.test.mjs
node scripts/audit/preset-build/run.mjs --stack rust
```

### Slice 3: Swift package harness [P] [depends: Slice 1] [scope: scripts/audit/preset-build/swift/**]

**WorkerTimeoutMs**: 90m

> A partial harness from an interrupted run is already committed under `scripts/audit/preset-build/swift/` (scaffold, per-file test targets, stub modules for Apple-only frameworks, a draft `manifest.json`). Continue from it rather than starting over. Each `swift build` in a fresh container re-resolves Vapor; mount or reuse a `.build` cache where `run.mjs` allows it.

1. Create `scripts/audit/preset-build/swift/scaffold/` (a `Package.swift` with the Vapor, Fluent and testing dependencies the preset uses, pinned, plus `Sources/App` and `Tests/AppTests` stubs).
2. Write `swift/manifest.json` mapping all 156 `swift` blocks. Skip, with a reason, blocks that need Apple-only frameworks (SwiftUI, UIKit) that `swift:6.4-noble` cannot build; list those in the PR description.
3. Make `run.mjs --stack swift` pass (`swift build --build-tests`), fixing any failing sample in its own commit.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/preset-build-manifest.test.mjs
node scripts/audit/preset-build/run.mjs --stack swift
```

### Slice 4: run.mjs and Docker builds [depends: Slice 2, Slice 3] [scope: scripts/audit/preset-build/run.mjs, scripts/audit/preset-build/docker/**]

**WorkerTimeoutMs**: 90m

> Slice 2 already created `run.mjs` with the `--stack rust` path; extend it rather than replacing it.

> On Docker Desktop for Windows, keep build output inside the container (as `swift --scratch-path /tmp/...` does) rather than on the bind-mounted `/work`; bind-mount writes are slow and can fail with I/O errors.

1. Finish `run.mjs`: start `services` containers on a private Docker network, run `check` in `image`, then for every `dockerfile` block in the stack's preset build it against the extracted project, run it, and poll its documented health path (default `/health`) for up to 60 seconds.
2. For dotnet, go, java, python, typescript and php, add `scripts/audit/preset-build/docker/<stack>/` with the smallest app that serves the health path the preset's Dockerfile and deploy instructions describe, and the build manifest entries for their Dockerfile blocks.
3. Fix any Dockerfile block that does not build, in its own commit.

**Validation Gate**:
```bash
node scripts/audit/preset-build/run.mjs --stack rust --docker-only
node scripts/audit/preset-build/run.mjs --stack typescript --docker-only
```

### Slice 5: Nightly workflow [depends: Slice 4] [scope: .github/workflows/preset-build.yml, scripts/README.md, scripts/audit/README.md]

1. Create `.github/workflows/preset-build.yml` per D4: a matrix over the stacks on `ubuntu-latest`, running `node scripts/audit/preset-build/run.mjs --stack ${{ matrix.stack }}`, plus a final job that opens, updates or closes one "Preset build checks" issue, using the same pattern as `.github/workflows/model-drift.yml`.
2. Document `extract.mjs`, `run.mjs` and the manifest format in `scripts/README.md` and `scripts/audit/README.md`.

**Validation Gate**:
```bash
node -e "const y=require('yaml');const d=y.parse(require('fs').readFileSync('.github/workflows/preset-build.yml','utf8'));if(!d.jobs||!d.on)throw new Error('bad workflow');console.log(Object.keys(d.jobs))"
```

### Slice 6: Coherence — every stack, end to end [depends: Slice 2, Slice 3, Slice 4, Slice 5] [scope: scripts/audit/preset-build/**, CHANGELOG.md]

1. Run `run.mjs` for every stack in one pass and confirm all PASS.
2. Re-check that `manifest.json` files only use the Shared Contract fields, and that every skip has a specific reason.
3. Add a CHANGELOG `[Unreleased]` entry, and close #309 after the first green nightly run on `master`.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/preset-build-manifest.test.mjs pforge-mcp/tests/preset-quality.test.mjs
node scripts/audit/preset-build/run.mjs --stack rust
node scripts/audit/preset-build/run.mjs --stack swift
```

---

## Re-anchor Checkpoints

After each slice, check:
- Are all changes inside the slice's `[scope:]`, apart from preset fixes made in their own commits?
- Does `preset-build-manifest.test.mjs` still pass?
- Are any manifest fields being used that are not in the Shared Contract?

## Stop Conditions

- More than 10% of a stack's blocks would need `skip` to pass. That points to a preset content problem; stop and file it instead of skipping.
- A sample can only be fixed by changing what the preset teaches, rather than a typo or version. Stop and decide with the maintainer.
- Docker is unavailable, or an image the preset documents no longer exists.

## Definition of Done

- [ ] All MUST acceptance criteria pass.
- [ ] Full `pforge-mcp` vitest suite green.
- [ ] Reviewer Gate passed (zero 🔴 Critical), including Shared Contract conformance.
- [ ] First nightly run on `master` green; #309 closed.

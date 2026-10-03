# Clean Code Audit Scripts — Phase 42

Run all audit scripts then view reports in `docs/plans/cleanup-findings/raw/`.

## Quick run (from repo root)

```bash
# Run the full aggregator (executes every script + merges results)
node scripts/audit/clean-code-review.mjs

# Or run scripts individually
node scripts/audit/measure-modules.mjs       # module-size (G14)
node scripts/audit/long-param-walker.mjs     # functions with >4 positional args
node scripts/audit/grep-matrix.mjs           # TODO/FIXME/HACK + commented-code
node scripts/audit/dead-exports.mjs          # exports nobody imports (Round 2)
node scripts/audit/test-smells.mjs           # focus/skip/time-flake/console-leak (Round 2)
node scripts/audit/shell-parity.mjs          # .ps1/.sh twin coverage (Round 4)
node scripts/audit/dep-boundaries.mjs        # cross-package import rules (Round 4)
node scripts/audit/frozen-arrays-drift.mjs   # hand-typed enum literals (Round 4)
node scripts/audit/preset-quality.mjs --php  # preset filler, copied blocks, wrong stack, skill steps, shell/PHP samples (#301; a gate, exits 1)
```

## Threshold calibration (from Appendix C.5)
| Rule | Threshold |
|------|-----------|
| max-lines-per-function | warn 100, error 300 |
| max-params | warn 4, error 6 |
| complexity | warn 12, error 20 |
| jscpd token threshold | 75 |
| G14 LOC flag | >1000 medium, >3000 high |
| shell-parity size-delta | <40% smaller/larger → SIZE-MISMATCH warn |

## False-positive triage guide
See CATALOG.md "Excluded findings" section.

---

# Preset Build Checks — `preset-build/` (#309)

Presets document code samples as fenced blocks inside Markdown files. Those
blocks are fragments — they only compile/run once assembled into a real
project. `scripts/audit/preset-build/` assembles each stack's blocks into a
scaffold and checks the result in Docker, so a preset edit that breaks a
sample is caught automatically instead of silently.

Run nightly (and on `presets/**` pushes) by `.github/workflows/preset-build.yml`,
which opens, updates or closes one "Preset build checks" tracking issue.

## `extract.mjs`

```bash
node scripts/audit/preset-build/extract.mjs --stack <name> --out <dir>
```

Reads `scripts/audit/preset-build/<stack>/manifest.json`, validates that
every main-language fenced block in `presets/<stack>` is mapped (`blocks`)
or explicitly skipped (`skip`, with a `reason`) and that every manifest
entry still points at a block that exists, then copies `<stack>/scaffold/`
to `<dir>` and writes each mapped block over it: `replace` writes the block
as the whole file, `append` adds it to the end. `fill` token substitutions
run before a block is written. Exits `0` on success, or `1` listing every
unmapped or stale entry without writing anything.

## `run.mjs`

```bash
node scripts/audit/preset-build/run.mjs --stack <name> [--docker-only]
```

Without `--docker-only`: extracts the stack to a temp dir (via
`extract.mjs`), starts any `services` containers the manifest declares
(e.g. `postgres`), runs the manifest's `check` command inside `image`, then
builds and health-checks every `dockerfile` block declared in
`docker/<stack>/manifest.json` (if any). Prints a `PASS`/`FAIL` line per
stage.

With `--docker-only`: skips the compile-check path (and the compile
manifest some stacks don't have yet — `dotnet`, `go`, `java`, `python`,
`typescript`, `php`) and only builds + health-checks the stack's documented
Dockerfile blocks.

Exits `0` if every stage passes, `1` on any `FAIL`, `2` on a usage or
environment error (missing `--stack`, or Docker unavailable).

## Manifest format

**`scripts/audit/preset-build/<stack>/manifest.json`** (compile check — rust,
swift today):

```json
{
  "stack": "rust",
  "language": "rust",
  "image": "rust:1.98-slim-bookworm",
  "check": "cargo check --all-targets --locked",
  "services": { "postgres": "postgres:18" },
  "blocks": [
    { "file": ".github/agents/architecture-reviewer.agent.md", "index": 0, "lang": "rust", "to": "src/samples/agent_architecture_reviewer.rs", "mode": "replace", "fill": { "token": "value" } }
  ],
  "skip": [
    { "file": "presets/rust/some-doc.md", "index": 2, "reason": "illustrates another project's layout" }
  ]
}
```

- `stack`: the preset directory under `presets/`. `language` (optional):
  the fenced-block language to check, if different from `stack`.
- `image`: the Docker image `check` runs in. `services` (optional): named
  containers (image refs) started on a private network before `check` runs
  — `postgres` gets a `DATABASE_URL` env var and is polled until it accepts
  connections.
- `blocks[]`: `file` is relative to `presets/<stack>/`; `index` counts that
  file's fenced blocks of `lang`, from 0. `to` is the scaffold-relative
  target path. `mode` is `replace` (whole file) or `append` (add to the
  end). `fill` (optional) maps template placeholders to literal values
  before the block is written.
- `skip[]`: same `file`/`index` shape plus a required `reason`. Every
  main-language block in the preset must appear in `blocks` or `skip`, or
  the manifest fails validation.

**`scripts/audit/preset-build/docker/<stack>/manifest.json`** (Dockerfile
build + health check — every stack with a documented Dockerfile):

```json
{
  "dockerfile": [
    { "file": "presets/go/deploy.md", "index": 0, "to": "Dockerfile", "port": 8080, "healthPath": "/health" }
  ],
  "skip": [
    { "file": "presets/go/deploy.md", "index": 1, "reason": "illustrative multi-stage variant, not the one scaffolded" }
  ]
}
```

- `dockerfile[]`: `file`/`index` identify the `dockerfile`-lang block in
  `presets/<stack>`; `to` (default `Dockerfile`) is where it's written over
  a copy of `docker/<stack>/scaffold/` (or `entry.scaffold` if set). `fill`
  works the same as the compile manifest. `port` (default `8080`) and
  `healthPath` (default `/health`) control the HTTP health poll after the
  built image is run; `protocol: "fastcgi"` falls back to a liveness check
  (container still running) for runtimes with no plain HTTP front end
  (e.g. php-fpm).
- `skip[]`: same shape as the compile manifest, reason required. Every
  `dockerfile`-lang block in the preset must appear in `dockerfile` or
  `skip`.
- A stack with no `docker/<stack>/manifest.json` (rust, swift today)
  trivially passes `--docker-only` with zero builds.

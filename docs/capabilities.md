# Plan Forge — Capabilities Reference

> **Tools**: 18 MCP | **Presets**: 9 | **Agents**: 19 | **Skills**: 12
>
> Machine-readable version: call `forge_capabilities` MCP tool or `GET https://planforge.software/.well-known/plan-forge.json`

---

## MCP Tools (18)

| Tool | Intent | Cost | Description |
|------|--------|------|-------------|
| `forge_capabilities` | discover | low | Returns full API surface — tools, workflows, config, memory, glossary |
| `forge_run_plan` | execute | high | Execute a hardened plan — DAG scheduling, validation gates, token tracking |
| `forge_abort` | stop | low | Abort active plan execution between slices |
| `forge_plan_status` | read | low | Latest run status from `.forge/runs/` |
| `forge_cost_report` | read | low | Cost tracking — total spend, per-model, monthly aggregation |
| `forge_smith` | diagnose | low | Environment diagnostics — VS Code config, setup health, version |
| `forge_validate` | validate | low | Check setup files, counts, placeholders |
| `forge_sweep` | scan | low | Find TODO/FIXME/stub/placeholder markers |
| `forge_status` | read | low | Phase status from DEPLOYMENT-ROADMAP.md |
| `forge_diff` | compare | low | Scope drift detection against plan's Scope Contract |
| `forge_analyze` | score | medium | Consistency scoring (0-100) with optional quorum mode for multi-model consensus. Supports plan/file modes and custom model overrides |
| `forge_diagnose` | analyze | medium | Multi-model bug investigation — dispatches file analysis to N models independently, synthesizes root cause + fix recommendations |
| `forge_ext_search` | search | low | Browse extension catalog |
| `forge_ext_info` | read | low | Extension details |
| `forge_new_phase` | create | low | Create plan file + roadmap entry |
| `forge_skill_status` | read | low | Query recent skill execution events from the hub |
| `forge_run_skill` | execute | medium | Execute any skill programmatically with dry-run mode and structured results |
| `forge_generate_image` | create | medium | Generate images via xAI Grok Aurora or OpenAI DALL-E. Saves to disk. For logos, diagrams, icons, mockups |

## Execution Modes

| Mode | Flag | Worker | Description |
|------|------|--------|-------------|
| **Full Auto** | *(default)* | `gh copilot` CLI | Agent executes each slice with full project context |
| **Assisted** | `--assisted` | Human in VS Code | Orchestrator prompts, human codes, gates validate |
| **Cloud Agent** | *(via `copilot-setup-steps.yml`)* | Copilot cloud agent | Cloud agent provisions environment, guardrails auto-load, MCP tools available |
| **Quorum** | `--quorum` | 3 models + reviewer | All slices: 3 dry-run analyses → synthesis → execute |
| **Quorum Auto** | `--quorum=auto` | 3 models (selective) | Only high-complexity slices (score ≥ threshold) get quorum |
| **Estimate** | `--estimate` | None | Returns cost prediction without executing |
| **Dry Run** | `--dry-run` | None | Parses and validates plan structure |
| **Resume** | `--resume-from N` | Same as auto | Skips completed slices |

## Agent-Per-Slice Routing

Assign a different AI model to each execution role via `modelRouting` in `.forge.json`. The orchestrator selects the appropriate model automatically based on the current operation:

| Role | Key | Default | Typical Use |
|------|-----|---------|-------------|
| General / fallback | `default` | `claude-opus-4.6` | Spec, harden, review |
| Slice execution | `execute` | `gpt-5.2-codex` | Writing code, generating tests |
| Review & audit | `review` | `claude-sonnet-4.6` | Gate checks, drift detection |

Config (`.forge.json`):
```json
{
  "modelRouting": {
    "default": "claude-opus-4.6",
    "execute": "gpt-5.2-codex",
    "review": "claude-sonnet-4.6"
  }
}
```

Override at runtime: `pforge run-plan <plan> --model gpt-5.2-codex` (applies to all roles for that run).
API providers (xAI Grok, etc.) are auto-routed by model name pattern — no extra config required.

## Auto-Escalation

When a slice fails repeatedly, the orchestrator automatically re-routes to the next model in `escalationChain` rather than retrying on the same model.

Config (`.forge.json`):
```json
{
  "escalationChain": ["auto", "claude-sonnet-4.6", "claude-opus-4.6"]
}
```

- Attempt 0: uses the configured/default model
- Attempt 1+: walks the chain in order (`"auto"` defers to `modelRouting.execute`)
- Emits `slice-escalated` event with `sliceId`, `reason`, and `models`
- Set `maxRetries` to control how many attempts are made before a slice is marked failed

## Model Performance Tracking

Per-slice performance data is appended to `.forge/model-performance.json` after every run. The orchestrator reads this file on startup and auto-selects the cheapest model with >80% historical success rate for each slice type.

| Field | Description |
|-------|-------------|
| `model` | Model name used for the slice |
| `sliceGoal` | Slice goal text (used for slice-type matching) |
| `passed` | `true` if the validation gate passed |
| `durationMs` | Slice execution time in milliseconds |
| `cost` | Estimated token cost for the slice |

- `--estimate` output shows the recommended model per slice with historical success rate
- Dashboard **Cost tab** shows a **Model Performance** table: run count, pass rate (color-coded), average duration, cost per run, total tokens
- `forge_cost_report` MCP tool includes `forge_model_stats` (aggregated per-model stats)

## CLI Commands (16)

```
pforge smith                          # Environment diagnostics
pforge check                          # Validate setup
pforge status                         # Phase status from roadmap
pforge sweep                          # Find deferred-work markers
pforge new-phase <name>               # Create plan + roadmap entry
pforge branch <plan>                  # Git branch from plan's Branch Strategy
pforge commit <plan> <N>              # Conventional commit from slice goal
pforge phase-status <plan> <status>   # Update roadmap status
pforge diff <plan>                    # Scope drift detection
pforge analyze <plan>                 # Consistency scoring (0-100)
pforge analyze <plan> --quorum        # Multi-model consensus analysis
pforge analyze <file> --mode file     # Code file analysis
pforge analyze <target> --models m1,m2 # Custom model lineup
pforge diagnose <file>                # Multi-model bug investigation
pforge diagnose <file> --models m1,m2 # Bug investigation with custom models
pforge run-plan <plan>                # Execute plan (Full Auto)
pforge run-plan <plan> --estimate     # Cost prediction
pforge run-plan <plan> --assisted     # Human + automated gates
pforge run-plan <plan> --quorum       # Multi-model consensus (all slices)
pforge run-plan <plan> --quorum=auto  # Consensus for complex slices only
pforge ext search|add|info|list       # Extension management
```

## API Providers

Plan Forge supports OpenAI-compatible HTTP endpoints via the `API_PROVIDERS` registry. Models are auto-routed by name pattern.

| Provider | Models | Env Var | Endpoint |
|----------|--------|---------|----------|
| **xAI Grok** | `grok-4.20`, `grok-4`, `grok-3`, `grok-3-mini` | `XAI_API_KEY` | `api.x.ai/v1` |

Set the env var, use any matching model name in `--models` or `.forge.json`, and the orchestrator routes automatically.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Current run status |
| GET | `/api/runs` | Run history (last 50) |
| GET | `/api/config` | Read `.forge.json` |
| POST | `/api/config` | Write `.forge.json` |
| GET | `/api/cost` | Cost report |
| POST | `/api/tool/:name` | Invoke CLI tool via HTTP |
| GET | `/api/hub` | WebSocket hub status |
| GET | `/api/replay/:run/:slice` | Session replay log |
| GET | `/api/traces` | All runs from index |
| GET | `/api/traces/:runId` | Single run trace detail |
| GET | `/api/capabilities` | Full capability surface |
| GET | `/.well-known/plan-forge.json` | Discovery endpoint |

Dashboard: `http://localhost:3100/dashboard` (8 tabs: Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces)

### Web UI — Live Dashboard

Real-time execution dashboard served at `http://localhost:3100/dashboard`. No build step required; updates via WebSocket as slices run.

| Tab | Purpose |
|-----|---------|
| **Progress** | Live slice cards — status, gate output, retry count |
| **Runs** | Full run history with pass/fail summary |
| **Cost** | Per-model spend, monthly aggregation, token breakdown |
| **Actions** | Trigger runs, abort, estimate cost |
| **Replay** | Session log replay for any past slice |
| **Extensions** | Browse, install, and manage extensions |
| **Config** | Edit `.forge.json` live — model routing, quorum, parallelism |
| **Traces** | OTLP waterfall timeline, span detail, severity filter |

Standalone (no MCP client needed): `node pforge-mcp/server.mjs --dashboard-only`

## Pipeline (6 Steps)

| Step | Name | Prompt | Agent | Description |
|------|------|--------|-------|-------------|
| 0 | Specify | `step0-specify-feature.prompt.md` | Specifier | Define what and why |
| 1 | Preflight | `step1-preflight-check.prompt.md` | — | Verify prerequisites |
| 2 | Harden | `step2-harden-plan.prompt.md` | Plan Hardener | Lock spec into execution contract |
| 3 | Execute | `step3-execute-slice.prompt.md` | Executor | Build slice-by-slice (or `pforge run-plan`) |
| 4 | Sweep | `step4-completeness-sweep.prompt.md` | — | Eliminate TODO/stub markers |
| 5 | Review | `step5-review-gate.prompt.md` | Reviewer Gate | Independent audit |

Session isolation: Steps 0-2 (Session 1) → Steps 3-4 (Session 2) → Step 5 (Session 3)

## Plan Format

```markdown
### Slice 1: Title [depends: Slice 2] [P] [scope: src/auth/**]
**Build command**: `dotnet build`
**Test command**: `dotnet test`

**Tasks**:
1. Create the service
2. Add validation

**Validation Gate**:
```bash
dotnet build
dotnet test
```
```

| Tag | Meaning |
|-----|---------|
| `[P]` | Parallel-eligible — runs concurrently with other `[P]` slices |
| `[depends: Slice N]` | Waits for Slice N to complete |
| `[scope: path/**]` | Restricts worker to these paths, enables conflict detection |

## Guardrails (17-18 per preset)

Auto-loading instruction files in `.github/instructions/`:

| Domain | File | Loads When |
|--------|------|-----------|
| Architecture | `architecture-principles.instructions.md` | All files |
| Context Management | `context-fuel.instructions.md` | All files |
| Security | `security.instructions.md` | Auth, middleware, API files |
| Database | `database.instructions.md` | Data access, migration files |
| Testing | `testing.instructions.md` | Test files |
| API Patterns | `api-patterns.instructions.md` | Controller, endpoint files |
| Error Handling | `errorhandling.instructions.md` | Exception, error files |
| Performance | `performance.instructions.md` | Hot paths, query files |
| Naming | `naming.instructions.md` | All files |
| + 9 more | See preset directory | Per `applyTo` pattern |

### Temper Guards & Warning Signs

Every instruction file includes two defensive sections:

- **Temper Guards** — tables of common shortcuts agents take that still produce compiling code but erode quality (e.g., "This is too simple to test" → "Simple code gets modified later. The test documents the contract."). Named after the metallurgical process — tempering strengthens steel against brittle failure.
- **Warning Signs** — observable behavioral patterns indicating the file's guidance is being violated (e.g., "Controller contains database queries", "Empty catch block"). Helps agents self-monitor during execution and reviewers catch violations during audit.

## Agents (19 per app preset)

**Stack-specific (6)**: architecture-reviewer, database-reviewer, deploy-helper, performance-analyzer, security-reviewer, test-runner

**Cross-stack (8)**: accessibility-reviewer, api-contract-reviewer, cicd-reviewer, compliance-reviewer, dependency-reviewer, error-handling-reviewer, multi-tenancy-reviewer, observability-reviewer

**Pipeline (6)**: specifier → preflight → plan-hardener → executor → reviewer-gate → shipper

**AI Tool Adapters**: `pforge init -Agent <tool>` generates adapter files for each platform:

| Adapter | Files Generated | Notes |
|---------|----------------|-------|
| `copilot` | `.github/copilot-instructions.md` | Default — always included |
| `claude` | `CLAUDE.md`, `.claude/commands/planforge/*.md` | Claude Code slash commands |
| `cursor` | `.cursorrules`, `.cursor/rules/*.mdc` | Cursor rules + commands |
| `windsurf` | `.windsurfrules`, `.windsurf/workflows/*.md` | Windsurf rules + workflows |
| `codex` | `AGENTS.md`, `.codex/context.md` | OpenAI Codex context |
| `gemini` | `GEMINI.md`, `.gemini/commands/planforge/*.toml`, `.gemini/settings.json` | Gemini CLI commands + MCP config |
| `generic` | `.ai/instructions.md`, `.ai/commands/` | Any AI tool (configurable dir) |
| `all` | All of the above | Full multi-tool support |

## Skills (12)

| Skill | Description |
|-------|-------------|
| `/database-migration` | Generate, review, test, deploy schema migrations |
| `/staging-deploy` | Build, push, migrate, deploy, verify |
| `/test-sweep` | Run all test suites, aggregate results |
| `/dependency-audit` | Vulnerabilities, outdated, license issues |
| `/security-audit` | OWASP scan, dependency CVEs, secret leak detection, hardening report |
| `/code-review` | Architecture, security, testing, patterns |
| `/release-notes` | Generate from git history + CHANGELOG |
| `/api-doc-gen` | OpenAPI spec generation + validation |
| `/onboarding` | New developer setup walkthrough |
| `/health-check` | Forge diagnostic: smith → validate → sweep |
| `/forge-execute` | Guided plan execution: list → estimate → execute → report |
| `/forge-troubleshoot` | Diagnose and resolve plan failures, gate errors, and environment issues |

## Telemetry

Per-run in `.forge/runs/<timestamp>/`:

| File | Format | Content |
|------|--------|---------|
| `trace.json` | OTLP JSON | Spans (SERVER/INTERNAL/CLIENT), events with severity, resource context |
| `manifest.json` | JSON | Artifact registry — lists all files in the run |
| `run.json` | JSON | Run metadata (plan, model, mode, sliceCount) |
| `summary.json` | JSON | Aggregate results, cost breakdown, sweep/analyze scores |
| `slice-N.json` | JSON | Per-slice result (status, tokens, gate output, attempts) |
| `slice-N-log.txt` | Text | Full worker stdout/stderr session log |
| `events.log` | Text | Timestamped lifecycle events |

Global: `.forge/runs/index.jsonl` — append-only run index for instant lookup

Severity levels: TRACE(1), DEBUG(5), INFO(9), WARN(13), ERROR(17), FATAL(21)

## Cost Tracking

- 23-model pricing table (Claude, GPT, Gemini)
- Per-slice token counts from worker stderr stats
- `.forge/cost-history.json` — aggregate across runs
- `forge_cost_report` MCP tool / `GET /api/cost`
- `--estimate` uses historical averages when available
- `--estimate --quorum` shows overhead breakdown per quorum-eligible slice

## Quorum Mode

Multi-model consensus: dispatch complex slices to 3 AI models for independent dry-run analysis, then a reviewer synthesizes the best approach.

```
slice → scoreComplexity (1-10)
          ├─ score < threshold → normal execution
          └─ score ≥ threshold → quorumDispatch
                    ├─ Claude Opus 4.6  → dry-run plan  ─┐
                    ├─ GPT-5.3-Codex    → dry-run plan  ─┼─ Promise.all() (parallel)
                    └─ Claude Sonnet    → dry-run plan  ─┘
                              ↓
                    quorumReview (synthesis — pick best approach per file)
                              ↓
                    spawnWorker (enhanced prompt) → gate ✓
```

| Signal | Weight | Source |
|--------|--------|--------|
| File scope count | 20% | `[scope:]` patterns in slice header |
| Cross-module deps | 20% | `[depends:]` tag count |
| Security keywords | 15% | auth, token, RBAC, encryption, JWT, etc. |
| Database keywords | 15% | migration, schema, ALTER, CREATE TABLE, etc. |
| Gate line count | 10% | Lines in validation gate |
| Task count | 10% | Number of tasks in slice |
| Historical failures | 10% | Past failure rate from `.forge/runs/` |

Config (`.forge.json`):
```json
{
  "quorum": {
    "enabled": false,
    "auto": true,
    "threshold": 7,
    "models": ["claude-opus-4.6", "gpt-5.3-codex", "gemini-3.1-pro"],
    "reviewerModel": "claude-opus-4.6",
    "dryRunTimeout": 300000
  }
}
```

CLI: `--quorum` (all slices) | `--quorum=auto` (threshold) | `--quorum-threshold N` (override)

Degradation: <2 successful dry-runs → falls back to normal execution. Reviewer failure → uses best single response.

### A/B Test Results (Invoice Engine — rate tiers, discounts, tax, banker's rounding)

| Metric | Standard | Quorum (3 models) | Delta |
|--------|----------|-------------------|-------|
| Pass rate | 4/4 | 4/4 | Tie |
| Duration | 12 min | 32 min | +168% |
| Tests generated | 15 | **18** | **+20%** |
| Code structure | Inline | **Extracted helpers** | Better |
| Test robustness | Hardcoded dates | **Relative dates** | Better |
| Edge cases | Standard | **+voided regen, +sequence** | Better |

## Memory Layers

Plan Forge uses three distinct memory systems. Each has a specific role in the 3-session pipeline:

| Layer | What It Is | Scope | Managed By | Best For |
|-------|-----------|-------|------------|---------|
| **Copilot Memory** | Built-in `/memories/` note storage (user / session / repo scopes) | User / Session / Repo | Copilot Chat natively | Free-form notes, personal patterns, ad-hoc insights |
| **Plan Forge Session Bridge** | Structured `/memories/repo/current-phase.md` + `lessons-learned.md` | Repository | You (via pipeline prompts) | Carrying Session 1 → 2 → 3 state through the hardening pipeline |
| **OpenBrain** | Semantic vector memory via MCP `search_thoughts` / `capture_thought` | Global (workspace-agnostic) | OpenBrain MCP server | Auto-injecting relevant prior decisions before each slice begins |

All three are complementary. A typical phase uses all three: Copilot Memory for quick notes, the session bridge files for structured handoffs, and OpenBrain for surfacing past decisions automatically without manual prompting.

See [COPILOT-VSCODE-GUIDE.md#memory-layers](COPILOT-VSCODE-GUIDE.md#memory-layers) for the full usage guide.

## OpenBrain Memory (Optional)

When configured (`.vscode/mcp.json` includes `openbrain`), the orchestrator injects prior decisions and conventions as context before each slice begins — bridging the 3-session model with long-term semantic memory.

| Hook | When | What |
|------|------|------|
| Before slice | Worker prompt injection | `search_thoughts` — prior conventions injected as context |
| After slice | Worker prompt injection | `capture_thought` — decisions recorded for future slices |
| After run | Summary field | `_memoryCapture` with run summary + cost anomaly |

Key OpenBrain tools: `search_thoughts`, `capture_thought`, `capture_thoughts`, `thought_stats`

## Presets

| Preset | Instructions | Agents | Prompts | Skills |
|--------|-------------|--------|---------|--------|
| dotnet | 17 | 19 | 15 | 9 |
| typescript | 18 | 19 | 15 | 9 |
| python | 17 | 19 | 15 | 9 |
| java | 17 | 19 | 15 | 9 |
| go | 17 | 19 | 15 | 9 |
| php | 17 | 19 | 15 | 9 |
| rust | 17 | 19 | 15 | 9 |
| swift | 16 | 19 | 13 | 9 |
| azure-iac | 12 | 18 | 6 | 3 |
| custom | 3 | 5 | 7 | 0 |

## Bridge (External Notifications)

The Plan Forge Bridge connects the WebSocket hub to external platforms, dispatching run events as notifications. Configured in `.forge.json` under the `bridge` key.

**Supported channels**: Telegram, Slack, Discord, generic webhooks

**Notification levels** (hierarchical — each level includes the ones below):

| Level | Events |
|-------|--------|
| `all` | run-started, slice-started, slice-completed, slice-failed, run-completed, run-aborted |
| `important` | run-started, slice-failed, run-completed, run-aborted |
| `critical` | slice-failed, run-aborted (+ run-completed with failures) |

**Config (`.forge.json`)**:
```json
{
  "bridge": {
    "enabled": true,
    "channels": [
      { "type": "telegram", "url": "https://api.telegram.org/bot<TOKEN>/sendMessage", "chatId": "<CHAT_ID>", "level": "important" },
      { "type": "slack",    "url": "https://hooks.slack.com/services/...", "level": "all" },
      { "type": "discord",  "url": "https://discord.com/api/webhooks/...", "level": "critical" },
      { "type": "webhook",  "url": "https://your-endpoint.example.com/hook", "level": "all" }
    ]
  }
}
```

Rate limit: 1 notification per 5 seconds per channel (anti-spam). Bridge reconnects automatically after disconnect.

Start the bridge: `node pforge-mcp/bridge.mjs` (or via dashboard standalone mode).

## CI/CD Hook Event

The `ci-triggered` event is emitted when a CI workflow is dispatched from a plan run, enabling external integrations to react when CI is started.

| Field | Description |
|-------|-------------|
| `workflow` | Workflow file name or ID |
| `ref` | Git ref (branch name or SHA) |
| `inputs` | Workflow dispatch input parameters |

The event is observable via the WebSocket hub (`GET /api/hub`) or captured in the run's `events.log` file. The `slice-escalated` event is emitted separately when a slice is re-routed to a new model via the escalation chain.

## Auto-Update

`pforge smith` automatically checks for a newer Plan Forge release:

- Fetches `VERSION` from the GitHub source tree with a 5 s timeout
- Result cached in `.forge/version-check.json` for 24 hours
- Warns: `⚠ New version available: vX.Y.Z → run pforge update`
- Silent when offline (network errors are suppressed)

Run `pforge update` to pull the latest release.

## Dual-Publish Extensions

`pforge ext publish <path>` validates the extension and outputs two catalog entries simultaneously:

- **Plan Forge catalog entry** — `catalog.json` format, installable with `pforge ext install`
- **Spec Kit-compatible entry** — `extensions.json` format for the Spec Kit extension registry

Extensions marked `speckit_compatible: true` in their `extension.json` work in both tools. See `extensions/PUBLISHING.md` for the full dual-publish workflow.

## Configuration (`.forge.json`)

```json
{
  "preset": "dotnet",
  "projectName": "MyApp",
  "modelRouting": {
    "default": "claude-opus-4.6",
    "execute": "gpt-5.2-codex",
    "review": "claude-sonnet-4.6"
  },
  "maxParallelism": 3,
  "maxRetries": 1,
  "maxRunHistory": 50,
  "quorum": {
    "enabled": false,
    "auto": true,
    "threshold": 7,
    "models": ["claude-opus-4.6", "gpt-5.3-codex", "gemini-3.1-pro"],
    "reviewerModel": "claude-opus-4.6"
  }
}
```

## Lifecycle Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| SessionStart | Agent session begins | Inject Project Principles + forbidden patterns |
| PreToolUse | Before file edit | Block edits to Forbidden Actions paths |
| PostToolUse | After file edit | Auto-format + warn on TODO/FIXME markers |
| Stop | Session ends | Warn if code changed but no tests run |

---

*Generated from the Plan Forge capability surface. For the live version, call `forge_capabilities` or visit `https://planforge.software/.well-known/plan-forge.json`.*

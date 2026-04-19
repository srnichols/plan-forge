# Extensions

> **Optional**: Extensions let teams share custom reviewers, prompts,
> and instruction files as installable packages.

## Overview

An extension is a folder containing guardrail files that can be
installed into any project using the Plan Forge Pipeline.
No runtime, no dependencies, no build step — just folders you copy.

## Structure

```
.forge/
└── extensions/
    ├── extensions.json              ← manifest of installed extensions
    └── <extension-name>/
        ├── extension.json           ← metadata (name, version, author)
        ├── instructions/            ← .instructions.md files
        ├── agents/                  ← .agent.md files
        ├── prompts/                 ← .prompt.md files
        └── README.md               ← usage documentation
```

## Extension Manifest (extension.json)

```json
{
  "name": "healthcare-compliance",
  "version": "1.0.0",
  "description": "HIPAA compliance guardrails and reviewer agent",
  "author": "your-org",
  "minTemplateVersion": "1.0.0",
  "files": {
    "instructions": ["hipaa.instructions.md"],
    "agents": ["hipaa-reviewer.agent.md"],
    "prompts": ["hipaa-checklist.prompt.md"]
  }
}
```

## Installing an Extension

### Manual (works everywhere)

1. Copy the extension folder to `.forge/extensions/<name>/`
2. Copy files from `instructions/` → `.github/instructions/`
3. Copy files from `agents/` → `.github/agents/`
4. Copy files from `prompts/` → `.github/prompts/`

### Using setup script

```powershell
.\setup.ps1 -InstallExtensions
```

### Using CLI (if installed)

```bash
pforge ext install .forge/extensions/healthcare-compliance
```

## Searching & Installing from the Community Catalog

Browse extensions without leaving the terminal:

```bash
pforge ext search                    # Show all available extensions
pforge ext search saas               # Filter by keyword
pforge ext search integration        # Filter by category
```

Install directly from the catalog (downloads + installs in one step):

```bash
pforge ext add saas-multi-tenancy    # Download and install
pforge ext info plan-forge-memory    # Show details before installing
```

The catalog is stored in `extensions/catalog.json` (fetches from GitHub if not local). Extensions marked with `speckit_compatible: true` also work as Spec Kit extensions.

### Publishing Your Extension

Use `pforge ext publish` to generate a ready-to-submit catalog entry from your extension's `extension.json`:

```bash
pforge ext publish .forge/extensions/my-extension
```

This validates your manifest, counts artifacts, and prints the catalog JSON to paste into `extensions/catalog.json`. It also prints the 4-step submission workflow:

1. **Fork** `https://github.com/srnichols/plan-forge`
2. **Edit** `extensions/catalog.json` — add the generated entry
3. **Open PR** with title: `feat(catalog): add <your-extension-name>`
4. **Link** to your extension's repository in the PR description

Your `extension.json` must include: `name`, `version`, `description`, `author`. Optional fields (`repository`, `license`, `category`, `tags`, `speckit_compatible`) are inferred with sensible defaults if omitted.

See [extensions/PUBLISHING.md](../extensions/PUBLISHING.md) for the full submission guide and catalog entry schema.

## Creating an Extension

1. Create a folder with the extension name
2. Add `extension.json` with metadata
3. Add your `.instructions.md`, `.agent.md`, and/or `.prompt.md` files
4. Add a `README.md` explaining what the extension provides
5. Distribute via GitHub repo, zip file, or any file-sharing method

See `templates/.forge/extensions/example-extension/` for a starter template.

## Example Extensions

The following example extensions are included in `docs/plans/examples/extensions/`:

| Extension | What It Adds | Best For |
|-----------|-------------|----------|
| `saas-multi-tenancy` | RLS policies, tenant isolation middleware, cross-tenant prevention | SaaS platforms with row-level security |
| `azure-infrastructure` | Bicep, Terraform, azd, CAF naming, security guardrails | Any app repo with an `infra/` folder |
| `plan-forge-memory` | Persistent decision capture, project history search, cross-session context | Any project — especially long-running or team-based |

> For pure Azure infrastructure repos (no application code), use the `azure-iac` preset instead of the extension.  
> See `presets/azure-iac/` for the full standalone preset.

### Featured: `plan-forge-memory` — Persistent Memory via OpenBrain

Plan Forge's 4-session isolation model prevents self-review bias but creates a side effect: **each session starts from zero context**. The agent that spent 45 minutes resolving a CQRS decision forgets it when the session ends. The next session re-discovers the same answer — or silently contradicts it.

The `plan-forge-memory` extension connects Plan Forge to [OpenBrain](https://github.com/srnichols/OpenBrain) — a self-hosted semantic memory server. Once installed, **106 files** across the pipeline automatically search OpenBrain for prior context before acting and capture decisions after completing. Knowledge compounds across phases instead of evaporating between sessions.

**What this means in practice:**

- **Less rework** — Agents find prior decisions before writing code, not after. A convention established in Phase 1 is automatically followed in Phase 8 without human reminding.
- **Fewer bugs from contradicted decisions** — The Executor searches for "data access patterns" before each slice and finds "Convention: all repos return domain objects, never DTOs" — preventing a pattern violation that would otherwise be caught at review (after the code is already written).
- **Lower token spend** — A single `search_thoughts()` returns the 5–10 most relevant prior decisions in ~500 tokens. Without memory, the agent reads 10+ files to reconstruct context (~5,000+ tokens). Multiply that by every slice in every phase.
- **Review quality compounds** — The Reviewer captures findings with `type: "postmortem"`. Future reviews search those — the agent already knows what to look for in this codebase.
- **Works across AI tools** — A decision captured from Copilot is searchable from Claude, Cursor, ChatGPT, or a terminal agent. Your context travels with you, not locked to one vendor.

**Install:**
```bash
pforge ext install docs/plans/examples/extensions/plan-forge-memory
```

**Requires:** [OpenBrain](https://github.com/srnichols/OpenBrain) running (Docker Compose, Kubernetes, or Azure — 5-minute setup). Zero cost if self-hosted with Ollama.

See the [extension README](plans/examples/extensions/plan-forge-memory/README.md) for the complete integration map, setup guide, and worked examples.

## Distribution Channels

| Channel | How | Best For |
|---------|-----|----------|
| **GitHub repo** | Clone or download | Open source extensions |
| **Git submodule** | `git submodule add <url> .forge/extensions/<name>` | Team-shared |
| **Manual copy** | Download and paste | Air-gapped / enterprise |

## Installed Extensions Manifest (extensions.json)

The `extensions.json` file in `.forge/extensions/` tracks which
extensions are installed. It is updated automatically by the setup script
or CLI, or you can edit it manually.

```json
{
  "description": "Installed Plan Forge extensions",
  "version": "1.0.0",
  "extensions": [
    {
      "name": "healthcare-compliance",
      "version": "1.0.0",
      "installedDate": "2026-03-23"
    }
  ]
}
```

---

## Tempering Scanner Extensions

The Tempering subsystem (TEMPER-03 Slice 03.2) introduced an extension surface for API contract scanners. The built-in scanner covers OpenAPI 3.x and GraphQL introspection; additional protocol scanners can be contributed as extensions.

### Scanner Contract

Every scanner extension module must export a single async function:

```js
export async function runScan(ctx) → ScannerResult
```

**`ctx` shape:**

| Field | Type | Description |
|-------|------|-------------|
| `config` | `object` | Loaded tempering config (from `.forge/tempering/config.json`) |
| `projectDir` | `string` | Absolute path to the project root |
| `runId` | `string` | Current run ID (e.g. `run-2026-04-19T…`) |
| `sliceRef` | `{plan, slice} \| null` | Optional plan+slice context |
| `importFn` | `Function` | Dynamic import for optional dependencies |
| `now` | `Function` | Monotonic clock (`() → number`) |
| `env` | `object` | `process.env`-shaped environment map |

**Return value (`ScannerResult`):**

```js
{
  scanner: string,      // e.g. "grpc-proto"
  verdict: "pass" | "fail" | "error" | "skipped" | "budget-exceeded",
  pass: number,
  fail: number,
  skipped: number,
  durationMs: number,
  violations?: Array<{ path?, method?, expected?, actual?, reason: string }>,
  reason?: string,      // when verdict is "skipped"
  details?: object,     // scanner-specific metadata
}
```

### Config Namespace

Each scanner extension should register its config under `config.scanners.<name>`:

```json
{
  "scanners": {
    "grpc-proto": {
      "enabled": true,
      "protoPath": "proto/",
      "baseUrl": "localhost:50051"
    }
  }
}
```

### Artifact Directory

Scanners write artifacts to `.forge/tempering/artifacts/<runId>/<scanner-name>/`. Use the `ensureScannerArtifactDir()` helper from `tempering/artifacts.mjs`.

### Requirements

- **Production guard**: Never fire requests against production URLs unless `config.scanners.<name>.allowProduction === true`. Use `looksLikeProduction()` from `ui-playwright.mjs`.
- **`X-Tempering-Scan: true` header**: All HTTP requests must include this header so servers can identify scanner traffic.
- **Never throw**: Return error frames instead of propagating exceptions.
- **Budget awareness**: Check `hardDeadline` between operations and return `verdict: "budget-exceeded"` if exceeded.

### Extension Opportunities

The following scanner slots are defined in `extensions/catalog.json` under `opportunities[]`:

| Name | Protocol | Status |
|------|----------|--------|
| `tempering-grpc` | gRPC proto contract scanner | Stub |
| `tempering-trpc` | tRPC router type-check scanner | Stub |
| `tempering-asyncapi` | AsyncAPI event contract scanner | Stub |

These are not installable via `pforge ext add` — they exist as contribution placeholders for the community.

---

## Tempering Bug-Adapter Extensions

The Tempering subsystem (TEMPER-06 Slice 06.2) introduced an extension surface for bug-tracking adapters. The built-in adapter covers GitHub Issues; additional provider adapters can be contributed as extensions.

### Adapter Contract

Every bug-adapter extension module must be placed at:

```
.forge/extensions/<provider>/tempering-bug-adapter.mjs
```

The module must export **4 async functions** — all must return `{ provider: string, ok: boolean, ... }` and **never throw**:

```js
export async function registerBug(bug, config, opts)
  // → { provider, ok, issueNumber?, url?, error?, warnings? }

export async function updateBugStatus(bug, config, opts)
  // → { provider, ok, commentId?, url?, error? }

export async function commentValidatedFix(bug, config, opts)
  // → { provider, ok, commentId?, url?, error? }

export async function syncStatusFromProvider(bugId, config, opts)
  // → { provider, ok, status?, labels?, error? }
```

### Parameter Shapes

**`bug`** — The full bug record from `.forge/bugs/<id>.json`:

| Field | Type | Description |
|-------|------|-------------|
| `bugId` | `string` | e.g. `bug-2026-04-19-001` |
| `fingerprint` | `string` | SHA-1 dedup fingerprint |
| `scanner` | `string` | Scanner that discovered the bug |
| `severity` | `string` | `critical` \| `high` \| `medium` \| `low` |
| `status` | `string` | `open` \| `in-fix` \| `fixed` \| `wont-fix` \| `duplicate` |
| `classification` | `string` | `real-bug` \| `infra` \| `needs-human-review` \| `unknown` |
| `evidence` | `object` | `{ testName, assertionMessage, stackTrace, ... }` |
| `affectedFiles` | `string[]` | Source files affected |
| `externalRef` | `object?` | `{ provider, issueNumber, url, syncedAt }` — set after first sync |

**`config`** — Loaded from `.forge.json` or `.forge/tempering/config.json`:

| Field | Type | Description |
|-------|------|-------------|
| `bugRegistry.integration` | `string` | Provider name: `"github"`, `"jsonl"`, or extension name |
| `bugRegistry.autoCreateIssues` | `boolean` | Must be `true` for `registerBug` to fire |
| `bugRegistry.labelPrefix` | `string` | Label prefix (default: `"tempering"`) |
| `bugRegistry.githubRepo` | `string?` | Explicit `owner/repo` override |

**`opts`** — Dependency injection bag:

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Project root directory |
| `fetch` | `Function?` | Override for `globalThis.fetch` |
| `execSync` | `Function?` | Override for `child_process.execSync` |

### Return-Value Contract

- Every function returns `{ provider: "<your-provider>", ok: boolean, ... }`.
- On failure: `{ provider, ok: false, error: "<ERROR_CODE>" }`.
- **Never throw.** Wrap all logic in try/catch and return error frames.

### Forbidden Actions

- **Never auto-close issues** — closing decisions belong to humans.
- **Never rewrite issue body on update** — updates must append comments only.

### Config Wiring

Set the integration provider in `.forge.json`:

```json
{
  "bugRegistry": {
    "integration": "<provider>",
    "autoCreateIssues": true,
    "labelPrefix": "tempering"
  }
}
```

Where `<provider>` matches your extension folder name under `.forge/extensions/`.

### Extension Opportunities

The following bug-adapter slots are defined in `extensions/catalog.json` under `opportunities[]`:

| Name | Provider | Status |
|------|----------|--------|
| `tempering-bug-gitlab` | GitLab Issues | Stub |
| `tempering-bug-azure-boards` | Azure DevOps Boards | Stub |
| `tempering-bug-jira-cloud` | Jira Cloud | Stub |
| `tempering-bug-linear` | Linear | Stub |
| `tempering-bug-jira-onprem` | On-prem Jira Server/DC | Stub |

These are not installable via `pforge ext add` — they exist as contribution placeholders for the community.

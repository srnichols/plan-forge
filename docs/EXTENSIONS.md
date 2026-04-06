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

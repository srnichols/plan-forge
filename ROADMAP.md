# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.  
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v1.2.2** (2026-04-02) — `azure-iac` preset, multi-preset support, `pforge.sh update` command.

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

---

## Shipped (Unreleased — Pending v1.3.0 Tag)

These features are on `master` and available to anyone who clones the repo. They'll be tagged as v1.3.0 soon.

- **`pforge smith`** — forge-themed diagnostics: environment, VS Code config, setup health, version currency, common problems (PS + Bash)
- **GitHub Action** (`srnichols/plan-forge-validate@v1`) — CI plan validation with 6 checks, configurable sweep, action outputs
- **Multi-agent support** — `-Agent claude|cursor|codex|all` generates rich native files:
  - Claude Code: `CLAUDE.md` with all 16 guardrails embedded + `.claude/skills/` (all prompts + all 18 reviewer agents)
  - Cursor: `.cursor/rules` with guardrails + `.cursor/commands/` (all prompts + all agents)
  - Codex CLI: `.agents/skills/` (all prompts + all agents)
  - Smart guardrail instructions emulate Copilot's auto-loading, post-edit scanning, and forbidden path checking
- **Extension ecosystem** — `pforge ext search/add/info` with `extensions/catalog.json` (Spec Kit catalog-compatible)
- **Spec Kit bridge** — Step 0 auto-detects Spec Kit artifacts, Project Principles Path D imports constitution, shared extension format
- **Spec Kit interop page** — `docs/speckit-interop.html` with combined workflow and artifact mapping
- **Feature parity table** — agent-by-agent comparison on `index.html`

---

## Planned

### v1.4 — MCP Server (Plan Forge as a Tool)

Expose Plan Forge operations as MCP tools so any agent with MCP support can invoke them as function calls — not just read prompt files.

- **`plan-forge-mcp` server** — lightweight MCP server (Node.js or Python) exposing:
  - `forge_smith` — run diagnostics, return structured JSON results
  - `forge_validate` — run setup validation, return pass/fail/warnings
  - `forge_sweep` — completeness sweep, return marker locations
  - `forge_status` — read roadmap phases, return structured status
  - `forge_diff` — scope drift check against active plan
  - `forge_ext_search` — search extension catalog, return matches
- **MCP config generation** — setup.ps1/sh generates `.vscode/mcp.json` (Copilot) and `.claude/mcp.json` (Claude) entries
- **Self-hosted** — runs locally alongside the project, zero cloud dependencies
- **Composable with OpenBrain** — if both MCP servers are configured, agents get Plan Forge operations + persistent memory in one session

### v1.5 — Cross-Artifact Analysis

~~Validate consistency across the full spec → plan → code → test chain.~~

**Shipped**: `pforge analyze <plan>` — consistency scoring with 4 dimensions (traceability, coverage, test coverage, gates). MCP tool `forge_analyze`. GitHub Action `analyze` input.

### v1.6 — Intelligence Layer

Data-driven pipeline optimization from historical execution data.

- **Token usage estimation** per slice — predict cost before executing
- **Plan complexity scoring** — auto-recommend pipeline depth (skip/light/full)
- **Historical metrics** — avg slices per phase, pass rates, common review findings
- **Slice duration estimation** — predict time from plan structure + past data
- Requires OpenBrain memory for historical data (optional — degrades gracefully without it)

---

## Backlog

These are planned but not yet prioritized into a version:

### Stack Expansion
- Rust preset (`presets/rust/`)
- PHP / Laravel preset (`presets/php/`)
- Swift / iOS preset (`presets/swift/`)

### Agent Expansion
- Gemini CLI adapter (requires TOML format — different from Markdown adapters)
- Windsurf adapter
- Generic bring-your-own-agent pattern (`--agent generic --commands-dir <path>`)

### Extension Ecosystem
- Dual-publish extensions to Spec Kit catalog
- Extension website or registry for discoverability
- Auto-update notification when source version is newer

### Enterprise
- **Team dashboard** for multi-developer plan coordination
- **Web UI** for plan visualization and status tracking
- Preset-specific validation minimum count checks in `validate-setup`

---

## Under Consideration

No committed timeline — evaluating based on community feedback:

- **Community walkthroughs** — greenfield and brownfield worked examples (demos like Spec Kit's repos)
- **`specify init` detection** — auto-detect Spec Kit project and layer Plan Forge guardrails on top
- ~~**Multi-model prompt variants** — GPT-4, Gemini-specific prompt tuning documentation~~ → shipped as "Tuning for Different Models" section in CUSTOMIZATION.md

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines

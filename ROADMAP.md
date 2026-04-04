# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.  
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v1.2.2** (2026-04-02) — `azure-iac` preset (Bicep/Terraform/PowerShell/azd + WAF/CAF/Landing Zone/Policy guardrails + enterprise `azure-sweeper` agent), multi-preset support (`-Preset dotnet,azure-iac`), `pforge.sh update` command, corrected skills/prompt/instruction counts across all docs.

**v1.2.1** (2026-04-01) — Claude 4.6 prompt engineering enhancements, pipeline workflow refinements, `pforge update` command (PowerShell + Bash), SVG logo, three-layer decision guide.

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

---

## Planned

### v1.3 — Stack Ecosystem Expansion
- Rust preset (`presets/rust/`)
- PHP / Laravel preset (`presets/php/`)
- Swift / iOS preset (`presets/swift/`)
- Community-contributed preset framework improvements

### v1.4 — Enhanced Automation
- Auto-update notification when source version is newer
- ~~`pforge doctor`~~ → shipped as `pforge smith` in v1.3.0
- Preset-specific validation minimum count checks in `validate-setup`

### v1.5 — Intelligence Layer
- Built-in token usage estimation per slice
- Plan complexity scoring (auto-recommend pipeline depth)
- Historical metrics from past phases (avg slices, pass rates, common findings)

---

### v1.6 — Broader Agent Support
- ~~First-class Claude Code integration (skills in `.claude/skills/`, `/speckit`-style slash commands)~~
- ~~Cursor agent support (`.cursor/` command directory)~~
- ~~`--ai <agent>` flag on setup to auto-configure the correct command format per agent~~
- Gemini CLI and Windsurf agent templates (deferred — TOML format adapter needed)
- Generic agent adapter for unsupported tools (bring-your-own-agent pattern)
- **Shipped**: Claude Code, Cursor, Codex CLI via `-Agent` / `--agent` parameter

### v1.7 — Community Extension Ecosystem
- ~~`pforge extension search` — browse and install community extensions from a catalog~~
- ~~`pforge extension publish` — package and submit extensions to the community catalog~~
- ~~Community preset framework — let contributors override templates/commands without forking~~
- ~~Extension categories: `docs`, `code`, `process`, `integration`, `visibility`~~
- **Shipped**: `pforge ext search/add/info` + `extensions/catalog.json` (Spec Kit catalog-compatible format)
- Dual-publish to Spec Kit catalog (deferred — needs community traction first)
- Extension website or registry for discoverability

### v1.8 — Specification Interoperability
- Spec Kit bridge — import Spec Kit `spec.md` / `plan.md` artifacts as Plan Forge execution contracts
- `/speckit.implement` → Plan Forge executor handoff (use Spec Kit for specify/plan, Plan Forge for hardened execution)
- Constitution-to-Project-Principles converter (map Spec Kit constitutions to Plan Forge `PROJECT-PRINCIPLES.md`)

---

## Under Consideration

These ideas are being evaluated but have no committed timeline:

- **Web UI** for plan visualization and status tracking
- ~~**GitHub Action** for automated plan validation in CI~~ → shipped as `srnichols/plan-forge-validate` action
- **MCP server** exposing Plan Forge operations as tools (plan, harden, review)
- **Multi-model support** documentation (prompt variants for GPT-4, Gemini, etc.)
- **Team dashboard** for multi-developer plan coordination
- **Specify CLI integration** — optional `specify init` detection that layers Plan Forge guardrails on top of a Spec Kit project
- **Community walkthroughs** — greenfield and brownfield worked examples (similar to Spec Kit's demo repos)
- **Cross-artifact analysis** — `/analyze` command that validates spec-to-plan-to-code consistency (inspired by Spec Kit's `/speckit.analyze`)

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines

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
- `pforge doctor` — diagnose common setup problems
- Preset-specific validation minimum count checks in `validate-setup`

### v1.5 — Intelligence Layer
- Built-in token usage estimation per slice
- Plan complexity scoring (auto-recommend pipeline depth)
- Historical metrics from past phases (avg slices, pass rates, common findings)

---

## Under Consideration

These ideas are being evaluated but have no committed timeline:

- **Web UI** for plan visualization and status tracking
- **GitHub Action** for automated plan validation in CI
- **MCP server** exposing Plan Forge operations as tools (plan, harden, review)
- **Multi-model support** documentation (prompt variants for GPT-4, Gemini, etc.)
- **Team dashboard** for multi-developer plan coordination

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines

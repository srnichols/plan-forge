# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.1.0] — 2026-03-23

### Added
- **Project Principles** — workshop prompt with 3 paths: interview, starter sets, codebase discovery
- **External Specification Support** — optional spec source field in Scope Contract with traceability
- **Requirements Register** — optional REQ-xxx → slice mapping with bidirectional verification in Step 5
- **Branch Strategy** — trunk / feature-branch / branch-per-slice guidance with preflight checking
- **Extension Ecosystem** — `.forge/extensions/` directory, manifest schema, install/remove workflow
- **CLI Wrapper** (`pforge`) — init, check, status, new-phase, branch, ext commands
- **CLI Guide** — `docs/CLI-GUIDE.md` with dual-audience (human + AI agent) documentation
- **Extensions Guide** — `docs/EXTENSIONS.md` with structure, manifest, distribution channels
- **Lifecycle Hooks** — `.github/hooks/plan-forge.json` with SessionStart (inject principles), PreToolUse (enforce Forbidden Actions), PostToolUse (warn on TODO/FIXME markers)
- **Skill Slash Commands** — all 3 skills now have proper frontmatter for `/database-migration`, `/staging-deploy`, `/test-sweep` invocation
- **5 New Skills** — `/dependency-audit`, `/code-review`, `/release-notes`, `/api-doc-gen`, `/onboarding` (8 total per preset)
- **2 New Shared Agents** — `dependency-reviewer.agent.md` (supply chain security) and `compliance-reviewer.agent.md` (GDPR/CCPA/SOC2)
- **Agents vs Skills explainer** — README now explains the difference with comparison table
- **Auto-format hook** — PostToolUse auto-runs project formatter (dotnet format, prettier, ruff, gofmt) after every file edit
- **`pforge commit`** — auto-generates conventional commit messages from slice goals
- **`pforge phase-status`** — updates roadmap status icons without manual editing
- **Setup wizard asks for build/test/lint commands** — eliminates placeholder editing step
- **Stop hook** — warns when agent session ends with code changes but no test run detected
- **`pforge sweep`** — scan code files for TODO/FIXME/stub/placeholder markers from terminal
- **`pforge diff`** — compare changed files against plan's Scope Contract for drift detection
- **Monorepo FAQ** — documents `chat.useCustomizationsInParentRepositories` setting
- **Agent Plugin Packaging** — `plugin.json` at repo root for `Chat: Install Plugin From Source` installation
- **VS Code Checkpoints** — added as Option 0 in Rollback Protocol for beginners
- **CHANGELOG** — version history
- **CONTRIBUTING.md** — contribution guide
- **VERSION file** — version tracking read by setup scripts
- **"Start Here" path selector** — quick navigation at top of README
- **Documentation Map** — reading order after setup
- **Troubleshooting table** — common problems and fixes in README

### Changed
- Renamed project from "AI Plan Hardening Template" to **Plan Forge**
- Renamed CLI from `pharden` to `pforge`
- Renamed config directory from `.plan-hardening/` to `.forge/`
- Renamed config file from `.plan-hardening.json` to `.forge.json`
- Updated all documentation, scripts, and presets for consistent branding
- CUSTOMIZATION.md now starts with Project Principles before Project Profile
- AGENT-SETUP.md Section 5 now documents CLI and post-setup recommendations
- Placeholder validation now shows "TODO" instead of "WARN" for better clarity
- Setup scripts auto-run validation after completing

## [1.0.0] — 2026-03-01

### Added
- Initial release
- 6-step pipeline (Step 0–5) with 3-session isolation
- 5 tech stack presets (dotnet, typescript, python, java, go) + custom
- 15 instruction files per preset with `applyTo` auto-loading
- 14 prompt templates per preset for scaffolding
- 6 stack-specific + 5 shared agent definitions per preset
- 3 skills per preset (database-migration, staging-deploy, test-sweep)
- Pipeline agents with handoff buttons (plan-hardener → executor → reviewer-gate)
- Setup wizard with auto-detection (`setup.ps1` / `setup.sh`)
- Validation scripts (`validate-setup.ps1` / `validate-setup.sh`)
- Worked examples for TypeScript, .NET, and Python

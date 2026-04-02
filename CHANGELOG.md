# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.2.2] — 2026-04-02

### Added
- **`azure-iac` preset** — Azure Bicep / Terraform / PowerShell / azd with 12 IaC-specific instruction files: `bicep`, `terraform`, `powershell`, `azd`, `naming`, `security`, `testing`, `deploy`, `waf`, `caf`, `landing-zone`, `policy`
- **`azure-sweeper` agent** — 8-layer enterprise governance sweep: WAF → CAF → Landing Zone → Policy → Org Rules → Resource Graph → Telemetry → Remediation codegen
- **WAF / CAF / Landing Zone / Policy instruction files** — Azure Well-Architected Framework, Cloud Adoption Framework, and Azure Landing Zone baselines; Azure Policy enforcement rules
- **3 azure-iac skills** — `/infra-deploy`, `/infra-test`, `/azure-sweep` slash commands
- **5 azure-iac agents** — `bicep-reviewer`, `terraform-reviewer`, `security-reviewer`, `deploy-helper`, `azure-sweeper`
- **6 azure-iac scaffolding prompts** — `new-bicep-module`, `new-terraform-module`, `new-pester-test`, `new-pipeline`, `new-azd-service`, `new-org-rules`
- **`azure-infrastructure` example extension** — for mixed app+infra repos using the `azure-iac` preset as an extension
- **Multi-preset support** — `setup.ps1 -Preset dotnet,azure-iac` and `setup.sh --preset dotnet,azure-iac` apply multiple presets in one pass; first preset sets `copilot-instructions.md` and `AGENTS.md`, subsequent presets add their unique files
- **`pforge.sh update`** — full `cmd_update()` bash implementation mirroring `pforge.ps1` `Invoke-Update`, with SHA256 hash comparison, preset-aware new-file delivery, and `--dry-run`/`--force` flags
- **Preset-aware `pforge update`** — both PS1 and SH update commands now deliver new preset-specific files (instructions, agents, prompts, skills) that don't yet exist in the project

### Fixed
- **Skills count corrected** — all presets ship with 8 skills (not 3); 5 additional skills (`dependency-audit`, `code-review`, `release-notes`, `api-doc-gen`, `onboarding`) were present in codebase but undocumented in counts
- **Instruction file count corrected** — 16 per app preset (not 15); `project-principles.instructions.md` was present but missing from totals (17 for TypeScript)
- **Prompt template count corrected** — 15 per app preset (not 14); `project-principles.prompt.md` was present but missing from count
- **Agent count corrected in AGENT-SETUP.md** — 18 per app preset installation (6 stack + 7 cross-stack + 5 pipeline), not 15
- **Update command preservation logic** — preset-aware update block now only ADDS new files; existing preset files (which may be user-customized) are never overwritten by either `pforge.ps1` or `pforge.sh`

### Changed
- `setup.ps1` and `setup.sh` wired for `azure-iac` auto-detection (`.bicep`, `bicepconfig.json`, `azure.yaml`, `*.tf` markers)
- `validate-setup.ps1` and `validate-setup.sh` have `azure-iac`-specific checks (`bicep.instructions.md`, `naming.instructions.md`, `deploy.instructions.md` instead of `database.instructions.md`)
- `AGENT-SETUP.md`, `docs/CLI-GUIDE.md`, README, CUSTOMIZATION.md, COPILOT-VSCODE-GUIDE.md all updated with correct counts, azure-iac tables, and multi-preset examples

---

## [1.2.1] — 2026-04-01

### Added
- **Claude Opus 4.6 prompt calibration** — softened aggressive STOP/MUST/HALT language across all pipeline prompts; Claude 4.6 is more responsive to instructions and overtriggers on aggressive phrasing
- **Few-shot examples in Step 0** — strong and weak specification examples (in `<examples>` tags) teach the model what good specs look like
- **MUST/SHOULD/MAY acceptance criteria** — structured format in Step 0 makes criteria mechanically testable and directly translatable to validation gates
- **Complexity estimation routing** — Step 0 now classifies work as Micro/Small/Medium/Large and recommends whether to skip, light-harden, or run the full pipeline
- **XML-structured spec output** — optional machine-readable `<specification>` block in Step 0 output for unambiguous downstream parsing
- **Plan quality self-check** — 7-point checklist in Step 2 catches broken plans before they enter execution (missing validation gates, unresolved TBDs, untraceable criteria)
- **Anti-hallucination directive** — `<investigate_before_coding>` block in Step 3 prevents the agent from assuming file contents without reading them
- **Anti-overengineering guard** — `<implementation_discipline>` block in Step 3 prevents adding features, abstractions, or error handling beyond what the slice requires
- **Context budget awareness** — slice templates now guide authors to list only domain-relevant instruction files (not all 15), reducing context window consumption
- **Lightweight re-anchor option** — 4 yes/no questions by default, full re-anchor every 3rd slice or on violation; saves ~500-1,000 tokens per clean slice
- **Session budget check** — Step 2 now flags plans with 8+ slices for session break points and slices with 5+ context files for trimming
- **Memory capture protocol** — Step 6 (Ship) now saves conventions, lessons learned, and forbidden patterns to `/memories/repo/` so future phases avoid past mistakes
- **Memory loading in Step 2** — hardening now reads `/memories/repo/` for prior phase lessons before scoping and slicing decisions
- **Claude 4.6 tuning section** — added to CUSTOMIZATION.md with guidance for over-halting, over-exploring, overengineering, context budgets, and effort parameter settings
- **Recommended plan template ordering** — Scope Contract and Stop Conditions first in hardened plans (most-referenced sections at top improves long-context performance)

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

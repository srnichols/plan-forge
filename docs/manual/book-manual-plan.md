# Plan Forge — User Manual

> **The Forge Guide**: From apprentice to master smith  
> **Format**: Static HTML book (`docs/manual/`), Tailwind CDN, GitHub Pages  
> **Status**: Planning — editorial outline complete, ready to scaffold

---

## Editorial Vision

This isn't a reference dump. It's a **learning journey** — a reader picks it up knowing nothing about Plan Forge and finishes understanding how to run autonomous AI development with confidence.

**Voice**: Authoritative but approachable. Like a senior engineer mentoring a colleague. No marketing language. No "revolutionary" or "cutting-edge." Direct, practical, occasionally wry.

**Structure**: Three acts — **Learn** (what and why), **Build** (hands-on), **Master** (advanced + reference). A reader can enter at any act depending on experience.

**The blacksmith metaphor runs throughout**: forge, harden, smith, anvil, hammer, heat, temper. Chapter opens use it lightly — never forced, never explained twice.

---

## Act I — Learn the Forge

### Chapter 1: What Is Plan Forge?

**Purpose**: Answer "should I keep reading?" in 5 minutes.  
**Tone**: Conversational. Problem → solution. No setup instructions yet.

**Sections**:
1. **The problem in one sentence** — AI coding agents are powerful but directionless
2. **What happens without guardrails** — real examples of drift, scope creep, style chaos
3. **What Plan Forge does** — one paragraph, no jargon
4. **The blacksmith analogy** — raw iron (idea) → heated (specified) → hammered (hardened) → cooled (executed) → inspected (reviewed)
5. **Who this is for** — solo devs, teams, enterprises (3 short paragraphs)
6. **What this is NOT** — not a code generator, not a CI system, not a project manager
7. **How to read this manual** — act structure, where to start based on role

**Source material**: README.md (problem/solution sections), docs/problem.html  
**Unique content to write**: The opening narrative, "what this is NOT" section  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Chapter hero | A forge workshop silhouette — anvil, glowing metal, tools on wall. Dark, moody, amber highlights. | 1200×400 | Grok: "dark fantasy forge workshop panoramic, amber firelight, silhouette of anvil and tools, no text, dark background" |
| Before/after diagram | Split panel: left = chaotic AI output (tangled wires), right = structured output (organized forge) | 800×400 | Grok: "split comparison, left side chaotic colorful wires tangled mess, right side organized glowing amber circuits in clean grid, dark background" |

**Screenshots**: None (conceptual chapter)  
**Animations**: None

---

### Chapter 2: How It Works

**Purpose**: Mental model. Reader understands the pipeline, sessions, and file structure without touching a terminal.  
**Tone**: Explanatory. Diagrams do the heavy lifting.

**Sections**:
1. **The 7-step pipeline** — visual walkthrough of Specify → Preflight → Harden → Execute → Sweep → Review → Ship
2. **Sessions and why they matter** — why Session 1 (plan) ≠ Session 2 (execute) ≠ Session 3 (review). Context isolation explained simply.
3. **The file system** — what `.github/instructions/`, `.github/agents/`, `.github/prompts/`, `.github/skills/` contain and why they're separated
4. **How Copilot reads guardrails** — the `applyTo` mechanism in 3 sentences + a diagram
5. **The `.forge.json` config** — what it stores, how it drives behavior
6. **Plans are Markdown** — a plan is just a `.md` file with structure. Show a minimal example.
7. **Slices, gates, and scope** — the three building blocks of every plan

**Source material**: AI-Plan-Hardening-Runbook.md (pipeline), COPILOT-VSCODE-GUIDE.md (sessions, applyTo), capabilities.md (file structure)  
**Unique content to write**: Simplified pipeline walkthrough without the full runbook detail  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Pipeline flow | 7-step horizontal flow with icons per step. Forge-amber accent. | 1200×300 | Mermaid diagram, rendered to SVG. Also provide as fallback `.png` via Grok |
| Session isolation | 3 panels (Plan / Execute / Review) with walls between them | 900×250 | Grok: "three separate forge chambers side by side, each with different tools, glass walls between them, dark background amber light" |
| File tree | Annotated `.github/` directory tree showing what auto-loads when | 600×400 | HTML/CSS diagram (not an image) |

**Screenshots**: None  
**Animations**: 
| Animation | Description | Format |
|-----------|------------|--------|
| applyTo matching | File opens → matching instruction file highlights in sidebar | GIF, 600×400, 3 sec loop |

---

### Chapter 3: Installation

**Purpose**: Get Plan Forge running. Zero to `pforge smith` green in 10 minutes.  
**Tone**: Step-by-step. Numbered. Every command has expected output.

**Sections**:
1. **Prerequisites** — VS Code, Copilot subscription, Node.js (for MCP), git. Version requirements table.
2. **Option A: One-click install** — `vscode://chat-plugin/install` link (VS Code 1.113+)
3. **Option B: Setup wizard** — `setup.ps1 -Preset dotnet` / `setup.sh --preset typescript` with full output
4. **Choosing your preset** — 9-card grid with stack logos, what each installs (instruction count, agent count)
5. **What just happened?** — tour of the files created, with a file tree
6. **Verify with `pforge smith`** — run smith, read the output, understand each section
7. **Multi-agent setup** — adding Claude, Cursor, Codex, Gemini, Windsurf adapters
8. **Updating** — `pforge update` when new versions are available

**Source material**: AGENT-SETUP.md, README.md (Quick Start), QUICKSTART-WALKTHROUGH.md (setup section)  
**Unique content to write**: Simplified single-path instructions (the existing docs cover every edge case — the manual covers the happy path)  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Preset grid | 9 tech stack cards with icons (C#, TS, Python, Java, Go, Swift, Rust, PHP, Azure IaC) | 1000×400 | Reuse docs/assets/tech-stacks-grid.webp or regenerate with cleaner layout |
| Agent adapter icons | 7 small logos: Copilot, Claude, Cursor, Codex, Gemini, Windsurf, Generic | 700×60 | Icon strip, SVG preferred |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Smith output | Clean `pforge smith` output showing all green checks | 800×600 |
| VS Code after setup | File explorer showing `.github/` tree after successful setup | 600×800 |
| Plugin install | One-click install dialog in VS Code | 500×300 |

**Animations**:
| Animation | Description | Format |
|-----------|------------|--------|
| Setup wizard | Terminal recording: `setup.ps1 -Preset dotnet` full run, 30 sec | GIF or WebM, 800×500 |

---

## Act II — Build with the Forge

### Chapter 4: Your First Plan

**Purpose**: Hands-on. Reader specifies, hardens, and executes a real feature in 30 minutes.  
**Tone**: Tutorial. "Do this, then this, then this." Expected output at every step.

**Sections**:
1. **What we're building** — `GET /health` endpoint. Simple, safe, teaches the full flow.
2. **Step 0: Specify** — open Copilot, use the specifier agent, answer the interview. Show exact prompts and responses.
3. **Step 1: Preflight** — run the preflight check, confirm all guardrails loaded
4. **Step 2: Harden** — watch the plan-hardener agent convert your spec into a hardened plan. Show the output.
5. **Reading the hardened plan** — annotated walkthrough: scope contract, slices, gates, forbidden actions, stop conditions. Every section explained.
6. **Step 3: Execute** — three ways shown side by side:
   - **Automatic**: `pforge run-plan` (kick off and walk away)
   - **Assisted**: human codes, orchestrator validates gates
   - **Manual**: copy-paste prompts in any AI tool
7. **Step 4: Sweep** — what the completeness sweep checks, how to fix findings
8. **Step 5: Review** — how the reviewer-gate agent audits independently
9. **Step 6: Ship** — `pforge commit`, update roadmap, done

**Source material**: QUICKSTART-WALKTHROUGH.md (primary), greenfield-todo-api.md walkthrough  
**Unique content to write**: Annotated plan walkthrough (section 5 — no existing doc explains each plan section for a beginner)  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Plan anatomy | Annotated plan file with callout arrows pointing to each section (scope contract, slices, gates, etc.) | 900×700 | Screenshot + overlay annotations in HTML/CSS |
| Execution modes | 3-panel comparison: Automatic (robot icon) / Assisted (human+robot) / Manual (human) | 800×250 | Grok: "three panels dark background, left robot working alone, middle human and robot collaborating, right human working with clipboard, amber accents, simple icons" |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Specifier interview | Copilot chat showing Step 0 specifier questions | 700×500 |
| Hardened plan output | The plan-hardener agent's output in chat | 700×600 |
| Gate pass | Terminal showing validation gate passing (green ✅) | 600×200 |
| Reviewer output | Reviewer-gate agent's audit with severity ratings | 700×400 |
| Dashboard progress | Progress tab showing slices executing | 900×500 |

**Animations**:
| Animation | Description | Format |
|-----------|------------|--------|
| Full pipeline | Screen recording of the complete specify→ship flow, narrated with captions | WebM, 1200×700, 2 min |
| Assisted mode | Human typing code, orchestrator popping up with gate validation | GIF, 800×500, 15 sec |

---

### Chapter 5: Writing Plans That Work

**Purpose**: Teach plan authoring. Reader learns to write plans that the orchestrator can execute reliably.  
**Tone**: Mentoring. "Here's what works and here's what breaks."

**Sections**:
1. **Plan structure** — the mandatory sections and why each exists
2. **Writing a good scope contract** — in-scope, out-of-scope, forbidden actions. Examples of tight vs loose scoping.
3. **Slicing strategy** — how to break work into 30-120 minute chunks. The "one PR" rule.
4. **Validation gates** — writing gates that actually catch problems. Bad gates vs good gates.
5. **Parallel execution** — `[P]` tag, `[depends: Slice N]`, `[scope: path/**]`. When to parallelize, when not to.
6. **Stop conditions** — what halts execution. Writing conditions that don't false-positive.
7. **Context files** — listing only relevant instruction files per slice (don't load all 17)
8. **Common mistakes** — plans that specify too loosely, plans that over-constrain, plans that forget gates
9. **Plan templates** — links to the 8 language-specific examples

**Source material**: AI-Plan-Hardening-Runbook.md (sections on scope, slicing, gates, parallel), docs/plans/examples/*.md  
**Unique content to write**: "Common mistakes" section, annotated good-vs-bad examples  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Slice anatomy | Single slice with callout for each part (title, scope tag, tasks, gate, stop condition) | 700×400 | HTML/CSS annotated code block |
| DAG diagram | 8-slice plan showing parallel groups and dependencies as a directed graph | 800×400 | Mermaid SVG |
| Good vs bad gate | Split panel: left = vague gate ("tests pass"), right = specific gate (exact `npm test` command with expected output) | 800×300 | Styled HTML comparison |

**Screenshots**: None (conceptual + code examples)  
**Animations**: None

---

### Chapter 6: The Dashboard

**Purpose**: Tour every dashboard tab. Reader knows what each shows and how to use it.  
**Tone**: Visual tour. Lead with screenshots, explain in captions.

**Sections**:
1. **Starting the dashboard** — `node pforge-mcp/server.mjs` → `localhost:3100/dashboard`
2. **Progress tab** — real-time slice cards, WebSocket updates, pending → executing → pass/fail
3. **Runs tab** — run history table, status, cost, duration, filtering
4. **Cost tab** — total spend, model breakdown doughnut chart, monthly trend bar chart
5. **Actions tab** — one-click buttons: Smith, Sweep, Analyze, Status, Validate, Extensions
6. **Replay tab** — browse agent session logs per slice, error/file filters
7. **Extensions tab** — visual extension catalog browser with search
8. **Config tab** — visual `.forge.json` editor, model routing, agent toggles
9. **Traces tab** — OTLP trace waterfall, span detail, severity filters

**Source material**: docs/dashboard.html, pforge-mcp/dashboard/app.js (tab names and logic)  
**Unique content to write**: Captions and explanations connecting each tab to the workflow  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Dashboard overview | Stylized illustration of a forge command center with 9 monitor screens | 1200×400 | Grok: "sci-fi forge command center, 9 holographic monitors in a semicircle, dark room, amber and purple glow, no text" |

**Screenshots** (all from `capture-screenshots.mjs`):
| Screenshot | Description | Size |
|-----------|------------|------|
| Progress tab | Mid-run: 3 slices passed, 1 running, 4 queued | 1100×600 |
| Runs tab | History showing 5+ completed runs | 1100×600 |
| Cost tab | Doughnut chart + monthly bar chart with data | 1100×600 |
| Actions tab | Button grid layout | 1100×600 |
| Replay tab | Session log with error highlighting | 1100×600 |
| Extensions tab | Catalog with search results | 1100×600 |
| Config tab | Editor showing model routing + agents | 1100×600 |
| Traces tab | Waterfall view with expanded span | 1100×600 |

**Animations**:
| Animation | Description | Format |
|-----------|------------|--------|
| Live progress | Slices transitioning from queued → running → passed in real-time | GIF, 1100×600, 10 sec loop |

---

## Act III — Master the Forge

### Chapter 7: CLI Reference

**Purpose**: Every command, every flag, every example. The chapter you bookmark.  
**Tone**: Reference. Consistent format per command. No narrative.

**Format per command**:
```
### `pforge <command>`
> One-line description

**Usage**: `pforge <command> [flags]`

| Flag | Type | Default | Description |
|------|------|---------|-------------|

**Example**:
[code block with output]

**Equivalent manual steps**: [what to do without the CLI]
```

**Commands to document** (16+): init, check, smith, status, new-phase, branch, commit, phase-status, sweep, diff, analyze, diagnose, run-plan, ext (search/add/info/list/remove/publish), update, org-rules

**Source material**: CLI-GUIDE.md (primary — restructure into consistent format)  
**Unique content to write**: Consistent formatting (CLI-GUIDE uses mixed formatting currently)  

**Page art**: None (pure reference)  
**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Smith output | Full colored smith output | 800×800 |
| Analyze output | Consistency score breakdown | 800×400 |
| Run-plan output | Mid-execution progress table | 800×500 |
| Sweep output | TODO/FIXME findings | 800×300 |

**Animations**: None

---

### Chapter 8: Customization

**Purpose**: Tailor Plan Forge to your project. From Project Principles to custom instruction files.  
**Tone**: Guide. "Here's how to make it yours."

**Sections**:
1. **The two-layer model** — universal baseline (shipped) vs project-specific (you write). Diagram.
2. **Project Principles** — what they are, when to create them, the guided workshop. Full example.
3. **Project Profile** — the interview that generates `project-profile.instructions.md`. When it helps vs when to skip.
4. **Editing `copilot-instructions.md`** — the master config file. What to put in it, what to leave out.
5. **Writing custom instruction files** — `applyTo` patterns, YAML frontmatter, domain-specific rules. Step-by-step.
6. **Customizing agents** — modifying reviewer agents, creating new ones, setting tool restrictions.
7. **Customizing skills** — adding multi-step workflows as slash commands.
8. **Customizing prompts** — editing scaffolding prompts for your patterns.
9. **Configuration hierarchy** — `.forge.json` → `preferences.json` → `.vscode/settings.json`. What lives where.

**Source material**: CUSTOMIZATION.md (primary)  
**Unique content to write**: Configuration hierarchy diagram (new with v2.17 preferences)  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Two-layer model | Layer 1 (universal, shipped) → Layer 2 (project-specific, you write) | 800×300 | Mermaid SVG |
| Config hierarchy | `.forge.json` (team) → `preferences.json` (personal) → VS Code settings | 800×300 | Mermaid SVG |
| applyTo matching | File glob pattern → matching files highlighted | 700×250 | HTML/CSS interactive example |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Project Principles workshop | Copilot chat during the principles interview | 700×500 |
| Custom instruction file | A `.instructions.md` file open in editor showing frontmatter | 600×400 |

**Animations**: None

---

### Chapter 9: Instruction Files & Agents

**Purpose**: Deep dive into the guardrail system. What each instruction file covers, how agents work, how skills chain.  
**Tone**: Reference + explanation. Per-domain coverage.

**Sections**:
1. **Instruction files overview** — what they are, how `applyTo` auto-loading works, where they live
2. **Universal files** (ship with every preset):
   - `architecture-principles.instructions.md` — the 5 questions, 4-layer architecture
   - `git-workflow.instructions.md` — conventional commits, push reminders
   - `status-reporting.instructions.md` — output templates for orchestration
3. **Domain files** (per-preset): API patterns, auth, caching, database, deploy, error handling, messaging, multi-environment, observability, performance, security, testing, version
4. **Stack-specific notes** — per-preset differences (TypeScript adds frontend, Swift drops graphql, etc.)
5. **Agents** — 6 stack-specific + 8 cross-stack + 5 pipeline. What each reviews, when each activates.
6. **Skills** — 12 slash commands. What each does, when to use each.
7. **Lifecycle hooks** — SessionStart, PreToolUse, PostToolUse, Stop. What they enforce automatically.

**Source material**: capabilities.md (agent/skill lists), COPILOT-VSCODE-GUIDE.md (applyTo), presets/dotnet/ instruction files (content)  
**Unique content to write**: Per-domain summaries (currently only available by reading each file)  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Auto-loading diagram | File opens → matching instruction file activates | 800×300 | Mermaid SVG |
| Agent taxonomy | Tree: Stack-specific (6) → Cross-stack (8) → Pipeline (5) | 800×400 | Mermaid SVG |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Agent picker | VS Code agent dropdown showing available agents | 500×400 |
| Skill invocation | `/security-audit` skill running in chat | 700×400 |

**Animations**:
| Animation | Description | Format |
|-----------|------------|--------|
| Instruction auto-load | Open a `*.test.ts` file → `testing.instructions.md` badge appears | GIF, 700×300, 3 sec |

---

### Chapter 10: MCP Server & Tools

**Purpose**: The 18 MCP tools, REST API, WebSocket hub, and telemetry system.  
**Tone**: Reference + architecture. For developers integrating or extending.

**Sections**:
1. **Architecture** — single Node.js process: MCP (stdio) + Express (HTTP) + WebSocket (events)
2. **Starting the server** — `node pforge-mcp/server.mjs`, ports 3100/3101, `.vscode/mcp.json` config
3. **MCP tools catalog** — all 18 tools with input/output schemas, examples
4. **REST API** — 16+ endpoints, request/response examples
5. **WebSocket hub** — event types, client connection, real-time dashboard updates
6. **Telemetry** — OTLP traces, span hierarchy, `.forge/runs/` structure
7. **Cost tracking** — model pricing table, cost-history.json, per-run breakdown

**Source material**: capabilities.md (primary), EVENTS.md (WebSocket), tools.json, server.mjs  
**Unique content to write**: Architecture diagram, tool-by-tool reference cards  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Architecture diagram | MCP ↔ Express ↔ WebSocket on a single process | 900×400 | Mermaid SVG |
| Trace waterfall | Example trace with parent/child spans | 800×400 | Screenshot or Mermaid |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Traces tab waterfall | Expanded trace with span detail | 1100×600 |
| MCP tool invocation | Copilot calling `forge_run_plan` in chat | 700×400 |

**Animations**: None

---

### Chapter 11: Extensions

**Purpose**: Install, create, and publish guardrail extensions.  
**Tone**: Tutorial + reference. Step-by-step for creating, catalog for browsing.

**Sections**:
1. **What extensions add** — custom instruction files, agents, prompts packaged together
2. **Browsing the catalog** — `pforge ext search`, filtering, the web catalog
3. **Installing an extension** — `pforge ext add <name>`, what gets copied where
4. **Creating your own extension** — 5-step process with example (saas-multi-tenancy)
5. **Extension manifest** — `extension.json` schema, versioning
6. **Publishing** — `pforge ext publish`, submission to catalog
7. **Featured extensions** — plan-forge-memory (OpenBrain), azure-infrastructure

**Source material**: EXTENSIONS.md, extensions/PUBLISHING.md, extensions/catalog.json  
**Unique content to write**: Step-by-step extension creation walkthrough  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Extension lifecycle | search → install → use → update → remove flow | 800×200 | Mermaid SVG |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Extension catalog | Dashboard Extensions tab with 3+ extensions | 1100×600 |
| ext search output | Terminal showing `pforge ext search` results | 800×300 |

**Animations**: None

---

### Chapter 12: Multi-Agent Setup

**Purpose**: Configure Plan Forge for Claude Code, Cursor, Codex, Gemini, Windsurf, and Generic agents.  
**Tone**: Reference + comparison. Feature parity matrix.

**Sections**:
1. **One setup, all agents** — `setup.ps1 -Agent all` and what it creates
2. **Agent comparison matrix** — feature parity table (instruction format, skill support, MCP, Full Auto)
3. **GitHub Copilot** — `.github/copilot-instructions.md`, native integration, Agent Mode
4. **Claude Code** — `CLAUDE.md`, 33+ skills, Full Auto, memory hooks
5. **Cursor** — `.cursor/rules/`, commands, Cascade integration
6. **Codex** — `.agents/skills/`, terminal-based execution
7. **Gemini** — `GEMINI.md`, `.gemini/commands/*.toml`
8. **Windsurf** — `.windsurf/rules/*.md`, trigger frontmatter, workflows
9. **Generic** — `AI-ASSISTANT.md` for any tool (ChatGPT, Ollama, etc.)
10. **Quorum mode** — multi-model consensus, model routing, escalation chains

**Source material**: AGENT-SETUP.md (agent sections), CUSTOMIZATION.md (agent mode), capabilities.md (adapter list)  
**Unique content to write**: Side-by-side comparison with screenshots of each agent's file format  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Agent ecosystem | 7 agent logos connected to central Plan Forge hub | 900×400 | Grok: "7 AI tool logos (robot icons, each different color) connected by glowing lines to a central amber anvil, dark background, network diagram style" |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| CLAUDE.md | Claude Code reading the embedded guardrails | 700×400 |
| .cursor/rules | Cursor rules file in editor | 700×300 |
| Agent comparison | Side-by-side of 3 agents executing same task | 1200×400 |

**Animations**: None

---

### Chapter 13: Advanced Execution

**Purpose**: Model routing, quorum mode, cost optimization, CI integration, cloud agents.  
**Tone**: Advanced guide. Assumes Chapter 4 knowledge.

**Sections**:
1. **Model routing** — `.forge.json` modelRouting config. Which model for execution vs review.
2. **Escalation chains** — auto-escalation on failure. Configuring the chain.
3. **Quorum mode** — multi-model consensus. When to use, cost implications, threshold tuning.
4. **Cost optimization** — `model-performance.json`, agent-per-slice routing, historical data driving selection
5. **CI integration** — GitHub Actions with `plan-forge-validate.yml`, PR quality gates, threshold scoring
6. **Cloud agent** — `copilot-setup-steps.yml`, running Plan Forge in GitHub's cloud agent
7. **Parallel execution** — when slices can run concurrently, conflict detection, merge checkpoints
8. **Resume and retry** — `--resume` flag, gate failure recovery, manual intervention points

**Source material**: capabilities.md (execution modes), CLI-GUIDE.md (run-plan flags), COPILOT-VSCODE-GUIDE.md (cloud agent)  
**Unique content to write**: Cost optimization strategy guide, quorum decision framework  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Escalation chain | Model A fails → Model B retries → Model C succeeds | 800×200 | Mermaid SVG |
| Quorum consensus | 3 models propose → reviewer synthesizes → best output selected | 800×300 | Mermaid SVG |
| CI pipeline | PR → validate → score → merge/block flow | 800×200 | Mermaid SVG |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Cost tab chart | Monthly cost breakdown by model | 1100×600 |
| Quorum output | 3-model comparison in terminal | 800×500 |
| GitHub Actions | PR check showing Plan Forge validation | 800×300 |

**Animations**: None

---

### Chapter 14: Troubleshooting

**Purpose**: "Something's wrong." Find the answer fast.  
**Tone**: Problem → diagnosis → fix. Decision tree format.

**Sections**:
1. **Diagnostic tools** — `pforge smith`, `pforge check`, `pforge diagnose`
2. **"Agent isn't following guardrails"** — instruction files not loading, applyTo mismatch, context budget exceeded
3. **"Plan execution fails"** — gate failures, model errors, timeout, scope violations
4. **"Dashboard won't load"** — port conflicts, missing dependencies, node version
5. **"Setup failed"** — preset not found, permission errors, existing files conflict
6. **"Costs are too high"** — model routing, quorum threshold tuning, context budget reduction
7. **"Files are missing after update"** — `pforge update` behavior, never-update list, force flag
8. **Common error messages** — table of error strings → causes → fixes
9. **Getting help** — GitHub Issues, community, CONTRIBUTING.md

**Source material**: faq.html (FAQ answers), COPILOT-VSCODE-GUIDE.md (troubleshooting section)  
**Unique content to write**: Decision tree diagrams, common error message table  

**Page art**:
| Asset | Description | Size | Notes |
|-------|------------|------|-------|
| Diagnostic decision tree | "What's wrong?" → branching paths to solutions | 900×600 | Mermaid SVG (flowchart) |

**Screenshots**:
| Screenshot | Description | Size |
|-----------|------------|------|
| Smith with failures | `pforge smith` showing ❌ failures with FIX suggestions | 800×600 |
| Diagnose output | `pforge diagnose` multi-model investigation | 800×500 |

**Animations**: None

---

## Appendices

### Appendix A: Glossary

**Purpose**: Alphabetical definitions of every Plan Forge term.  
**Source**: `capabilities.mjs` glossary object (auto-generate, then edit for clarity)

~40 terms: DAG, Extension, Forge, Gate, Guardrail, Hardened Plan, Hub, Lifecycle Hook, Manifest, OpenBrain, Orchestrator, Pipeline, Plan, Preferences, Preset, Quorum, Run, Scope Contract, Slice, Smith, Span, Sweep, Telemetry, Trace, Validation Gate, Worker...

### Appendix B: Quick Reference Card

**Purpose**: Two-page printable cheat sheet. Commands, keyboard shortcuts, file locations.  
**Format**: Dense 2-column layout. Print-optimized.

| Section | Content |
|---------|---------|
| CLI commands | All 16 commands with one-line descriptions |
| Key files | `.forge.json`, `.github/copilot-instructions.md`, instruction file locations |
| Pipeline steps | 7 steps with one-line each |
| Keyboard shortcuts | Copilot chat, agent picker, prompt templates |
| Port reference | 3100 (HTTP), 3101 (WebSocket) |

### Appendix C: Stack-Specific Notes

**Purpose**: Per-preset differences at a glance.  
**Format**: One page per stack (9 stacks). Build/test commands, unique instruction files, detection rules.

---

## File Structure (final)

```
docs/manual/
├── index.html                 ← Book cover + chapter grid
├── what-is-plan-forge.html    ← Ch 1
├── how-it-works.html          ← Ch 2
├── installation.html          ← Ch 3
├── your-first-plan.html       ← Ch 4
├── writing-plans.html         ← Ch 5
├── dashboard.html             ← Ch 6
├── cli-reference.html         ← Ch 7
├── customization.html         ← Ch 8
├── instructions-agents.html   ← Ch 9
├── mcp-server.html            ← Ch 10
├── extensions.html            ← Ch 11
├── multi-agent.html           ← Ch 12
├── advanced-execution.html    ← Ch 13
├── troubleshooting.html       ← Ch 14
├── glossary.html              ← Appendix A
├── quick-reference.html       ← Appendix B
├── stack-notes.html           ← Appendix C
├── assets/
│   ├── manual.css             ← Manual styles (extends shared.css)
│   ├── manual.js              ← Sidebar, search, prev/next, print
│   ├── chapter-heroes/        ← Grok-generated chapter header art (1200×400 each)
│   ├── screenshots/           ← Annotated PNGs from live app
│   ├── diagrams/              ← Mermaid SVGs + fallback PNGs
│   └── animations/            ← GIF/WebM recordings
└── book-manual-plan.md        ← This file
```

---

## Visual Asset Summary

| Category | Count | Source |
|----------|-------|--------|
| Chapter hero illustrations | 6 | Grok image generation (forge/workshop/smith themed) |
| Conceptual illustrations | 5 | Grok (split panels, ecosystem diagrams, command centers) |
| Mermaid diagrams → SVG | 12 | Pipeline flow, DAG, architecture, escalation, decision trees |
| HTML/CSS diagrams | 3 | File trees, annotated code blocks, interactive examples |
| Screenshots | 25+ | Live app captures (dashboard tabs, smith, terminal output, VS Code) |
| Animations (GIF/WebM) | 5 | Screen recordings (setup wizard, live progress, auto-load, assisted mode, full pipeline) |
| **Total visual assets** | **~51** | |

### Screenshot & Live Content Source

The **`E:\GitHub\plan-forge-testbed`** repo contains a **Tracker sample app** with a fully configured Plan Forge installation. Use this repo for:
- Dashboard screenshots (run the MCP server against a real project with run history)
- `pforge smith` output captures (shows realistic file counts, preset detection, version checks)
- Setup wizard recordings (run `setup.ps1` / `setup.sh` against the testbed)
- Execution recordings (run a plan against the Tracker app for real slice progress)
- VS Code screenshots (open the testbed in VS Code to show instruction files, agents, skills in the file tree)
- Copilot chat screenshots (Copilot interacting with testbed code with guardrails loaded)

---

## Iteration Rounds

### Round 1 — Shell + Template Chapter
- [ ] `index.html` — book cover with chapter cards, act structure
- [ ] `manual.css` + `manual.js` — sidebar, navigation, search stub, dark mode
- [ ] Chapter 7 (CLI Reference) — most structured, tests the page template
- [ ] Verify: desktop, mobile, print

### Round 2 — Act I (Learn)
- [ ] Chapter 1 (What Is Plan Forge) + hero art
- [ ] Chapter 2 (How It Works) + pipeline diagram
- [ ] Chapter 3 (Installation) + setup recording

### Round 3 — Act II (Build)
- [ ] Chapter 4 (Your First Plan) + screenshots + pipeline recording
- [ ] Chapter 5 (Writing Plans) + annotated examples
- [ ] Chapter 6 (Dashboard) + all 9 tab screenshots

### Round 4 — Act III (Master)
- [ ] Chapter 8 (Customization)
- [ ] Chapter 9 (Instruction Files & Agents)
- [ ] Chapter 10 (MCP Server & Tools)

### Round 5 — Complete + Polish
- [ ] Chapters 11–14 (Extensions, Multi-Agent, Advanced, Troubleshooting)
- [ ] Appendices A–C (Glossary, Quick Reference, Stack Notes)
- [ ] Client-side search index
- [ ] Cross-chapter links verified
- [ ] Print stylesheet
- [ ] Link from main site nav to manual
- [ ] Add `docs/manual/` to sitemap + `llms.txt`

---

## Open Decisions

- [ ] Version tracking: should the manual version match Plan Forge version?
- [ ] "Last verified" dates on chapters to flag stale content?
- [ ] Auto-generate glossary from `capabilities.mjs` or maintain manually?
- [ ] Auto-generate CLI Reference from `cli-schema.json` or write manually?
- [ ] Include a "What's New" chapter mirroring CHANGELOG in narrative form?
- [ ] Should the manual link back to the source `.md` files for "full detail"?

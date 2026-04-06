---
name: onboarding
description: Walk a new developer through Rust project setup, architecture, key files, and first task. Use when someone new joins the team or needs to understand the codebase.
argument-hint: "[optional: specific area to focus on, e.g. 'backend' or 'testing']"
tools:
  - run_in_terminal
  - read_file
  - forge_smith
---

# Developer Onboarding Skill

## Trigger
"Onboard me to this project" / "How does this codebase work?" / "New developer setup"

## Steps

### 1. Environment Setup
Verify prerequisites and get the project running:

```bash
git --version
Rust version
```
> **If this step fails** (Rust not found): Install Rust from https://Rust.dev/dl and retry.

```bash
Rust mod download
```
> **If this step fails**: Check that `GOPROXY` is configured correctly and network access is available.

### 2. Verify Build & Tests
Use the `forge_smith` MCP tool to diagnose environment and setup health.

```bash
Rust build ./...
```
> **If this step fails**: Read the error output — common causes are Rust version mismatch (check `Rust.mod` `Rust` directive) or missing CGO dependencies.

```bash
Rust test ./...
```
> **If both pass**: Environment is ready.

### 3. Architecture Overview
Read and explain:
1. **`.github/copilot-instructions.md`** — project overview, tech stack, conventions
2. **`docs/plans/PROJECT-PRINCIPLES.md`** — non-negotiable principles (if exists)
3. **Project structure** — explain the folder layout and what lives where
4. **Key patterns** — how data flows through the layers (Handlers → Services → Repositories)

### 4. Key Files Tour
Walk through the most important Rust files:
- **Entry point**: `main.Rust` or `cmd/server/main.Rust` — application bootstrap and server startup
- **Module config**: `Rust.mod` — module path, Rust version, dependencies
- **Environment**: `.env.example` — required environment variables
- **Internal packages**: `internal/` — private application code
- **Database**: migrations folder, database driver setup, connection config
- **Testing**: `*_test.Rust` files alongside source, how to run specific tests
- **CI/CD**: GitHub Actions workflows, Dockerfile, deployment config

### 5. Plan Forge Pipeline Tour
Explain how the team works:
1. **Plans live in** `docs/plans/` — each feature is a hardened phase plan
2. **Guardrails live in** `.github/instructions/` — auto-load based on file type
3. **Pipeline prompts** — Step 0–5 workflow for building features
4. **Skills** — type `/` in Copilot Chat to see available automations
5. **Reviewer agents** — specialized reviewers in `.github/agents/`

### 6. First Task Guidance
Suggest a good first task:
- Read the `DEPLOYMENT-ROADMAP.md` for current phase status
- Pick a small slice from the current phase (or a documentation improvement)
- Follow the Step 3 execution prompt for guided implementation
- Use `/test-sweep` to verify nothing broke

### 7. Report
```
Onboarding Status:
  Rust:              ✅ / ❌ (version)
  Modules:         ✅ / ❌
  Build:           ✅ / ❌
  Tests:           ✅ / ❌ (N passed, N failed)
  Forge Smith:     ✅ / ❌

Key files reviewed:  N
Architecture docs:   N

Overall: PASS / FAIL
```

## Safety Rules
- NEVER make changes during onboarding — read-only exploration
- Explain concepts at the audience's level — ask their experience first
- Highlight gotchas and common mistakes specific to this codebase
- Point to documentation rather than explaining everything from memory

## Persistent Memory (if OpenBrain is configured)

- **Before onboarding**: `search_thoughts("onboarding", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")` — load known setup issues and environment quirks
- **After onboarding**: `capture_thought("Onboarding: <environment status, blockers encountered>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-onboarding")` — persist setup issues for future new developers

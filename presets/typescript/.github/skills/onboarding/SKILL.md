---
name: onboarding
description: Walk a new developer through TypeScript/Node.js project setup, architecture, key files, and first task. Use when someone new joins the team or needs to understand the codebase.
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
node --version
pnpm --version
```
> **If this step fails** (node not found): Install Node.js from https://nodejs.org and retry.

> **If pnpm not found**: Run `npm install -g pnpm` and retry.

```bash
pnpm install
```
> **If this step fails**: Check that `.npmrc` is configured correctly and network access is available.

### 2. Verify Build & Tests
Use the `forge_smith` MCP tool to diagnose environment and setup health.

```bash
pnpm build
```
> **If this step fails**: Read the error output — common causes are missing TypeScript version or misconfigured `tsconfig.json`.

```bash
pnpm test
```
> **If both pass**: Environment is ready.

### 3. Architecture Overview
Read and explain:
1. **`.github/copilot-instructions.md`** — project overview, tech stack, conventions
2. **`docs/plans/PROJECT-PRINCIPLES.md`** — non-negotiable principles (if exists)
3. **Project structure** — explain the folder layout and what lives where
4. **Key patterns** — how data flows through the layers (Routes → Services → Repositories)

### 4. Key Files Tour
Walk through the most important TypeScript files:
- **Entry point**: `index.ts` or `src/index.ts` — application bootstrap and server startup
- **Configuration**: `package.json` — scripts, dependencies, project metadata
- **TypeScript config**: `tsconfig.json` — compiler options and path aliases
- **Environment**: `.env.example` — required environment variables
- **Database**: migrations folder, ORM config, connection setup
- **Testing**: test folder structure, how to run specific test suites
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
  Node.js:         ✅ / ❌ (version)
  pnpm:            ✅ / ❌ (version)
  Install:         ✅ / ❌
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

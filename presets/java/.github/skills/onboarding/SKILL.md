---
name: onboarding
description: Walk a new developer through project setup, architecture, key files, and first task. Use when someone new joins the team or needs to understand the codebase.
argument-hint: "[optional: specific area to focus on, e.g. 'backend' or 'testing']"
---

# Developer Onboarding Skill

## Trigger
"Onboard me to this project" / "How does this codebase work?" / "New developer setup"

## Steps

### 1. Environment Setup
Verify prerequisites and get the project running:

```bash
# Check required tools
git --version
# Stack-specific:
dotnet --version    # .NET
node --version      # Node/TypeScript
python --version    # Python
go version          # Go
java --version      # Java
```

```bash
# Clone and set up
git clone <repo-url>
cd <project>

# Install dependencies (stack-specific)
dotnet restore              # .NET
pnpm install                # Node
pip install -r requirements.txt  # Python
go mod download             # Go
./gradlew build             # Java
```

### 2. Verify Build & Tests
```bash
# Inspect the forge first (diagnose environment + setup health)
pforge smith

# Build
<BUILD_COMMAND>

# Run tests
<TEST_COMMAND>

# If both pass, environment is ready
```

### 3. Architecture Overview
Read and explain:
1. **`.github/copilot-instructions.md`** — project overview, tech stack, conventions
2. **`docs/plans/PROJECT-PRINCIPLES.md`** — non-negotiable principles (if exists)
3. **Project structure** — explain the folder layout and what lives where
4. **Key patterns** — how data flows through the layers (controller → service → repository)

### 4. Key Files Tour
Walk through the most important files:
- Entry point (Program.cs, index.ts, main.py, main.go, Application.java)
- Configuration (appsettings.json, .env, config.yaml)
- Database (migrations, schema, connection setup)
- Testing (test structure, how to run specific tests)
- CI/CD (GitHub Actions, Dockerfile, deployment config)

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

### 7. Resources Summary
```
Key files to bookmark:
  📋 docs/plans/DEPLOYMENT-ROADMAP.md  — what we're building
  📖 CUSTOMIZATION.md                  — how to customize guardrails
  🔧 docs/CLI-GUIDE.md                — CLI commands reference
  📚 docs/COPILOT-VSCODE-GUIDE.md     — how to use Copilot effectively
```

## Safety Rules
- NEVER make changes during onboarding — read-only exploration
- Explain concepts at the audience's level — ask their experience first
- Highlight gotchas and common mistakes specific to this codebase
- Point to documentation rather than explaining everything from memory

## Persistent Memory (if OpenBrain is configured)

- **During onboarding**: `search_thoughts("architecture", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode")` — surface architecture decisions, conventions, and lessons learned to give the new developer full project context
- **After onboarding**: `capture_thought("Onboarding: <questions asked, gaps found in docs>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-onboarding")` — persist common onboarding questions to improve docs

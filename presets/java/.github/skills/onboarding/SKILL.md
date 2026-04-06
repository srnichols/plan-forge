---
name: onboarding
description: Walk a new developer through Java/Maven project setup, architecture, key files, and first task. Use when someone new joins the team or needs to understand the codebase.
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
java --version
./mvnw --version
```
> **If this step fails** (java not found): Install a JDK (17+) from https://adoptium.net and retry.

> **If mvnw not found**: Try `mvn --version` for a system-wide Maven installation.

```bash
./mvnw dependency:resolve
```
> **If this step fails**: Check that Maven repository settings (`~/.m2/settings.xml`) are configured and network access is available.

### 2. Verify Build & Tests
Use the `forge_smith` MCP tool to diagnose environment and setup health.

```bash
./mvnw verify
```
> **If this step fails**: Read the error output — common causes are missing JDK version (check `pom.xml` `<java.version>`) or database connection required for integration tests.

> **If verify passes**: Environment is ready (compile + unit tests + integration tests).

### 3. Architecture Overview
Read and explain:
1. **`.github/copilot-instructions.md`** — project overview, tech stack, conventions
2. **`docs/plans/PROJECT-PRINCIPLES.md`** — non-negotiable principles (if exists)
3. **Project structure** — explain the folder layout and what lives where
4. **Key patterns** — how data flows through the layers (Controller → Service → Repository)

### 4. Key Files Tour
Walk through the most important Java files:
- **Entry point**: `Application.java` — Spring Boot main class with `@SpringBootApplication`
- **Build config**: `pom.xml` — dependencies, plugins, profiles
- **Properties**: `application.yml` or `application.properties` — settings per environment
- **Database**: `src/main/resources/db/migration/` (Flyway) or Liquibase changelogs
- **Testing**: `src/test/java/` structure, how to run specific test classes
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
  Java JDK:        ✅ / ❌ (version)
  Maven:           ✅ / ❌ (version)
  Dependencies:    ✅ / ❌
  Build + Tests:   ✅ / ❌ (N passed, N failed)
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

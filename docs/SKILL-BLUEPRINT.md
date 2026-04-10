---
description: Skill Blueprint — the canonical format specification for Plan Forge skills
applyTo: '**/*.md'
---

# Skill Blueprint

> **Purpose**: Formal specification for Plan Forge skill files (`SKILL.md`). Follow this format when creating new skills, contributing extensions, or reviewing existing skills.
>
> **Audience**: Skill authors (internal teams, extension contributors, community)

---

## File Location

Every skill lives in its own directory:

```
.github/skills/
  skill-name/
    SKILL.md          # Required: the skill definition
```

---

## Required Format

```markdown
---
name: skill-name-with-hyphens
description: "Brief statement of what the skill does. Use when [trigger]."
argument-hint: "[optional: example CLI-style argument]"
tools:
  - tool_name_1
  - tool_name_2
---

# Skill Title

## Trigger
Natural language phrases that activate this skill.

## Steps
Numbered workflow with validation between steps.

## Safety Rules
Invariants — what the skill must NEVER do.

## Temper Guards
Shortcuts agents take + why they break.

## Warning Signs
Observable patterns indicating the skill is being circumvented.

## Exit Proof
Verifiable checklist confirming the skill completed correctly.

## Persistent Memory (if OpenBrain is configured)
search_thoughts before + capture_thought after.
```

---

## Section Reference

### Frontmatter (Required)

| Field | Required | Format | Purpose |
|-------|----------|--------|---------|
| `name` | Yes | `kebab-case` | Must match the directory name |
| `description` | Yes | String, ≤1024 chars | What + when trigger. Agents discover skills by reading descriptions. |
| `argument-hint` | No | String | Example argument shown to users (e.g., `"[plan file path]"`) |
| `tools` | Yes | YAML list | MCP tools and VS Code tools this skill uses |

**Description rules**: Start with what the skill does (third person), followed by trigger conditions ("Use when..."). Do NOT describe the workflow — if the description contains steps, the agent may follow the summary instead of reading the full skill.

### Trigger

Natural language phrases a user might say that should activate this skill. Include 3–5 variants.

```markdown
## Trigger
"Create a database migration for..." / "Add column..." / "Change schema..."
```

### Steps

The core workflow — numbered, specific, executable. Each step should:
- Have a clear action verb ("Generate", "Run", "Validate", "Report")
- Include the exact command or tool call where applicable
- State what to do if the step fails (conditional blocks with `>` blockquotes)

```markdown
### 1. Generate Migration
[exact command]

### 2. Validate
[exact command]

> **If validation fails**: STOP. Report the error and do not proceed.
```

### Safety Rules

Non-negotiable invariants. Use "NEVER" and "ALWAYS" language.

```markdown
## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS include rollback SQL
- ALWAYS show cost estimate before executing
```

### Temper Guards

Table of shortcuts agents use to cut corners within this skill's workflow, paired with rebuttals. Named after the metallurgical process — tempering strengthens steel against brittle failure.

```markdown
## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll combine the migration and seed data" | Mixed changes make rollback impossible. One concern per migration. |
| "Rollback SQL isn't needed for additive changes" | Additive changes can still cause issues. Always provide a clean undo path. |
```

**Guidelines**:
- 3–6 entries per skill
- Each rebuttal must be concrete and specific to this skill's domain
- Target the most common ways agents compress or skip steps in this workflow

### Warning Signs

Observable behavioral patterns indicating this skill's process was circumvented or is being violated. Helps reviewers and the agent itself detect violations.

```markdown
## Warning Signs

- Migration file created but no rollback section present
- Schema change made without a corresponding migration file
- Integration tests not re-run after migration applied
```

**Guidelines**:
- 4–6 bullets per skill
- Each sign must be observable (can be checked by looking at code/output)
- Not subjective — "code looks complex" is bad; "function exceeds 300 lines" is good

### Exit Proof

Verifiable checklist confirming the skill completed correctly. Every checkbox must have evidence — test output, command output, file existence. "Seems right" is never sufficient.

```markdown
## Exit Proof

After completing this skill, confirm:
- [ ] Migration file exists in the expected directory
- [ ] `dotnet ef database update` completes without errors
- [ ] All integration tests pass (paste output)
- [ ] Rollback SQL tested (paste output)
- [ ] No TODO/FIXME markers in migration file
```

**Guidelines**:
- 4–6 checkboxes per skill
- Each item verifiable with concrete evidence (command output, file path, test result)
- Include the verification command where applicable
- Read-only skills (reviews, audits) prove completion via the report output

### Persistent Memory

Standard hooks for OpenBrain integration. Search before acting, capture after completing.

```markdown
## Persistent Memory (if OpenBrain is configured)

- **Before**: `search_thoughts("<skill domain>", project: "<YOUR PROJECT NAME>", ...)` — load prior decisions
- **After**: `capture_thought("<skill outcome summary>", project: "<YOUR PROJECT NAME>", ...)` — persist results
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Skill directory | `kebab-case` | `database-migration/` |
| Skill file | `SKILL.md` (always uppercase) | `SKILL.md` |
| Slash command | `/skill-name` | `/database-migration` |
| `name` in frontmatter | Matches directory name exactly | `database-migration` |

---

## Cross-Skill References

Reference other skills by name — don't duplicate content:

```markdown
If the build breaks, use the `/forge-troubleshoot` skill to diagnose.
After migration, run `/test-sweep` to verify no regressions.
```

---

## Token Budget

- Keep `SKILL.md` under 200 lines — the full file loads into context when activated
- Put detailed reference material in supporting files (only if >100 lines)
- Write specific descriptions — helps the agent activate the right skill without loading all of them
- Prefer tool calls over inline code blocks — tool execution doesn't consume context

---

## Checklist for New Skills

Before submitting a new skill (internal or extension):

- [ ] Directory name matches `name` in frontmatter
- [ ] Description says what AND when (not how)
- [ ] Steps are numbered with specific commands
- [ ] Safety Rules use NEVER/ALWAYS language
- [ ] Temper Guards have 3–6 domain-specific entries
- [ ] Warning Signs have 4–6 observable patterns
- [ ] Exit Proof has 4–6 checkboxes with verifiable evidence
- [ ] Persistent Memory hooks present (search before, capture after)
- [ ] Total file under 200 lines
- [ ] Tested end-to-end on a real project

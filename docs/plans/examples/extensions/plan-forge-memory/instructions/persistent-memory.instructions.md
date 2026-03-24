---
description: Persistent memory rules — when to search OpenBrain for prior decisions and when to capture new ones
applyTo: '**'
---

# Persistent Memory Rules (OpenBrain)

When the OpenBrain MCP server is available, follow these rules to maintain
long-term project memory across sessions.

## When to SEARCH OpenBrain

Search for prior decisions and context in these situations:

1. **Start of every session** — Before any work, search for:
   - Prior decisions about the current phase/feature
   - Post-mortem lessons from previous phases
   - Architectural patterns already established
   - Technology choices already locked in

2. **Before making an architectural decision** — Search:
   - "Has this been decided before?"
   - "What alternatives were considered?"
   - "Why was this pattern chosen?"

3. **When encountering unfamiliar code** — Search:
   - "What's the history of this component?"
   - "Who worked on this and what did they decide?"

4. **During plan hardening (Step 2)** — Search:
   - Prior phase post-mortems for lessons learned
   - Similar features built before for pattern reuse

### Search Examples

Always scope searches to the current project when working in a multi-project environment:

```
search_thoughts("error handling patterns for this project", project: "my-api")
search_thoughts("database migration decisions", project: "my-api", type: "decision")
search_thoughts("Phase 3 post-mortem lessons", project: "my-api", type: "postmortem")
search_thoughts("why did we choose Dapper over EF Core", project: "my-api", type: "architecture")
search_thoughts("naming conventions", project: "my-api", type: "convention")
```

Use `type` filters to narrow results:
- `decision` — Technology and design choices
- `architecture` — System design, layer choices, technology selection
- `pattern` — Reusable code patterns and approaches
- `postmortem` — Lessons learned, what went wrong
- `requirement` — Functional or non-functional requirements
- `bug` — Bug discoveries, root causes, fixes
- `convention` — Naming, formatting, workflow conventions

## When to CAPTURE to OpenBrain

Capture decisions and context in these situations:

1. **After resolving a Required Decision** — Capture:
   - The decision made
   - Alternatives considered
   - Rationale for the choice
   - Who was involved

2. **After completing each execution slice** — Capture:
   - What was built
   - Key implementation choices
   - Any surprises or deviations from plan

3. **After the Review Gate (Step 5)** — Capture:
   - Post-mortem insights
   - Patterns that should be repeated
   - Guardrail gaps discovered
   - What drifted and why

4. **When discovering a pattern** — Capture:
   - The pattern and where it applies
   - Why it works for this project
   - When NOT to use it

### Capture Format

Always include `project` and `source` for traceability:

```
capture_thought(
  "Decision: [WHAT] — [WHY]. Alternatives: [WHAT ELSE]. Context: [PHASE/SLICE]",
  project: "<current-project>",
  source: "plan-forge-phase-N-slice-K"
)
capture_thought(
  "Pattern: [NAME] — [DESCRIPTION]. Use when: [CONDITION]. Avoid when: [CONDITION]",
  project: "<current-project>",
  source: "plan-forge-phase-N"
)
capture_thought(
  "Lesson: [WHAT HAPPENED] — [WHAT WE LEARNED]. Applies to: [FUTURE PHASES]",
  project: "<current-project>",
  source: "plan-forge-phase-N-postmortem"
)
```

After a post-mortem, use batch capture for multiple lessons:

```
capture_thoughts([
  "Lesson: [FIRST LESSON]",
  "Lesson: [SECOND LESSON]",
  "Pattern: [PATTERN DISCOVERED]"
], project: "<current-project>", source: "plan-forge-phase-N-postmortem")
```

To supersede a prior decision, link to the old one:

```
capture_thought(
  "Decision: Switched from Redis to Memcached for caching. Reason: simpler ops.",
  project: "<current-project>",
  source: "plan-forge-phase-N-slice-K",
  supersedes: "<uuid-of-old-decision>"
)
```

Or update the old decision in place:

```
update_thought(id: "<uuid>", content: "Decision: [UPDATED CONTENT]")
```

Or delete a stale thought entirely:

```
delete_thought(id: "<uuid>")
```

## What NOT to Store in OpenBrain

- **Code snippets** — Those belong in the codebase (Git)
- **Full plan content** — That's in `docs/plans/*.md`
- **Project Principles** — Those are in `PROJECT-PRINCIPLES.md`
- **Transient status updates** — "Build is running" is noise
- **Sensitive data** — No secrets, credentials, or PII

OpenBrain stores **decisions, reasoning, and lessons** — the "why" that doesn't 
live anywhere else.

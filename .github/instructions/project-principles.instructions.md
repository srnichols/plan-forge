---
description: Project Principles — auto-loads governing principles when docs/plans/PROJECT-PRINCIPLES.md exists
applyTo: '**'
globs: docs/plans/PROJECT-PRINCIPLES.md
---

# Project Principles Guardrails

If `docs/plans/PROJECT-PRINCIPLES.md` exists in this project, it declares the
non-negotiable principles, technology commitments, and forbidden patterns
for this codebase.

## Rules

1. **Read the Project Principles** before proposing architectural changes
2. **Never violate a Core Principle** — these are non-negotiable
3. **Never introduce a Forbidden Pattern** — regardless of convenience
4. **Respect Technology Commitments** — do not suggest alternatives to
   locked-in choices
5. **Flag potential violations** — if a requested change might conflict
   with the Project Principles, cite the specific principle and ask before proceeding

## Relationship to Other Guardrails

- **Project Principles** = what the project believes (human-authored declarations)
- **Project Profile** = how Copilot should write code (generated from interview)
- **Architecture Principles** = universal baseline (applies to all projects)

Project Principles take precedence when they conflict with generated guardrails.

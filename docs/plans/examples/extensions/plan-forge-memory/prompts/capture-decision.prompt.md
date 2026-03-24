---
description: "Capture an architectural decision, pattern, or lesson to OpenBrain for future reference"
mode: agent
tools: ["openbrain"]
---

# Capture Decision to Persistent Memory

You have access to the OpenBrain MCP server. Use the `capture_thought` tool
to store a decision, pattern, or lesson for future sessions.

## When to Use This

- After resolving a Required Decision during plan hardening
- After completing an execution slice with notable implementation choices
- After discovering a pattern worth reusing
- After a post-mortem reveals a lesson
- Anytime someone says "we should remember this"

## Process

1. **Ask the user** what they want to capture (or extract from current context)

2. **Structure the thought** using one of these formats:

   **Decision**:
   ```
   Decision: [WHAT was decided]
   Context: Phase [N], Slice [K] — [feature name]
   Alternatives: [what else was considered]
   Rationale: [why this choice]
   Impact: [what this affects going forward]
   ```

   **Pattern**:
   ```
   Pattern: [NAME]
   Description: [how it works]
   Use when: [conditions]
   Avoid when: [conditions]
   Example: [brief code or file reference]
   ```

   **Lesson**:
   ```
   Lesson: [what we learned]
   Context: Phase [N] — [what happened]
   Root cause: [why it happened]
   Prevention: [how to avoid in future]
   Applies to: [future phases/features]
   ```

3. **Confirm with the user** before capturing

4. **Call `capture_thought`** with the structured content

5. **Report** the auto-extracted metadata (type, topics, action items)

## Guidelines

- **Be specific** — "Use Dapper with parameterized queries for all data access"
  is better than "We chose a data access pattern"
- **Include context** — Phase number, slice, feature name so future searches can scope
- **Include rationale** — The "why" is what future sessions need most
- **Don't capture code** — Reference file paths instead; code belongs in Git
- **Don't capture secrets** — No API keys, passwords, or PII

---
description: "Search OpenBrain for prior decisions, patterns, and lessons related to the current task"
mode: agent
tools: ["openbrain"]
---

# Search Project History

You have access to the OpenBrain MCP server — a persistent semantic memory
that stores decisions, patterns, and lessons from all prior sessions.

## What to Do

1. **Ask the user** what they want to find:
   - A prior decision ("Why did we choose Dapper?")
   - A pattern ("How do we handle auth in this project?")
   - A lesson ("What went wrong in Phase 3?")
   - General context ("What do we know about the notification system?")

2. **Search OpenBrain** using the `search_thoughts` tool with their query.
   Use natural language — the search is semantic, not keyword-based.

3. **Present findings** organized by relevance:
   - Most relevant decisions first
   - Include the date and context of each finding
   - Note if any findings contradict each other (decisions may have evolved)

4. **If nothing found**, suggest:
   - Alternative search terms
   - Whether this might be a new decision that should be captured
   - Check if the decision was made before OpenBrain was set up

## Example Searches

```
"error handling patterns for API endpoints"
"database migration decisions from Phase 2"
"why we rejected Entity Framework"
"authentication architecture decisions"
"post-mortem lessons about performance"
"what did we decide about caching strategy"
```

## Output Format

### Found: N relevant thoughts

| # | Date | Type | Summary | Relevance |
|---|------|------|---------|-----------|
| 1 | 2026-03-15 | decision | Use Dapper for all data access... | 0.92 |
| 2 | 2026-03-10 | lesson | EF Core caused N+1 queries in... | 0.87 |

### Key Takeaway
(Synthesize the findings into actionable context for the current task)

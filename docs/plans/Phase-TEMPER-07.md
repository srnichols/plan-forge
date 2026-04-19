---
crucibleId: c9f3a582-1e74-4d26-b831-55bc4f8a2901
source: self-hosted
status: complete
phase: TEMPER-07
arc: TEMPER
---

# Phase TEMPER-07: Agent routing — wire scanner verdicts into the agent/skill stack

> **Status**: ✅ COMPLETE — Slice 07.1 shipped (53a20ae, pushed to master)
> **Estimated Effort**: 1 slice (single-ship; no UI)
> **Risk Level**: Low (additive routing layer; no scanner / agent / skill
> internals change)
> **Target Version**: v2.50.x (ships after FORGE-SHOP-02, before
> FORGE-SHOP-06 ask-bus)

See TEMPER arc: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)
Depends on: [Phase-FORGE-SHOP-02.md](Phase-FORGE-SHOP-02.md) (review queue
— agent outputs land as review items)

---

## Why

The TEMPER arc (v2.42.0–v2.47.0) shipped **5 scanners** and a **bug
registry**. Separately, Plan Forge has **13 agent personas** in
`.github/agents/` (security, performance, test-runner, architecture,
database, deploy, api-contracts, accessibility, multi-tenancy, ci-cd,
observability, dependency, compliance) and **12 skills** in
`c:\Users\srnic\.agents\skills\` / `.github/skills\`
(test-sweep, security-audit, database-migration, …).

**These two stacks never talk.** When the bug classifier emits
`bug.type = security, severity = critical`, nothing routes that to the
security-audit agent or skill. The operator has to click "Run
security-audit" manually. This is the biggest unrealized multiplier
in the whole system.

TEMPER-07 ships the **router only** — a deterministic
`(bug.type, bug.severity) → agent|skill` map plus a single MCP tool
that invokes the matched persona in **read-only analyst mode**. Its
output becomes a `fix-plan-approval` review-queue item (requires
FORGE-SHOP-02 merged).

## Scope Contract

### In-scope

- `pforge-mcp/tempering/agent-router.mjs` — **new file**, ~140 LOC:
  - `const ROUTING_TABLE` — frozen object, one line per rule:

    ```js
    {
      "security|critical":  { agent: "security",          skill: "security-audit" },
      "security|major":     { agent: "security",          skill: "security-audit" },
      "performance|critical": { agent: "performance",     skill: null },
      "performance|major":    { agent: "performance",     skill: null },
      "functional|critical":  { agent: "test-runner",     skill: "test-sweep" },
      "functional|major":     { agent: "test-runner",     skill: null },
      "contract|*":           { agent: "api-contracts",   skill: "api-doc-gen" },
      "visual|*":             { agent: "accessibility",   skill: null },
      // fallthrough — no routing
    }
    ```

  - `resolveRoute(bug)` — returns `{ agent, skill }` or `null`; pure,
    no IO, unit-tested
  - `buildAnalystPrompt(bug, route)` — composes a **read-only** prompt
    using the record path + evidence links + a hard rule "do NOT edit
    files, only analyze and return findings"
  - `writeAnalystFinding(targetPath, bug, route, finding)` — persists
    to `.forge/tempering/findings/<bugId>.json` (new L2 family, atomic
    write)
- New MCP tool **`forge_delegate_to_agent`** — writer + dispatcher:
  - Input: `{ bugId, targetPath?, mode: "analyst" | "review-queue-item",
    dryRun?: boolean }`
  - Flow:
    1. Load bug record via existing `readBug`
    2. `resolveRoute(bug)` → if `null`, return
       `{ ok: true, routed: false, reason: "no-rule-matches" }`
    3. In `mode=analyst`: construct the analyst prompt and return it
       (the executor — MCP client — makes the LLM call). Record the
       delegation intent in `.forge/tempering/delegations.jsonl`
    4. In `mode=review-queue-item`: also call `forge_review_add` with
       `source: "fix-plan-approval"`, severity matching the bug,
       `context.recordRef` pointing to the bug file, and
       `context.suggestedAgent` + `suggestedSkill` from the route
    5. Emit hub event `tempering-bug-delegated`
  - `dryRun: true` — returns the would-be delegation payload without
    writing the jsonl or adding a review item. Useful for agents
    validating their own routing choice
- TOOL_METADATA entry in `capabilities.mjs` + regenerated
  `tools.json`; `addedIn: "2.50.0"`; `writesFiles: true`;
  `risk: "low"`
- Hub event `tempering-bug-delegated` (payload: `bugId`, `agent`,
  `skill`, `mode`, `reviewItemId` or null)
- **L3 capture** on `tempering-bug-delegated`: tag `tempering`,
  `delegation`, `<agent>`, `<severity>`. Payload:
  `{ bugId, route, mode }` — never the analyst prompt text.
- Integration points (tiny wire-ins):
  - `forge_bug_register` (TEMPER-06.1) — at the end of the handler,
    if `bug.severity` ∈ {`critical`, `major`}, emit a follow-up
    `forge_delegate_to_agent` call in `mode: "review-queue-item"`.
    **Guarded by** `.forge/tempering/config.json > agentRouting.enabled`
    (default: `false` to preserve v2.47 behavior on upgrade).
  - `forge_tempering_approve_baseline` — unchanged; visual baselines
    are already operator-driven
- Tests:
  - `pforge-mcp/tests/tempering-agent-router.test.mjs` — **new**, ~20
    tests (every routing key, fallthrough, invalid input, dryRun, L3
    capture, review-queue-item integration, config-guard off behavior)

### Out of scope (later)

- Auto-invoking the LLM server-side (MCP is client-driven; FORGE-SHOP-06
  ask-bus will formalize server-initiated requests)
- Writing agent-generated fixes directly to code files (stays
  human-gated via review queue)
- Dynamic routing rules (table is frozen in code; future phase can
  load from `.forge/tempering/agent-routes.json`)
- Multi-agent consensus on findings (quorum lives in `quorum.mjs`,
  not here)
- Skills beyond the 5 mapped above — add rules as need emerges

### Forbidden actions

- Do NOT invoke the agent's LLM from inside the router — this is a
  client-responsibility boundary. The tool returns the prompt; the
  caller executes
- Do NOT edit files as a side effect of delegation — the analyst
  finding lands in `.forge/tempering/findings/` only
- Do NOT swallow routing misses — log via `logWarn` with `bugId` so
  the operator can see which bug types lack rules
- Do NOT add a new writer to the bug record itself — findings are a
  sibling L2 family, not a bug-record mutation
- Do NOT enable `agentRouting` by default on existing installs —
  respect the config-guard

## Slices

### Slice 07.1 — Router table + `forge_delegate_to_agent` + wire-in

**Files touched:**
- `pforge-mcp/tempering/agent-router.mjs` — **new**, ~140 LOC
- `pforge-mcp/server.mjs` — tool handler (~50 LOC)
- `pforge-mcp/capabilities.mjs` — TOOL_METADATA entry
- `pforge-mcp/tools.json` — auto-regenerated
- `pforge-mcp/tempering/bug-registry.mjs` — 1 tiny wire-in at the end
  of `register()`: call `forge_delegate_to_agent` if
  `config.agentRouting.enabled && severity ∈ {critical, major}`.
  Wrapped in try/catch; never blocks registration.
- `pforge-mcp/tests/tempering-agent-router.test.mjs` — **new**, ~20 tests
- `pforge-mcp/tests/tempering-bug-registry.test.mjs` — existing file,
  add 4 tests covering the guarded delegation wire-in (on/off)

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass. Tool count 55 → 56 (assuming FORGE-SHOP-02 merged first at 55).

**Self-check before commit:**
- Critical security bug registered with `agentRouting.enabled = true`
  produces (a) a `.forge/tempering/delegations.jsonl` row and
  (b) an `open` review-queue item with `source = fix-plan-approval`
- Same scenario with `agentRouting.enabled = false` produces neither
- Fallthrough bug type (e.g., `dependency`) registers cleanly and
  returns `{ routed: false }` from the router
- Dry-run returns the prompt without any filesystem writes

## Success Criteria

- Router table covers the 5 primary bug types from TEMPER-06
  classifier
- Config-guarded default OFF — existing installs upgrade without
  behavior change
- Analyst findings persist as a separate L2 family (no bug-record
  mutation)
- Review queue adoption: critical bugs automatically surface as
  `fix-plan-approval` items when routing is enabled
- Tool count +1 (→ 56)
- Test count +24
- CHANGELOG entry under `[Unreleased]` targeting v2.50.0
- `Phase-TEMPER-07.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- TEMPER-06 (bug registry + classifier) ✅ shipped v2.47.0
- FORGE-SHOP-02 (review queue) — target merge before this phase

**On later phases:**
- FORGE-SHOP-06 (ask-bus) will extend `mode` with `"rpc"` — letting
  the executor request an agent analysis synchronously over the
  hub. **Not a blocker for this phase** — analyst-mode stdout-and-file
  output is enough

## Notes for the executing agent

- Keep the routing table **in code**. Future "data-driven" version is
  a follow-up phase, not this one. Frozen-in-code = deterministic +
  testable + diffable in PRs
- `buildAnalystPrompt` must include the hard rule "do NOT edit files"
  — verify with a test that the prompt string contains that phrase
- Config guard pattern mirrors TEMPER-05 `allowProduction` — look
  there for the test-guard style

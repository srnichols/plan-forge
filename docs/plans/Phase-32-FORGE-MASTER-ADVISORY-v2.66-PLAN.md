---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session harden from Scott Nichols' philosophy)
hardened_at: 2026-04-22
---

# Phase-32 — Forge-Master Advisory Mode

> **Target release**: v2.66.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-31.1 shipped (v2.65.1 tagged; rebuilt `version-bump --strict` verified on live repo)
> **Branch strategy**: Direct to `master`. No public-API breaks; all changes are additive (new advisory lane, new `{principles_block}` placeholder, new `forge_master_ask` agentGuidance string, new `.forge.json#forgeMaster.philosophy` key). Existing lanes, existing prompts, existing tool calls all unchanged.
> **Session budget**: 1 session, 5 slices. Natural session-break after Slice 3 if needed.

---

## Specification Source

- **Field input 1**: Clicking a prompt chip in Forge-Master Studio does not populate the composer textarea. Reproduced on Windows 11 / Edge 120. Root cause in [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js#L70-L82): `onclick="forgeMasterPickPrompt(${JSON.stringify(p.id)})"` interpolates `"ps-current-status"` with double quotes into a double-quoted HTML attribute. Browser parses it as attribute termination plus stray attributes.
- **Field input 2**: Asked Forge-Master "what's the status of slice 4" — got the canned offtopic redirect. The intent router's [KEYWORD_RULES at pforge-master/src/intent-router.mjs#L89-L100](pforge-master/src/intent-router.mjs#L89-L100) only matches "slice" when followed by `passed|failed|done|complete`. Bare-word queries fall through to the `grok-3-mini` router model, which has no Plan Forge vocabulary and classifies `offtopic`.
- **Field input 3**: Scott requested CTO-in-a-box advisory capability grounded in his written philosophy (A/B test post, guardrails-lessons post, 80/20-wall post) — distilled into the "Architecture-First, Always" principles block documented in the outline. The current [system-prompt.md](pforge-master/src/system-prompt.md) embeds Plan Forge commitments but has no loader for user-declared philosophy.
- **Architecture anchor**: All three defects share one root cause — Forge-Master was scoped as a narrow operational bot, not a principled advisor. Fix in one phase, not three hotfixes. `forge_master_ask` is the right MCP surface for agent-to-agent advisory consultation — we extend its contract, not replace it.
- **Prior postmortems**: Meta-bug [#91](https://github.com/srnichols/plan-forge/issues/91) (version-bump regex) and [#92](https://github.com/srnichols/plan-forge/issues/92) (gate quoting) are unrelated but closed/in-flight. No prior Forge-Master postmortems.

---

## Scope Contract

### In scope

- [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js) — gallery rendering + event delegation
- [pforge-mcp/dashboard/index.html](pforge-mcp/dashboard/index.html) — only if DOM containers need adjustment (likely no change needed)
- [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) — glossary expansion + new `advisory` lane + updated redirect text
- [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md) — new `{principles_block}` placeholder, updated off-topic redirect text
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) — principles loader integration into system prompt assembly
- [pforge-master/src/principles.mjs](pforge-master/src/principles.mjs) — NEW file, principles loader
- [pforge-master/src/allowlist.mjs](pforge-master/src/allowlist.mjs) — `LANE_TOOLS` entry for `advisory`
- [pforge-mcp/capabilities.mjs](pforge-mcp/capabilities.mjs) — `forge_master_ask` agentGuidance + intent array
- [pforge-mcp/tools.json](pforge-mcp/tools.json) — matching entry update
- `pforge-mcp/tests/forge-master-gallery.test.mjs` — NEW jsdom test
- `pforge-mcp/tests/forge-master.test.mjs` — add glossary + advisory-lane classification tests
- `pforge-mcp/tests/forge-master-principles.test.mjs` — NEW principles-loader test
- `pforge-mcp/tests/forge-master.advisory.test.mjs` — NEW advisory integration test
- `CHANGELOG.md`, `ROADMAP.md` — release notes at Slice 5

### Out of scope

- Any change to the `build`, `operational`, or `troubleshoot` lane tool lists
- Any write tool in the `advisory` lane
- Any Crucible interview integration with advisory (Crucible = "what to build"; advisory = "how to decide")
- Any principles injection into the Plan Forge pipeline prompts (step0–step5)
- Any redesign of `forge-master.js` module shape (TypeScript conversion, state-machine refactor, etc.)
- Any change to `.forge.json` schema validation rules for users automatically — `forgeMaster.philosophy` key is opt-in
- Any change to provider adapters (`providers/anthropic-tools.mjs` etc.)
- Any change to the MCP server wiring in `server.mjs` or `forge-master-routes.mjs` (the API contract is stable)
- Any other MCP tool besides `forge_master_ask`

### Forbidden actions

- ❌ Rename or remove any existing lane (`build`, `operational`, `troubleshoot`, `offtopic`)
- ❌ Remove the `{context_block}` placeholder from `system-prompt.md`
- ❌ Modify any file in `.forge/runs/**` or `.forge/brain/**`
- ❌ Edit any `docs/plans/Phase-3[0-1]*` (completed or in-flight phase artifacts)
- ❌ Add any new write tool to `BASE_ALLOWLIST` or `LANE_TOOLS.advisory`
- ❌ Introduce a new dependency in `pforge-mcp/package.json` or `pforge-master/package.json`
- ❌ Change the `forge_master_ask` input schema (`message`, `sessionId`, `maxToolCalls` must stay)
- ❌ Change the MCP API routes shape (`/api/forge-master/prompts`, `/chat`, etc.)
- ❌ Remove the `window.forgeMaster*` global assignments until Slice 1 proves event delegation works (Slice 1 may remove them; later slices must not touch `forge-master.js`)

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Slice 1 test environment — jsdom or real browser | Resolved | **jsdom via vitest**. Existing vitest config already supports jsdom environment. Playwright is out of scope (too much dependency surface for a single test file). jsdom reproduces `addEventListener`, `MouseEvent`, `closest()`, and `focus()` — everything the gallery click path needs. |
| 2 | `principles.mjs` caching strategy | Resolved | **Per-cwd in-memory cache with mtime invalidation**. First call per cwd: stat the source files, cache the concatenated block with mtime. Subsequent calls: stat again; if any mtime advanced, rebuild. Keeps hot path fast without staleness risk. |
| 3 | Override semantics for `.forge.json#forgeMaster.philosophy` | Resolved | **Replace by default; append if string starts with `"+ "` marker (literal plus-space).** Example: `"philosophy": "Use bold instead of italics."` replaces. `"philosophy": "+ Also: never log PII."` appends after file-based principles with a separator heading. Predictable, documentable in the config-key docstring. |
| 4 | Advisory lane allowlist | Resolved | **Read-only only**, same as `operational`. Advisory calls cannot mutate state under any reasoning path. `LANE_TOOLS.advisory` = `["forge_search", "forge_timeline", "brain_recall", "forge_capabilities", "forge_hotspot", "forge_drift_report", "forge_plan_status", "forge_cost_report"]`. |
| 5 | Fallback principles when no source found | Resolved | **Ten-principle architecture-first baseline**, embedded verbatim as `UNIVERSAL_BASELINE` in `principles.mjs`: (1) Architecture-First, Always; (2) Vibe Coding Is a Trap; (3) Define What Shouldn't Be Built; (4) The Builder Must Never Review Its Own Work; (5) Slice Boundaries Are Non-Negotiable; (6) Enterprise Quality Is the Default; (7) Evidence Over Assumption; (8) When in Doubt, Say the Architectural Answer; (9) Work Triage Order — Hotfix, Operational, Strategic (with the inversion-trap paragraph); (10) Keep Gates Boring — gates fail on syntax before they fail on logic, no nested shell layers or escaped-quote gymnastics. Full text lives in [Phase-32 OUTLINE](docs/plans/Phase-32-FORGE-MASTER-ADVISORY-v2.66-OUTLINE.md) under "The Philosophy Block (Default `{principles_block}`)". |
| 6 | Glossary test coverage bar | Resolved | **At least one positive + one negative test per new keyword family.** Positive: "what's the status of slice 4" → operational. Negative: "slice me an apple" → not operational (falls to router-model, accepted as offtopic). Prevents false positives that turn casual English into operational queries. |
| 7 | System-prompt truncation order under token pressure | Resolved | **`{context_block}` trims first, `{principles_block}` last.** Principles are non-negotiable. If the total exceeds 6K tokens (estimated), trim oldest L3 → L2 → L1 context entries; principles survive. Document this in the `reasoning.mjs` system-prompt builder. |
| 8 | Release trigger for v2.66.0 | Resolved | **Slice 5 is the release slice.** Dogfoods the v2.65.1 rebuilt `version-bump --strict` on Plan Forge itself — the field test of Phase-31.1. |

No open TBDs.

---

## Acceptance Criteria

### Event-delegated prompt gallery (Slice 1)

- **MUST**: `forgeMasterRenderGallery` emits `<button data-prompt-id="...">` elements with NO `onclick` attribute.
- **MUST**: `forgeMasterInit` attaches exactly one delegated `click` listener on `#fm-gallery-list` that resolves the target via `event.target.closest('[data-prompt-id]')` and calls `forgeMasterPickPrompt(id)`.
- **MUST**: A jsdom-based vitest in `pforge-mcp/tests/forge-master-gallery.test.mjs` seeds a fake catalog, renders the gallery, dispatches a synthetic `click` MouseEvent on a prompt button, and asserts `#fm-composer.value` equals the prompt template.
- **MUST**: The same test also asserts `document.activeElement.id === "fm-composer"` after the click.
- **MUST**: The inline `window.forgeMaster*` global-assignment hack at the top of the file is removed (comment explaining Phase-30.1 rationale stays as historical note but wrapped in a single `// Historical:` comment line, not a block).
- **MUST**: No regression in the existing `forge-master-tab.test.mjs` — it still passes.
- **SHOULD**: The button's `title` attribute still shows the prompt description (currently used as hover tooltip).

### Glossary expansion (Slice 2)

- **MUST**: [intent-router.mjs](pforge-master/src/intent-router.mjs)'s `KEYWORD_RULES` gains at least 9 new entries covering the term families listed in the outline (slices bare, hardening, gates, execution, tempering, quorum, meta-bugs, crucible extras, phase refs).
- **MUST**: Each new keyword family has at least one positive test (example query → correct lane) and at least one negative test (casual-English false-match check) in `pforge-mcp/tests/forge-master.test.mjs`.
- **MUST**: The query "what's the status of slice 4" classifies as `operational`.
- **MUST**: The query "help me harden Phase-33" classifies as `operational` (hardening = plan operation).
- **MUST**: The query "did tempering fire on this slice" classifies as `operational`.
- **MUST**: The query "why did the gate fail on slice 2" classifies as `troubleshoot`.
- **MUST**: `OFFTOPIC_REDIRECT` is rewritten to list the five lanes (`build`, `operational`, `troubleshoot`, `advisory`, `offtopic`) with one example question each.
- **MUST**: The updated redirect text is exported unchanged from `intent-router.mjs` and referenced (not inlined) everywhere it appears.
- **SHOULD**: The casual-English guard "slice me an apple" still classifies as `offtopic` (the new `slice` keyword must not trigger on food/cooking contexts — handled by the existing food/cooking offtopic rules which score higher).

### Advisory lane + principles loader (Slice 3)

- **MUST**: `intent-router.mjs` exports a new `LANES.ADVISORY = "advisory"` constant.
- **MUST**: `LANE_TOOLS.advisory` contains exactly the eight read-only tools enumerated in Required Decision #4.
- **MUST**: At least 6 keyword rules route common advisory phrases to the new lane: "should I", "should we", "what's the right", "architecture advice", "help me decide", "recommend".
- **MUST**: A new file `pforge-master/src/principles.mjs` exports `loadPrinciples({ cwd })` that:
  - Reads `docs/plans/PROJECT-PRINCIPLES.md` if present.
  - Extracts the `## Architecture Principles` block from `.github/copilot-instructions.md` if present (up to the next `##` heading).
  - Reads `.forge.json#forgeMaster.philosophy` if present.
  - Applies replace-or-append semantics per Required Decision #3.
  - Falls back to the universal baseline per Required Decision #5.
  - Returns `{ block: string, sources: string[] }`.
  - Caches per-cwd with mtime invalidation per Required Decision #2.
- **MUST**: [system-prompt.md](pforge-master/src/system-prompt.md) has a new `## Philosophy & Guardrails` section (above `## Current Context`) with a `{principles_block}` placeholder.
- **MUST**: `reasoning.mjs` calls `loadPrinciples({ cwd })` during system-prompt assembly and interpolates the result into `{principles_block}`. On loader error, falls back to the universal baseline (non-fatal).
- **MUST**: The truncation order in `reasoning.mjs` / `retrieval.mjs` trims `{context_block}` before `{principles_block}`.
- **MUST**: `pforge-mcp/tests/forge-master-principles.test.mjs` covers: (a) no sources → universal baseline, (b) only `PROJECT-PRINCIPLES.md` → that content returned, (c) replace semantics with `.forge.json`, (d) append semantics with `"+ "` prefix, (e) mtime cache invalidation after file mutation.
- **SHOULD**: The principles block is printed once in the dashboard's tool-trace panel under a "principles-applied" pseudo-event so the user can see what guardrails were in force.

### CTO-in-a-box advisory contract (Slice 4)

- **MUST**: [capabilities.mjs](pforge-mcp/capabilities.mjs)'s `forge_master_ask.intent` array includes `"advisory"` and `"cto-in-a-box"`.
- **MUST**: The `agentGuidance` string is rewritten to explicitly describe the advisory contract per the outline's Slice 4 wording (principles-grounded recommendations, read-only, suitable for agent-to-agent consultation).
- **MUST**: The `example` block gains a second example showing an advisory call: input message "Should I refactor this controller or ship the feature?" → reply citing the architecture-first commitment and the specific Forbidden-Actions guardrail.
- **MUST**: [tools.json](pforge-mcp/tools.json) `forge_master_ask` entry gains matching intent/description updates (if the shape differs from `TOOL_METADATA`).
- **MUST**: `pforge-mcp/tests/forge-master.advisory.test.mjs` covers: (a) classification — advisory query → `LANES.ADVISORY`, (b) system prompt contains the principles block verbatim before the tool-use loop begins, (c) mock provider receives a system prompt whose first 500 characters include "Architecture-First" (sanity check that the block is actually injected), (d) reply is produced without any write-tool dispatch.
- **MUST**: `forge_capabilities` output surfaces the new advisory lane — specifically, the `forgeMaster` subsystem summary from `forge-master-routes.mjs#getForgeMasterCapabilitiesSummary` or an equivalent surface gains `advisoryLaneAvailable: true`.
- **SHOULD**: The prompt catalog at [pforge-master/src/prompts.mjs](pforge-master/src/prompts.mjs) gains a new category `"advisory"` with 2–3 starter prompts: "Should I refactor vs ship?", "Architecture advice for this module", "Is this approach over-engineered?".

### Release v2.66.0 (Slice 5)

- **MUST**: `.\pforge.ps1 version-bump 2.66.0 --dry-run` output reviewed; diff matches expected 5-file changes.
- **MUST**: `.\pforge.ps1 version-bump 2.66.0 --strict` exits 0 with `Updated 5/5 targets, 0 failure(s)` summary (dogfoods Phase-31.1 rebuild).
- **MUST**: VERSION file contains exactly `2.66.0`.
- **MUST**: `CHANGELOG.md` `[Unreleased]` promoted to `[2.66.0] — 2026-04-22` with entries for each of Slices 1–4.
- **MUST**: `ROADMAP.md` reflects v2.66.0 and Phase-32 as shipped.
- **MUST**: Commit tagged `v2.66.0`, pushed. GitHub release created with notes linking all four Slice deliverables.
- **SHOULD**: Vitest suites for `pforge-mcp` and `pforge-master` both pass under `npm test`.

---

## Execution Slices

### Slice 1 — Event-delegated prompt gallery [sequential]

**Depends On**: — (entry slice)
**Context Files**: [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js), [pforge-mcp/dashboard/index.html](pforge-mcp/dashboard/index.html) (read-only reference), [pforge-mcp/tests/forge-master-tab.test.mjs](pforge-mcp/tests/forge-master-tab.test.mjs), [pforge-mcp/vitest.config.mjs](pforge-mcp/vitest.config.mjs), `.github/instructions/testing.instructions.md`
**Scope**: [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js), `pforge-mcp/tests/forge-master-gallery.test.mjs` (NEW)

1. Read current `forgeMasterRenderGallery` and confirm the exact inline `onclick` template.
2. Rewrite the button template: `<button class="..." data-prompt-id="${p.id}" title="${p.description}">${p.title}</button>` — NO inline `onclick`.
3. In `forgeMasterInit`, after `forgeMasterRenderGallery()`, attach one delegated listener:
   ```js
   document.getElementById("fm-gallery-list").addEventListener("click", (e) => {
     const btn = e.target.closest("[data-prompt-id]");
     if (btn) forgeMasterPickPrompt(btn.dataset.promptId);
   });
   ```
4. Remove the `window.forgeMasterPickPrompt` global assignment (no longer needed for inline handlers). Keep `window.forgeMasterNewChat`, `window.forgeMasterSend`, `window.forgeMasterFilterGallery`, `window.forgeMasterOnTabActivate` — those are still called from `index.html` inline handlers outside the gallery.
5. Collapse the Phase-30.1 multi-line comment block into a single `// Historical note: globals kept for cross-tab inline handlers.` line.
6. Create `pforge-mcp/tests/forge-master-gallery.test.mjs` using vitest's jsdom environment (add `/* @vitest-environment jsdom */` directive at the top). Test: import the module (via dynamic `import()` after DOM setup), seed `document.body` with the required DOM (a `#fm-gallery-list` div and `#fm-composer` textarea), inject `window.forgeMasterFilterGallery` placeholder if needed, call the module's init, then dispatch `new MouseEvent('click', { bubbles: true })` on a button and assert `#fm-composer.value` equals the template and `document.activeElement.id === "fm-composer"`.

**Validation Gate**:
```bash
bash -c "grep -q 'data-prompt-id' pforge-mcp/dashboard/forge-master.js && cd pforge-mcp && npx vitest run tests/forge-master-gallery.test.mjs --reporter=default"
```

**Stop Condition**: Any inline `onclick="forgeMasterPickPrompt` survives, or the new gallery test fails. (The absence of inline onclick is proven by the vitest test, which only passes if the delegated listener works — inline handlers would short-circuit it.)

---

### Slice 2 — Glossary expansion [sequential]

**Depends On**: Slice 1
**Context Files**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), [pforge-mcp/tests/forge-master.test.mjs](pforge-mcp/tests/forge-master.test.mjs), [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md) (for redirect text)
**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), [pforge-mcp/tests/forge-master.test.mjs](pforge-mcp/tests/forge-master.test.mjs)

1. Add 9+ new entries to `KEYWORD_RULES` per the term-family table in the outline. Each entry: `{ pattern: /.../i, lane: LANES.X, weight: 2 }` or `weight: 3` for strong signals.
2. For the bare `slice` family, use a pattern that requires a Plan Forge context marker: `/\b(slice|slices|gate|gates)\s+(\d+|status|passed|failed|done|complete|ran|running|in.progress|stuck|blocked)/i` weight 3. This prevents "slice me an apple" from matching.
3. For phase refs, use `/\b(phase[-\s]?\d+(\.\d+)?)\b/i` weight 3 → operational.
4. For meta-bugs, use `/\b(meta[-\s]?bug|self[-\s]?repair|plan[-\s]?defect|orchestrator[-\s]?defect|prompt[-\s]?defect)\b/i` weight 3 → troubleshoot.
5. Rewrite `OFFTOPIC_REDIRECT` as:
   ```
   I'm scoped to Plan Forge topics. Try asking about:
     • operational — "what's the status of slice 4", "cost report for this week"
     • troubleshoot — "why did the gate fail", "diagnose this incident"
     • build — "I want to add OAuth" (routes to Crucible)
     • advisory — "should I refactor or ship", "architecture advice"
   Outside those lanes I'll redirect you.
   ```
6. Add positive + negative tests for each new keyword family in `forge-master.test.mjs` under a new `describe("glossary expansion")` block.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs --reporter=default"
```

**Stop Condition**: Any glossary test fails, or "what's the status of slice 4" does not classify as `operational`, or "slice me an apple" drifts out of `offtopic`.

---

### Slice 3 — Advisory lane + principles loader [sequential]

**Depends On**: Slice 2
**Context Files**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md), [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), [pforge-master/src/allowlist.mjs](pforge-master/src/allowlist.mjs), [pforge-master/src/config.mjs](pforge-master/src/config.mjs), [.github/instructions/architecture-principles.instructions.md](.github/instructions/architecture-principles.instructions.md), `.github/instructions/context-fuel.instructions.md`
**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), [pforge-master/src/allowlist.mjs](pforge-master/src/allowlist.mjs), [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md), [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), `pforge-master/src/principles.mjs` (NEW), `pforge-mcp/tests/forge-master-principles.test.mjs` (NEW), new advisory-lane tests in `forge-master.test.mjs`

1. Add `LANES.ADVISORY = "advisory"` to the frozen `LANES` object in `intent-router.mjs`.
2. Add `LANE_TOOLS.advisory = [...]` with the 8 tools from Required Decision #4.
3. Add 6+ keyword rules for advisory signals. Pattern examples:
   - `/\bshould\s+(i|we)\b/i` weight 3 → advisory
   - `/\b(what|which)\s+is\s+the\s+(right|best)\s+(approach|path|way|choice)\b/i` weight 3 → advisory
   - `/\b(architecture\s+advice|architect\s+this|arch\s+review)\b/i` weight 3 → advisory
   - `/\b(refactor\s+or\s+ship|ship\s+vs|fix\s+later|do\s+it\s+right)\b/i` weight 3 → advisory
   - `/\b(cto|principal|staff\s+engineer)\b/i` weight 2 → advisory
   - `/\b(recommend|recommendation|your\s+take)\b/i` weight 2 → advisory
4. Create `pforge-master/src/principles.mjs`:
   ```js
   export function loadPrinciples({ cwd = process.cwd() } = {}) { /* ... */ }
   ```
   - Read `docs/plans/PROJECT-PRINCIPLES.md` via `readFileSync` in a try/catch.
   - Read `.github/copilot-instructions.md`; extract from first `## Architecture Principles` heading to the next `##` heading (use a simple regex). If section absent, skip.
   - Read `.forge.json`; parse; extract `forgeMaster.philosophy` string.
   - Apply replace/append semantics: if philosophy string starts with `"+ "`, append the remainder as a new section; otherwise replace file-based principles entirely.
   - If all three sources are absent/empty, emit the universal baseline — a hardcoded const `UNIVERSAL_BASELINE` containing the ten-principle block verbatim from the Phase-32 OUTLINE's "The Philosophy Block" section (including Work Triage Order with hotfix > operational > strategic ranking, the inversion-trap paragraph, and Keep Gates Boring).
   - Cache: `Map<cwd, { block, sources, mtimes }>`; before returning a cached entry, stat each source file and bust the cache if any mtime advanced.
5. Edit [system-prompt.md](pforge-master/src/system-prompt.md). Add a new section between `## Response Style` and `## Current Context`:
   ```markdown
   ---

   ## Philosophy & Guardrails

   {principles_block}

   ---
   ```
   Update the truncation note in the docstring.
6. Edit `reasoning.mjs`. Import `loadPrinciples` from `./principles.mjs`. In `loadSystemPrompt` or the caller, load principles, replace both `{principles_block}` and `{context_block}` placeholders. On loader error (file read failures, etc.) fall back to the universal baseline — log once via `console.warn` but do not throw.
7. In `retrieval.mjs` or wherever context-block truncation happens, ensure `{principles_block}` content is excluded from the 4000-token context cap — it's computed separately and appended last.
8. Tests in `pforge-mcp/tests/forge-master-principles.test.mjs`: (a) empty temp dir → universal baseline returned, (b) PROJECT-PRINCIPLES.md present → content included in `block`, (c) `.forge.json` with `philosophy: "Use X."` replaces, (d) `.forge.json` with `philosophy: "+ Use X."` appends, (e) mtime cache invalidation by writing a new PROJECT-PRINCIPLES.md and calling again.
9. Tests in `forge-master.test.mjs`: advisory classification for "should I refactor or ship", "architecture advice please", "recommend a path forward".

**Validation Gate**:
```bash
bash -c "grep -q 'ADVISORY' pforge-master/src/intent-router.mjs && grep -q 'loadPrinciples' pforge-master/src/principles.mjs && grep -q 'principles_block' pforge-master/src/system-prompt.md && grep -q 'loadPrinciples' pforge-master/src/reasoning.mjs && cd pforge-mcp && npx vitest run tests/forge-master-principles.test.mjs tests/forge-master.test.mjs --reporter=default"
```

**Stop Condition**: Principles loader tests fail, advisory classification tests fail, or the system prompt doesn't contain the `{principles_block}` placeholder.

---

### Slice 4 — CTO-in-a-box advisory contract [sequential]

**Depends On**: Slice 3
**Context Files**: [pforge-mcp/capabilities.mjs](pforge-mcp/capabilities.mjs) (specifically the `forge_master_ask` TOOL_METADATA entry around L1379), [pforge-mcp/tools.json](pforge-mcp/tools.json), [pforge-mcp/forge-master-routes.mjs](pforge-mcp/forge-master-routes.mjs) (`getForgeMasterCapabilitiesSummary`), [pforge-mcp/tests/forge-master.integration.test.mjs](pforge-mcp/tests/forge-master.integration.test.mjs)
**Scope**: [pforge-mcp/capabilities.mjs](pforge-mcp/capabilities.mjs), [pforge-mcp/tools.json](pforge-mcp/tools.json), [pforge-mcp/forge-master-routes.mjs](pforge-mcp/forge-master-routes.mjs), `pforge-mcp/tests/forge-master.advisory.test.mjs` (NEW), optionally [pforge-master/src/prompts.mjs](pforge-master/src/prompts.mjs) (new advisory category)

1. In `capabilities.mjs`, update the `forge_master_ask` entry:
   - `intent` array: add `"advisory"` and `"cto-in-a-box"`.
   - `agentGuidance`: rewrite to include the advisory-contract paragraph (verbatim text from Slice 4 of the outline).
   - `example`: keep the existing feature-building example; add a second entry for advisory: input `{ message: "Should I refactor this controller or ship?" }`, output citing architecture-first principles.
2. Update `tools.json` `forge_master_ask` entry to match (description field; intent if present).
3. Update `forge-master-routes.mjs#getForgeMasterCapabilitiesSummary` to include `advisoryLaneAvailable: true` in the summary object.
4. (Optional but preferred) Add an `"advisory"` category to `prompts.mjs` with 2–3 starter prompts using the same shape as existing categories.
5. Create `pforge-mcp/tests/forge-master.advisory.test.mjs`:
   - Set up a mock provider that records the system prompt received.
   - Write a temp `PROJECT-PRINCIPLES.md` containing the architecture-first distilled text.
   - Call `runTurn({ message: "Should I refactor this controller or ship?" }, { provider: mockProvider, ... })`.
   - Assert (a) classification lane was `advisory` (check via `deps.dispatcher` call trace or by spying on `classify`), (b) the system prompt sent to `mockProvider.sendTurn` includes the string "Architecture-First" verbatim, (c) the system prompt includes the truncation-safe principles section, (d) the mock provider returned a reply and no write tool was dispatched.
6. Update `capabilities.mjs` version hint if applicable (`addedIn` stays at `"2.61.0"` for the base tool; advisory contract documented in CHANGELOG instead).

**Validation Gate**:
```bash
bash -c "grep -q 'advisory' pforge-mcp/capabilities.mjs && grep -q 'cto-in-a-box' pforge-mcp/capabilities.mjs && grep -q 'advisoryLaneAvailable' pforge-mcp/forge-master-routes.mjs && cd pforge-mcp && npx vitest run tests/forge-master.advisory.test.mjs --reporter=default"
```

**Stop Condition**: Capabilities surface doesn't advertise advisory, the advisory integration test fails, or the mock provider's system prompt doesn't contain "Architecture-First".

---

### Slice 5 — Release v2.66.0 [sequential]

**Depends On**: Slice 4
**Context Files**: `CHANGELOG.md`, `ROADMAP.md`, [pforge.ps1](pforge.ps1) (Phase-31.1 rebuild), `.github/instructions/git-workflow.instructions.md`
**Scope**: `CHANGELOG.md`, `ROADMAP.md`, `VERSION`, `pforge-mcp/package.json`, `docs/index.html`, `README.md` (all mutated by bump), git tag, GitHub release

1. `.\pforge.ps1 version-bump 2.66.0 --dry-run` — review diff. Expect 5 target updates (VERSION, package.json, docs/index.html × 2 patterns, ROADMAP; README may warn as Optional).
2. `.\pforge.ps1 version-bump 2.66.0 --strict` — expect `Updated 5/5 targets, 0 failure(s)` and exit 0. Any failure here means Phase-31.1's rebuild failed the field test; stop and file a meta-bug.
3. Edit `CHANGELOG.md`: promote `[Unreleased]` to `[2.66.0] — 2026-04-22`. Entries:
   - **Forge-Master Studio: Event-delegated gallery.** Fixed prompt-chip click not populating the composer. Replaced inline `onclick` HTML injection with data-attribute + delegated listener.
   - **Forge-Master: Expanded domain glossary.** Intent router now recognises bare "slice", phase references, tempering vocabulary, meta-bug terms, and more. Off-topic redirect teaches the user the accepted lanes.
   - **Forge-Master: Advisory lane + principles loader.** New `advisory` lane for "should I...?" / "what's the right path?" questions. New `principles.mjs` loads `PROJECT-PRINCIPLES.md`, the principles block from `copilot-instructions.md`, and `.forge.json#forgeMaster.philosophy`. Falls back to the universal architecture-first baseline.
   - **`forge_master_ask`: CTO-in-a-box advisory contract.** `agentGuidance` now advertises principles-grounded advisory calls for agent-to-agent consultation. Read-only. Low-medium cost.
4. Edit `ROADMAP.md`: current release → v2.66.0; add "Phase-32 ✅ Forge-Master Advisory Mode" under 2.66.x.
5. `git add -A && git commit -m "chore(release): v2.66.0"` with body summarising the four deliverables and linking Phase-32 plan.
6. `git tag -a v2.66.0 -m "v2.66.0 — Forge-Master Advisory Mode"`.
7. `git push origin master && git push origin v2.66.0`.
8. `gh release create v2.66.0 --title "v2.66.0 — Forge-Master Advisory Mode (Phase-32)" --notes-file <notes>` where notes summarise each slice.

**Validation Gate**:
```bash
bash -c "grep -q '^2.66.0$' VERSION && git rev-parse v2.66.0 >/dev/null 2>&1 && grep -q '\\[2.66.0\\]' CHANGELOG.md && echo OK"
```

**Stop Condition**: VERSION does not equal `2.66.0`, the v2.66.0 tag is missing, or CHANGELOG lacks the `[2.66.0]` section.

---

## Rollback

- **After Slice 1**: `git revert <slice-commit>`. Removes the event-delegation refactor; restores inline-onclick (still broken but no worse than before). Delete the new test file.
- **After Slice 2**: `git revert`. Glossary shrinks back to pre-Phase-32. No consumers depend on the new lane classifications yet.
- **After Slice 3**: `git revert` + delete `principles.mjs` + delete `forge-master-principles.test.mjs`. The `{principles_block}` placeholder in `system-prompt.md` would be left as a literal — do a second revert of `system-prompt.md` to remove it.
- **After Slice 4**: `git revert`. Capabilities surface loses advisory advertising; the advisory lane still works but isn't discoverable by other agents. Acceptable partial state.
- **After Slice 5 tag**: Delete tag (`git tag -d v2.66.0 && git push origin :refs/tags/v2.66.0`), delete GitHub release (`gh release delete v2.66.0`), revert the release commit. Previous v2.65.1 remains the latest shipped version.

## Success Signals

- Scott asks "should I refactor this controller or ship?" in Forge-Master Studio and receives a principles-grounded answer that cites the architecture-first commitment by name.
- Clicking any prompt chip in the gallery populates the composer on first click, every time, across Chrome/Edge/Firefox.
- Questions using "slice", "harden", "tempering", "Phase-33" no longer fall through to the `offtopic` redirect.
- Another AI agent, reading `forge_capabilities`, discovers `forge_master_ask` as an advisory surface and begins using it during quorum flows for principles-grounded decisions.
- The `.forge.json#forgeMaster.philosophy` key, when set, materially changes Forge-Master's advice (verifiable by setting it to something contrarian and observing the behaviour shift).

## Anti-Pattern Guards

- **Don't** convert `forge-master.js` to TypeScript or ES modules-with-bundling in Slice 1. Surgical fix only.
- **Don't** let principles-loading become a `.forge.json` migration. Missing keys fall back; no write-back to the config file.
- **Don't** inject principles into every Plan Forge prompt. Scope is Forge-Master only.
- **Don't** widen the advisory lane to cover operational territory. "What's my cost?" stays operational even if the user says "should I check my cost?" (the operational signal is stronger).
- **Don't** try to auto-detect "client pressure" to relax the architecture-first default. That is a user override that lives in the philosophy block, not a router heuristic.

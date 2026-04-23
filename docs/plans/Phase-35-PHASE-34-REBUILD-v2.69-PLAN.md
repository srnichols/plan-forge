---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session rebuild plan)
hardened_at: 2026-04-23
---

# Phase-35 — Phase-34 Hollow Slice Rebuild (Meta-Bug #96)

> **Target release**: v2.69.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: v2.68.1 shipped (Phase-34.1)
> **Addresses**: Meta-bug [#96](https://github.com/srnichols/plan-forge/issues/96) — Phase-34 Slices 2 & 3 shipped hollow

---

## Specification Source

- **Field input**: Validation harness `scripts/probe-forge-master.mjs` surfaced that Phase-34 Slices 2 and 3 shipped without implementation. Two committed test files import symbols that do not exist:
  - [pforge-master/src/__tests__/intent-auto-escalation.test.mjs](pforge-master/src/__tests__/intent-auto-escalation.test.mjs) — 10 failures. Imports `LANES.TEMPERING`, `LANES.PRINCIPLE_JUDGMENT`, `LANES.META_BUG_TRIAGE`, `LANE_DESCRIPTORS`. None exist in [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs).
  - [pforge-mcp/tests/forge-master-prefs.test.mjs](pforge-mcp/tests/forge-master-prefs.test.mjs) — 5 failures. Imports `loadPrefs`, `savePrefs`, and requires `createHttpRoutes` to register `GET` / `PUT /api/forge-master/prefs`. None exist in [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs).
- **Root cause**: Phase-34's grep-only gates matched placeholder identifiers without ever running `vitest`. The test files were committed as artifacts of the plan; the implementation never landed.
- **Architecture anchor**: Principle 7 (Evidence Over Assumption) and Principle 10 (Keep Gates Boring) — every gate that references a test file must execute it.
- **Contract**: The committed test files are the authoritative spec. This plan rebuilds the implementation to make them pass unmodified. API shapes (exported names, return-value keys, default values, file paths) are pinned by the tests and are NOT negotiable.

---

## Scope Contract

### In scope

- [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) — add `LANES.TEMPERING`, `LANES.PRINCIPLE_JUDGMENT`, `LANES.META_BUG_TRIAGE`; export `LANE_DESCRIPTORS`; add keyword patterns for the three new lanes.
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) — auto-escalation path; `runTurn` return shape extended with `autoEscalated`, `fromTier`, `toTier`, `reason`.
- [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs) — export `loadPrefs(cwd)` and `savePrefs(prefs, cwd)`; register `GET` and `PUT /api/forge-master/prefs` in `createHttpRoutes`.
- [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js) — Fast/Balanced/Deep segmented control wired to the prefs endpoints.
- `.gitignore` — add `.forge/fm-prefs.json`.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.69.0 release metadata.

### Out of scope

- **Do NOT modify** the two existing test files (`intent-auto-escalation.test.mjs`, `forge-master-prefs.test.mjs`). They are the spec.
- **Do NOT modify** [docs/plans/Phase-34-FORGE-MASTER-REASONING-DIAL-v2.68-PLAN.md](docs/plans/Phase-34-FORGE-MASTER-REASONING-DIAL-v2.68-PLAN.md) — historical record.
- **Do NOT** refactor or rename existing lanes (`BUILD`, `OPERATIONAL`, `TROUBLESHOOT`, `OFFTOPIC`, `ADVISORY`). Their `recommendedTierBump` is `0` per the test spec.
- **Do NOT** change Phase-34 Slice 1 tier-resolver code ([pforge-master/src/reasoning-tier.mjs](pforge-master/src/reasoning-tier.mjs) or the tier-resolution path in `reasoning.mjs`). Only add the auto-escalation layer on top.
- **Do NOT** wire real dispatcher into `/stream` route. That is Phase-36's work.
- **Do NOT** emit `classification` SSE event. That is Phase-36's work.
- **Do NOT** expand classifier keyword coverage beyond the three new lanes. That is Phase-37's work.

### Forbidden actions

- **No `.skip` / `xit` / deleted tests.** Both test files must pass with all assertions active.
- **No grep-only gates on source files.** Every gate that references a test file MUST invoke `npx vitest run <file>`. Structural grep is allowed ONLY as a secondary cross-check alongside vitest, never as the sole gate. This rule is the core fix for meta-bug #96.
- **No prefs filename other than `.forge/fm-prefs.json`.** The test pins this exact path.
- **No prefs defaults other than `{ tier: null, autoEscalate: false }`** when the file is missing. The test pins this exact shape.
- **No model names** (`gpt-4`, `claude`, `gemini`, `opus`, `sonnet`) in [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js) visible strings or CSS class names.
- **No Unix-tool gate commands other than `grep`, `test`, and `npx`/`node`.** Windows dispatch via bash is supported (Phase-34.1) but keep gates minimal — vitest + one grep per slice.

---

## Acceptance Criteria

### Criteria for Slice 1 — Intent-router additions

- **MUST**: `pforge-master/src/intent-router.mjs` exports `LANES.TEMPERING = "tempering"`, `LANES.PRINCIPLE_JUDGMENT = "principle-judgment"`, `LANES.META_BUG_TRIAGE = "meta-bug-triage"`.
- **MUST**: `pforge-master/src/intent-router.mjs` exports `LANE_DESCRIPTORS` — a frozen object keyed by every lane value. Each value is an object with at minimum `{ recommendedTierBump: number }`. `LANE_DESCRIPTORS[LANES.TEMPERING].recommendedTierBump === 1`, `LANE_DESCRIPTORS[LANES.PRINCIPLE_JUDGMENT].recommendedTierBump === 1`, `LANE_DESCRIPTORS[LANES.META_BUG_TRIAGE].recommendedTierBump === 1`. All other lanes have `recommendedTierBump: 0`.
- **MUST**: Keyword patterns added so that:
  - `classify("Please run a tempering gate evaluation for this slice")` returns `{ lane: LANES.TEMPERING, confidence > 0, ... }`.
  - `classify("I need a principle judgment on whether to add this abstraction")` returns `{ lane: LANES.PRINCIPLE_JUDGMENT, confidence > 0, ... }`.
  - `classify("Can you triage this meta bug from Slice 4?")` returns `{ lane: LANES.META_BUG_TRIAGE, confidence > 0, ... }`.
- **MUST**: The new tempering pattern is strong enough to beat the existing tempering-as-operational pattern on line 141 (current: `tempering|baseline|enforcement|suppressed` weight 2, lane OPERATIONAL). Options: remove `tempering` from the operational pattern and move it solely to TEMPERING lane (weight 3), OR add a TEMPERING pattern with weight ≥ 3 AND a tempering+context pattern (`tempering\s+(gate|evaluation|triage)`) at weight 4. Either is acceptable provided probe (3) passes.
- **MUST**: The meta-bug-triage pattern is strong enough to beat the existing meta-bug-as-troubleshoot pattern on line 122 (`meta[-\s]?bug|...` weight 3, lane TROUBLESHOOT). Add a META_BUG_TRIAGE pattern with weight ≥ 4, OR add a tie-break rule. Probe (5) must pass.
- **MUST**: Existing tests in [pforge-master/src/__tests__/intent-router.test.mjs](pforge-master/src/__tests__/intent-router.test.mjs) continue to pass — no regressions to BUILD / OPERATIONAL / TROUBLESHOOT / OFFTOPIC / ADVISORY routing.
- **MUST**: `LANE_TOOLS` export includes entries for the three new lanes (empty array `[]` acceptable for this phase; Phase-36 fills them).
- **MUST**: The `scoreKeywords` return-value map and stage-2 router-model prompt are extended to include the three new lanes so the classifier does not fall to OFFTOPIC on ambiguous inputs that touch these lanes.

### Criteria for Slice 2 — Auto-escalation in runTurn

- **MUST**: `runTurn` in [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) inspects `classification.lane` and, if `LANE_DESCRIPTORS[lane].recommendedTierBump > 0`, bumps the resolved tier by that amount for this turn: `low → medium → high`, capped at `high`.
- **MUST**: When auto-escalation fires, `runTurn` return object includes `autoEscalated: true`, `fromTier: <originalTier>`, `toTier: <bumpedTier>`, `reason: <string>` where the string matches `/high-stakes lane/` AND includes the lane name (e.g., `"high-stakes lane: tempering"`).
- **MUST**: When auto-escalation does NOT fire (lane bump is 0, or no tier requested, or explicit `input.model` override set, or `config.forgeMaster.autoEscalate === false`), `runTurn` return object includes `autoEscalated: false` (and may omit `fromTier` / `toTier` / `reason` or set them to `null`).
- **MUST**: `resolvedModel` in the return object reflects the bumped tier's model. In the test fixture (`reasoningTiers: { high: "claude-opus-4", medium: "gpt-4o", low: "gpt-4o-mini" }`) a tempering message with `tier: "medium"` must return `resolvedModel: "claude-opus-4"`.
- **MUST**: `requestedTier` in the return object is the originally requested tier (`"medium"` in the test), NOT the bumped tier.
- **MUST**: Auto-escalation is independent of rate-limit fallback — the `escalated` field (used for rate-limit cascades) is unaffected. Test (6) asserts `result.escalated === false`.
- **MUST**: Explicit `input.model` override bypasses auto-escalation entirely (no bump, no tier logic).
- **MUST**: `config.forgeMaster.autoEscalate = false` disables the bump.
- **SHOULD**: Turn trace emitted via hub / log includes the autoEscalation fields for later audit.

### Criteria for Slice 3 — Prefs file persistence + REST endpoints

- **MUST**: `pforge-master/src/http-routes.mjs` exports `loadPrefs(cwd)` and `savePrefs(prefs, cwd)`.
- **MUST**: Prefs backing file is `<cwd>/.forge/fm-prefs.json` (EXACTLY this filename — test (4) writes to this path).
- **MUST**: `loadPrefs(cwd)` returns `{ tier: null, autoEscalate: false }` when the file does not exist (test 1).
- **MUST**: `loadPrefs(cwd)` returns `{ tier, autoEscalate }` from the file when present and `tier ∈ {"low","medium","high"}` (tests 2, 3).
- **MUST**: `loadPrefs(cwd)` returns `tier: null` when the file contains an invalid tier value (e.g., `"turbo"`). `autoEscalate` reflects the file's value (test 4).
- **MUST**: `savePrefs({ tier, autoEscalate }, cwd)` creates `.forge/` directory if missing and writes the JSON atomically. Round-trip with `loadPrefs` preserves both fields (tests 2, 3).
- **MUST**: `createHttpRoutes(app)` registers `GET /api/forge-master/prefs` and `PUT /api/forge-master/prefs` (test 5). Express `app.get(path, handler)` and `app.put(path, handler)` calls with the exact path string `/api/forge-master/prefs`.
- **MUST**: `GET /api/forge-master/prefs` responds with JSON body `{ tier, autoEscalate }` from `loadPrefs(process.cwd())`.
- **MUST**: `PUT /api/forge-master/prefs` accepts JSON body `{ tier?, autoEscalate? }`; validates `tier ∈ {"low","medium","high"}` else responds `400`; writes via `savePrefs`; responds with the persisted object.
- **MUST**: `.gitignore` lists `.forge/fm-prefs.json` (or equivalent pattern that excludes it — `.forge/` already gitignored counts).
- **MUST**: `forge_master_ask` tool in [pforge-mcp/server.mjs](pforge-mcp/server.mjs) reads `loadPrefs(process.cwd()).tier` on each invocation and threads `tier` into `runTurn({ tier, ... })` when non-null.
- **SHOULD**: `PUT` endpoint error responses use the existing ProblemDetails pattern from the codebase if any; otherwise plain JSON `{ error: "..." }` is acceptable.

### Criteria for Slice 4 — Dashboard dial UI + release v2.69.0

- **MUST**: [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js) contains a segmented control with exactly three buttons labelled `Fast`, `Balanced`, `Deep` (visible strings; case-sensitive).
- **MUST**: On dial change, the dashboard calls `PUT /api/forge-master/prefs` with the mapped tier (`Fast → low`, `Balanced → medium`, `Deep → high`) and the current `autoEscalate` value.
- **MUST**: On tab load, the dashboard calls `GET /api/forge-master/prefs` and sets the dial position accordingly.
- **MUST**: `forge-master.js` does NOT contain any of these substrings (case-insensitive): `gpt-4`, `claude`, `gemini`, `opus`, `sonnet`, `haiku`. Grep gate enforces this.
- **MUST**: `VERSION` contains exactly `2.69.0`.
- **MUST**: `CHANGELOG.md` has a `[2.69.0] — 2026-04-23` section under `[Unreleased]`, containing the phrase `Closes #96` AND one of `phantom completion` / `hollow slices` / `grep-only gates`.
- **MUST**: `ROADMAP.md` reflects Phase-35 / v2.69.0 as shipped.
- **MUST**: Slice 4 release commit message includes `Closes #96` in the body (footer preferred).
- **MUST**: Git tag `v2.69.0` exists on the Slice 4 release commit.

### Quality bar

- **SHOULD**: Release commit message format `chore(release): v2.69.0 — Phase-34 rebuild (closes #96)`.
- **SHOULD**: Toast notifications on dial change and auto-escalation are functional but not strictly required for this phase's gate (UX polish acceptable in a follow-up).

---

## Execution Slices

### Slice 1 — Intent-router additions (LANES, LANE_DESCRIPTORS, keyword patterns)

**Complexity**: 3 (module edit, keyword weight tuning, no new files).

**Files to modify**:
- `pforge-master/src/intent-router.mjs`

**Steps**:
1. Read `intent-router.mjs` — reuse the `LANES`, `LANE_TOOLS`, and `KEYWORD_RULES` patterns.
2. Add to `LANES`: `TEMPERING: "tempering"`, `PRINCIPLE_JUDGMENT: "principle-judgment"`, `META_BUG_TRIAGE: "meta-bug-triage"`.
3. Add `LANE_TOOLS` entries for the three new lanes — `[]` is acceptable (Phase-36 will populate).
4. Export new `LANE_DESCRIPTORS`:
   ```js
   export const LANE_DESCRIPTORS = Object.freeze({
     [LANES.BUILD]:              { recommendedTierBump: 0 },
     [LANES.OPERATIONAL]:         { recommendedTierBump: 0 },
     [LANES.TROUBLESHOOT]:        { recommendedTierBump: 0 },
     [LANES.OFFTOPIC]:            { recommendedTierBump: 0 },
     [LANES.ADVISORY]:            { recommendedTierBump: 0 },
     [LANES.TEMPERING]:           { recommendedTierBump: 1 },
     [LANES.PRINCIPLE_JUDGMENT]:  { recommendedTierBump: 1 },
     [LANES.META_BUG_TRIAGE]:     { recommendedTierBump: 1 },
   });
   ```
5. **Adjust existing rules** to prevent collisions:
   - Line 141 `tempering|baseline|enforcement|suppressed`: remove `tempering` from this pattern (keep `baseline|enforcement|suppressed` for OPERATIONAL).
   - Line 122 meta-bug pattern for TROUBLESHOOT: keep it, but add a higher-weight META_BUG_TRIAGE pattern.
6. Add new keyword patterns (weight chosen to beat colliding lanes):
   ```js
   // Tempering lane
   { pattern: /\btempering\s+(gate|evaluation|triage|analysis|review)/i, lane: LANES.TEMPERING, weight: 4 },
   { pattern: /\btempering\b/i, lane: LANES.TEMPERING, weight: 3 },

   // Principle-judgment lane
   { pattern: /\bprinciple\s+(judgment|judgement|call|question)\b/i, lane: LANES.PRINCIPLE_JUDGMENT, weight: 4 },
   { pattern: /\b(vibe[-\s]?coding|over[-\s]?engineer(ing)?|separation\s+of\s+concerns)\b/i, lane: LANES.PRINCIPLE_JUDGMENT, weight: 3 },

   // Meta-bug-triage lane
   { pattern: /\btriage\s+(this|a|the)?\s*meta[-\s]?bug\b/i, lane: LANES.META_BUG_TRIAGE, weight: 4 },
   { pattern: /\bmeta[-\s]?bug\s+(triage|classification|routing)\b/i, lane: LANES.META_BUG_TRIAGE, weight: 4 },
   ```
7. Update `scoreKeywords` — the initial zero-score map on line 181 must include entries for the three new lanes.
8. Update the stage-2 router-model prompt (the text around line 229–240 listing lanes) to include the three new lanes with short descriptions. Keep existing lane descriptions unchanged.
9. Update the JSDoc lane list comment (lines 9–13) to include the three new lanes.

**Validation gate**:
```bash
npx vitest run pforge-master/src/__tests__/intent-auto-escalation.test.mjs --reporter=default 2>&1 | tee /tmp/s1-out.txt
grep -E "Tests +10 passed" /tmp/s1-out.txt
```
AND
```bash
npx vitest run pforge-master/src/__tests__/intent-router.test.mjs --reporter=default 2>&1 | tee /tmp/s1-reg.txt
grep -E "failed" /tmp/s1-reg.txt ; [ $? -ne 0 ]
```
Expected: first gate exits 0 and stdout contains `Tests  10 passed`. Second gate exits 0 because `grep failed` finds nothing (no regressions). Windows dispatch auto-wraps through git bash per Phase-34.1.

**Commit**: `feat(intent-router): add tempering / principle-judgment / meta-bug-triage lanes + LANE_DESCRIPTORS (#96)`

---

### Slice 2 — Auto-escalation in runTurn

**Complexity**: 3 (conditional branch in reasoning loop, return-shape additions).

**Files to modify**:
- `pforge-master/src/reasoning.mjs`

**Steps**:
1. Read `reasoning.mjs` around `runTurn` — identify the point just after `classify()` completes (around line 234) and just before tool-use loop begins.
2. Import `LANE_DESCRIPTORS` from `./intent-router.mjs`.
3. After `classification` is computed, before the OFFTOPIC short-circuit block, compute auto-escalation:
   ```js
   const laneDescriptor = LANE_DESCRIPTORS[classification.lane] || { recommendedTierBump: 0 };
   const bump = laneDescriptor.recommendedTierBump || 0;
   const autoEscalateEnabled = config.forgeMaster?.autoEscalate !== false; // default true
   const canEscalate = bump > 0 && autoEscalateEnabled && !inputModel && currentTier;
   let autoEscalated = false;
   let fromTier = null;
   let toTier = null;
   let reason = null;
   if (canEscalate) {
     const order = ["low", "medium", "high"];
     const fromIdx = order.indexOf(currentTier);
     const toIdx = Math.min(fromIdx + bump, order.length - 1);
     if (toIdx > fromIdx) {
       fromTier = currentTier;
       toTier = order[toIdx];
       currentTier = toTier;
       currentModel = resolveModel(currentTier, config);
       autoEscalated = true;
       reason = `high-stakes lane: ${classification.lane}`;
     }
   }
   ```
4. Include `autoEscalated`, `fromTier`, `toTier`, `reason` on every `runTurn` return path (OFFTOPIC short-circuit, no-provider error, success, tool-loop truncation). Set to `false` / `null` when not escalated.
5. Verify `resolvedModel` reflects the bumped model in the return object.
6. Ensure `requestedTier` remains the originally-requested tier (the value of `requestedTier` variable, untouched by the bump).
7. Respect explicit `input.model` override — the `!inputModel` guard above handles this.

**Validation gate**:
```bash
npx vitest run pforge-master/src/__tests__/intent-auto-escalation.test.mjs --reporter=default 2>&1 | tee /tmp/s2-out.txt
grep -E "Tests +10 passed" /tmp/s2-out.txt
```
AND
```bash
npx vitest run pforge-master/src/__tests__/reasoning-tier.test.mjs --reporter=default 2>&1 | tee /tmp/s2-reg.txt
grep -E "failed" /tmp/s2-reg.txt ; [ $? -ne 0 ]
```
Expected: auto-escalation test (test 6) now passes; Phase-34 Slice 1 tier-resolver tests still green.

**Commit**: `feat(reasoning): auto-escalate tier for high-stakes lanes (#96)`

---

### Slice 3 — Prefs file persistence + REST endpoints

**Complexity**: 4 (new exported functions, new routes, .gitignore, server.mjs wiring).

**Files to modify**:
- `pforge-master/src/http-routes.mjs`
- `pforge-mcp/server.mjs` (wire `loadPrefs` into `forge_master_ask`)
- `.gitignore`

**Files to create**: none (prefs helpers live in `http-routes.mjs` per the test import).

**Steps**:
1. In `http-routes.mjs` add at module scope:
   ```js
   import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
   import { join } from "node:path";

   const VALID_TIERS = ["low", "medium", "high"];
   const PREFS_DEFAULTS = { tier: null, autoEscalate: false };

   export function loadPrefs(cwd = process.cwd()) {
     const path = join(cwd, ".forge", "fm-prefs.json");
     if (!existsSync(path)) return { ...PREFS_DEFAULTS };
     try {
       const raw = JSON.parse(readFileSync(path, "utf-8"));
       const tier = VALID_TIERS.includes(raw.tier) ? raw.tier : null;
       const autoEscalate = typeof raw.autoEscalate === "boolean" ? raw.autoEscalate : false;
       return { tier, autoEscalate };
     } catch {
       return { ...PREFS_DEFAULTS };
     }
   }

   export function savePrefs(prefs, cwd = process.cwd()) {
     const forgeDir = join(cwd, ".forge");
     if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });
     const path = join(forgeDir, "fm-prefs.json");
     writeFileSync(path, JSON.stringify(prefs, null, 2), "utf-8");
   }
   ```
2. In `createHttpRoutes(app)` add the two routes (both express and node-built-in handlers — `createHttpRoutes` wires the express path; the built-in `_buildNodeHandler` must also register equivalent handlers):
   ```js
   app.get("/api/forge-master/prefs", (req, res) => {
     res.json(loadPrefs(process.cwd()));
   });
   app.put("/api/forge-master/prefs", (req, res) => {
     const { tier, autoEscalate } = req.body || {};
     if (tier !== undefined && !VALID_TIERS.includes(tier)) {
       return res.status(400).json({ error: "tier must be one of low|medium|high" });
     }
     const current = loadPrefs(process.cwd());
     const next = {
       tier: tier !== undefined ? tier : current.tier,
       autoEscalate: typeof autoEscalate === "boolean" ? autoEscalate : current.autoEscalate,
     };
     savePrefs(next, process.cwd());
     res.json(next);
   });
   ```
3. Mirror the GET/PUT logic in the built-in `_buildNodeHandler` path (around line 180 where `/api/forge-master/prefs` request parsing would go) so non-express servers also expose the endpoints.
4. In `pforge-mcp/server.mjs` — locate the `forge_master_ask` tool handler. Before calling `runTurn`, read `loadPrefs(process.cwd())` and thread the tier:
   ```js
   import { loadPrefs } from "../pforge-master/src/http-routes.mjs";
   // inside handler:
   const prefs = loadPrefs(process.cwd());
   const effectiveTier = input.tier ?? prefs.tier ?? undefined;
   // pass effectiveTier to runTurn
   ```
   If `forge_master_ask` already accepts a `tier` parameter, the explicit call-site value wins; prefs fills in when none provided.
5. Add `.forge/fm-prefs.json` to `.gitignore`. If `.forge/` is already ignored, this is a no-op documentation line; add a commented line for clarity.

**Validation gate**:
```bash
npx vitest run pforge-mcp/tests/forge-master-prefs.test.mjs --reporter=default 2>&1 | tee /tmp/s3-out.txt
grep -E "Tests +5 passed" /tmp/s3-out.txt
```
AND
```bash
grep -q "\.forge/fm-prefs.json\|\.forge/" .gitignore
```
Expected: vitest shows `Tests  5 passed`; grep finds the gitignore entry.

**Commit**: `feat(forge-master): prefs persistence + REST endpoints (#96)`

---

### Slice 4 — Dashboard dial UI + release v2.69.0

**Complexity**: 3 (dashboard JS, docs, version bump, tag).

**Files to modify**:
- `pforge-mcp/dashboard/forge-master.js`
- `VERSION`
- `CHANGELOG.md`
- `ROADMAP.md`
- `package.json` files (via `version-bump` tool)

**Steps**:
1. Read `pforge-mcp/dashboard/forge-master.js` — identify the Forge-Master tab render root.
2. Add segmented control HTML/JS:
   - Three buttons: `Fast`, `Balanced`, `Deep`.
   - Mapping: Fast↔low, Balanced↔medium, Deep↔high.
   - On click, `fetch("/api/forge-master/prefs", { method: "PUT", body: JSON.stringify({ tier }) })`.
   - On load, `fetch("/api/forge-master/prefs")` and apply to button state.
   - Tooltip: `"Powered by frontier models via your GitHub Copilot subscription. Higher tiers may hit rate limits sooner."` (no model names in this string).
3. Confirm no model names appear anywhere in the file (grep -i).
4. Run `.\pforge.ps1 version-bump 2.69.0 --strict`. Require `Updated 5/5`.
5. Update `CHANGELOG.md` — add `[2.69.0] — 2026-04-23 — Phase-34 rebuild` section under `[Unreleased]`. Include:
   - Phrase `Closes #96`.
   - Phrase `phantom completion` OR `hollow slices` OR `grep-only gates`.
   - One line: "New lanes: tempering, principle-judgment, meta-bug-triage with auto-escalation."
   - One line: "Prefs endpoints + Fast/Balanced/Deep dashboard dial."
   - One line: "Root cause: Phase-34 grep-only gates shipped without running test suites. Fix: every gate that references a test file now invokes vitest."
6. Update `ROADMAP.md` — Phase-35 / v2.69.0 shipped.
7. Commit with `Closes #96` in body. Tag v2.69.0 and push.

**Validation gate**:
```bash
grep -q "^2.69.0$" VERSION
grep -q "\[2.69.0\]" CHANGELOG.md
grep -q "Closes #96" CHANGELOG.md
grep -q -E "Fast|Balanced|Deep" pforge-mcp/dashboard/forge-master.js
grep -i -q -E "gpt-4|claude|gemini|opus|sonnet|haiku" pforge-mcp/dashboard/forge-master.js ; [ $? -ne 0 ]
```
Expected: first four greps exit 0; last grep inverted (exit code negated) — absence of model names.

**Commit**: `chore(release): v2.69.0 — Phase-34 rebuild (closes #96)`

---

## Execution Order

1 → 2 → 3 → 4. No parallelism. Slices 1 and 2 are tightly coupled (Slice 2 test depends on Slice 1 classifier routing); Slice 3 is independent; Slice 4 is release.

## Risks and Mitigations

- **Risk**: Keyword weight for new lanes collides with existing patterns, breaking regression tests. *Mitigation*: Slice 1 gate runs both `intent-auto-escalation.test.mjs` AND `intent-router.test.mjs`. The plan explicitly calls out the two known collision points (tempering+operational on line 141, meta-bug+troubleshoot on line 122) and resolves them.
- **Risk**: `runTurn` return shape changes break callers. *Mitigation*: only ADD keys (`autoEscalated`, `fromTier`, `toTier`, `reason`). Do not remove or rename existing return fields.
- **Risk**: `loadPrefs` / `savePrefs` import path for `server.mjs` could create a cycle if `http-routes.mjs` imports anything from `server.mjs`. *Mitigation*: `http-routes.mjs` already has no such dependency today (checked at hardening time). Keep it that way.
- **Risk**: The built-in node handler path in `http-routes.mjs` is a second code path that's easy to forget. *Mitigation*: Slice 3 step 3 explicitly calls out mirroring in `_buildNodeHandler`. The test only checks the express path but runtime needs both.
- **Risk**: Meta-bug #96 remains open if commit footer syntax varies. *Mitigation*: CHANGELOG text `Closes #96` is guaranteed by grep gate; commit footer `Closes #96` is a SHOULD. If GitHub doesn't auto-close, run `gh issue close 96` manually after tag push.

## Session Break Points

- After Slice 2 if context is thin — Slices 1 and 2 land the critical lane + escalation behavior that unblocks Phase-36. Slices 3 and 4 are UI + release, safe to resume in a new session.

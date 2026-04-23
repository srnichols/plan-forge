---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session plan)
hardened_at: 2026-04-23
---

# Phase-37 — Forge-Master Classifier Calibration

> **Target release**: v2.71.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-36 shipped (v2.70.0) — `classification` SSE event flowing, real dispatcher, probe harness wired for lane-match
> **Addresses**: Finding 1 from `.forge/validation/FINDINGS-2026-04-23.md` (offtopic mis-routing for 6/24 probes)

---

## Specification Source

- **Field input**: Probe baseline `.forge/validation/results-2026-04-23T02-01-29-488Z.md` recorded 6 mis-routes to OFFTOPIC:
  `op-cost-week`, `op-phase-reference`, `op-slice-status`, `ts-recurrence`, `adv-principle-judgment`, `adv-arch-review`.
- **Root cause**: `scoreKeywords` in [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) has thin keyword sets. When zero keywords match, `classify()` defaults to OFFTOPIC. In zero-provider mode (the default Copilot-zero-key path from Phase-33), stage-2 router-model cannot recover, so every ambiguous prompt becomes offtopic.
- **Contract**: `.forge/validation/probes.json` is the ground truth. Every probe with `lane != "any"` must route to its expected lane in keyword-only mode (stage 2 mocked off). This phase is complete when keyword-only lane-match ≥ 16/18 AND the calibration test pins the mapping permanently.

---

## Scope Contract

### In scope

- [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) — `scoreKeywords` map: add patterns; adjust `classify()` return shape to include `confidence: "low"|"medium"|"high"`; add OFFTOPIC tie-breaker.
- New `pforge-master/src/__tests__/classifier-calibration.test.mjs` — authoritative probe-to-lane regression harness, keyword-only mode.
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs) — add `--keyword-only` flag to force-disable stage 2 during harness runs.
- [.forge/validation/probes.json](.forge/validation/probes.json) — may extend (not weaken) probe set; committed via `git add -f`.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.71.0 release metadata.
- Committed probe-run results: `.forge/validation/results-<ISO>.md`.

### Out of scope

- **Do not modify stage 2 router-model logic.** It remains the ambiguity breaker; this phase only reduces how often it fires.
- **Do not change lane IDs, order, or `LANE_DESCRIPTORS`.** Phase-35 shipped them; they stay frozen.
- **Do not alter the SSE event schema.** Phase-36 pinned `classification` shape `{lane, confidence}` — this phase fills in the `confidence` field correctly but does not rename or reshape.
- **Do not remove existing keyword patterns.** Additions only. If a pattern proves too greedy during calibration, narrow the regex — do not delete.
- **Do not add a `pforge forge-master classify <message>` CLI.** Future phase.
- **Do not disable `OFFTOPIC` for weather/food/general-code prompts.** The existing offtopic guards stay.

### Forbidden actions

- **Do not weaken probe expectations** in `.forge/validation/probes.json` to make tests pass. Probes are the contract.
- **Do not let calibration test shrink** — it must cover ALL 18 non-`any`-lane probes plus 3 OFFTOPIC guards (`off-weather`, `off-code-gen`, `amb-slice-food`). Gate enforces a minimum probe count.
- **Do not skip stage-2-mock isolation** — the calibration test MUST mock stage 2 to throw, ensuring only keyword scoring is exercised. A test that silently falls through to stage 2 is a false-green.
- **Do not hand-edit `results-*.md`** to claim success. The harness writes it; gate verifies the counter.

---

## Acceptance Criteria

### Criteria for Slice 1 — Operational lane keyword expansion

- **MUST**: `scoreKeywords.operational` in [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) gains at least these patterns with indicated weights:
  - `/\b(phase[- ]?\d+|slice\s+\d+)\b/i` — weight 3
  - `/\b(cost|spend|spent|budget|tokens|quorum|estimate)\b/i` — weight 3
  - `/\b(ship|shipped|landed|merged|released|deployed)\b/i` — weight 2
  - `/\b(status|progress|running|ran|failed|passed|green|red)\b/i` — weight 2
  - `/\b(memory|recall|brain|remembered)\b/i` — weight 3
- **MUST**: New file `pforge-master/src/__tests__/classifier-calibration.test.mjs` exists. It imports `classify` from `intent-router.mjs`, mocks stage 2 router-model to throw (via `vi.mock` or `deps.routerModel` stub), and pins at minimum these probes:
  - `op-cost-week`, `op-phase-reference`, `op-slice-status` → `lane === "operational"`
  - Plus the operational probes already passing baseline (at least 3 more) → still `operational`
- **MUST**: All tests in the calibration file pass.
- **MUST**: Existing `pforge-master/src/__tests__/intent-router.test.mjs` suite still passes (no regressions on existing keyword behavior).

### Criteria for Slice 2 — Troubleshoot + advisory keyword expansion

- **MUST**: `scoreKeywords.troubleshoot` gains at minimum:
  - `/\b(orchestrator|worker|gate|timeout|stuck|hang|deadlock|erroring|crash|exception)\b/i` — weight 3
  - `/\b(did we see|seen before|recurring|again|last time)\b/i` — weight 2
  - `/\b(incident|outage|alert)\b/i` — weight 3
- **MUST**: `scoreKeywords.advisory` gains at minimum:
  - `/\b(architecture|design|refactor|abstraction|principle|over.?engineer|separation of concerns)\b/i` — weight 3
  - `/\b(review|audit|critique|thoughts on|opinion)\b/i` — weight 2
  - `/\b(should i|should we|best path|best approach|way forward|trade.?offs?)\b/i` — weight 3
- **MUST**: Calibration test extended to pin:
  - `ts-recurrence` → `lane === "troubleshoot"`
  - `adv-principle-judgment`, `adv-arch-review` → `lane === "advisory"`
- **MUST**: All existing calibration + intent-router tests still pass.

### Criteria for Slice 3 — Confidence field + OFFTOPIC tie-breaker

- **MUST**: `classify()` return object gains `confidence: "low" | "medium" | "high"`:
  - `low` when winning-lane score ≤ 2
  - `medium` when 3 ≤ score ≤ 5
  - `high` when score ≥ 6
- **MUST**: Tie-breaker: when OFFTOPIC score equals the top non-OFFTOPIC score, OFFTOPIC wins. This prevents "slice me an apple" from routing to operational.
- **MUST**: Calibration test gains OFFTOPIC-guard cases pinning:
  - `off-weather` → `lane === "offtopic"`
  - `off-code-gen` → `lane === "offtopic"`
  - `amb-slice-food` → `lane === "offtopic"` (tie-breaker)
  - `amb-plan` → `confidence === "low"` (pin the confidence, not the lane)
- **MUST**: `runTurn` in `reasoning.mjs` threads `confidence` through to the `classification` callback payload and return field (it already does structurally — confirm via test).
- **MUST**: `pforge-master/tests/http-routes-sse.test.mjs` continues to pass (SSE payload includes `confidence`).
- **MUST**: Existing `pforge-master/src/__tests__/reasoning-classification-surface.test.mjs` still passes.

### Criteria for Slice 4 — Harness validation + release v2.71.0

- **MUST**: `scripts/probe-forge-master.mjs` accepts `--keyword-only` flag. When set, the harness sends a header `x-pforge-keyword-only: 1` (or equivalent) that `http-routes.mjs` / `runTurn` honors by mocking/skipping stage 2.
- **MUST**: [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs) reads the header and propagates `deps.forceKeywordOnly = true` into `runTurn`. `runTurn` skips the router-model stage when this flag is set.
- **MUST**: A live harness run with `--keyword-only` produces `.forge/validation/results-<ISO>.md` with ≥16/18 lane-match on non-`any` probes.
- **MUST**: A second run WITHOUT `--keyword-only` produces a results file with ≥22/24 OK replies AND ≥16/18 lane-match. Committed as primary evidence for v2.71.0.
- **MUST**: Both results files committed with `git add -f`.
- **MUST**: `VERSION` contains exactly `2.71.0`.
- **MUST**: `CHANGELOG.md` has a `[2.71.0] — 2026-04-23` section under `[Unreleased]` mentioning `classifier calibration`, `lane-match`, and citing the baseline 3/18 → new count.
- **MUST**: `ROADMAP.md` reflects Phase-37 / v2.71.0 as shipped.
- **MUST**: Git tag `v2.71.0` exists on the Slice 4 release commit. `.forge/validation/FINDINGS-2026-04-23.md` Finding 1 gets a `RESOLVED` stamp.

### Quality bar

- **SHOULD**: Release commit message format `chore(release): v2.71.0 — classifier calibration`.
- **SHOULD**: Harness output Markdown includes a per-lane precision+recall table.
- **SHOULD**: Classifier confidence badge appears in the Phase-36 dashboard UI (not gate-enforced).

---

## Execution Slices

### Slice 1 — Operational lane keyword expansion

**Complexity**: 2.

**Files to modify**: `pforge-master/src/intent-router.mjs`.

**Files to create**: `pforge-master/src/__tests__/classifier-calibration.test.mjs`.

**Steps**:
1. Read `intent-router.mjs`, locate `scoreKeywords` map.
2. Add the 5 operational patterns with specified weights. Preserve existing patterns.
3. Create `classifier-calibration.test.mjs`. Import `classify`. Use `vi.mock` or inject `deps.routerModel` that throws. Write one `describe("operational", ...)` block pinning `op-cost-week`, `op-phase-reference`, `op-slice-status`, plus 3 other operational probes from `probes.json`.
4. Run `npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs -t operational`.
5. Run full intent-router suite to confirm no regressions.

**Validation gate**:
```bash
npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs -t operational --reporter=default 2>&1 | tee /tmp/s1-out.txt
grep -E "Tests +[3-9][0-9]* passed" /tmp/s1-out.txt
```
AND
```bash
npx vitest run pforge-master/src/__tests__/intent-router.test.mjs --reporter=default 2>&1 | tee /tmp/s1-reg.txt
grep -E "failed" /tmp/s1-reg.txt ; [ $? -ne 0 ]
```

**Commit**: `feat(classifier): expand operational lane keyword coverage`

---

### Slice 2 — Troubleshoot + advisory keyword expansion

**Complexity**: 2.

**Files to modify**:
- `pforge-master/src/intent-router.mjs`
- `pforge-master/src/__tests__/classifier-calibration.test.mjs` (extend)

**Steps**:
1. Add troubleshoot + advisory patterns with specified weights.
2. Extend calibration test: `describe("troubleshoot", ...)` pinning `ts-recurrence` plus existing troubleshoot probes. `describe("advisory", ...)` pinning `adv-principle-judgment`, `adv-arch-review` plus existing advisory probes.
3. Run full calibration + intent-router suites.

**Validation gate**:
```bash
npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs --reporter=default 2>&1 | tee /tmp/s2-out.txt
grep -E "Tests +[6-9][0-9]* passed" /tmp/s2-out.txt
```
AND
```bash
npx vitest run pforge-master/src/__tests__/intent-router.test.mjs --reporter=default 2>&1 | tee /tmp/s2-reg.txt
grep -E "failed" /tmp/s2-reg.txt ; [ $? -ne 0 ]
```

**Commit**: `feat(classifier): expand troubleshoot + advisory keyword coverage`

---

### Slice 3 — Confidence field + OFFTOPIC tie-breaker

**Complexity**: 3.

**Files to modify**:
- `pforge-master/src/intent-router.mjs` — add confidence scoring + tie-breaker
- `pforge-master/src/__tests__/classifier-calibration.test.mjs` — extend with offtopic + confidence cases

**Steps**:
1. In `classify()`, after winner is selected, compute `confidence`:
   ```js
   let confidence;
   if (topScore <= 2) confidence = "low";
   else if (topScore <= 5) confidence = "medium";
   else confidence = "high";
   return { lane: winner, confidence, scores };
   ```
2. Before selecting winner, add tie-breaker: if `scores.offtopic >= maxNonOfftopicScore`, force `winner = "offtopic"`.
3. Extend calibration test:
   - `describe("offtopic guards", ...)` — pin `off-weather`, `off-code-gen`, `amb-slice-food` → `lane === "offtopic"`.
   - `describe("confidence", ...)` — pin `amb-plan` → `confidence === "low"`; one high-score probe → `confidence === "high"`.
4. Run calibration + reasoning + http-routes-sse suites.

**Validation gate**:
```bash
npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs --reporter=default 2>&1 | tee /tmp/s3-out.txt
grep -E "Tests +[8-9][0-9]*|Tests +[1-9][0-9][0-9]+ passed" /tmp/s3-out.txt
```
AND
```bash
npx vitest run pforge-master/src/__tests__/reasoning-classification-surface.test.mjs pforge-master/tests/http-routes-sse.test.mjs --reporter=default 2>&1 | tee /tmp/s3-reg.txt
grep -E "failed" /tmp/s3-reg.txt ; [ $? -ne 0 ]
```

**Commit**: `feat(classifier): confidence field + offtopic tie-breaker`

---

### Slice 4 — Harness validation + release v2.71.0

**Complexity**: 3.

**Files to modify**:
- `scripts/probe-forge-master.mjs` — add `--keyword-only` flag
- `pforge-master/src/http-routes.mjs` — honor `x-pforge-keyword-only` header
- `pforge-master/src/reasoning.mjs` — accept `deps.forceKeywordOnly`, skip stage 2 when set
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Files created during slice**:
- `.forge/validation/results-<ISO>-keyword-only.md` + `.json`
- `.forge/validation/results-<ISO>.md` + `.json`

**Steps**:
1. Harness: parse `--keyword-only`; when set, send request header `x-pforge-keyword-only: 1`.
2. `http-routes.mjs`: read header; pass `deps.forceKeywordOnly = true` to `runTurn`.
3. `reasoning.mjs`: when `deps.forceKeywordOnly`, do not call stage-2 router-model; use keyword-only classification result directly.
4. Start server locally. Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90`. Inspect output; require lane-match ≥16/18.
5. Run `node scripts/probe-forge-master.mjs --timeout=90` (normal). Require OK ≥22/24 AND lane-match ≥16/18.
6. `git add -f` both results pairs.
7. `.\pforge.ps1 version-bump 2.71.0 --strict`. Confirm `Updated 5/5`.
8. CHANGELOG `[2.71.0] — 2026-04-23` section with required phrases. ROADMAP update. `.forge/validation/FINDINGS-2026-04-23.md` Finding 1 stamped `RESOLVED 2026-04-23`.
9. Commit + tag `v2.71.0`.

**Validation gate**:
```bash
grep -q "^2.71.0$" VERSION
grep -q "\[2.71.0\]" CHANGELOG.md
grep -q "classifier calibration" CHANGELOG.md
grep -q "lane-match" CHANGELOG.md
ls .forge/validation/results-*.md | wc -l | awk '{ if ($1 < 2) exit 1 }'
```

**Commit**: `chore(release): v2.71.0 — classifier calibration`

---

## Execution Order

1 → 2 → 3 → 4. Order is driven by dependency: keyword additions (1,2) must land before the tie-breaker (3) can be calibrated; 3 must land before the harness can measure (4).

## Risks and Mitigations

- **Risk**: Expanded vocab over-matches real offtopic prompts. *Mitigation*: Slice 3's tie-breaker + the OFFTOPIC-guard test cases prevent regressions. If a specific pattern proves greedy during Slice 4 harness run, tighten the regex (not delete).
- **Risk**: Confidence thresholds (2/5) feel arbitrary. *Mitigation*: they are pinned by test; future phases can tune with evidence. Starting simple.
- **Risk**: `forceKeywordOnly` flag diverges test mode from production. *Mitigation*: flag is scoped to probe harness only; prod clients never send the header. `http-routes.mjs` explicitly only reads the header for localhost-origin requests — or, simpler, we document that the flag is harness-only and accept that anyone with network access could force keyword-only mode (no security implication since keyword-only is the safer/cheaper path).
- **Risk**: Probe harness total lane-match flat-lines at 14/18 despite expansions. *Mitigation*: at Slice 4 diagnose with keyword-only mode; add targeted patterns to close the gap (weighted toward the missing probe's vocabulary) while running Slice 2's regression tests. Document in CHANGELOG any probes that still mis-route as known-limitation.

## Session Break Points

- After Slice 2 if context is thin. Slice 3 introduces a cross-cutting `confidence` field that requires re-reading downstream consumers; a fresh session avoids stale mental model.

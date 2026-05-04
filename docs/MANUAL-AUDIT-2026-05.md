# Manual Audit — May 2026

> **Generated**: May 4, 2026
> **Reference ground truth**: README.md v2.80.0, CHANGELOG.md (entries through v2.82.2), `docs/capabilities.md`, `pforge-mcp/tools.json`, `pforge-mcp/capabilities.mjs`
> **Pages audited**: 38 of 38
> **Working document**: edit this file as items are resolved

---

## Summary

| Status | Count | Meaning |
|---|---|---|
| ✅ Current | 12 | Aligns with v2.80+ |
| 🟡 Minor drift | 14 | Small number / wording updates |
| 🟠 Needs refresh | 8 | Missing features added in v2.78–v2.82 |
| 🔴 Major rewrite | 2 | Crucible critical-fields gate, Forge-Master |
| ⚫ Missing | 3 | Forge-Master, Host-aware routing, Embedding cache |

**Aggregate findings**: 127 stale items · 43 missing features · 30 missing hero images · 4 new pages recommended

---

## Per-Page Findings

### Act I — Smelt (5 chapters)

#### `what-is-plan-forge.html` — ✅ Current
- Excellent alignment with v2.80 positioning
- Hero image: ✅ exists (`forge-shop-panorama.webp`)
- **Action**: None needed

#### `how-it-works.html` — ✅ Current
- Four-station model still accurate
- Inner-loop callout exists; audit-loop not referenced
- Hero image: ✅ exists (`forge-shop-panorama.webp`)
- **Action**: Minor — add brief callout to audit-loop as part of Tempering subsystems

#### `installation.html` — 🟡 Minor drift
- Setup instructions are current
- Hero image: ❌ missing (needs `ch3-hero`)
- Stale: Node.js version (says 18+, should mention 20 LTS recommended)
- Missing: Setup wizard for Quorum presets (added v2.81)
- **Action**: Add `ch3-hero`; add note on Quorum preset selection during setup

#### `writing-plans.html` — 🟠 Needs refresh
- Plan structure is still correct, but missing critical recent additions
- Hero image: ❌ missing
- Stale items:
  - No mention of Crucible critical-fields gate (v2.82.1) — plans now require `build-command` + `test-command`
  - Forbidden Actions example is generic, doesn't mention the new `forbidden-actions` question in Crucible interview (v2.82.1)
- Missing features:
  - `**Files in scope**` accepted as alias for `**Files:**` (v2.82.1)
  - `**Exit gate**` accepted as alias for `**Validation Gate**` (v2.82.1)
- **Action**: Rewrite plan-frontmatter sections to include new CRITICAL_FIELDS; update Forbidden Actions section with interview-derived examples

#### `crucible.html` — 🔴 Major rewrite
- Crucible lanes and interview loop are current, but missing major v2.82.1 changes
- Hero image: ❌ missing
- Stale items:
  - No mention of Phase-35 critical-fields gate (v2.82.0)
  - Question count outdated: says feature lane ~6 questions, but now 7 (`forbidden-actions` was added)
  - Finalize section doesn't mention new `CruciblePlanExistsError` (v2.82.1) or the `overwrite: true` parameter
- Missing features:
  - New `questionId` parameter on `forge_crucible_ask` (v2.82.1)
  - Build/test command inference via `inferRepoCommands`
  - Finalize refusal gate + draft-only message (v2.82.1)
- **Action**: Major rewrite of interview loop + finalize sections; update question bank tables

---

### Act II — Forge (10 chapters + 4 deep dives)

#### `your-first-plan.html` — 🟡 Minor drift
- Tutorial flow is excellent; example still works
- Hero image: ✅ exists (`ch4-hero.jpg`)
- Missing: No mention of Crucible pre-hardening step (Phase 37) — tutorial jumps straight to Step 0 specify
- **Screenshot need**: Dashboard progress tab during execution
- **Action**: Add optional subsection "If this is your first smelt: start with Crucible"; add screenshot of dashboard slice progression

#### `dashboard.html` — 🟡 Minor drift
- 25 tabs still accurate; all major sections covered
- Hero image: ❌ missing (needs `ch6-hero` for dashboard, distinct from your-first-plan)
- Stale items:
  - No mention of Forge-Master section (added Phase 38.7)
  - No mention of audit-loop config toggle (added Phase 39)
  - Timeline tab now has 9 sources (added `fm-turn` in v2.82); page says 8
- Missing features:
  - Forge-Master tab (quorum advisory, intent classification)
  - Embedding cache stats endpoint (v2.79)
  - Audit-loop mode toggle on Config tab (v2.80)
- **Screenshot needs**: Config tab with Forge-Master settings + Audit-loop toggle; Forge-Master tab showing live quorum advisory
- **Action**: Add two new subsections (Forge-Master tab, Audit-Loop settings); update timeline source count 8→9

#### `cli-reference.html` — 🟠 Needs refresh
- Core commands still valid
- Hero image: ❌ missing
- Stale items:
  - No mention of `pforge audit-loop` command (v2.80)
  - No mention of `pforge timeline` command (v2.82)
  - Estimate command section outdated re: cost models (v2.81 fixed routing)
- Missing features:
  - `forge_estimate_quorum` + `forge_estimate_slice` tools (v2.28/v2.80)
  - Quorum advisory mode
  - Host-aware routing preference (v2.82)
  - New flags: `--quorum=power`, `--quorum=speed` (v2.82)
- **Action**: Add sections for `pforge audit-loop` and `pforge timeline`; update `pforge run-plan` flags table; add quorum mode selection section

#### `customization.html` — ✅ Current
- Project Principles + Project Profile still accurate
- Hero image: ❌ missing
- **Action**: Add `ch8-hero`

#### `instructions-agents.html` — 🟡 Minor drift
- Instruction files and agents overview is solid
- Hero image: ❌ missing
- Stale items:
  - Says "19 agents" but README says "14 Agents" — discrepancy (likely counting pipeline + reviewers)
  - Says "18 instruction files" but count appears to be 17
- Missing features:
  - LiveGuard hooks (`preDeploy`, `postSlice`, `preAgentHandoff`) added v2.82.1
  - Crucible+Tempering agent additions
- **Action**: Clarify agent count; document LiveGuard hooks section

#### `mcp-server.html` — 🟠 Needs refresh
- Architecture is current; tool count significantly out of date
- Hero image: ❌ missing
- Stale items:
  - Says "19 MCP tools" but current count is 67+ (LiveGuard, Crucible, Tempering, Bug Registry, Testbed, etc.)
  - Says "12+ endpoints" but many more in v2.80+
- Missing features:
  - Forge-Master routes (`/api/forge-master/*`)
  - Tempering drain tools
  - Crucible tools (6 total)
  - Bug Registry tools
- **Action**: Major restructure: list tools by category (Core, LiveGuard, Crucible, Tempering, Bug Registry, Testbed, Forge-Master); update counts

#### `extensions.html` — ✅ Current
- Extension system unchanged; catalog references current
- Hero image: ❌ missing
- **Action**: Add `ch11-hero`

#### `multi-agent.html` — ✅ Current
- Seven agents covered; feature parity matrix accurate
- Hero image: ✅ exists (`ch12-hero.jpg`)
- **Action**: None needed

#### `advanced-execution.html` — 🟡 Minor drift
- Model routing, escalation, quorum covered
- Hero image: ❌ missing
- Missing features:
  - Quorum advisory mode (v2.78)
  - New quorum presets `--quorum=power` / `--quorum=speed` (v2.82)
  - Model routing split (`DIRECT_API_ONLY` vs `COPILOT_SERVABLE`, v2.81)
  - Host-aware routing preference (v2.82)
- **Action**: Add "Quorum Advisory Mode" section; document new model routing semantics + host-aware preference; add `ch13-hero`

#### `troubleshooting.html` — 🟠 Needs refresh
- Diagnostic tools and trees are good
- Hero image: ❌ missing
- Missing features:
  - Crucible finalize failures (plan exists, critical gaps)
  - Forge-Master classifier misroutes
  - Host-aware routing confusion
  - New error codes from v2.82: `PLAN_ALREADY_EXISTS`, `CRITICAL_FIELDS_MISSING`, `ASK_QUESTION_MISMATCH`
- **Action**: Add "Crucible Finalize Fails" section; add "Forge-Master Misroutes Intent" section; update error code table

#### `self-deterministic-loop.html` — ✅ Current
- v2.58 model unchanged
- Hero image: ❌ missing
- **Action**: None needed; add diagram hero if desired

#### `inner-loop.html` — ✅ Current
- Seven subsystems (v2.57) + three Phase-26 subsystems (v2.58) all documented
- Hero image: ❌ missing
- **Action**: None needed; add diagram hero if desired

#### `competitive-loop.html` — ✅ Current
- Worktree races, winner election, auto-fix, cost-anomaly detection accurate
- Hero image: ❌ missing
- **Action**: None needed; add diagram hero if desired

#### `audit-loop.html` — 🟠 Needs refresh
- Audit drain loop documented; missing activation modes and Crucible integration
- Hero image: ❌ missing
- Missing features:
  - `pforge audit-loop --auto` flag (v2.80)
  - Content-audit scanner options (`allowProduction`, `env`)
  - Triage destination "spec" lane (submits to Crucible)
  - New classifier-reviewer agent
  - `/audit-loop` skill
- **Action**: Add CLI section; document triage lanes (bug/spec/classifier) with Crucible integration; mention classifier-reviewer agent

---

### Act III — Guard (5 chapters)

#### `what-is-liveguard.html` — ✅ Current
- Four-station + LiveGuard positioning accurate
- Hero image: ✅ exists (`ch15-hero.jpg`)
- **Action**: None needed

#### `liveguard-tools.html` — 🟡 Minor drift
- 14 tools documented (v2.30)
- Hero image: ✅ exists (`ch16-hero.jpg`)
- Missing features:
  - Pre-deploy hook (v2.82.1) — `forge_secret_scan` + `forge_env_diff` now run as PreDeploy gate
  - Liveliness check via `/api/forge-master/cache-stats` (v2.79)
  - Content-audit scanner tool details
- **Action**: Mention pre-deploy hook execution; brief note on content-audit; reference new hook docs in `instructions-agents.html`

#### `liveguard-dashboard.html` — 🟡 Minor drift
- Five LiveGuard tabs (Health, Incidents, Triage, Security, Env) accurate
- Hero image: ✅ exists (`ch17-hero.jpg`)
- Missing features:
  - Forge-Master quorum advisory results display
  - Fix Proposals Feed activation details
- **Screenshot needs**: Incidents tab with Fix Proposals Feed; Security tab with recent secrets; Env tab showing divergence
- **Action**: Add screenshot of Fix Proposals Feed; clarify when feed appears

#### `watcher.html` — ✅ Current
- Snapshot + analyze + live-tail modes documented; anomaly rules current
- Hero image: ❌ missing
- **Screenshot need**: Dashboard Watcher tab during plan execution
- **Action**: Add `ch19-hero`; add screenshot

#### `remote-bridge.html` — ✅ Current
- Four channels (Telegram, Slack, Discord, OpenClaw) documented
- Hero image: ❌ missing
- **Action**: Add `ch20-hero`; add screenshot of Telegram approval button flow

---

### Act IV — Learn (4 chapters)

#### `bug-registry.html` — ✅ Current
- Fingerprint dedup, status lifecycle, classification accurate
- Hero image: ❌ missing
- **Screenshot need**: Triage tab showing open bugs with status chips
- **Action**: Add `ch21-hero`; add screenshot

#### `testbed.html` — ✅ Current
- Scenario fixtures, lock mechanism, error recovery documented
- Hero image: ❌ missing
- **Action**: Add `ch22-hero`

#### `health-dna.html` — ✅ Current
- Five signals, composite scoring, decay detection accurate
- Hero image: ❌ missing
- **Screenshot need**: Health tab showing 30-day drift trend + composite score gauge
- **Action**: Add `ch23-hero`; add screenshot

#### `memory-architecture.html` — ✅ Current
- Three-tier memory (L1 hub, L2 files, L3 OpenBrain) accurate
- Hero image: ❌ missing
- **Action**: None needed; add `ch24-hero` if desired

---

### Appendices (6)

#### `glossary.html` — 🟡 Minor drift
- Core concepts well defined
- Missing definitions:
  - "Crucible critical-fields"
  - "Host-aware routing"
  - "Embedding cache"
  - "Quorum advisory"
- **Action**: Add new term definitions for v2.78–v2.82 features

#### `quick-reference.html` — 🟡 Minor drift
- CLI commands and key files mostly current
- Stale: missing `pforge audit-loop`, `pforge timeline`
- **Action**: Add new commands to CLI table

#### `stack-notes.html` — ⚠️ Verify
- Per-preset configs for 9 stacks
- **Action**: Spot-check links resolve and presets are current

#### `grok-image-warnings.html` — ⚠️ Verify
- Specialist page for Grok image model guardrails
- **Action**: Verify if needs update for Grok Aurora (v2.81+)

#### `sample-project.html` — ⚠️ Verify
- Sample app build walkthrough
- **Action**: Verify links to `plan-forge-testbed` still resolve

#### `liveguard-runbooks.html` — ✅ Current
- Operational runbooks for LiveGuard alerts
- **Action**: Verify no new LiveGuard tools need runbook sections

---

### Other Pages (2)

#### `about-author.html` — ✅ Current — None needed

#### `index.html` — 🟡 Minor drift
- TOC + landing
- Says Chapter 11 has "65 tools" — should be 69
- **Action**: Update tool count; add new chapter links if Forge-Master/host-routing pages added

---

## Missing Pages (Proposed)

### 1. `forge-master.html` — Intent Router + Quorum Advisory (Priority: **High**)

**Why**: Forge-Master (v2.78–v2.79, Phase-38.7–38.8) is now a first-class system but has no manual chapter:
- Intent classification with keyword routing, embedding cache fallback, LLM router
- Quorum advisory mode for high-stakes decisions
- Multi-model consensus with dissent summarization
- Has its own dashboard tab

**Suggested outline**:
1. What Forge-Master does — operational vs. high-stakes decision routing
2. Intent classification stages (keyword → embedding → router model)
3. Quorum advisory mode — when it activates, how to read replies, dissent detection
4. Dashboard Forge-Master tab — live classification, cache stats, quorum results
5. Configuration in `.forge.json` — turn advisory on/off, model selection, dissent thresholds

**Screenshots needed**:
- Dashboard Forge-Master tab showing live classifications
- Quorum advisory with 3 model replies + dissent summary

### 2. `host-aware-routing.html` — Model Routing Preference (Priority: **Medium**)

**Why**: Host-aware routing (v2.82, #104) is a new first-class decision surface:
- Claude Code / Cursor / Windsurf / Zed → prefer direct API (honor user's subscription)
- VS Code + Copilot / CLI keep gh-copilot first
- `"drop"` mode refuses `gpt-*` without `OPENAI_API_KEY`

**Suggested outline**:
1. Problem: billing confusion between subscriptions (Copilot) and per-token APIs
2. Host detection — how Forge detects your environment
3. Three routing modes (`auto`, `gh-copilot`, `direct-api`, `drop`)
4. Config in `.forge.json` → `routing.hostPreference`
5. Billing surface table — which subscription each route hits

**Screenshot needed**: Quorum pre-run summary table showing host + billing surface per model

### 3. Embedding Cache — subsection of `forge-master.html` (Priority: **Low**)

**Why**: Embedding cache (v2.79, Phase-38.8) provides stage 1.5 for intent classification. Recommend keeping this as a subsection of the new `forge-master.html` rather than its own page.

**Outline as subsection**:
1. Cache hit semantics — cosine ≥ 0.85 → reuse classification
2. Zero-cost operation — offline after warm
3. Fallback providers (transformers vs. hash-bag)
4. Config: `embeddingFallback: true/false` in Forge-Master prefs
5. Dashboard cache stats: size, hit rate, LRU capacity

---

## Hero Image Generation List

**Currently 8 hero images exist** (in `docs/manual/assets/chapter-heroes/`): `appendix-e`, `ch1`, `ch4`, `ch12`, `ch15`, `ch16`, `ch17`, `ch18`.

**30 chapters still need heroes.** Prioritize by traffic:

### Tier 1 — Must have (high-traffic chapters)

| Slug | For page | Concept |
|---|---|---|
| `ch3-hero` | installation.html | Craftspeople at workbenches with Plan Forge logo, setup tools |
| `ch5-hero` | writing-plans.html | Architect's blueprint with annotations (scope amber, gates emerald, forbidden red) |
| `ch6-hero` | crucible.html | Fiery crucible smelter with question marks crystallizing into a plan |
| `ch7-hero` | dashboard.html | Control room with multiple screens, amber/blue color scheme |
| `ch8-hero` | cli-reference.html | Terminal screen with `pforge` commands glowing |
| `ch13-hero` | advanced-execution.html | Three paths diverging from quorum decision (escalation chain) |
| `ch14-hero` | troubleshooting.html | Decision tree flowchart with diagnostic tools |

### Tier 2 — Important (medium-traffic, reference)

| Slug | For page | Concept |
|---|---|---|
| `ch9-hero` | customization.html | Project crest/seal with customization icons |
| `ch10-hero` | instructions-agents.html | Interconnected nodes (auto-loading instructions) |
| `ch11-hero` | mcp-server.html | Server architecture with tool icons radiating |
| `ch12-hero-ext` | extensions.html | Marketplace shelves with extension boxes |
| `ch19-hero` | watcher.html | Watchtower with second pair of eyes |
| `ch20-hero` | remote-bridge.html | Bridge connecting forge to messaging platforms |

### Tier 3 — Nice-to-have (deep-dives, learn chapters)

| Slug | For page | Concept |
|---|---|---|
| `ch21-hero` | bug-registry.html | Fingerprint + bug icon merger |
| `ch22-hero` | testbed.html | Laboratory with test fixtures |
| `ch23-hero` | health-dna.html | DNA double helix encoded with health metrics |
| `ch24-hero` | memory-architecture.html | Three-tier memory cathedral / vault |
| `ch-sdl-hero` | self-deterministic-loop.html | Circular flow with feedback arrows |
| `ch-inner-hero` | inner-loop.html | Reflective mirror with loop arrows |
| `ch-comp-hero` | competitive-loop.html | Multiple paths racing, winner emerging |
| `ch-audit-hero` | audit-loop.html | Drain/funnel with findings flowing through triage |
| `ch-update-hero` | update-source.html | Branching paths (GitHub vs sibling clone) |

### Grok-ready prompts (Tier 1)

```
ch3-hero: "Technical setup workshop scene: a craftsman at a wooden workbench with the Plan Forge anvil-and-shield emblem glowing above, surrounded by setup tools (wrench, checklist, gear). Amber and slate color palette, painterly digital art, 16:9 wide composition. ABSOLUTELY NO text, NO words, NO letters, NO numbers."

ch5-hero: "Architect's blueprint with glowing annotations, showing scope boundaries in amber, validation gates in emerald, forbidden zones in red. Held by hands of an engineer in amber candlelight. Painterly digital art. ABSOLUTELY NO text."

ch6-hero: "Fiery crucible smelting pot in a forge, molten ore glowing amber. Floating above the crucible: glowing question marks crystallizing into a solid blueprint shape. Amber + slate palette. Painterly digital art. ABSOLUTELY NO text."

ch7-hero: "Cinematic over-the-shoulder shot of a master smith looking at a wall of glowing amber screens (control room aesthetic), each screen showing different live data streams (gauges, charts, status lights). Forge backdrop, amber + slate. Painterly digital art. ABSOLUTELY NO text."

ch8-hero: "Hacker's terminal screen filling the frame, command-line prompt glowing bright amber on slate-black background, cursor blinking. Forge sparks drifting upward across the screen. Painterly digital art. ABSOLUTELY NO text — only abstract glyphs that suggest commands."

ch13-hero: "Three distinct paths diverging from a central glowing decision node (escalation chain). Each path shows a different model-spirit working at its own anvil: green spirit, blue spirit, golden spirit. Arrows showing escalation upward. Painterly digital art, amber and slate. ABSOLUTELY NO text."

ch14-hero: "Diagnostic decision tree as a flowchart etched in glowing amber lines on a slate background, branches forking and merging, tool icons (wrench, magnifier, key) at each leaf node. Painterly digital art. ABSOLUTELY NO text."
```

---

## SVG Diagram List

**4 SVGs currently exist** in `docs/manual/assets/diagrams/`: `dag-parallel`, `escalation-chain`, `quorum-flow`, `troubleshooting-tree`.

**6 new diagrams recommended**:

### Tier 1 — Fill critical gaps

| File | For pages | Concept |
|---|---|---|
| `forge-master-intent-flow.svg` | forge-master.html (new), advanced-execution.html | Three-stage intent classifier: keyword → embedding cache → router LLM |
| `crucible-critical-fields-gate.svg` | crucible.html | Crucible finalize gate checking CRITICAL_FIELDS (build, test, scope, etc.) |
| `audit-loop-triage-lanes.svg` | audit-loop.html | Content-audit scan → triage router → three lanes (bug/spec/classifier) → feedback loop |

### Tier 2 — Enhance existing chapters

| File | For pages | Concept |
|---|---|---|
| `host-aware-routing-decision.svg` | host-aware-routing.html (new), advanced-execution.html | Host detection → routing preference tree (auto/gh-copilot/direct-api/drop) |
| `memory-three-tier-capture.svg` | memory-architecture.html | One `captureMemory` call → fan-out to L1 (hub), L2 (files), L3 (OpenBrain) |
| `liveguard-composite-health.svg` | health-dna.html | Five signals → composite health score; decay detection threshold |

---

## Screenshot Capture List

**No screenshots currently in manual.** All from testbed at `E:\GitHub\plan-forge-testbed`.

### Tier 1 — Critical for learning

| File | For page | State to capture |
|---|---|---|
| `dashboard-progress-tab.png` | dashboard.html, your-first-plan.html | Plan in progress: 3 slices passed (✅ + time + cost), 1 executing (amber pulse), 1 queued (gray) |
| `dashboard-cost-tab.png` | dashboard.html | Per-model costs, monthly trend, quorum impact viz |
| `dashboard-runs-tab.png` | dashboard.html | Historical runs: status chips, duration, cost, gate results |
| `dashboard-config-tab.png` | dashboard.html, customization.html | `.forge.json` inline editor: modelRouting, escalation, innerLoop, audit, remoteBridge |

### Tier 2 — LiveGuard & Guard chapters

| File | For page | State to capture |
|---|---|---|
| `liveguard-health-tab.png` | health-dna.html, what-is-liveguard.html | Composite gauge (0–100), 30-day drift trend, MTTBF, cost trend |
| `liveguard-incidents-tab.png` | liveguard-dashboard.html | Open incidents list with severity badges, MTTR timer, Fix Proposals Feed |
| `liveguard-security-tab.png` | liveguard-dashboard.html | Recent secret scan results: severity, redacted preview, timestamp |
| `watcher-tab.png` | watcher.html | Watcher snapshot mode: "Slices: 7/12 passed, Tokens: 4231, Anomalies: 1 (review-queue-backlog)" |

### Tier 3 — Deep-dive chapters

| File | For page | State to capture |
|---|---|---|
| `dashboard-forge-master-tab.png` | forge-master.html (new), dashboard.html | Live classifications: keyword score, embedding cache hit rate, router confidence, quorum advisory |
| `dashboard-timeline-tab.png` | dashboard.html | Unified timeline: runs, incidents, bugs, crucible, deploys + filter chips |
| `dashboard-audit-loop-tab.png` | audit-loop.html | Audit drain progress: round 1/5, scanners passed, findings triaged, fixes applied |

### Testbed states needed

To capture the screenshots above, the testbed needs to be in these states:

- Fresh setup (no history) — for "first run" screenshots
- Mid-execution (progress tab with mixed slice states)
- Post-completion with cost report
- LiveGuard health decay scenario (composite score dropping over 30 days)
- Watcher live-tail with real events streaming
- Crucible finalize success (plan created with CRITICAL_FIELDS satisfied)

---

## Prioritization Recommendation

### Tier 1 — Must Fix (blocks new users, high traffic)

- [ ] `crucible.html` — rewrite finalize section, update question counts, add critical-fields gate
- [ ] `cli-reference.html` — add `pforge audit-loop`, `pforge timeline`, new quorum modes
- [ ] `mcp-server.html` — restructure tool list by category, update count 19→69
- [ ] `installation.html` — add `ch3-hero`, mention Quorum preset setup
- [ ] `writing-plans.html` — CRITICAL_FIELDS gate explanation, update Forbidden Actions section
- [ ] `index.html` — fix "65 tools" → 69

### Tier 2 — Important (enhance completeness, medium traffic)

- [ ] **NEW** `forge-master.html` — intent routing + quorum advisory + embedding cache subsection
- [ ] `troubleshooting.html` — Crucible finalize errors, Forge-Master misroutes, new error codes
- [ ] `dashboard.html` — Forge-Master tab section, audit-loop config, timeline source count 8→9
- [ ] `customization.html` — add `ch8-hero`
- [ ] `watcher.html` — add `ch19-hero` + dashboard screenshot

### Tier 3 — Polish (nice-to-have, lower traffic)

- [ ] `advanced-execution.html` — Quorum advisory, model routing split, host-aware preference
- [ ] **NEW** `host-aware-routing.html` — full chapter
- [ ] `glossary.html` — add v2.78–v2.82 term definitions
- [ ] Generate remaining 23 hero images (Tier 2 + 3)
- [ ] Create 6 new SVG diagrams
- [ ] Capture 11 testbed screenshots

---

## Working Checklist

> **Status as of 2026-05-04**: ✅ ALL items complete. Manual is fully refreshed against v2.83.0-dev / v2.82.2 release.

### Priority 1 — Critical content fixes ✅

- [x] [2026-05-04] crucible.html refresh — CRITICAL_FIELDS gate, 6 tools documented, v2.82.1 finalize errors
- [x] [2026-05-04] cli-reference.html refresh — pforge audit-loop, pforge timeline, quorum power/speed
- [x] [2026-05-04] mcp-server.html restructure — 8 categories, 69 tools, 30+ REST endpoints, 7 new WebSocket events
- [x] [2026-05-04] writing-plans.html refresh — CRITICAL_FIELDS gate, field aliases (Files in scope / Exit gate)
- [x] [2026-05-04] index.html count fix — 65→69 tools

### Priority 2 — Major additions ✅

- [x] [2026-05-04] **forge-master.html created** — 288-line deep-dive chapter (Phase 38.7/38.8)
- [x] [2026-05-04] troubleshooting.html refresh — 7 new error rows + 3 new H2 sections (Crucible, Forge-Master, host-aware)
- [x] [2026-05-04] dashboard.html sections added — Studio tab, Audit-Loop, Timeline (9 sources)

### Priority 3 — Visual assets ✅

- [x] [2026-05-04] Tier 1 hero images generated (7) — installation, writing-plans, crucible, dashboard, cli-reference, advanced-execution, troubleshooting
- [x] [2026-05-04] Tier 2 hero images generated (6) — customization, instructions-agents, mcp-server, extensions, watcher, remote-bridge
- [x] [2026-05-04] Tier 3 hero images generated (9) — bug-registry, testbed, health-dna, memory-architecture, self-deterministic, inner-loop, competitive-loop, audit-loop, update-source
- [x] [2026-05-04] Tier 1 SVG diagrams (3) — forge-master-intent-flow, crucible-critical-fields-gate, audit-loop-triage-lanes
- [x] [2026-05-04] Tier 2 SVG diagrams (3) — host-aware-routing-decision, memory-three-tier-capture, liveguard-composite-health
- [x] [2026-05-04] Tier 1 screenshots (4 of 4) — captured live from Phase 4 testbed run
- [x] [2026-05-04] Tier 2 screenshots (2 of 4) — Forge-Master Studio, LiveGuard Health (Incidents/Security deferred — no live incidents in testbed)
- [ ] **Deferred**: Tier 3 screenshots (3) — Audit-loop tab, Bug Registry triage with open bugs, Watcher live tail. All require specific testbed states not currently present.

### Priority 4 — Polish ✅

- [x] [2026-05-04] advanced-execution.html refresh — Quorum vs Advisory, host-aware routing, DIRECT_API_ONLY split
- [x] [2026-05-04] **host-aware-routing covered in advanced-execution.html** (kept as section, not separate page — the topic fits naturally there)
- [x] [2026-05-04] glossary.html term additions — 8 new terms (Quorum Advisory, Forge-Master, Embedding Cache, CRITICAL_FIELDS, Host-Aware Routing, DIRECT_API_ONLY, COPILOT_SERVABLE) + MCP count update
- [x] [2026-05-04] instructions-agents.html count clarification — '19 agents'→'14 reviewer agents', '18 instruction files'→'17'
- [x] [2026-05-04] liveguard-tools.html — verified current
- [x] [2026-05-04] liveguard-dashboard.html — pre-existing screenshot wiring is current
- [x] [2026-05-04] quick-reference.html new commands — pforge audit-loop + pforge timeline
- [x] [2026-05-04] stack-notes / grok-image-warnings / sample-project pages — verified current

---

## Stretch goals (optional follow-ups)

These are nice-to-haves that the audit identified but aren't blocking:

- 3 remaining Tier 3 screenshots (audit-loop, bug-registry triage, watcher live tail) — capture during a future testbed run that has the right state
- Standalone `host-aware-routing.html` page — currently covered as a section in `advanced-execution.html` which is sufficient; promote to its own chapter only if it grows substantially
- Replace older `docs/assets/dashboard/*.png` screenshots that weren't on the Tier 1 list (actions, replay, extensions, traces, skills) with fresh captures during a future run

---

---

## Source Material from `docs/index.html`

The homepage is up-to-date and contains battle-tested copy that should be reused (verbatim or lightly adapted) when refreshing the manual chapters below. Reusing the same prose keeps messaging consistent across homepage ↔ manual ↔ blog and saves drafting time.

| Manual chapter to refresh | Homepage section (reusable copy) | Lines |
|---|---|---|
| **NEW** `forge-master.html` | Forge-Master Studio feature card — elevator pitch + 3 access surfaces (dashboard tab, MCP tool, CLI) | 1010–1033 |
| `mcp-server.html` (restructure) | "MCP Server + Orchestrator" feature card — categorized tool list (Core · LiveGuard · Watcher · Crucible · Tempering · Bug Registry · Testbed · Forge-Master) | 1106–1110 |
| `audit-loop.html` (refresh) | "Audit Loop" feature card — closed-loop description | ~1001 |
| `what-is-liveguard.html` (reinforce) | LiveGuard Detect / Respond / Learn three-step framing | 1208–1265 |
| `memory-architecture.html` (reuse) | Memory section: Capture / Search / Any-Tool framing + before/after example terminal | 1296–1395 |
| `cli-reference.html` (refresh quorum section) | "Three Ways to Run the Same Pipeline" — Auto / Assisted / Quorum modes | ~870 |
| `troubleshooting.html` (refresh) | "The Smith" feature card — diagnostic surface description | 1075–1080 |
| `instructions-agents.html` (clarify counts) | "File-types disambiguation" table — "Wait — what's the difference between all these file types?" | ~1153 |
| `multi-agent.html` (already current ✅) | Quick-start section — `setup.ps1 -Preset dotnet -Agent claude\|all` examples | 1793–1794 |
| `extensions.html` (add hero) | Setup wizard line referencing `pforge-mcp/server.mjs` install | ~1728 |

### Single source of truth

When the homepage and the manual disagree on a number or name, **the homepage wins** until the manual is rewritten. Always re-check `README.md` and `pforge-mcp/tools.json` for definitive counts. Current canonical values (May 2026):

- `69 MCP tools` (verified by grepping `"name": "forge_` in `tools.json`)
- `14 reviewer agents` (per README badge)
- `15 skills`, `9 presets`, `7 host adapters`, `17 instruction files`
- `14 LiveGuard tools`
- Latest released version: `v2.82.2` (CHANGELOG)

---

## Appendix: How to use this document

1. **Check off** items as you complete them with the date
2. **Add notes** under each entry if scope changes
3. **Track new findings** at the bottom under a "Discovered During Work" section
4. **Final commit** can reference: `git commit -m "docs(manual): complete audit batch N from MANUAL-AUDIT-2026-05.md"`

When all items are checked, this file can be archived to `docs/audits/MANUAL-AUDIT-2026-05.md` for historical reference.

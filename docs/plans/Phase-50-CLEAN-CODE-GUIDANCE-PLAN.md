---
phase: 50
name: CLEAN-CODE-GUIDANCE
status: HARDENED
lockHash: f0ea5dd19c646852592247bed591a0a842e24d05199ff25106fdd95984582a0a
---

# Phase 50 — CLEAN-CODE-GUIDANCE — Agent guidance for engineering best practices

> **Status**: **HARDENED — awaiting Execution Hold lift** (Phase 42 retro must ship first). Cleared for `pforge run-plan` once Execution Hold checklist is satisfied. Step-2 harden completed 2026-05-19.
> **Source**: Carryover from Phase 42 (CLEAN-CODE-AUDIT) planning. Phase 42 builds a read-only audit catalog; Phase 50 turns the empirical findings into **guidance surfaces** so agents stop introducing the same patterns at write-time. Conversation captured: the abstract engineering ideas (small functions, descriptive names, SOLID, dependency direction, TDD) are decades-old, universally-taught practices popularized by Robert C. Martin and others — Plan Forge applies them with appropriate attribution but without paraphrase-hedging.
> **Tracks**: `.github/instructions/clean-code.instructions.md` (NEW), `.github/instructions/architecture-principles.instructions.md` (expansion), `/clean-code-review` skill (NEW), rollout to `presets/*/.github/instructions/` and `templates/.github/instructions/`, `.github/copilot-instructions.md` + `AGENTS.md` cross-references. No production code touched.
> **Estimated cost**: low. Zero LLM-cost surfaces beyond the skill's invocation cost. Mostly markdown + skill wrapper.
> **Pipeline**: Specify ✅ → Harden ⏳ → HOLD → Execute → S6 retro. **No QA/E2E slice** because this phase produces no behavior change; the "QA" is dogfooding the new instruction file against a representative file edit in S6.
> **Recommended starting slice**: **S0 → S1 → S2** (instruction file → architecture expansion → skill wrapper) so the hardest content decisions land first; rollout slices S3-S5 are mechanical once content is locked.
> **Session budget**: 7 slices. Recommend one session — phase is bounded and content-focused, low cognitive overhead per slice.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] **Phase 42 (CLEAN-CODE-AUDIT) has shipped its retro (S5)**. Without the empirical catalog, this phase would guess which heuristics actually fire in real code. The catalog's top-finding categories drive the instruction file's rule selection.
- [ ] `master` is clean
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time
- [ ] No competing in-flight plan is restructuring `.github/instructions/`, `presets/`, or `templates/`. (Rollout slices touch many files; concurrent restructuring would create merge hell.)

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-50-CLEAN-CODE-GUIDANCE-PLAN.md`.

---

## Why this phase exists

Phase 42 produced a catalog. A catalog records past sins; it doesn't prevent future ones. The leverage is at **write-time**, not audit-time:

- Agents that read `.github/instructions/clean-code.instructions.md` before writing a function won't ship a 400-line function in the first place.
- A `/clean-code-review` skill lets a developer ask "is this PR clean?" on demand, reusing Phase 42's tooling.
- An expanded `architecture-principles.instructions.md` puts SOLID, the Dependency Rule, and Component Cohesion in front of every agent on every edit.

Phase 42 is the *catalog*. Phase 50 is the *guardrail* that closes the loop. Without Phase 50, Phase 42's catalog gets re-generated every year with the same findings.

---

## Scope Contract

### In Scope

**S0 — Author `clean-code.instructions.md`**:
- New file: `.github/instructions/clean-code.instructions.md`
- Length budget: **≤120 lines** (hard cap; bigger content goes in the skill)
- Frontmatter: `description: Engineering best practices for writing maintainable code — auto-loads on source-file edits`, `applyTo: '**/*.{mjs,js,ts,tsx,jsx,cs,fs,py,rs,go,java,php,rb,swift,kt}'`, `priority: medium`
- Organized by **agent decision point**, not by reference-book taxonomy:
  - **When writing a function** — size, parameter count, single responsibility, return-type clarity
  - **When naming** — descriptive, no encodings, no abbreviations, scope-appropriate length
  - **When commenting** — explain *why* not *what*, no commented-out code, no obsolete TODOs
  - **When introducing a dependency** — direction (concrete depends on abstract), cohesion, stable-depends-on-stable
  - **When writing a test** — one concept per test, fast (<100 ms), isolated, named for behavior
  - **When reviewing your own diff** — boy scout rule, no debug noise, no commented-out code
- **References section at bottom only** — single block citing canonical sources (Martin 2008/2017/2011, Beck 2002, McConnell 2004, Fowler 1999, Parnas 1972, Liskov 1987). No per-rule citations.
- Rules biased toward heuristics that **actually fired in Phase 42's catalog** — empirical weighting, not exhaustive coverage. Heuristics with zero Phase-42 findings get a single-line mention or are omitted.
- A footer "Need a deep review?" pointer to the `/clean-code-review` skill

**S1 — Expand `architecture-principles.instructions.md`**:
- Add ≤80 net new lines total (hard cap; this file is already in every session's context)
- New content (in this order, integrated with existing structure):
  - **The Dependency Rule** — inserted into the existing "4-Layer Architecture" section: "Dependencies always point inward. Outer layers may import from inner layers; inner layers MUST NOT import from outer."
  - **SOLID per-letter expansion** — new sub-section between "Non-Negotiable Best Practices" and "Decision Framework". One line per letter + one observable violation per letter.
  - **Component Cohesion (REP / CCP / CRP)** — new row in Temper Guards table: "Should this be one package or three? Things that change together belong together; things reused together belong together; things neither change-together nor reuse-together belong apart."
  - **Stable Dependencies Principle** — new row in Warning Signs: "Stable component depends on a volatile component (e.g., a utility imports from a feature module)."
  - **The Boy Scout Rule** — new checkbox in Code Review Checklist: "Adjacent code touched? Was it left cleaner or no worse?"
  - **Professional Refusal** — new row in Temper Guards: "User says 'just hack it in once'? Agents have permission AND obligation to refuse and propose a properly-scoped plan."

**S2 — `/clean-code-review` skill**:
- New skill at `.github/skills/clean-code-review/SKILL.md`
- Description triggers: "review code for clean code violations", "audit this file for maintainability", "is this PR clean?"
- Input: file path OR git diff range (e.g. `HEAD~3..HEAD`)
- Behavior:
  1. Validates input path/range exists
  2. Invokes **Phase 42's tooling** (`scripts/audit/eslint-clean-code.config.mjs` + `scripts/audit/run-jscpd.mjs` + `scripts/audit/grep-matrix.mjs`) scoped to the input
  3. Maps findings to clean-code.instructions.md sections (so the agent can cite the rule the user already loaded)
  4. Emits a markdown report grouped by severity with file:line anchors
  5. Optional `--fix-suggestions` flag emits proposed fixes inline but does **NOT** apply them
- **REUSES Phase 42's devDependencies** — no new packages introduced
- Skill is **invoke-only** — never auto-loaded, never triggered by a file edit

**S3 — Roll out to all 9 presets**:
- Copy the finalized `clean-code.instructions.md` (from S0) to:
  - `presets/dotnet/.github/instructions/`
  - `presets/go/.github/instructions/`
  - `presets/java/.github/instructions/`
  - `presets/php/.github/instructions/`
  - `presets/python/.github/instructions/`
  - `presets/rust/.github/instructions/`
  - `presets/swift/.github/instructions/`
  - `presets/typescript/.github/instructions/`
  - `presets/azure-iac/.github/instructions/`
- The file is **identical across all presets** — clean code is language-agnostic. Per-language style guides are a separate (out-of-scope) phase if ever undertaken.
- Update each preset's `applyTo` glob to that preset's primary extensions (`.cs/.fs` for dotnet, `.go` for go, etc.)

**S4 — Roll out to `templates/`**:
- Copy `clean-code.instructions.md` to `templates/.github/instructions/`
- Verify `setup.ps1` / `setup.sh` copy logic picks it up (no script change needed if the existing copy logic uses `Get-ChildItem -Recurse`; add an explicit test in the validate step if not)
- Verify `presets/` versions take precedence when a preset is selected (preset → templates → defaults order)

**S5 — Cross-reference updates**:
- `.github/copilot-instructions.md` — add `clean-code.instructions.md` to the Instruction Files table; add `/clean-code-review` to the Skill Slash Commands table
- `AGENTS.md` (planning/main only) — add `clean-code.instructions.md` to the "Start Here" pointer list
- `templates/.github/copilot-instructions.md` — same updates as above (so consumers get the references)

**S6 — Retro + roadmap update + CHANGELOG**:
- `docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md` — what got included vs cut, dogfood result (the retro must include running `/clean-code-review` on at least one Plan-Forge source file and recording the report verbatim), friction in rule selection, recommendation for cadence (when to refresh the instruction file based on a new audit)
- `docs/plans/DEPLOYMENT-ROADMAP.md` — mark Phase 50 as Completed; reference the retro
- `CHANGELOG.md` — entry under `[Unreleased]`: `### Added — Clean-code agent guidance (instruction file + /clean-code-review skill + architecture-principles expansion). Universal across all 9 presets.`

### Out of Scope

- **Any production code change in `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh`, or any application file.** The only allowed file modifications are: `.github/instructions/clean-code.instructions.md` (NEW), `.github/instructions/architecture-principles.instructions.md` (≤80 new lines), `.github/skills/clean-code-review/**` (NEW), `.github/copilot-instructions.md` (table additions), `AGENTS.md` (Start Here pointer), `presets/*/.github/instructions/clean-code.instructions.md` (NEW × 9), `templates/.github/instructions/clean-code.instructions.md` (NEW), `templates/.github/copilot-instructions.md` (table additions), `docs/plans/DEPLOYMENT-ROADMAP.md`, `docs/plans/testbed-findings/Phase-50-...-retro.md` (NEW), `CHANGELOG.md`.
- **Fixing any catalog finding.** Phase 50 ships guidance; the per-category fix phases (Phase 43+ from Phase 42's S3 stubs) ship code fixes.
- **Per-language style guides.** Naming conventions, file-organization rules, idioms — these are language-specific and belong in per-stack instruction files if ever undertaken.
- **Auto-formatter rollout** (Prettier, gofmt, ruff format, etc.). Separate phase per language if/when funded.
- **Linting auto-fix integration in the skill.** The skill reports; it never modifies.
- **Adding new ESLint rules beyond what Phase 42 already installed.** Rule pack changes belong to Phase 42 or a successor audit-tooling phase.
- **A Clean Architecture mega-file.** The 4 high-leverage Clean Architecture concepts fold into the existing `architecture-principles.instructions.md`. A dedicated clean-architecture file would duplicate content and bloat per-session context.
- **A Clean Coder dedicated file.** Most of Clean Coder is professional-behavior advice that doesn't translate to per-edit guidance. The 2-3 useful concepts (Boy Scout Rule, Professional Refusal, TDD-as-honesty) fold inline.
- **Cross-repo rollout (consuming projects).** Only the framework + its presets + templates. Existing consumer projects pick up the new instruction file on their next `setup.ps1` update or via `forge_sync_instructions`.
- **Replicating any reference book's prose, examples, or structure verbatim.** Plan-Forge-native organization, generic engineering vocabulary, single References section at the bottom.
- **Marketing/branding the instruction file with any trademarked term.** File name is plain `clean-code.instructions.md` — describes what it covers, not who codified it.
- Touching `pforge-sdk/`, `extensions/`, `pforge-master/` source (universal carveouts)

### Forbidden Actions

- **Do NOT exceed the 120-line cap on `clean-code.instructions.md`.** Bigger content goes in the skill or in `architecture-principles.instructions.md`. Bloat in an auto-loaded instruction file taxes every session.
- **Do NOT exceed the 80-line net-add cap on `architecture-principles.instructions.md`.** That file is in every Copilot session; growth there compounds across the entire user base.
- **Do NOT** copy paragraphs, examples, or chapter structures verbatim from Martin / Beck / McConnell / Fowler or any other reference. Generic engineering vocabulary only; plan-forge-native organization.
- **Do NOT** add per-rule citations to a reference book. ONE References section at the bottom of `clean-code.instructions.md`; no in-rule "(per Martin, Ch. 3)" footnotes.
- **Do NOT** introduce new devDependencies in the skill. It MUST reuse Phase 42's tooling. If Phase 42's tooling can't do what the skill needs, file a Phase-42-follow-up instead.
- **Do NOT** make the skill auto-invocable. Skills are slash-command-only. An auto-invoking clean-code reviewer would fire on every edit and destroy session UX.
- **Do NOT** ship divergent versions of `clean-code.instructions.md` across presets. Identical content; `applyTo` glob is the only per-preset variation.
- **Do NOT** modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (universal tripwire — does not apply this phase but mentioned for completeness).
- **Do NOT** include rules that contradict `architecture-principles.instructions.md`. Phase 50 EXPANDS that file; it never overrides.
- **Do NOT** ship rules with zero Phase-42 catalog support unless they are universally agreed (e.g., "no secrets in source" is allowed without catalog support; "prefer guard clauses" is not).
- **Do NOT** bundle slices. Each slice = one commit. S0, S1, S2, S3, S4, S5, S6 each = one commit.
- **Do NOT** open follow-up phases from within S6. Promotion to numbered Phase 51+ is a separate roadmap decision.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **Plan-Forge-native organization** — `clean-code.instructions.md` is organized by agent decision points (writing fn / naming / commenting / dependency / testing / reviewing diff), NOT by any reference-book chapter taxonomy.
2. **Single References section at the bottom** — Martin / Beck / McConnell / Fowler / Parnas / Liskov / Dijkstra cited once, in a block, no per-rule footnotes.
3. **Empirical weighting** — rules are biased toward heuristics that produced findings in Phase 42's catalog. Heuristics with zero catalog hits get one-line mention or omission.
4. **Universal across presets** — clean code is language-agnostic; same file ships to all 9 presets + templates. Per-language style guides are a separate (out-of-scope) phase.
5. **120-line cap on the instruction file** — hard cap. Bigger content goes in the skill.
6. **80-line net-add cap on architecture-principles** — hard cap. That file is in every session's context.
7. **Skill is invoke-only** — no auto-load, no edit triggers. `/clean-code-review path/to/file` or `/clean-code-review HEAD~3..HEAD`.
8. **Skill REUSES Phase 42 devDeps** — zero new packages. If the skill needs more, that's a Phase 42 follow-up, not a Phase 50 scope expansion.
9. **No per-language variation in content** — only `applyTo` glob differs across presets.
10. **The 4 Clean Architecture concepts fold inline** — Dependency Rule, SOLID expansion, Component Cohesion, Stable Dependencies. No separate clean-architecture file.
11. **The 3 Clean Coder concepts fold inline** — Boy Scout Rule (Code Review Checklist), Professional Refusal (Temper Guards), TDD-as-honesty (already in Principle 4, reinforce only).
12. **Dogfood verification in retro** — S6 must run `/clean-code-review` against at least one Plan-Forge source file and record the report verbatim. If the skill produces nothing useful, the phase has failed regardless of file existence.
13. **Cadence recommendation lives in retro** — not codified in the instruction file. The file is durable; refresh cadence is a roadmap decision.

---

## Required Decisions

All decisions for this phase are resolved in §"Resolved Decisions" above (13 items, locked at draft time). No open TBDs blocking execution. **The only deferred calibration** — exact rule selection in S0 — explicitly depends on Phase 42's catalog data and is handled by the Execution Hold gate, not by adding new TBDs here.

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Instruction file organization | ✅ Resolved | Plan-Forge-native agent-decision-point sections (RD #1) |
| 2 | Reference attribution model | ✅ Resolved | Single References block at file bottom; no per-rule citations (RD #2) |
| 3 | Rule prioritization signal | ✅ Resolved | Bias toward Phase 42 catalog top-finding categories (RD #3) |
| 4 | Preset coverage | ✅ Resolved | Universal — same content, only `applyTo` varies (RD #4) |
| 5 | Instruction file size cap | ✅ Resolved | ≤120 lines hard cap (RD #5) |
| 6 | Architecture-principles expansion cap | ✅ Resolved | ≤80 net-added lines hard cap (RD #6) |
| 7 | Skill invocation model | ✅ Resolved | Invoke-only via `/clean-code-review`; no auto-load (RD #7) |
| 8 | Skill dependency policy | ✅ Resolved | Zero new devDeps; reuse Phase 42 tooling (RD #8) |
| 9 | Per-language variation | ✅ Resolved | None — content identical across presets (RD #9) |
| 10 | Clean Architecture folding | ✅ Resolved | 4 concepts fold inline into architecture-principles (RD #10) |
| 11 | Clean Coder folding | ✅ Resolved | 3 concepts fold inline; no dedicated file (RD #11) |
| 12 | Retro dogfood verification | ✅ Resolved | S6 must run `/clean-code-review` against a real source file (RD #12) |
| 13 | Cadence codification | ✅ Resolved | Lives in retro, not in shipped instruction file (RD #13) |

---

## Slice Decomposition

> All slices are tagged **[sequential]** — each builds on content/decisions locked in the prior. No parallel group exists; the dependency chain (content → architecture → skill → rollout → docs → retro) is strict.

### S0 — Author `clean-code.instructions.md`

- **Depends On**: nothing (Phase 42 retro must have shipped per Execution Hold, but that is enforced outside the slice graph)
- **Parallelism**: [sequential]
- **Context Files**: `.github/instructions/architecture-principles.instructions.md`, `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` (from Phase 42), `docs/plans/cleanup-findings/CATALOG.md` (top 20 entries)
- **Traces to**: MUST #1
- Create `.github/instructions/clean-code.instructions.md` (≤120 lines, YAML frontmatter + 6 decision-point sections + References block + skill pointer)
- Pull rule-priority signal from Phase 42's `CATEGORIES-SUMMARY.md` — top-finding categories drive section emphasis and rule selection
- **Validation Gate**:
  ```bash
  node -e "const c=require('fs').readFileSync('.github/instructions/clean-code.instructions.md','utf8');const lines=c.split('\n').length;if(lines>120)throw new Error('exceeds 120 lines: '+lines);for(const k of ['When writing a function','When naming','When commenting','## References','clean-code-review']){if(!c.includes(k))throw new Error('missing required section/marker: '+k);}console.log('ok '+lines+' lines, all required sections present');"
  ```

### S1 — Expand `architecture-principles.instructions.md`

- **Depends On**: S0 (drives which architectural rules deserve emphasis based on what `clean-code.instructions.md` already covers — avoid duplication)
- **Parallelism**: [sequential]
- **Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/clean-code.instructions.md` (S0 output), `docs/plans/cleanup-findings/CATALOG.md` (A1-A4 findings from Phase 42)
- **Traces to**: MUST #2
- Add the 4 Clean Architecture concepts (Dependency Rule, SOLID per-letter, Component Cohesion REP/CCP/CRP, Stable Dependencies) + 2 Clean Coder concepts (Boy Scout Rule, Professional Refusal) per §"In Scope" S1
- Each addition cites the existing structural anchor it integrates with (Temper Guards row / Warning Signs row / Code Review Checklist row / new sub-section between Best Practices and Decision Framework)
- 80-line net-add cap enforced via S5 review (post-commit `git diff` against the lockHash baseline), not via per-slice gate — gate verifies presence of all concepts, sweep verifies budget
- **Validation Gate**:
  ```bash
  node -e "const c=require('fs').readFileSync('.github/instructions/architecture-principles.instructions.md','utf8');for(const k of ['Dependency Rule','SOLID','Boy Scout','Component Cohesion','Stable Dependencies','Professional Refusal']){if(!c.includes(k))throw new Error('missing concept: '+k);}console.log('ok all 6 concepts present');"
  ```

### S2 — `/clean-code-review` skill

- **Depends On**: S0 (skill maps findings to instruction-file sections), S1 (skill may cite architectural rules from expanded file)
- **Parallelism**: [sequential]
- **Context Files**: `.github/skills/` (existing skill examples for shape), `scripts/audit/` (Phase 42 tooling the skill wraps), `.github/instructions/clean-code.instructions.md` (S0 output for section mapping)
- **Traces to**: MUST #3
- Create `.github/skills/clean-code-review/SKILL.md` with description + invocation pattern + behavior
- Skill body: validate input → invoke Phase 42 tooling scoped to input → map findings to `clean-code.instructions.md` decision-point sections → emit markdown report grouped by severity with file:line anchors
- Optional `--fix-suggestions` flag emits proposed fixes inline; never applies them
- Zero new devDependencies — verified by parsing `package.json` against Phase 42's tooling list
- **Validation Gate**:
  ```bash
  node -e "const fs=require('fs');const path='.github/skills/clean-code-review/SKILL.md';if(!fs.existsSync(path))throw new Error('SKILL.md missing');const s=fs.readFileSync(path,'utf8');if(!s.includes('description:'))throw new Error('missing description frontmatter');if(!/clean[- ]?code[- ]?review/i.test(s))throw new Error('missing skill identifier');if(!s.includes('--fix-suggestions'))throw new Error('missing --fix-suggestions flag doc');console.log('ok skill file structurally valid');"
  ```

### S3 — Roll out to 9 presets

- **Depends On**: S0 (canonical instruction file content)
- **Parallelism**: [sequential] (single agent does the 9 copies; copy correctness depends on having one finalized source)
- **Context Files**: `.github/instructions/clean-code.instructions.md` (canonical source from S0), `presets/typescript/.github/instructions/` (existing example for shape)
- **Traces to**: MUST #4
- Copy canonical `clean-code.instructions.md` to each of the 9 preset directories (`dotnet`, `go`, `java`, `php`, `python`, `rust`, `swift`, `typescript`, `azure-iac`)
- Adjust `applyTo` glob per preset's primary extensions; all other content identical
- **Validation Gate**:
  ```bash
  node -e "const fs=require('fs');const presets=['dotnet','go','java','php','python','rust','swift','typescript','azure-iac'];const missing=presets.filter(p=>!fs.existsSync('presets/'+p+'/.github/instructions/clean-code.instructions.md'));if(missing.length)throw new Error('missing presets: '+missing.join(','));console.log('ok 9 preset copies present');"
  ```

### S4 — Roll out to `templates/`

- **Depends On**: S0 (canonical source)
- **Parallelism**: [sequential]
- **Context Files**: `.github/instructions/clean-code.instructions.md`, `templates/.github/instructions/architecture-principles.instructions.md` (existing template instruction file for shape)
- **Traces to**: MUST #5
- Copy canonical `clean-code.instructions.md` to `templates/.github/instructions/`
- **Validation Gate**:
  ```bash
  node -e "const fs=require('fs');if(!fs.existsSync('templates/.github/instructions/clean-code.instructions.md'))throw new Error('missing in templates');const t=fs.readFileSync('templates/.github/instructions/clean-code.instructions.md','utf8');const c=fs.readFileSync('.github/instructions/clean-code.instructions.md','utf8');if(t.length<100)throw new Error('templates copy suspiciously short');console.log('ok templates copy present ('+t.length+' bytes)');"
  ```

### S5 — Cross-reference updates

- **Depends On**: S0 (instruction file exists), S2 (skill exists), S3 + S4 (rollouts complete so references are accurate)
- **Parallelism**: [sequential]
- **Context Files**: `.github/copilot-instructions.md`, `templates/.github/copilot-instructions.md`, `AGENTS.md`
- **Traces to**: MUST #6, MUST #7, MUST #8
- Add `clean-code.instructions.md` row to the Instruction Files table in both root and template `copilot-instructions.md`
- Add `/clean-code-review` row to the Skill Slash Commands table in both
- Add `clean-code.instructions.md` pointer to AGENTS.md "Start Here" list
- **Validation Gate**:
  ```bash
  node -e "const fs=require('fs');const ci=fs.readFileSync('.github/copilot-instructions.md','utf8');const tci=fs.readFileSync('templates/.github/copilot-instructions.md','utf8');const a=fs.readFileSync('AGENTS.md','utf8');const checks=[[ci,'clean-code.instructions.md','copilot-instructions'],[ci,'/clean-code-review','copilot-instructions'],[tci,'clean-code.instructions.md','templates/copilot-instructions'],[a,'clean-code','AGENTS.md']];for(const[c,k,n]of checks)if(!c.includes(k))throw new Error('missing '+k+' in '+n);console.log('ok all 4 references present');"
  ```

### S6 — Retro + roadmap update

- **Depends On**: S0-S5 all green
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/` (existing retro examples for shape)
- **Traces to**: MUST #9, MUST #10, MUST #11
- Create `docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md` per §"In Scope" S6 — **must include verbatim output of `/clean-code-review` run against at least one Plan-Forge source file** (dogfood evidence)
- Update `docs/plans/DEPLOYMENT-ROADMAP.md` — Phase 50 promoted to Completed/Shipped with date
- Add `[Unreleased]` entry to `CHANGELOG.md`: `### Added — Clean-code agent guidance (instruction file + /clean-code-review skill + architecture-principles expansion)`
- **Validation Gate**:
  ```bash
  node -e "const fs=require('fs');const r='docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md';if(!fs.existsSync(r))throw new Error('retro missing');const c=fs.readFileSync(r,'utf8');if(!c.includes('clean-code-review'))throw new Error('retro missing dogfood evidence');const ch=fs.readFileSync('CHANGELOG.md','utf8');if(!ch.includes('Clean-code agent guidance'))throw new Error('CHANGELOG entry missing');const dr=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!/Phase 50.*(Completed|Shipped|✅)/s.test(dr))throw new Error('roadmap not updated');console.log('ok retro + CHANGELOG + roadmap');"
  ```

---

## Re-anchor Checkpoints

Lightweight re-anchor (4 yes/no) after every slice. Full re-anchor against §"Scope Contract" + §"Resolved Decisions" at these breakpoints:

- **After S2** (content + skill complete, before rollouts): full re-anchor. Specifically verify (a) instruction file ≤120 lines, (b) architecture-principles net-add ≤80 lines, (c) skill is invoke-only and added zero devDeps, (d) no reference-book content verbatim. If any fails, fix before rollout begins — fixing 9 preset copies post-hoc is expensive.
- **After S5** (cross-references complete, before retro): full re-anchor + drift check. Specifically verify the rule selection in S0 still matches Phase 42 catalog data, and no Resolved Decision has been silently violated by an edit chain. Confirm no preset copy diverges from canonical (anything beyond `applyTo` is drift).

---

---

## Acceptance Criteria

### MUST

1. `.github/instructions/clean-code.instructions.md` exists, ≤120 lines, frontmatter valid, organized by agent decision point, References section present, skill pointer present
2. `.github/instructions/architecture-principles.instructions.md` expanded with the 4 Clean Architecture concepts + 2 Clean Coder concepts, net-add ≤80 lines
3. `.github/skills/clean-code-review/SKILL.md` exists, invoke-only, reuses Phase 42 devDeps (zero new packages)
4. `clean-code.instructions.md` ships to all 9 preset directories with identical content (only `applyTo` differs)
5. `clean-code.instructions.md` ships to `templates/.github/instructions/`
6. `.github/copilot-instructions.md` references both new artifacts in its tables
7. `templates/.github/copilot-instructions.md` references both new artifacts
8. `AGENTS.md` references the new instruction file in its "Start Here" pointer
9. Retro at `docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md` includes verbatim `/clean-code-review` output against at least one Plan-Forge source file
10. `docs/plans/DEPLOYMENT-ROADMAP.md` reflects Phase 50 completion
11. `CHANGELOG.md` `[Unreleased]` entry exists
12. **Zero changes to files under `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh`** — verifiable by `git diff --stat <S0-commit> HEAD -- pforge-mcp pforge-master pforge.ps1 pforge.sh` showing empty output

### SHOULD

- `clean-code.instructions.md` rule priority should visibly reflect Phase 42's top-finding categories (e.g., if Phase 42 surfaced lots of long functions, the "When writing a function" section leads)
- Skill output format should match a forge-search-style ACI contract (bounded payload, severity-grouped, file:line anchors)
- Architecture-principles additions should each cite the existing structural anchor they integrate with (in commit message or inline comment)
- Cross-references in copilot-instructions tables should match the existing table format exactly (no formatting drift)

### Verification commands

```bash
# Instruction file size + structure
wc -l .github/instructions/clean-code.instructions.md   # expect ≤120
grep -c '^## When' .github/instructions/clean-code.instructions.md   # expect ≥4

# Architecture-principles net-add within budget
git diff --shortstat <S0-commit> HEAD -- .github/instructions/architecture-principles.instructions.md

# Skill exists and is invoke-only
test -f .github/skills/clean-code-review/SKILL.md
grep -q 'description:' .github/skills/clean-code-review/SKILL.md

# Universal preset rollout
find presets -name clean-code.instructions.md | wc -l   # expect 9

# Template rollout
test -f templates/.github/instructions/clean-code.instructions.md

# No new devDeps introduced
git diff <Phase-42-final-commit> HEAD -- package.json pforge-mcp/package.json pforge-master/package.json

# Dogfood evidence
grep -q 'clean-code-review' docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md
```

---

## Stop Conditions

Halt execution and request human review if any of these fire:

**Scope drift / content quality**
- Phase 42 retro reveals the catalog's top-finding categories don't match the rule selection made in S0 — STOP, rebias the instruction file before continuing to S1
- `clean-code.instructions.md` exceeds 120 lines — STOP, move content to the skill OR cut rules (gate already enforces, but Stop applies if gate is silenced)
- `architecture-principles.instructions.md` net-add exceeds 80 lines (measured by `git diff --shortstat` against the pre-Phase-50 baseline of that file) — STOP, prune to highest-leverage additions
- Any reference-book paragraph, example, or chapter title appears verbatim in the instruction file — STOP, rewrite in plan-forge-native voice
- More than one preset's `clean-code.instructions.md` diverges from the canonical content (anything beyond `applyTo`) — STOP, re-sync
- A reviewer flags a rule as contradicting `architecture-principles.instructions.md` — STOP, reconcile before continuing

**Build / test failure** (phase ships markdown + a skill wrapper; "build" here means structural checks)
- Any slice's validation gate fails twice consecutively — STOP, do not retry blindly; diagnose root cause and either fix or file a bug
- `pforge validate` flags either the new skill or the new instruction file as malformed — STOP, fix structural issue before continuing
- The S6 dogfood run of `/clean-code-review` produces zero output OR produces obviously wrong output (e.g., reports a finding in a file the skill wasn't asked to scan) — STOP, fix the skill before claiming phase done
- The skill requires a new devDependency not in Phase 42's lockfile — STOP, file a Phase-42 follow-up to add the dep there; do NOT add it in Phase 50

**Security**
- The skill, while scanning a file, ever attempts to apply a fix (auto-edit, format-on-save trigger, write to any file other than its own stdout) — STOP, skill is read-only by contract (RD #7); rip out the offending code path
- Any preset rollout writes to a file outside `presets/<name>/.github/instructions/` — STOP, scope violation
- A skill or instruction file references an external URL that resolves to a non-Plan-Forge / non-attribution-target domain — STOP, audit for accidental telemetry / external dependency

---

## Definition of Done

Phase 50 is complete when ALL of the following are true:

- [ ] All 7 slice validation gates green (S0-S6)
- [ ] Reviewer Gate passed (zero 🔴 Critical, zero 🟡 High that block scope)
- [ ] `.github/instructions/clean-code.instructions.md` exists in repo root, ≤120 lines, frontmatter valid, all 6 decision-point sections present, References section present, skill pointer present
- [ ] `.github/instructions/architecture-principles.instructions.md` contains all 6 new concepts (Dependency Rule, SOLID, Boy Scout, Component Cohesion, Stable Dependencies, Professional Refusal), net-add ≤80 lines verified by `git diff --shortstat` against the pre-Phase-50 baseline
- [ ] `.github/skills/clean-code-review/SKILL.md` exists, invoke-only, frontmatter valid, `--fix-suggestions` flag documented, zero new devDependencies in `package.json` vs Phase 42 baseline
- [ ] All 9 preset directories (`dotnet`, `go`, `java`, `php`, `python`, `rust`, `swift`, `typescript`, `azure-iac`) contain `clean-code.instructions.md` with content identical to canonical (only `applyTo` differs)
- [ ] `templates/.github/instructions/clean-code.instructions.md` exists with canonical content
- [ ] `.github/copilot-instructions.md` references both new artifacts in tables
- [ ] `templates/.github/copilot-instructions.md` references both new artifacts in tables
- [ ] `AGENTS.md` "Start Here" section pointers updated
- [ ] `docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md` exists with at least one dogfood run of `/clean-code-review` against a Plan-Forge source file (verbatim output included)
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` marks Phase 50 Completed/Shipped with date
- [ ] `CHANGELOG.md` `[Unreleased]` entry added
- [ ] Branch model respected: instruction/skill/preset/template/CHANGELOG edits land on `master`; `AGENTS.md` edit lands on `planning/main` only
- [ ] `pforge validate` clean on both branches

---

## Commit Convention

- Each slice = one commit
- S0: `feat(instructions): S0 — clean-code.instructions.md (agent guidance, ≤120 lines)`
- S1: `feat(instructions): S1 — architecture-principles expansion (SOLID, Dependency Rule, Component Cohesion, Boy Scout)`
- S2: `feat(skills): S2 — /clean-code-review skill (reuses Phase 42 tooling)`
- S3: `chore(presets): S3 — roll out clean-code.instructions.md to 9 presets`
- S4: `chore(templates): S4 — roll out clean-code.instructions.md to templates/`
- S5: `docs(instructions): S5 — cross-reference clean-code in copilot-instructions + AGENTS.md`
- S6: `docs(plans): S6 — Phase 50 retro + roadmap update + CHANGELOG`

All commits land on `master` (instruction files, skills, presets, templates ship to consumers). The S5 update to `AGENTS.md` lands on `planning/main` only (per branch model). PreCommit chain runs on each.

---

## Hardening Audit Trail

| Date | Action | By |
|---|---|---|
| 2026-05-19 | Draft created from Phase 42 planning conversation. User clarified scope: abstract engineering ideas (SOLID, SRP, small functions, descriptive names, TDD) are decades-old common knowledge — Plan Forge applies them with attribution but without paraphrase-hedging. Plan-Forge-native organization decided over reference-book taxonomy mirror. | Copilot session |
| 2026-05-19 | **Step-2 harden**: (a) YAML frontmatter added with `lockHash` field. (b) Per-slice metadata added: `Depends On`, `Parallelism: [sequential]`, `Context Files`, `Traces to` (Acceptance Criteria MUST-N mapping). (c) All slice validation gates rewritten in `node -e` form to eliminate Windows cmd→bash shim portability risk (no nested escaped quotes; no `[ $(wc -l) ]` brittle bash brackets; no `git diff HEAD~1` which doesn't work pre-commit). (d) `## Required Decisions` section added (all 13 resolved at draft time, none open). (e) `## Re-anchor Checkpoints` section added (full re-anchors after S2 and S5). (f) `## Definition of Done` section added with 14 explicit checks including Reviewer Gate. (g) Stop Conditions reorganized into scope / build-test / security categories per Runbook §"Stop Conditions". (h) Status flipped DRAFT → HARDENED. **lockHash protects Forbidden Actions list only** because slice headers use `S0/S1` not `Slice 0/Slice 1` (matching project convention); this is acknowledged drift-protection scope. | Copilot session (Step-2) |
| _pending_ | Execution Hold lifted (gates on Phase 42 retro shipping) | _pending_ |

---

## Carryover (explicitly out of this phase)

- **Per-language style guides** (naming idioms, file layout per stack) — separate phases per stack if ever funded
- **Auto-formatter rollout** (Prettier / gofmt / ruff format / etc.) — separate phase per language
- **CI integration of `/clean-code-review`** (auto-run on every PR) — separate enabling phase if the skill proves useful
- **Cross-repo rollout to existing consumer projects** — happens passively via `forge_sync_instructions` and the next `setup.ps1` update
- **A dedicated clean-architecture.instructions.md file** — explicitly rejected; the 4 high-leverage concepts fold into architecture-principles instead
- **A dedicated clean-coder.instructions.md file** — explicitly rejected; the 2-3 useful concepts fold inline
- **Per-language linter integration** (eslint-plugin-react, ruff, golangci-lint, etc.) — separate per-stack phases
- **Skill output telemetry** (track which rules fire most often across user invocations) — useful but separate observability phase

---

## Appendix A — Reference list (canonical sources cited in the instruction file)

The `clean-code.instructions.md` References section will cite (single block, no per-rule footnotes):

- Martin, R. C. (2008/2025). *Clean Code: A Handbook of Agile Software Craftsmanship* (1st / 2nd ed.)
- Martin, R. C. (2017). *Clean Architecture: A Craftsman's Guide to Software Structure and Design*
- Martin, R. C. (2011). *The Clean Coder: A Code of Conduct for Professional Programmers*
- Beck, K. (2002). *Test-Driven Development: By Example*
- McConnell, S. (2004). *Code Complete* (2nd ed.)
- Fowler, M. (1999). *Refactoring: Improving the Design of Existing Code*
- Parnas, D. L. (1972). *On the Criteria to Be Used in Decomposing Systems into Modules*
- Liskov, B. (1987). *Data Abstraction and Hierarchy* (LSP origin)
- Dijkstra, E. W. (1968). *Go To Statement Considered Harmful*

These references establish that the practices in the instruction file are universally-taught engineering knowledge, codified by multiple authors over five decades. Attribution is collective and historical, not per-rule.

---

## Appendix B — Pre-harden notes (2026-05-19)

> **Status**: Advisory data for the Step-2 hardener.

### B.1 — Why this phase, not bigger or smaller

**Bigger** (one instruction file per Uncle Bob book + per-language style guides) would:
- Add thousands of tokens to every session's auto-load
- Force maintenance of three parallel documents that repeat each other
- Imply Plan Forge is "the Uncle Bob framework" (we're not — these ideas predate him)

**Smaller** (just expand architecture-principles, no new file, no skill) would:
- Miss the leverage: a dedicated file is searchable, citable, and ships to all presets
- Force every clean-code rule into a file that's already loaded everywhere (architecture-principles is hot context — keep it lean)
- Skip the on-demand deep-review workflow that the skill enables

The 3-artifact shape (instruction file + architecture expansion + skill) is the smallest viable footprint that hits all three leverage points: write-time guidance, decision-time principles, and review-time deep audit.

### B.2 — Hardener decisions that depend on Phase 42 data

The Step-2 hardener for THIS phase CANNOT finalize until Phase 42 ships its retro. Specifically:

| Decision | Needs from Phase 42 |
|---|---|
| Which heuristics get prime real estate in the "When writing a function" section | Top finding counts by function-related rule |
| Whether `console.log` deserves a rule (and how strict) | Catalog's bulk-triage decision on the 129 `console.log` hits |
| Whether to include a duplication rule | jscpd findings count + false-positive ratio |
| Whether the skill's `--fix-suggestions` flag is feasible | Phase 42's ESLint config + whether it supports `--fix-dry-run` |

Recommend the hardener wait until Phase 42 S5 retro is committed before locking S0 content choices.

### B.3 — Rollout count check

S3 + S4 create **10 new files** (`clean-code.instructions.md` × 9 presets + templates). S5 modifies **3 existing files** (`.github/copilot-instructions.md`, `templates/.github/copilot-instructions.md`, `AGENTS.md`). S2 creates **1 skill directory** with at least one `SKILL.md`. Total file delta: **~14 new files, 3 modified files** (plus 2 modifications already counted in S0 and S1).

The hardener should verify Plan Forge's preset-sync tooling (`forge_sync_instructions`) handles "new instruction file added to all presets at once" correctly. If not, this is a Phase-50 prerequisite (file a Phase-42-follow-up).

### B.4 — Reproduction commands for B.2 data (run AFTER Phase 42 ships)

```pwsh
# Top finding categories
Get-Content docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md

# console.log triage decision
Select-String -Path docs/plans/cleanup-findings/CATALOG.md -Pattern 'console.log' -SimpleMatch

# jscpd false-positive ratio
$total = (Select-String -Path docs/plans/cleanup-findings/CATALOG.md -Pattern '^\| (G5|F4|G7) ' | Measure-Object).Count
$fp = (Select-String -Path docs/plans/cleanup-findings/CATALOG.md -Pattern 'false.positive' | Measure-Object).Count
"FP ratio: $fp / $total"
```

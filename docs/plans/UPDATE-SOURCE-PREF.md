# Phase UPDATE-SOURCE-PREF — Hardened Plan

> **Status**: DRAFT — awaiting Session 1 harden pass
> **Author**: Session 1 planner (2026-04-20)
> **Target release**: v2.56.0
> **Type**: Behavior change (update pathway), scoped feature
> **Scope Contract**: Change `pforge update` source-selection defaults + add explicit `updateSource` preference with dashboard UI + manual chapter. No changes to `pforge self-update`, install layout, or dashboard ports.
>
> **Context**: Related bug history — [v2.52.1](../../CHANGELOG.md) (VERSION-before-tag fix), [v2.53.1](../../CHANGELOG.md) (corrupt-install detector), [v2.53.2](../../CHANGELOG.md) (`-dev` source refusal). This plan closes the last gap: preventing accidental `-dev` propagation when a sibling clone exists and the user didn't know `self-update` would have done the right thing.
>
> **Locked decisions (2026-04-20)**:
> - Three-tier implementation: default logic change (S1) + config preference (S2) + dashboard UI (S3) + manual chapter (S4)
> - Keep `-dev` suffix on master VERSION (it's a feature, not a bug — see Principle #3 below)
> - Keep both `pforge update` and `pforge self-update` as separate commands (don't merge)
> - Config schema: `updateSource: "auto" | "github-tags" | "local-sibling"`, default `"auto"`
> - Dashboard UI location: existing Config tab under a new **Update Source** section

---

## 1. Principles (guardrails for this plan)

1. **No silent behavior change for contributors.** Anyone with a sibling `plan-forge/` clone and a master-tracking install today must still be able to update from that clone without flags.
2. **No `-dev` bytes on a clean install without explicit opt-in.** Already enforced by v2.53.2's refusal — this plan extends the protection proactively.
3. **`-dev` suffix on master is load-bearing.** It tells contributors at a glance they're on unreleased bytes. We do NOT change how the suffix works.
4. **Two sources, one knob.** Update can come from (a) local sibling clone or (b) GitHub tag. One config key picks the preference. No third source, no sub-modes.
5. **Reproducibility at the team level.** A team lead should be able to commit `updateSource: "github-tags"` into `.forge.json` and have every dev's `pforge update` land on the same tagged release.

---

## 2. Current State (as of 2026-04-20, master @ c1962e0)

### 2.1 How `pforge update` picks a source today

[pforge.ps1:1190](../../pforge.ps1) `Invoke-Update`:

1. If `--from-github` passed → fetch tarball from latest tag (or `--tag <x>`)
2. Else → look for positional path arg
3. Else → search siblings `../plan-forge` and `../Plan-Forge` for a `VERSION` file
4. Else → error out

**Problem**: step 3 wins silently whenever a sibling clone exists, regardless of whether that sibling is on a clean tag or on master-with-`-dev`.

### 2.2 What v2.53.2 already protects against

`$sourceIsDev && !$currentIsDev && !$allowDev` → refuse. Protects clean installs from `-dev` propagation. Does NOT protect against:

- A dev machine that's already on `-dev` updating to more `-dev` when it might have wanted a clean tag
- A team member who cloned the repo once, forgot it was there, and now gets silent master updates

### 2.3 What a user actually sees today

**Scenario from user's screenshot**:
```
Updated: v2.50.0-dev → v2.54.0-dev
```
Correct behavior (sibling update) but surprising because the user didn't realize their sibling clone was the source — they'd have preferred the tagged release.

---

## 3. Goals (what ships in v2.56.0)

### 3.1 Functional

- Users on a clean install who accidentally have a sibling clone on master → get tagged releases by default (no flag needed)
- Users on a dev install (contributors, dogfood boxes) → unchanged behavior, no prompts, no warnings
- Teams can commit `updateSource: "github-tags"` to `.forge.json` and enforce tag-only updates across all team members
- Dashboard Config tab shows current source preference + has a dropdown to change it + writes back to `.forge.json`

### 3.2 Non-functional

- Zero new dependencies
- No schema migration (new optional key; absence = `"auto"`)
- Manual chapter explains the three modes in ≤ 2 pages
- Backwards compatible: any `.forge.json` without `updateSource` behaves exactly as it does today after the source-selection logic update

### 3.3 Explicit non-goals

- NOT changing how `-dev` suffix works on master
- NOT merging `pforge update` and `pforge self-update`
- NOT adding a third source (e.g. arbitrary git URLs, npm registry)
- NOT auto-updating on timer
- NOT touching the installer / `setup.ps1` / `setup.sh`

---

## 4. Design

### 4.1 New config key in `.forge.json`

```jsonc
{
  "templateVersion": "2.55.0",
  "preset": "typescript",
  "updateSource": "auto",  // NEW — default when absent
  // ...
}
```

| Value | Behavior |
|-------|---------|
| `"auto"` (default) | Compare latest GitHub tag's version vs local sibling's VERSION. Pick the one that's a **stable release** when available. If sibling is ahead of latest tag (i.e. master `-dev`), require `--allow-dev`. |
| `"github-tags"` | Always resolve latest tag, download tarball. Ignore sibling clones entirely. What teams commit for reproducibility. |
| `"local-sibling"` | Always prefer sibling clone if present. Fall back to `--from-github` only if no sibling found. Current default behavior. What contributors set on dev machines. |

### 4.2 New source-selection logic (auto mode)

Pseudo-code for `Invoke-Update` when no explicit `--from-github` flag AND `updateSource` is `auto` or unset:

```
if sibling-clone exists:
    read sibling VERSION → sibling_ver
    read latest-GitHub-tag via node helper → latest_tag_ver
    if latest_tag_ver > sibling_ver:
        source = github-tag(latest_tag_ver)
        note: "sibling clone is behind v{latest_tag_ver} — using GitHub tag"
    elif sibling_ver ends with -dev:
        # sibling is on master, ahead of latest tag
        if current install is clean:
            # v2.53.2 refusal already handles this
            refuse, suggest self-update or --allow-dev
        else:
            # dev-to-dev update — current behavior
            source = sibling-clone
    else:
        # sibling is on a clean checkout of a tag
        source = sibling-clone
else:
    # no sibling — today this errors. New behavior: auto-fallback to github.
    source = github-tag(latest)
    note: "no sibling clone found — using GitHub tag"
```

### 4.3 Flag precedence (unchanged)

Explicit flags always override `updateSource`:
- `--from-github` → force GitHub tag (ignore preference)
- Positional path → force that path (ignore preference)
- `--allow-dev` → permit `-dev` source over clean install (unchanged)

### 4.4 Dashboard Config tab UI

Under existing Config tab ([pforge-mcp/dashboard/index.html](../../pforge-mcp/dashboard/index.html)), add a new panel after the workers line, before the advanced settings `<details>`:

```html
<div class="cfg-section">
  <h3>Update Source</h3>
  <p class="cfg-help">Where `pforge update` pulls from.</p>
  <select id="cfg-update-source">
    <option value="auto">Auto (prefer tagged releases over dev bytes)</option>
    <option value="github-tags">GitHub tags only (reproducible)</option>
    <option value="local-sibling">Local sibling clone (contributor mode)</option>
  </select>
  <div id="cfg-update-source-status" class="cfg-status">current: auto</div>
</div>
```

Selecting a value → `POST /api/config` → writes `.forge.json` → toast confirms.

### 4.5 New REST endpoint

Currently `/api/config` likely read-only. This plan adds `PATCH /api/config` accepting:
```json
{ "updateSource": "github-tags" }
```
Validates against enum, writes `.forge.json` atomically (tmp + rename), returns 200 + new config.

### 4.6 Manual chapter

New chapter `docs/manual/update-source.html` under **Act I — Enter the Shop** (after Installation). ~200–300 words. Three tables: modes, when to use each, how to change via CLI or dashboard.

---

## 5. Slices

> Every slice is a single commit on master (standard Plan Forge admin-bypass push flow). Rollback = `git revert <sha>`.

| Slice | Title | Scope | Gates | Size |
|-------|-------|-------|-------|------|
| **S1** | Auto mode default logic | Modify `Invoke-Update` source-selection; add tag-vs-sibling comparison; update error messages; pass existing tests | `vitest run` green; `pforge update --dry-run` output shows new "auto" decision; no regression on `--from-github` / `--allow-dev` paths | M |
| **S2** | Config schema + CLI read | Add `updateSource` key to config reader; respect preference in `Invoke-Update`; add `pforge config get update-source` / `pforge config set update-source <value>` CLI; unit tests for all 3 modes | All 3 modes have passing tests; `pforge config set update-source github-tags` then `pforge update` goes to GitHub even with sibling present | M |
| **S3** | Dashboard UI + PATCH endpoint | Add panel to Config tab; wire select → PATCH /api/config; toast on success; preserve scroll position | Manual test: toggle all 3 values, verify .forge.json updates, verify dashboard re-reads on refresh | S |
| **S4** | Manual chapter + docs polish | New `update-source.html`; sidebar entry; cross-link from installation.html; update CLI-REFERENCE; run `check-metrics.ps1` | Chapter renders; drift checker green; metrics SSOT still accurate | S |
| **S5** | Tests + release notes | Integration test matrix (3 modes × 3 scenarios = 9 cases); add CHANGELOG entry; write release notes | Full vitest run green; CHANGELOG entry accurate | S |

**Estimated total**: ~half a day actual work if everything goes smoothly.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Users depending on silent sibling-preference now see "using GitHub tag" noise | M | L | The auto logic only switches when GitHub is **newer** — matches what a reasonable person wants. Loud-but-correct beats silent-and-wrong. |
| Node helper (`update-from-github.mjs resolve-tag`) call adds latency to every update | L | L | Cache the resolution result for 24h (same TTL as existing update-check.json). |
| Dashboard PATCH endpoint becomes a surface for config tampering | L | M | Restrict to `127.0.0.1` origin (existing dashboard convention); whitelist allowed keys; reject unknown paths. |
| Manual chapter inflates docs/_metrics.json's chapter count and breaks drift checker | L | L | Update `_metrics.json` manualChapters 24 → 25 as part of S4. |
| Existing v2.53.2 `-dev` refusal logic conflicts with new auto mode | M | M | S1's implementation lives INSIDE the existing refusal branch — it runs AFTER the v2.53.2 guard, not around it. |

---

## 7. Out-of-Scope Prompts (Scope Contract)

| Out of scope | Why |
|--------------|-----|
| *"While you're in there, add auto-update on a timer"* | Silent auto-update = loss of user control. Separate plan if ever. |
| *"Let update pull from arbitrary git URLs"* | Unbounded attack surface. Security review required. |
| *"Make `-dev` on master configurable"* | Feature, not bug. See Principle #3. |
| *"Move dashboard config editing to a separate page"* | Bigger IA change, unrelated. |
| *"Add a VERSION bump for v2.56.0 mid-plan"* | Bundle at release time, standard pipeline flow. |

---

## 8. Definition of Done

1. ✅ `pforge update` on a machine with a sibling clone that's behind master's latest tag → uses the GitHub tag, prints a note
2. ✅ Same machine, sibling is ahead of latest tag (master `-dev`), current is `-dev` → unchanged behavior (sibling wins)
3. ✅ Same machine, sibling is ahead of latest tag, current is clean → v2.53.2 refusal fires (unchanged)
4. ✅ `.forge.json` with `updateSource: "github-tags"` → always uses GitHub, ignores sibling, even when sibling is newer
5. ✅ Dashboard Config tab has working Update Source dropdown; selection persists across refresh
6. ✅ Manual chapter `update-source.html` renders, is linked from sidebar and installation chapter
7. ✅ All existing vitest tests green; new tests cover all 9 (mode × scenario) combinations
8. ✅ CHANGELOG entry + release notes file ready
9. ✅ `scripts/check-metrics.ps1` green

---

## 9. Post-Ship

- Tag as `v2.56.0` (follow `/memories/repo/release-procedure.md` strictly — VERSION cleaned BEFORE tagging, `-dev` bump AFTER)
- Release notes highlight: "Your other PC finally does the right thing by default"
- Dashboard blog post? Optional. Only if the UX story is compelling enough to warrant one.

---

## 10. Open Questions for Harden Pass

1. **`pforge config` CLI.** Does a `pforge config get/set` subcommand already exist? If yes, S2 just adds a key. If no, S2 either creates the subcommand (bigger) or stays dashboard-only (simpler). → **Verify during harden.**
2. **Cache location for resolved tag.** Reuse `.forge/update-check.json` or new file? → Reuse, extend schema.
3. **Should `self-update` also respect `updateSource: "local-sibling"`?** Argument for: consistency. Argument against: `self-update` is explicitly "from GitHub" — overloading it confuses the mental model. → **Keep `self-update` unchanged.** Document clearly.
4. **Migration on existing installs.** None. New key is optional, absence = `"auto"` = new-default behavior. → Confirmed.

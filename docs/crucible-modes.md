# Crucible Multi-Mode Substrate

> **Added**: Phase 59 — CRUCIBLE-MODES  
> **Audience**: Plan Forge operators and contributors

---

## Overview

The Crucible intake pipeline supports multiple **mode** lanes, each with its own question bank, critical-field set, and body renderer. The correct mode is inferred from the raw idea text (via `inferLane`) and can be overridden at submission time.

---

## Available Modes

| Lane | Label | Critical Fields | Best For |
|------|-------|----------------|----------|
| `tweak` | Tweak | scope-file, validation, forbidden-actions | Small targeted changes, minor fixes |
| `feature` | Feature | scope-files, validation-gates, forbidden-actions | Multi-file feature additions |
| `full` | Full | scope-in, forbidden-actions, rollback-plan | Broad architectural or multi-phase work |
| `bug-batch` | Bug Batch | scope-files, validation-gates, forbidden-actions, slice-breakdown | Bug fixes requiring multiple slices |

---

## Using `bug-batch`

The `bug-batch` mode is designed for bugs that require coordinated changes across files and need multiple slices to land safely.

### Question Bank (8 questions)

1. `symptom-observed` — What symptom are you observing?
2. `expected-behavior` — What is the expected behavior?
3. `suspected-component` — Which component or file is suspected?
4. `scope-files` — Which files need to change to fix this bug?
5. `slice-breakdown` — Break the fix into slices (see format below)
6. `validation-gates` — What validation gates will confirm the fix?
7. `forbidden-actions` — What changes are forbidden while fixing this bug?
8. `rollback` — How do we roll back if the fix makes things worse?

### `slice-breakdown` Format

Each line in the `slice-breakdown` answer must follow this format:

```
<slice-name> | <files-changed> | <test-command-or-acceptance>
```

**Example:**

```
Guard empty scope-files | pforge-mcp/orchestrator/plan-parser.mjs | npm run test:parser
Add regression test | pforge-mcp/tests/plan-parser.test.mjs | npm run test:parser
```

Finalization refuses with `CrucibleFinalizeRefusedError` if any line has fewer than 3 `|`-separated parts.

### Rendered Output

`bug-batch` produces a plan document with:

1. **`## Root Cause Hypothesis`** — three fields: symptom observed, expected behavior, suspected component
2. **`## Scope Contract`** → **`### In Scope`** (from `scope-files`) + **`### Forbidden`** (from `forbidden-actions`)
3. **`## Slices`** — N synthesized `### Slice N — <name> [scope: <files>]` blocks from `slice-breakdown`
4. **`## Validation Gates`**, **`## Stop Conditions`**, **`## Rollback`**, **`## Change Manifest`**

### `bugId` and `linkedBugs`

Pass `bugId` at submit time to automatically populate frontmatter:

```json
{ "rawIdea": "Fix crash in parser", "lane": "bug-batch", "bugId": "RMG-0035" }
```

The finalized plan's YAML frontmatter will include:

```yaml
---
crucibleId: <uuid>
lane: bug-batch
source: human
phaseId: Phase-60
linkedBugs: [RMG-0035]
bugId: RMG-0035
---
```

Additional linked bugs can be recorded via the `linked-bugs` interview question (appended at the end of each mode's question bank).

---

## Renderer/Parser Alignment (Phase 59 S5)

All rendered plan documents now use heading shapes that the orchestrator's plan-parser can consume directly:

| Renderer Heading | Parser Function | Field |
|-----------------|----------------|-------|
| `### In Scope` | `parseScopeContract` | `contract.inScope` |
| `### Out of Scope` | `parseScopeContract` | `contract.outOfScope` |
| `### Forbidden` | `parseScopeContract` | `contract.forbidden` |
| `### Slice N — <name> [scope: <files>]` | `parseSlices` | `slice.scope` |

The `## Anti-patterns & Forbidden Actions` heading has been removed. Forbidden actions now live exclusively under `## Scope Contract → ### Forbidden`.

---

## Legacy TBD-Placeholder Behavior

### Background

Before Phase 59 Slice 2, unanswered non-critical fields rendered as `{{TBD: <question-id>}}` markers in the plan document. This allowed operators to hand-fill the values later. Post-S2, unanswered non-critical fields are **omitted** instead (truthful refusal principle), keeping the plan body clean.

### Opt-In (Deprecated)

If you need the old behavior temporarily, set this in `.forge/crucible/config.json`:

```json
{
  "legacy": {
    "tbdPlaceholders": true
  }
}
```

When this flag is enabled, Plan Forge will emit a one-time warning at startup:

```
[Plan Forge] crucible.legacy.tbdPlaceholders is enabled.
This flag is deprecated and will be removed in the major-after-next release.
```

**Critical fields are never affected by this flag.** A smelt missing a critical field will always fail finalization with `CrucibleFinalizeRefusedError` regardless of `legacy.tbdPlaceholders`.

### Deprecation Schedule

| Release | Status |
|---------|--------|
| Current (Phase 59+) | Flag available; one-time deprecation warning emitted |
| Next major release | Flag still available; warning escalates to `console.error` |
| Major-after-next | Flag removed; config key silently ignored |

---

## Registering a Custom Mode

Modes self-register by calling `registerMode()` from `pforge-mcp/crucible/registry.mjs`. Each mode must satisfy the `CrucibleMode` interface defined in `pforge-mcp/crucible/mode.mjs`:

```js
import { registerMode } from "./crucible/registry.mjs";

const myMode = {
  id: "my-mode",
  label: "My Mode",
  criticalFields: new Set(["scope-files", "validation-gates"]),
  questionBank: () => MY_QUESTIONS,
  renderDraft: (smelt, opts) => myRenderFn(smelt, opts),
  finalize: () => { throw new Error("use handleFinalize"); },
};

registerMode(myMode);
```

Then import the mode file as a side effect in `crucible-server.mjs`:

```js
import "./crucible/modes/my-mode.mjs";
```

For modes with custom body layouts (like `bug-batch`), implement `renderBody(smelt, opts)` — the `crucible-draft.mjs` renderer will delegate to it automatically.

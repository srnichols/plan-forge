/**
 * Plan Forge — Forge-Master Principles Loader (Phase-32, Slice 3).
 *
 * Loads the active principles block for Forge-Master's advisory lane from
 * three sources (in precedence order):
 *   1. docs/plans/PROJECT-PRINCIPLES.md (if present)
 *   2. ## Architecture Principles section of .github/copilot-instructions.md
 *   3. .forge.json#forgeMaster.philosophy string
 *
 * Override semantics:
 *   - philosophy string (no prefix) → REPLACES file-based content entirely
 *   - philosophy string starting with "+ " → APPENDS after file-based content
 *
 * Falls back to UNIVERSAL_BASELINE when no sources are found.
 *
 * Caches per-cwd with mtime invalidation — fast on repeated calls, never stale.
 *
 * Exports:
 *   loadPrinciples({ cwd? }) → { block: string, sources: string[] }
 *   UNIVERSAL_BASELINE       — ten-principle architecture-first baseline
 *   _clearCache()            — test helper to reset the per-cwd cache
 *
 * @module forge-master/principles
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// ─── Universal Baseline ─────────────────────────────────────────────

export const UNIVERSAL_BASELINE = `**Architecture-First, Always.** Unless under explicit pressure from a real client deadline, do it right the first time. No shortcuts. Guardrails don't slow you down — rework slows you down. The first pass should be the right pass.

**Vibe Coding Is a Trap.** Prompting with intent and hoping for the best works for prototypes and falls apart for anything maintainable. Structure isn't overhead; it's how you avoid the 80/20 wall. A 99/100 app and a 44/100 app can ship in the same 7 minutes — the difference is whether the agent had constraints.

**Define What Shouldn't Be Built.** The most powerful guardrail isn't "do this," it's "don't do that." Every recommendation should include explicit Forbidden Actions, not just aspirations. Scope drift is prevented by the boundary, not the wish.

**The Builder Must Never Review Its Own Work.** Fresh sessions for review. Fresh eyes for audit. Sunk-cost bias is structural, not personal — it lives in the token sequence. If you wrote it, you cannot see its blind spots.

**Slice Boundaries Are Non-Negotiable.** Every substantial change decomposes into 3-7 slices with build + test gates. Failures are caught when they're small. Green-to-green progression means a safe rollback point always exists.

**Enterprise Quality Is the Default, Not an Upgrade.** Every deliverable ships with tests, proper error handling, input validation, and architectural compliance from the first commit. "Add tests later" is how codebases rot. There is no opt-in to quality.

**Evidence Over Assumption.** When asked whether something is done, don't say "it seems right." Paste the test output. Show the commit. Prove coverage didn't drop. Gates produce evidence; assertions produce bugs.

**When in Doubt, Say the Architectural Answer.** If asked "should I take the shortcut?" — the answer is no, unless the user has explicitly invoked client pressure. If asked "is this good enough?" — the answer is the quality bar, not the expediency bar. The advisor's job is to tell the truth about the path, not to be agreeable.

**Work Triage Order — Hotfix, Operational, Strategic.** Rank work in this order, always. Invert only with an explicit, stated reason.

1. **Hotfixes / patches** — production is bleeding. Real users, real pain, right now. Security incidents live here too. Everything else waits. Ship the minimum surgical fix, then come back and do it architecturally right in the next cycle.
2. **Operational** — the system is running but something is off. Flaky tests, slow queries, noisy logs, drift creeping in, toil accumulating. Operational debt compounds faster than feature debt — pay it down before it becomes a hotfix tomorrow.
3. **Strategic** — net-new features, architecture moves, platform bets. This is where the leverage is, but only *after* the first two are quiet. A strategic move on top of a smouldering operational fire is a vibe-coding move in a suit.

The inversion trap: when strategic work feels more exciting than operational work, agents (human or AI) start reaching up the stack. Don't. The excitement gap is a signal that operational hygiene is being neglected, not that strategy is more valuable. When unsure which tier a task belongs to: ask "what breaks if I don't do this today?" Production → hotfix. Toil → operational. Nothing visible → strategic.

**Keep Gates Boring.** Gates fail on syntax before they fail on logic. The validation step of every slice must be so simple a human can read it and predict the outcome in one breath. Plain \`grep -q 'pattern'\`, plain \`npx vitest run <file>\`, plain \`test -f <file>\`. No nested shell layers, no escaped quotes inside escaped quotes, no clever one-liners that pipe through four tools. If a gate needs to check two things, run two gates. If a gate needs a negative assertion, prove it in a test file, not in the gate. A gate that fails on its own shell quoting is worse than no gate — it hides working code behind a false red.`;

// ─── Per-cwd Cache ──────────────────────────────────────────────────

/** @type {Map<string, { block: string, sources: string[], mtimes: Record<string, number|null> }>} */
const _cache = new Map();

/** Reset the cache — for tests only. */
export function _clearCache() {
  _cache.clear();
}

// ─── Helpers ────────────────────────────────────────────────────────

function safeStat(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function safeReadFile(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function mtimesMatch(cached, current) {
  for (const [p, mtime] of Object.entries(current)) {
    if (cached[p] !== mtime) return false;
  }
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Load the active principles block for a given project root.
 *
 * Sources are read in order; the first file-based source wins unless
 * `.forge.json#forgeMaster.philosophy` overrides it (replace or append).
 * Falls back to UNIVERSAL_BASELINE when no sources are found.
 *
 * Caches results per-cwd; busts the cache if any source file mtime changes.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {{ block: string, sources: string[] }}
 */
export function loadPrinciples({ cwd = process.cwd() } = {}) {
  const projectPrinciplesPath = resolve(cwd, "docs/plans/PROJECT-PRINCIPLES.md");
  const copilotInstructionsPath = resolve(cwd, ".github/copilot-instructions.md");
  const forgeJsonPath = resolve(cwd, ".forge.json");

  const sourcePaths = [projectPrinciplesPath, copilotInstructionsPath, forgeJsonPath];

  const currentMtimes = {};
  for (const p of sourcePaths) {
    currentMtimes[p] = safeStat(p);
  }

  // Return cached if all mtimes match
  const cached = _cache.get(cwd);
  if (cached && mtimesMatch(cached.mtimes, currentMtimes)) {
    return { block: cached.block, sources: cached.sources };
  }

  // ── Load file-based sources ─────────────────────────────────────

  let fileBlock = "";
  const fileSources = [];

  // 1. PROJECT-PRINCIPLES.md
  const projectPrinciplesContent = safeReadFile(projectPrinciplesPath);
  if (projectPrinciplesContent && projectPrinciplesContent.trim()) {
    fileBlock = projectPrinciplesContent.trim();
    fileSources.push("docs/plans/PROJECT-PRINCIPLES.md");
  }

  // 2. .github/copilot-instructions.md — extract ## Architecture Principles section
  if (!fileBlock) {
    const copilotContent = safeReadFile(copilotInstructionsPath);
    if (copilotContent) {
      const match = copilotContent.match(/## Architecture Principles\n([\s\S]*?)(?=\n##|$)/);
      if (match && match[1].trim()) {
        fileBlock = match[1].trim();
        fileSources.push(".github/copilot-instructions.md (Architecture Principles)");
      }
    }
  }

  // 3. .forge.json — extract forgeMaster.philosophy
  let philosophy = null;
  const forgeJsonContent = safeReadFile(forgeJsonPath);
  if (forgeJsonContent) {
    try {
      const parsed = JSON.parse(forgeJsonContent);
      const raw = parsed?.forgeMaster?.philosophy;
      if (raw && typeof raw === "string") philosophy = raw;
    } catch { /* malformed JSON — skip */ }
  }

  // ── Apply override semantics ────────────────────────────────────

  let block = "";
  const sources = [];

  if (philosophy !== null) {
    if (philosophy.startsWith("+ ")) {
      // Append mode: file-based (or universal) + separator + philosophy remainder
      const base = fileBlock || UNIVERSAL_BASELINE;
      const appendedSources = fileBlock
        ? [...fileSources]
        : ["universal-baseline"];
      block = base + "\n\n---\n\n" + philosophy.slice(2).trim();
      sources.push(...appendedSources, ".forge.json#forgeMaster.philosophy (append)");
    } else {
      // Replace mode: philosophy string entirely replaces file-based content
      block = philosophy;
      sources.push(".forge.json#forgeMaster.philosophy");
    }
  } else if (fileBlock) {
    block = fileBlock;
    sources.push(...fileSources);
  } else {
    block = UNIVERSAL_BASELINE;
    sources.push("universal-baseline");
  }

  _cache.set(cwd, { block, sources, mtimes: currentMtimes });

  return { block, sources };
}

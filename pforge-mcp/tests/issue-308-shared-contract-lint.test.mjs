/**
 * #308 — parallel slices over one artifact need a shared contract and a coherence gate.
 *
 * In the #292 preset rewrite, parallel slices each passed their own gates yet
 * disagreed with one another: two definitions of the same helper, signatures
 * that didn't fit together, and conflicting routes. It converged only once a
 * written contract pinned the shared shapes and one slice verified the whole
 * artifact. Gate lint now warns when a plan runs parallel slices on the same
 * artifact without a "## Shared Contract" section, or with no later slice that
 * depends on all of them.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function lint(markdown) {
  const dir = mkdtempSync(join(tmpdir(), "pf-308-"));
  dirs.push(dir);
  const file = join(dir, "Phase-1-PLAN.md");
  writeFileSync(file, markdown);
  return lintGateCommands(file, dir);
}

function slice(n, title, tags, gate = "npm test") {
  return `### Slice ${n}: ${title} ${tags}\n\n1. Do the work.\n\n**Validation Gate**:\n\`\`\`bash\n${gate}\n\`\`\`\n`;
}

const PARALLEL_PHP = [
  slice(1, "Instructions", "[P] [scope: presets/php/.github/instructions/**]"),
  slice(2, "Skills", "[P] [scope: presets/php/.github/skills/**]"),
].join("\n");
const COHERENCE = slice(3, "Build the whole preset", "[depends: Slice 1, Slice 2] [scope: presets/php/**]", "node scripts/audit/preset-quality.mjs --presets php");
const CONTRACT = "## Shared Contract\n\n- `ValidatedJson` is defined once, in `rules.md`.\n\n";

const rule = (r, name) => r.warnings.filter((w) => w.rule === name);

describe("#308 parallel slices over one artifact", () => {
  it("warns about a missing shared contract and a missing coherence slice", () => {
    const r = lint(`# Phase 1\n\n## Execution Slices\n\n${PARALLEL_PHP}`);
    const contract = rule(r, "parallel-no-shared-contract");
    expect(contract).toHaveLength(1);
    expect(contract[0].message).toMatch(/Slices 1, 2 .*presets\/php/);
    expect(contract[0].message).toContain("## Shared Contract");
    expect(rule(r, "parallel-no-coherence-gate")).toHaveLength(1);
    expect(r.passed).toBe(true);
  });

  it("is satisfied by a Shared Contract section and a slice depending on every parallel slice", () => {
    const r = lint(`# Phase 1\n\n${CONTRACT}## Execution Slices\n\n${PARALLEL_PHP}\n${COHERENCE}`);
    expect(rule(r, "parallel-no-shared-contract")).toEqual([]);
    expect(rule(r, "parallel-no-coherence-gate")).toEqual([]);
  });

  it("accepts a coherence slice that depends on them transitively", () => {
    const mid = slice(3, "Merge checkpoint", "[depends: Slice 1, Slice 2] [scope: presets/php/README.md]");
    const end = slice(4, "Build the whole preset", "[depends: Slice 3] [scope: presets/php/**]");
    const r = lint(`# Phase 1\n\n${CONTRACT}## Execution Slices\n\n${PARALLEL_PHP}\n${mid}\n${end}`);
    expect(rule(r, "parallel-no-coherence-gate")).toEqual([]);
  });

  it("ignores parallel slices on different artifacts, and sequential slices on the same one", () => {
    const apart = [
      slice(1, "PHP", "[P] [scope: presets/php/**]"),
      slice(2, "Rust", "[P] [scope: presets/rust/**]"),
    ].join("\n");
    expect(rule(lint(`# P\n\n## Execution Slices\n\n${apart}`), "parallel-no-shared-contract")).toEqual([]);
    const ordered = [
      slice(1, "Instructions", "[scope: presets/php/.github/instructions/**]"),
      slice(2, "Skills", "[depends: Slice 1] [scope: presets/php/.github/skills/**]"),
    ].join("\n");
    expect(rule(lint(`# P\n\n## Execution Slices\n\n${ordered}`), "parallel-no-shared-contract")).toEqual([]);
  });
});

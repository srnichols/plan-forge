/**
 * Plan Forge — Phase WORKER-GUARDRAILS Slice 5 (A6)
 * plan-frontmatter-extensions.test.mjs
 *
 * Covers:
 *   1. parsePlan extracts lockHash from frontmatter
 *   2. parsePlan leaves meta.lockHash undefined when field is absent
 *   3. computeLockHash produces a consistent hex digest for a plan
 *   4. computeLockHash changes when Scope changes
 *   5. computeLockHash changes when Validation Gate changes
 *   6. computeLockHash changes when Forbidden Actions list changes
 *   7. computeLockHash is stable when non-hash-scoped content changes
 *      (title, status, body prose, slice task lists, frontmatter)
 *   8. computeLockHash strips frontmatter before hashing (lockHash field
 *      itself does not affect the computed value — no circular dependency)
 *   9. runPlan returns LOCK_HASH_MISMATCH when lockHash does not match
 *  10. runPlan proceeds normally when lockHash matches
 *  11. runPlan proceeds normally when lockHash is absent (backwards-compat)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";

import { parsePlan, computeLockHash, runPlan } from "../orchestrator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── helpers ─────────────────────────────────────────────────────────────────

let tempDirs = [];

function makeTempDir() {
  const d = mkdtempSync(resolve(tmpdir(), "pforge-fme-test-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs = [];
});

function writePlan(dir, frontmatter, body) {
  const content = frontmatter
    ? `---\n${frontmatter}\n---\n\n${body}`
    : body;
  const path = resolve(dir, "plan.md");
  writeFileSync(path, content, "utf-8");
  return path;
}

function minimalPlanBody({ title = "Test Plan", status = "HARDENED", forbiddenItems = ["- Do not delete prod"], scope1 = ["- `src/parser.mjs`"], gate1 = "node -e 'console.log(1)'" } = {}) {
  const forbiddenSection = forbiddenItems.join("\n");
  const scopeSection = scope1.join("\n");
  return `# ${title}

> **Status**: ${status}

---

## Scope Contract

### In Scope
- Add parser module

### Out of Scope
- Database changes

### Forbidden Actions
${forbiddenSection}

---

## Execution Slices

### Slice 1: Do work

**Scope** (files in scope):
${scopeSection}

**Worker guidance**: keep it simple.

**Validation Gate**:

\`\`\`bash
${gate1}
\`\`\`

1. Do the thing
`;
}

// ─── 1. parsePlan — lockHash frontmatter ─────────────────────────────────────

describe("parsePlan: lockHash frontmatter", () => {
  it("parses lockHash from frontmatter", () => {
    const dir = makeTempDir();
    const planPath = writePlan(
      dir,
      "lockHash: abc123def456",
      minimalPlanBody(),
    );
    const result = parsePlan(planPath, dir);
    expect(result.meta.lockHash).toBe("abc123def456");
  });

  it("leaves meta.lockHash undefined when field is absent", () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, null, minimalPlanBody());
    const result = parsePlan(planPath, dir);
    expect(result.meta.lockHash).toBeUndefined();
  });

  it("leaves meta.lockHash undefined when lockHash is empty string", () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, "lockHash:", minimalPlanBody());
    const result = parsePlan(planPath, dir);
    expect(result.meta.lockHash).toBeUndefined();
  });

  it("parses lockHash alongside other frontmatter fields", () => {
    const dir = makeTempDir();
    const planPath = writePlan(
      dir,
      "lockHash: deadbeef0011\nnetwork.allowed: [api.example.com]",
      minimalPlanBody(),
    );
    const result = parsePlan(planPath, dir);
    expect(result.meta.lockHash).toBe("deadbeef0011");
    expect(result.meta.networkAllowed).toEqual(["api.example.com"]);
  });
});

// ─── 2. computeLockHash — basic shape ────────────────────────────────────────

describe("computeLockHash: output shape", () => {
  it("returns a 64-character hex string (sha256)", () => {
    const content = minimalPlanBody();
    const hash = computeLockHash(content);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const content = minimalPlanBody();
    expect(computeLockHash(content)).toBe(computeLockHash(content));
  });
});

// ─── 3. computeLockHash — Scope changes ──────────────────────────────────────

describe("computeLockHash: Scope sensitivity", () => {
  it("changes when a scope file is added", () => {
    const a = computeLockHash(minimalPlanBody({ scope1: ["- `src/parser.mjs`"] }));
    const b = computeLockHash(minimalPlanBody({ scope1: ["- `src/parser.mjs`", "- `src/types.mjs`"] }));
    expect(a).not.toBe(b);
  });

  it("changes when a scope file is renamed", () => {
    const a = computeLockHash(minimalPlanBody({ scope1: ["- `src/parser.mjs`"] }));
    const b = computeLockHash(minimalPlanBody({ scope1: ["- `src/lexer.mjs`"] }));
    expect(a).not.toBe(b);
  });
});

// ─── 4. computeLockHash — Validation Gate changes ────────────────────────────

describe("computeLockHash: Validation Gate sensitivity", () => {
  it("changes when the gate command changes", () => {
    const a = computeLockHash(minimalPlanBody({ gate1: "node -e 'console.log(1)'" }));
    const b = computeLockHash(minimalPlanBody({ gate1: "node -e 'console.log(2)'" }));
    expect(a).not.toBe(b);
  });

  it("changes when a gate command line is added", () => {
    const a = computeLockHash(minimalPlanBody({ gate1: "node -e 'console.log(1)'" }));
    const b = computeLockHash(minimalPlanBody({ gate1: "node -e 'console.log(1)'\nbash -c 'cd pforge-mcp && npx vitest run'" }));
    expect(a).not.toBe(b);
  });
});

// ─── 5. computeLockHash — Forbidden Actions changes ──────────────────────────

describe("computeLockHash: Forbidden Actions sensitivity", () => {
  it("changes when a forbidden entry is added", () => {
    const a = computeLockHash(minimalPlanBody({ forbiddenItems: ["- Do not delete prod"] }));
    const b = computeLockHash(minimalPlanBody({ forbiddenItems: ["- Do not delete prod", "- Do not edit secrets"] }));
    expect(a).not.toBe(b);
  });

  it("changes when a forbidden entry is modified", () => {
    const a = computeLockHash(minimalPlanBody({ forbiddenItems: ["- Do not delete prod"] }));
    const b = computeLockHash(minimalPlanBody({ forbiddenItems: ["- Do not delete staging"] }));
    expect(a).not.toBe(b);
  });
});

// ─── 6. computeLockHash — stability for non-scoped content ───────────────────

describe("computeLockHash: stable for non-hash-scoped changes", () => {
  it("is stable when plan title changes", () => {
    const a = computeLockHash(minimalPlanBody({ title: "Plan Alpha" }));
    const b = computeLockHash(minimalPlanBody({ title: "Plan Beta" }));
    expect(a).toBe(b);
  });

  it("is stable when status line changes", () => {
    const a = computeLockHash(minimalPlanBody({ status: "HARDENED" }));
    const b = computeLockHash(minimalPlanBody({ status: "COMPLETED" }));
    expect(a).toBe(b);
  });
});

// ─── 7. computeLockHash — frontmatter stripping ───────────────────────────────

describe("computeLockHash: frontmatter stripping", () => {
  it("produces the same hash whether frontmatter is present or absent", () => {
    const body = minimalPlanBody();
    const withFm = `---\nsome: field\n---\n\n${body}`;
    const withoutFm = body;
    expect(computeLockHash(withFm)).toBe(computeLockHash(withoutFm));
  });

  it("adding lockHash to frontmatter does not change the computed hash", () => {
    const body = minimalPlanBody();
    const withoutLockHash = `---\nstatus: hardened\n---\n\n${body}`;
    const hash1 = computeLockHash(withoutLockHash);
    const withLockHash = `---\nstatus: hardened\nlockHash: ${hash1}\n---\n\n${body}`;
    const hash2 = computeLockHash(withLockHash);
    expect(hash1).toBe(hash2);
  });
});

// ─── 8. runPlan — lockHash enforcement ───────────────────────────────────────

describe("runPlan: lockHash enforcement", () => {
  it("returns LOCK_HASH_MISMATCH when lockHash does not match", async () => {
    const dir = makeTempDir();
    const body = minimalPlanBody();
    const planPath = writePlan(dir, "lockHash: 0000000000000000000000000000000000000000000000000000000000000000", body);

    const result = await runPlan(planPath, {
      cwd: dir,
      dryRunWorker: true,
      manualImport: true,
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("LOCK_HASH_MISMATCH");
    expect(result.storedHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
    expect(typeof result.computedHash).toBe("string");
    expect(result.computedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.computedHash).not.toBe("0000000000000000000000000000000000000000000000000000000000000000");
  });

  it("proceeds past lockHash check when hash matches", async () => {
    const dir = makeTempDir();
    const body = minimalPlanBody();
    const correctHash = computeLockHash(`---\nlockHash: placeholder\n---\n\n${body}`);
    const planPath = writePlan(dir, `lockHash: ${correctHash}`, body);

    const result = await runPlan(planPath, {
      cwd: dir,
      dryRunWorker: true,
      manualImport: true,
      quorum: false, // lockHash tests don't exercise quorum; avoid model-probe failures in CI
    });

    expect(result.code).not.toBe("LOCK_HASH_MISMATCH");
    expect(result.status).not.toBe("failed");
  });

  it("proceeds normally when lockHash is absent (backwards-compatible)", async () => {
    const dir = makeTempDir();
    const body = minimalPlanBody();
    const planPath = writePlan(dir, null, body);

    const result = await runPlan(planPath, {
      cwd: dir,
      dryRunWorker: true,
      manualImport: true,
      quorum: false, // lockHash tests don't exercise quorum; avoid model-probe failures in CI
    });

    expect(result.code).not.toBe("LOCK_HASH_MISMATCH");
  });
});

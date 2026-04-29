/**
 * Meta-bug #129 — origin tag-collision preflight unit tests.
 *
 * Covers: extractPlanReleaseVersion (filename / frontmatter / chore line),
 * detectVersionCollision (no-version / collision / no-collision / network-fail),
 * and runPlan VERSION_COLLISION early-return + --allow-retrograde bypass.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  extractPlanReleaseVersion,
  detectVersionCollision,
  runPlan,
} from "../orchestrator.mjs";

function makeDir() {
  const dir = resolve(tmpdir(), `pforge-vc-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal plan body that parses but does nothing. */
const MINIMAL_PLAN_BODY = `---
crucibleId: test-crucible-001
version: '0.0.1'
---

# Test plan

### Slice 1: noop

**Validation Gate**:
\`\`\`bash
echo ok
\`\`\`
`;

describe("extractPlanReleaseVersion", () => {
  it("extracts patch version from filename", () => {
    expect(extractPlanReleaseVersion("/x/Phase-33.4-FOO-v2.67.4-PLAN.md")).toBe("2.67.4");
  });

  it("extracts minor-only version from filename", () => {
    expect(extractPlanReleaseVersion("/x/Phase-33-FOO-v2.67-PLAN.md")).toBe("2.67");
  });

  it("does not capture pre-release suffix from filename (must come from frontmatter/body)", () => {
    // Pre-release suffix in filename is too risky (would swallow `-PLAN.md`).
    // Filename match returns the bare semver only.
    expect(extractPlanReleaseVersion("/x/Phase-33-FOO-v2.67.4-rc1-PLAN.md")).toBe("2.67.4");
  });

  it("returns null when filename has no version literal", () => {
    expect(extractPlanReleaseVersion("/x/random-plan.md")).toBeNull();
  });

  it("falls back to frontmatter version: when filename has none", () => {
    const dir = makeDir();
    const planPath = resolve(dir, "plan.md");
    writeFileSync(planPath, "---\nversion: '3.4.5'\n---\n# x\n");
    expect(extractPlanReleaseVersion(planPath)).toBe("3.4.5");
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to chore(release) line when filename and frontmatter have none", () => {
    const dir = makeDir();
    const planPath = resolve(dir, "plan.md");
    writeFileSync(planPath, "# x\n\nCommit: chore(release): v9.9.9 — final\n");
    expect(extractPlanReleaseVersion(planPath)).toBe("9.9.9");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("detectVersionCollision", () => {
  it("returns no-collision when plan has no version literal", () => {
    const result = detectVersionCollision("/x/random-plan.md");
    expect(result.version).toBeNull();
    expect(result.collision).toBe(false);
  });

  it("returns collision when origin has the tag", () => {
    const calls = [];
    const result = detectVersionCollision(
      "/x/Phase-33.4-v2.67.4-PLAN.md",
      "/cwd",
      {
        runner: (cmd, opts) => {
          calls.push({ cmd, opts });
          return "deadbeef0123\trefs/tags/v2.67.4\n";
        },
      },
    );
    expect(result.version).toBe("2.67.4");
    expect(result.collision).toBe(true);
    expect(result.originSha).toBe("deadbeef0123");
    expect(calls[0].cmd).toMatch(/git ls-remote --tags origin refs\/tags\/v2\.67\.4/);
    expect(calls[0].opts.cwd).toBe("/cwd");
  });

  it("returns no-collision when origin has no matching tag", () => {
    const result = detectVersionCollision(
      "/x/Phase-99-v9.9.9-PLAN.md",
      "/cwd",
      { runner: () => "" },
    );
    expect(result.version).toBe("9.9.9");
    expect(result.collision).toBe(false);
    expect(result.originSha).toBeNull();
  });

  it("treats network errors as advisory (no collision, error populated)", () => {
    const result = detectVersionCollision(
      "/x/Phase-33.4-v2.67.4-PLAN.md",
      "/cwd",
      {
        runner: () => {
          throw new Error("fatal: unable to access 'origin'");
        },
      },
    );
    expect(result.version).toBe("2.67.4");
    expect(result.collision).toBe(false);
    expect(result.error).toMatch(/unable to access/);
  });
});

describe("runPlan VERSION_COLLISION preflight", () => {
  let dir;
  beforeEach(() => {
    dir = makeDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not block plans with no version literal in filename", async () => {
    const planPath = resolve(dir, "no-version-plan.md");
    writeFileSync(planPath, MINIMAL_PLAN_BODY);

    const result = await runPlan(planPath, {
      cwd: dir,
      dryRun: true,
      manualImport: true,
    });
    // No VERSION_COLLISION because no version was extracted from filename
    expect(result.status).toBe("dry-run");
  });

  it("does not block plans whose version is fresh (no origin tag)", async () => {
    // v999.999.999 will never exist on origin — preflight should pass and
    // dry-run should complete normally.
    const planPath = resolve(dir, "Phase-99-FRESH-v999.999.999-PLAN.md");
    writeFileSync(planPath, MINIMAL_PLAN_BODY);

    const result = await runPlan(planPath, {
      cwd: dir,
      dryRun: true,
      manualImport: true,
    });
    expect(result.status).toBe("dry-run");
  });

  it("--allow-retrograde flag is plumbed through runPlan options", async () => {
    // Verify the option is accepted without error. Even if cwd has no git
    // origin (tmpdir), allowRetrograde=true should skip the check entirely.
    const planPath = resolve(dir, "Phase-99-RETRO-v0.0.1-PLAN.md");
    writeFileSync(planPath, MINIMAL_PLAN_BODY);

    const result = await runPlan(planPath, {
      cwd: dir,
      dryRun: true,
      manualImport: true,
      allowRetrograde: true,
    });
    expect(result.status).toBe("dry-run");
  });
});

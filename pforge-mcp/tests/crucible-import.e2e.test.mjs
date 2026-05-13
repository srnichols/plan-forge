/**
 * End-to-end integration tests for the Spec Kit CLI entry point.
 *
 * Phase CRUCIBLE-IMPORT-CLI Slice 5.
 *
 * Unlike the unit tests in crucible-import.test.mjs (which call the exported
 * API directly), these tests spawn `node crucible-import.mjs` as a real
 * subprocess and validate exit codes, stdout/stderr rendering, and the files
 * written to disk — the same observable surface a human or CI script sees.
 *
 * Covered scenarios:
 *   1.  --help → exit 0, usage text on stdout
 *   2.  import --dry-run --json → JSON payload, ok:true, dryRun:true, no files written
 *   3.  import --dry-run (human render) → "DRY RUN" in stdout
 *   4.  import --json → exit 0, valid JSON, files on disk
 *   5.  import (human render) → exit 0, success summary on stdout, files on disk
 *   6.  status --json (after import) → lists the smelt
 *   7.  status <smeltId> --json → full smelt detail
 *   8.  status <nonexistent-id> --json → exit 1
 *   9.  import missing --from → exit 2, stderr message
 *  10.  import --from=unsupported-source → exit 2
 *  11.  unknown subcommand → exit 2
 *  12.  import on empty project → exit 1, SPECKIT_IMPORT_NOT_FOUND in JSON
 *  13.  import --sync-principles → writes PROJECT-PRINCIPLES.md
 *  14.  import --sync-principles when target exists → exit 1, PROJECT_PRINCIPLES_EXISTS
 *  15.  import --name=<slug> → plan file uses the custom slug
 *  16.  Two successive imports → second plan filename gets -2 suffix
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "speckit");
const CLI = resolve(HERE, "..", "crucible-import.mjs");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Copy a named speckit fixture into a fresh temp project and return the
 * project root.  Constitution files are placed under memory/ (Spec Kit's
 * default layout) unless `inlineConstitution` is true.
 */
function stageProject(fixtureName, { feature = "demo-feature", inlineConstitution = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "speckit-e2e-"));
  const featDir = join(root, "specs", feature);
  mkdirSync(featDir, { recursive: true });
  const src = join(FIXTURES, fixtureName);
  for (const f of readdirSync(src)) {
    if (f === "constitution.md" && !inlineConstitution) {
      const memDir = join(root, "memory");
      mkdirSync(memDir, { recursive: true });
      copyFileSync(join(src, f), join(memDir, f));
    } else {
      copyFileSync(join(src, f), join(featDir, f));
    }
  }
  return root;
}

/**
 * Spawn `node crucible-import.mjs [args]` with a timeout and return
 * { status, stdout, stderr }.
 */
function run(args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: opts.cwd || HERE,
    env: { ...process.env },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

let cleanupRoots = [];
afterEach(() => {
  for (const r of cleanupRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  cleanupRoots = [];
});

// ─── 1. Help text ─────────────────────────────────────────────────────────────

describe("CLI: --help", () => {
  it("exits 0 and prints usage text", () => {
    const { status, stdout } = run(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/import\s+--from=/);
    expect(stdout).toMatch(/status/);
    expect(stdout).toMatch(/--dry-run/);
    expect(stdout).toMatch(/--sync-principles/);
  });

  it("help subcommand also exits 0", () => {
    const { status, stdout } = run(["help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/import\s+--from=/);
  });
});

// ─── 2. Dry-run JSON mode ─────────────────────────────────────────────────────

describe("CLI: import --dry-run --json", () => {
  it("exits 0, emits valid JSON with ok:true and dryRun:true, writes no files", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit",
      `--project=${root}`,
      "--dry-run", "--json",
    ]);

    expect(status).toBe(0);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.mappedFields.length).toBeGreaterThan(0);
    expect(existsSync(join(root, ".forge", "crucible"))).toBe(false);
    expect(existsSync(join(root, "docs", "plans"))).toBe(false);
  });
});

// ─── 3. Dry-run human render ──────────────────────────────────────────────────

describe("CLI: import --dry-run (human)", () => {
  it("exits 0 and prints DRY RUN summary to stdout", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit",
      `--project=${root}`,
      "--dry-run",
    ]);

    expect(status).toBe(0);
    expect(stdout).toMatch(/DRY RUN/i);
    expect(stdout).toMatch(/smelt:/i);
    expect(stdout).toMatch(/Mapped fields:/i);
  });
});

// ─── 4. Full import JSON mode ─────────────────────────────────────────────────

describe("CLI: import --json (full write)", () => {
  it("exits 0, emits valid JSON payload, writes smelt + plan + audit log", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit",
      `--project=${root}`,
      "--json",
    ]);

    expect(status).toBe(0);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(true);
    expect(r.smeltId).toBeTruthy();
    expect(existsSync(r.smeltPath)).toBe(true);
    expect(existsSync(r.planPath)).toBe(true);

    // Smelt JSON integrity
    const smelt = JSON.parse(readFileSync(r.smeltPath, "utf-8"));
    expect(smelt.source).toBe("speckit");
    expect(smelt.status).toBe("imported");
    expect(smelt["plan-title"]).toBe("Rate Limit Login Endpoint");
    expect(smelt.slices).toHaveLength(5);
    expect(smelt["forbidden-actions"]).toHaveLength(4);
    expect(smelt["agent-constraints"].length).toBeGreaterThanOrEqual(5);

    // Plan frontmatter integrity
    const plan = readFileSync(r.planPath, "utf-8");
    expect(plan).toMatch(/^---\r?\ncrucibleId: imported-speckit-/);
    expect(plan).toMatch(/source: speckit/);
    expect(plan).toMatch(/lane: full/);

    // Audit log
    const auditPath = join(root, ".forge", "crucible", "manual-imports.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const audit = readFileSync(auditPath, "utf-8");
    expect(audit).toMatch(/"source":"speckit"/);
    // crucibleId in audit is "imported-speckit-<smeltId>"
    expect(audit).toContain(r.smeltId);
  });
});

// ─── 5. Full import human render ─────────────────────────────────────────────

describe("CLI: import (human render)", () => {
  it("exits 0 and prints human-readable success summary with next-step hint", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit",
      `--project=${root}`,
    ]);

    expect(status).toBe(0);
    expect(stdout).toMatch(/Spec Kit.*Crucible import/i);
    expect(stdout).toMatch(/✓ Imported smelt/);
    expect(stdout).toMatch(/pforge run-plan/);
  });
});

// ─── 6. Status list ───────────────────────────────────────────────────────────

describe("CLI: status --json (list)", () => {
  it("lists the smelt written by a prior import", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    // First do an import
    const imp = run(["import", "--from=spec-kit", `--project=${root}`, "--json"]);
    expect(imp.status).toBe(0);
    const imported = JSON.parse(imp.stdout);
    expect(imported.ok).toBe(true);

    // Now list
    const { status, stdout } = run(["status", `--project=${root}`, "--json"]);
    expect(status).toBe(0);
    const list = JSON.parse(stdout);
    expect(list.smelts).toHaveLength(1);
    expect(list.smelts[0].source).toBe("speckit");
    expect(list.smelts[0].status).toBe("imported");
    expect(list.smelts[0].planTitle).toBe("Rate Limit Login Endpoint");
    expect(list.smelts[0].id).toBe(imported.smeltId);
  });

  it("prints empty list when no smelts exist", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-empty-"));
    cleanupRoots.push(root);

    const { status, stdout } = run(["status", `--project=${root}`, "--json"]);
    expect(status).toBe(0);
    const list = JSON.parse(stdout);
    expect(list.smelts).toEqual([]);
  });
});

// ─── 7. Status detail ─────────────────────────────────────────────────────────

describe("CLI: status <smeltId> --json", () => {
  it("returns full smelt JSON for a known id", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const imp = run(["import", "--from=spec-kit", `--project=${root}`, "--json"]);
    const { smeltId } = JSON.parse(imp.stdout);

    const { status, stdout } = run(["status", smeltId, `--project=${root}`, "--json"]);
    expect(status).toBe(0);
    const smelt = JSON.parse(stdout);
    expect(smelt.id).toBe(smeltId);
    expect(smelt.source).toBe("speckit");
    expect(smelt["plan-title"]).toBe("Rate Limit Login Endpoint");
  });

  it("renders human-readable detail for a known id", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const imp = run(["import", "--from=spec-kit", `--project=${root}`, "--json"]);
    const { smeltId } = JSON.parse(imp.stdout);

    const { status, stdout } = run(["status", smeltId, `--project=${root}`]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Smelt/);
    expect(stdout).toMatch(/speckit/);
  });
});

// ─── 8. Status: nonexistent smelt id ──────────────────────────────────────────

describe("CLI: status <nonexistent-id>", () => {
  it("exits 1 and emits SMELT_NOT_FOUND JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-nosmelt-"));
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "status", "aaaabbbb-0000-0000-0000-000000000000",
      `--project=${root}`, "--json",
    ]);
    expect(status).toBe(1);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SMELT_NOT_FOUND");
  });

  it("exits 1 and prints error to stderr in human mode", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-nosmelt-"));
    cleanupRoots.push(root);

    const { status, stderr } = run([
      "status", "aaaabbbb-0000-0000-0000-000000000000",
      `--project=${root}`,
    ]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/smelt not found/i);
  });
});

// ─── 9. Missing --from argument ────────────────────────────────────────────────

describe("CLI: import without --from", () => {
  it("exits 2 and prints an error to stderr", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stderr } = run(["import", `--project=${root}`]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/--from/);
  });
});

// ─── 10. Unsupported --from source ────────────────────────────────────────────

describe("CLI: import --from=unsupported-source", () => {
  it("exits 2 and mentions supported sources", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stderr } = run([
      "import", "--from=github-issues", `--project=${root}`,
    ]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/spec-kit/);
  });
});

// ─── 11. Unknown subcommand ────────────────────────────────────────────────────

describe("CLI: unknown subcommand", () => {
  it("exits 2 and mentions the unknown subcommand", () => {
    const { status, stderr } = run(["frobnicate"]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/frobnicate/);
  });
});

// ─── 12. Import on empty project ──────────────────────────────────────────────

describe("CLI: import on empty project", () => {
  it("exits 1 and emits SPECKIT_IMPORT_NOT_FOUND in JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-noartifacts-"));
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit", `--project=${root}`, "--json",
    ]);
    expect(status).toBe(1);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SPECKIT_IMPORT_NOT_FOUND");
  });

  it("exits 1 with human output describing the failure", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-noartifacts-"));
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit", `--project=${root}`,
    ]);
    expect(status).toBe(1);
    expect(stdout).toMatch(/FAILED/i);
    expect(stdout).toMatch(/SPECKIT_IMPORT_NOT_FOUND/);
  });
});

// ─── 13. --sync-principles writes PROJECT-PRINCIPLES.md ───────────────────────

describe("CLI: import --sync-principles", () => {
  it("writes PROJECT-PRINCIPLES.md and exits 0", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit", `--project=${root}`,
      "--sync-principles", "--json",
    ]);
    expect(status).toBe(0);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(true);

    const pp = join(root, "docs", "plans", "PROJECT-PRINCIPLES.md");
    expect(existsSync(pp)).toBe(true);
    const body = readFileSync(pp, "utf-8");
    expect(body).toMatch(/^# Project Principles/);
    expect(body).toMatch(/secret manager/i);
  });
});

// ─── 14. --sync-principles when target already exists ─────────────────────────

describe("CLI: import --sync-principles (target exists)", () => {
  it("exits 1 and emits PROJECT_PRINCIPLES_EXISTS in JSON", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    // Pre-create the target
    const pp = join(root, "docs", "plans", "PROJECT-PRINCIPLES.md");
    mkdirSync(dirname(pp), { recursive: true });
    writeFileSync(pp, "# pre-existing\n");

    const { status, stdout } = run([
      "import", "--from=spec-kit", `--project=${root}`,
      "--sync-principles", "--json",
    ]);
    expect(status).toBe(1);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("PROJECT_PRINCIPLES_EXISTS");
  });
});

// ─── 15. Custom --name slug ───────────────────────────────────────────────────

describe("CLI: import --name=<slug>", () => {
  it("uses the custom slug in the plan filename", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const { status, stdout } = run([
      "import", "--from=spec-kit", `--project=${root}`,
      "--name=my-custom-slug", "--json",
    ]);
    expect(status).toBe(0);
    const r = JSON.parse(stdout);
    expect(r.ok).toBe(true);
    expect(r.planPath).toMatch(/MY-CUSTOM-SLUG/);
  });
});

// ─── 16. Plan filename collision ──────────────────────────────────────────────

describe("CLI: two successive imports (collision)", () => {
  it("gives the second plan a -2 suffix instead of overwriting", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const r1 = JSON.parse(
      run(["import", "--from=spec-kit", `--project=${root}`, "--json"]).stdout,
    );
    const r2 = JSON.parse(
      run(["import", "--from=spec-kit", `--project=${root}`, "--json"]).stdout,
    );

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.planPath).not.toBe(r2.planPath);
    expect(r2.planPath).toMatch(/-2-PLAN\.md$/);
    expect(existsSync(r1.planPath)).toBe(true);
    expect(existsSync(r2.planPath)).toBe(true);
  });
});

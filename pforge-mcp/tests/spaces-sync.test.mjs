/**
 * Tests for pforge-mcp/spaces-sync.mjs (Phase GITHUB-E).
 *
 * Covers:
 *   1. sha256  — deterministic digest
 *   2. buildPayload — all four sources: active-plan, instructions, tool-catalog, project-profile
 *   3. buildPayload --no-instructions — skips instruction files
 *   4. getActivePlan — pointer file present / absent (fallback)
 *   5. getInstructionFiles — project-profile gets top-level space path
 *   6. getToolCatalog — builds markdown table from tools.json
 *   7. findSpace — resolves user space by name/owner
 *   8. findSpace — falls back to org space list
 *   9. findSpace — throws SpacesNotFoundError on complete miss
 *  10. syncSpaces dry-run — returns dryRun list, no uploads
 *  11. syncSpaces upload — uploads changed files, skips unchanged
 *  12. syncSpaces --force — re-uploads even if SHA matches
 *  13. syncSpaces --no-instructions — no instruction files in payload
 *  14. findSpace / ghApi — 401 → SpacesAuthError
 *  15. findSpace / ghApi — 403 → SpacesAuthError
 *  16. resolveTargets — reads .forge.json github.spacesTarget
 *  17. syncSpaces — throws when no target specified and .forge.json absent
 *
 * All tests use createMockGh — no real GitHub API calls.
 */

import {
  describe, it, expect, beforeAll, afterAll, beforeEach, afterEach,
} from "vitest";
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  sha256,
  buildPayload,
  getActivePlan,
  getInstructionFiles,
  getToolCatalog,
  findSpace,
  syncSpaces,
  SpacesSyncError,
  SpacesAuthError,
  SpacesNotFoundError,
} from "../spaces-sync.mjs";
import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_SPACES = [
  { id: "space-abc-123", name: "plan-forge", owner: { login: "acme-org" } },
];

const SAMPLE_FILES = [
  { path: "plan-forge/tool-catalog.md", sha: "DEADBEEF" },
];

const SAMPLE_TOOLS = [
  { name: "forge_run_plan", description: "Execute a plan autonomously." },
  { name: "forge_analyze", description: "Analyze the current plan state." },
];

// ─── Project root factory ─────────────────────────────────────────────────────

/**
 * Create a minimal fake project directory tree for testing.
 *
 * @param {string} base - Parent tmpdir
 * @param {Object} [opts]
 * @param {boolean} [opts.withActivePlan=true]
 * @param {boolean} [opts.withInstructions=true]
 * @param {boolean} [opts.withToolsJson=true]
 * @param {boolean} [opts.withForgeJson=false]
 * @param {string}  [opts.spacesTarget]
 * @returns {string} path to project root
 */
function makeProject(base, {
  withActivePlan = true,
  withInstructions = true,
  withToolsJson = true,
  withForgeJson = false,
  spacesTarget,
} = {}) {
  const root = join(base, randomUUID());
  mkdirSync(root, { recursive: true });

  if (withActivePlan) {
    mkdirSync(join(root, ".forge"), { recursive: true });
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    writeFileSync(
      join(root, "docs", "plans", "Phase-TEST-PLAN.md"),
      "# Test Plan\n\nThis is the active plan content.\n"
    );
    writeFileSync(
      join(root, ".forge", "active-plan"),
      "docs/plans/Phase-TEST-PLAN.md"
    );
  }

  if (withInstructions) {
    const instrDir = join(root, ".github", "instructions");
    mkdirSync(instrDir, { recursive: true });
    writeFileSync(
      join(instrDir, "architecture-principles.instructions.md"),
      "# Architecture Principles\n\nUse layers.\n"
    );
    writeFileSync(
      join(instrDir, "project-profile.instructions.md"),
      "# Project Profile\n\nMy project.\n"
    );
  }

  if (withToolsJson) {
    const mcpDir = join(root, "pforge-mcp");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(join(mcpDir, "tools.json"), JSON.stringify(SAMPLE_TOOLS));
  }

  if (withForgeJson || spacesTarget) {
    const config = { github: { spacesTarget: spacesTarget ?? "acme-org/plan-forge" } };
    writeFileSync(join(root, ".forge.json"), JSON.stringify(config));
  }

  return root;
}

// ─── Suite-level tmpdir ───────────────────────────────────────────────────────

let SUITE_TMP;

beforeAll(() => {
  SUITE_TMP = join(tmpdir(), `pf-spaces-sync-${randomUUID()}`);
  mkdirSync(SUITE_TMP, { recursive: true });
});

afterAll(() => {
  if (SUITE_TMP) rmSync(SUITE_TMP, { recursive: true, force: true });
});

// ─── sha256 ───────────────────────────────────────────────────────────────────

describe("sha256", () => {
  it("returns a 64-char hex string", () => {
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
  });

  it("differs for different inputs", () => {
    expect(sha256("abc")).not.toBe(sha256("xyz"));
  });
});

// ─── getActivePlan ────────────────────────────────────────────────────────────

describe("getActivePlan", () => {
  it("reads plan from pointer file", () => {
    const root = makeProject(SUITE_TMP);
    const result = getActivePlan(root);
    expect(result).not.toBeNull();
    expect(result.spacePath).toBe("plan-forge/active-plan.md");
    expect(result.content).toContain("Test Plan");
  });

  it("returns null when no plan exists at all", () => {
    const root = join(SUITE_TMP, randomUUID());
    mkdirSync(root, { recursive: true });
    const result = getActivePlan(root);
    expect(result).toBeNull();
  });

  it("falls back to most-recently-modified plan when pointer is absent", () => {
    const root = join(SUITE_TMP, randomUUID());
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    writeFileSync(
      join(root, "docs", "plans", "Phase-FALLBACK-PLAN.md"),
      "# Fallback Plan\n"
    );
    const result = getActivePlan(root);
    expect(result?.content).toContain("Fallback Plan");
  });
});

// ─── getInstructionFiles ──────────────────────────────────────────────────────

describe("getInstructionFiles", () => {
  it("returns list with correct spacePaths", () => {
    const root = makeProject(SUITE_TMP);
    const files = getInstructionFiles(root);
    const paths = files.map((f) => f.spacePath);
    expect(paths).toContain("plan-forge/project-profile.md");
    expect(paths).toContain("plan-forge/instructions/architecture-principles.md");
  });

  it("project-profile gets top-level spacePath", () => {
    const root = makeProject(SUITE_TMP);
    const files = getInstructionFiles(root);
    const pp = files.find((f) => f.localPath.endsWith("project-profile.instructions.md"));
    expect(pp?.spacePath).toBe("plan-forge/project-profile.md");
  });

  it("returns empty array when .github/instructions does not exist", () => {
    const root = join(SUITE_TMP, randomUUID());
    mkdirSync(root, { recursive: true });
    expect(getInstructionFiles(root)).toEqual([]);
  });
});

// ─── getToolCatalog ───────────────────────────────────────────────────────────

describe("getToolCatalog", () => {
  it("builds Markdown table from tools.json", () => {
    const root = makeProject(SUITE_TMP);
    const result = getToolCatalog(root);
    expect(result).not.toBeNull();
    expect(result.spacePath).toBe("plan-forge/tool-catalog.md");
    expect(result.content).toContain("forge_run_plan");
    expect(result.content).toContain("forge_analyze");
    expect(result.content).toContain("| Tool | Description |");
  });

  it("falls back to the framework tool catalog when the project has none", () => {
    // getToolCatalog resolves the bundled framework tools.json next to the
    // module as a last-resort candidate, so an empty project still yields the
    // canonical catalog (deterministic across platforms after the
    // fileURLToPath fix — previously null on Windows via a URL.pathname bug).
    const root = join(SUITE_TMP, randomUUID());
    mkdirSync(root, { recursive: true });
    const result = getToolCatalog(root);
    expect(result).not.toBeNull();
    expect(result.spacePath).toBe("plan-forge/tool-catalog.md");
    expect(result.content).toContain("| Tool | Description |");
  });
});

// ─── buildPayload ─────────────────────────────────────────────────────────────

describe("buildPayload", () => {
  it("includes active-plan, instructions, project-profile, and tool-catalog", () => {
    const root = makeProject(SUITE_TMP);
    const payload = buildPayload(root);
    const paths = payload.map((p) => p.spacePath);
    expect(paths).toContain("plan-forge/active-plan.md");
    expect(paths).toContain("plan-forge/tool-catalog.md");
    expect(paths).toContain("plan-forge/project-profile.md");
    expect(paths).toContain("plan-forge/instructions/architecture-principles.md");
  });

  it("each item has a digest", () => {
    const root = makeProject(SUITE_TMP);
    const payload = buildPayload(root);
    expect(payload.every((p) => typeof p.digest === "string" && p.digest.length === 64)).toBe(true);
  });

  it("--no-instructions excludes instruction files but keeps plan and catalog", () => {
    const root = makeProject(SUITE_TMP);
    const payload = buildPayload(root, { noInstructions: true });
    const paths = payload.map((p) => p.spacePath);
    expect(paths).toContain("plan-forge/active-plan.md");
    expect(paths).toContain("plan-forge/tool-catalog.md");
    expect(paths).not.toContain("plan-forge/instructions/architecture-principles.md");
    expect(paths).not.toContain("plan-forge/project-profile.md");
  });
});

// ─── findSpace ────────────────────────────────────────────────────────────────

describe("findSpace", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("resolves space ID from user space list", () => {
    mock = createMockGh([
      {
        match: ["api", "/user/copilot/spaces"],
        stdout: JSON.stringify(SAMPLE_SPACES) + "\n",
      },
    ]);
    const id = findSpace("acme-org/plan-forge", { ghCmd: "gh", env: mock.env });
    expect(id).toBe("space-abc-123");
  });

  it("falls back to org space list when not in user spaces", () => {
    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: "[]\n" },
      {
        match: ["api", "/orgs/acme-org/copilot/spaces"],
        stdout: JSON.stringify(SAMPLE_SPACES) + "\n",
      },
    ]);
    const id = findSpace("acme-org/plan-forge", { ghCmd: "gh", env: mock.env });
    expect(id).toBe("space-abc-123");
  });

  it("throws SpacesNotFoundError when space not found anywhere", () => {
    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: "[]\n" },
      { match: ["api", "/orgs/acme-org/copilot/spaces"], stdout: "[]\n" },
    ]);
    expect(() => findSpace("acme-org/plan-forge", { ghCmd: "gh", env: mock.env }))
      .toThrow(SpacesNotFoundError);
  });

  it("throws SpacesAuthError on 401", () => {
    mock = createMockGh([
      {
        match: ["api", "/user/copilot/spaces"],
        stderr: "HTTP 401: Bad credentials\n",
        exit: 1,
      },
    ]);
    expect(() => findSpace("acme-org/plan-forge", { ghCmd: "gh", env: mock.env }))
      .toThrow(SpacesAuthError);
  });

  it("throws SpacesAuthError on 403", () => {
    mock = createMockGh([
      {
        match: ["api", "/user/copilot/spaces"],
        stderr: "HTTP 403: Forbidden\n",
        exit: 1,
      },
    ]);
    expect(() => findSpace("acme-org/plan-forge", { ghCmd: "gh", env: mock.env }))
      .toThrow(SpacesAuthError);
  });

  it("throws SpacesSyncError for invalid ref format", () => {
    expect(() => findSpace("noslash", { ghCmd: "gh" }))
      .toThrow(SpacesSyncError);
  });
});

// ─── syncSpaces — dry-run ─────────────────────────────────────────────────────

describe("syncSpaces dry-run", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("returns dryRun list without uploading", () => {
    mock = createMockGh([]);
    const root = makeProject(SUITE_TMP, { withForgeJson: true });
    const result = syncSpaces({
      projectRoot: root,
      spaceRef: "acme-org/plan-forge",
      dryRun: true,
      ghCmd: "gh",
      env: mock.env,
    });
    expect(result.dryRunMode).toBe(true);
    expect(Array.isArray(result.dryRun)).toBe(true);
    expect(result.dryRun.length).toBeGreaterThan(0);
    expect(result.uploaded).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

// ─── syncSpaces — upload ──────────────────────────────────────────────────────

describe("syncSpaces upload", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  /** Wildcard PUT scenario — matches any upload call */
  const PUT_OK = {
    match: ["api", "-X", "PUT"],
    stdout: '{"ok":true}\n',
  };

  it("uploads all files when none exist yet", () => {
    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: JSON.stringify(SAMPLE_SPACES) + "\n" },
      { match: ["api", "/user/copilot/spaces/space-abc-123/files"], stdout: "[]\n" },
      PUT_OK,
    ]);

    const root = makeProject(SUITE_TMP);
    const result = syncSpaces({
      projectRoot: root,
      spaceRef: "acme-org/plan-forge",
      ghCmd: "gh",
      env: mock.env,
    });
    expect(result.dryRunMode).toBe(false);
    expect(result.uploaded.length).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips unchanged files based on SHA comparison", () => {
    const root = makeProject(SUITE_TMP, {
      withInstructions: false,
      withActivePlan: false,
    });
    // Build payload to know the real digest of tool-catalog
    const payload = buildPayload(root);
    const catalogItem = payload.find((p) => p.spacePath === "plan-forge/tool-catalog.md");
    const realDigest = catalogItem.digest;

    const existingFiles = [
      { path: "plan-forge/tool-catalog.md", sha: realDigest },
    ];

    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: JSON.stringify(SAMPLE_SPACES) + "\n" },
      { match: ["api", "/user/copilot/spaces/space-abc-123/files"], stdout: JSON.stringify(existingFiles) + "\n" },
      PUT_OK,
    ]);

    const result = syncSpaces({
      projectRoot: root,
      spaceRef: "acme-org/plan-forge",
      ghCmd: "gh",
      env: mock.env,
    });
    expect(result.skipped).toContain("plan-forge/tool-catalog.md");
    expect(result.uploaded).not.toContain("plan-forge/tool-catalog.md");
  });

  it("--force re-uploads even when SHA matches", () => {
    const root = makeProject(SUITE_TMP, {
      withInstructions: false,
      withActivePlan: false,
    });
    const payload = buildPayload(root);
    const catalogItem = payload.find((p) => p.spacePath === "plan-forge/tool-catalog.md");
    const realDigest = catalogItem.digest;

    const existingFiles = [
      { path: "plan-forge/tool-catalog.md", sha: realDigest },
    ];

    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: JSON.stringify(SAMPLE_SPACES) + "\n" },
      { match: ["api", "/user/copilot/spaces/space-abc-123/files"], stdout: JSON.stringify(existingFiles) + "\n" },
      PUT_OK,
    ]);

    const result = syncSpaces({
      projectRoot: root,
      spaceRef: "acme-org/plan-forge",
      force: true,
      ghCmd: "gh",
      env: mock.env,
    });
    expect(result.uploaded).toContain("plan-forge/tool-catalog.md");
    expect(result.skipped).not.toContain("plan-forge/tool-catalog.md");
  });

  it("--no-instructions excludes instruction files from upload", () => {
    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: JSON.stringify(SAMPLE_SPACES) + "\n" },
      { match: ["api", "/user/copilot/spaces/space-abc-123/files"], stdout: "[]\n" },
      PUT_OK,
    ]);

    const root = makeProject(SUITE_TMP);
    const result = syncSpaces({
      projectRoot: root,
      spaceRef: "acme-org/plan-forge",
      noInstructions: true,
      ghCmd: "gh",
      env: mock.env,
    });
    expect(result.uploaded).not.toContain(
      expect.stringContaining("plan-forge/instructions/")
    );
  });
});

// ─── .forge.json config reading ───────────────────────────────────────────────

describe("syncSpaces config reading", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("reads target from .forge.json github.spacesTarget", () => {
    const root = makeProject(SUITE_TMP, { spacesTarget: "acme-org/plan-forge" });

    mock = createMockGh([
      { match: ["api", "/user/copilot/spaces"], stdout: JSON.stringify(SAMPLE_SPACES) + "\n" },
      { match: ["api", "/user/copilot/spaces/space-abc-123/files"], stdout: "[]\n" },
      { match: ["api", "-X", "PUT"], stdout: '{"ok":true}\n' },
    ]);

    const result = syncSpaces({
      projectRoot: root,    // no spaceRef passed — should read .forge.json
      ghCmd: "gh",
      env: mock.env,
    });
    expect(result.spaceRef).toBe("acme-org/plan-forge");
  });

  it("throws SpacesSyncError when no target specified anywhere", () => {
    const root = makeProject(SUITE_TMP, { withForgeJson: false });
    // Remove any .forge.json that may exist from other calls
    try { rmSync(join(root, ".forge.json")); } catch {}

    mock = createMockGh([]);
    expect(() =>
      syncSpaces({ projectRoot: root, ghCmd: "gh", env: mock.env })
    ).toThrow(SpacesSyncError);
  });
});

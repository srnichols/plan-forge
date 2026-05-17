/**
 * Tests for the Chat Customizations editor REST API (D5, v3.1.0).
 *
 * Tests the underlying syncInstructions behavior that the REST endpoints
 * expose — GET status, POST preview (dry-run), and POST sync (write).
 *
 * Covers:
 *   1.  GET /api/copilot-instructions — file absent: exists=false
 *   2.  GET /api/copilot-instructions — file present: exists=true, content returned
 *   3.  GET /api/copilot-instructions — sectionCount counts ## headings
 *   4.  POST /api/copilot-instructions/preview — returns dryRunContent without writing
 *   5.  POST /api/copilot-instructions/preview — noPrinciples flag respected
 *   6.  POST /api/copilot-instructions/preview — noProfile flag respected
 *   7.  POST /api/copilot-instructions/preview — noExtras flag respected
 *   8.  POST /api/copilot-instructions/sync — writes .github/copilot-instructions.md
 *   9.  POST /api/copilot-instructions/sync — changed=false when content unchanged
 *   10. POST /api/copilot-instructions/sync — changed=true after force=true
 *   11. POST /api/copilot-instructions/sync — noPrinciples omits section from written file
 *   12. POST /api/copilot-instructions/sync — sectionsCount correct in result
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { syncInstructions } from "../sync-instructions.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROFILE_CONTENT = `---
description: Test profile
applyTo: '**'
---

# My Test Project

Node.js 22, ESM, Vitest.
`;

const PRINCIPLES_CONTENT = `# Project Principles

1. **Architecture-First** — 5 questions before coding.
2. **TDD** — red-green-refactor.
`;

const FORGE_JSON = JSON.stringify({
  modelRouting: { default: "claude-sonnet-4.6" },
  maxParallelism: 4,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoot() {
  const root = join(tmpdir(), `pforge-d5-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function setupRoot(root, { profile = true, principles = true, forge = true } = {}) {
  const ghDir      = join(root, ".github");
  const instrDir   = join(ghDir, "instructions");
  const docsPlans  = join(root, "docs", "plans");

  mkdirSync(instrDir, { recursive: true });
  mkdirSync(docsPlans, { recursive: true });

  if (profile) {
    writeFileSync(join(instrDir, "project-profile.instructions.md"), PROFILE_CONTENT);
  }
  if (principles) {
    writeFileSync(join(docsPlans, "PROJECT-PRINCIPLES.md"), PRINCIPLES_CONTENT);
  }
  if (forge) {
    writeFileSync(join(root, ".forge.json"), FORGE_JSON);
  }
}

// Simulate what GET /api/copilot-instructions does
function getInstructionsStatus(root) {
  const filePath = join(root, ".github", "copilot-instructions.md");
  const exists = existsSync(filePath);
  let content = null, lastModified = null, byteSize = 0;
  if (exists) {
    content = readFileSync(filePath, "utf-8");
    const st = statSync(filePath);
    lastModified = st.mtimeMs;
    byteSize = st.size;
  }
  const sectionCount = content ? (content.match(/^##\s/gm) || []).length : 0;
  return { ok: true, exists, filePath, content, lastModified, byteSize, sectionCount };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let root;

beforeEach(() => { root = makeRoot(); });
afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* non-fatal */ } });

describe("GET /api/copilot-instructions (status)", () => {
  it("1. returns exists=false when file absent", () => {
    const r = getInstructionsStatus(root);
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(false);
    expect(r.content).toBeNull();
    expect(r.sectionCount).toBe(0);
  });

  it("2. returns exists=true and content when file present", () => {
    setupRoot(root);
    syncInstructions({ projectRoot: root });
    const r = getInstructionsStatus(root);
    expect(r.exists).toBe(true);
    expect(typeof r.content).toBe("string");
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.lastModified).toBeGreaterThan(0);
    expect(r.byteSize).toBeGreaterThan(0);
  });

  it("3. sectionCount counts ## headings in the generated file", () => {
    setupRoot(root);
    syncInstructions({ projectRoot: root });
    const r = getInstructionsStatus(root);
    // With profile + principles + forgeConfig — at least 3 sections
    expect(r.sectionCount).toBeGreaterThanOrEqual(3);
  });
});

describe("POST /api/copilot-instructions/preview (dry-run)", () => {
  it("4. returns dryRunContent without writing the file", () => {
    setupRoot(root);
    const result = syncInstructions({ projectRoot: root, dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRunMode).toBe(true);
    expect(typeof result.dryRunContent).toBe("string");
    expect(result.dryRunContent.length).toBeGreaterThan(0);
    // File should NOT be written
    expect(existsSync(join(root, ".github", "copilot-instructions.md"))).toBe(false);
  });

  it("5. noPrinciples flag omits Project Principles from preview", () => {
    setupRoot(root);
    const result = syncInstructions({ projectRoot: root, dryRun: true, noPrinciples: true });
    expect(result.ok).toBe(true);
    expect(result.dryRunContent).not.toContain("## Project Principles");
    expect(result.sections.principles).toBe(false);
  });

  it("6. noProfile flag omits Project Profile from preview", () => {
    setupRoot(root);
    const result = syncInstructions({ projectRoot: root, dryRun: true, noProfile: true });
    expect(result.ok).toBe(true);
    expect(result.dryRunContent).not.toContain("## Project Profile");
    expect(result.sections.profile).toBe(false);
  });

  it("7. noExtras flag is passed through — extraCount is 0", () => {
    // Add an extra instruction file
    const instrDir = join(root, ".github", "instructions");
    mkdirSync(instrDir, { recursive: true });
    writeFileSync(join(instrDir, "api-patterns.instructions.md"), "# API Patterns\n\nREST conventions.");
    setupRoot(root, { profile: false, principles: false, forge: false });

    const withExtras = syncInstructions({ projectRoot: root, dryRun: true });
    const withoutExtras = syncInstructions({ projectRoot: root, dryRun: true, noExtras: true });

    expect(withExtras.sections.extraCount).toBeGreaterThan(0);
    expect(withoutExtras.sections.extraCount).toBe(0);
  });
});

describe("POST /api/copilot-instructions/sync (write)", () => {
  it("8. writes .github/copilot-instructions.md", () => {
    setupRoot(root);
    const result = syncInstructions({ projectRoot: root });
    const outPath = join(root, ".github", "copilot-instructions.md");
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(existsSync(outPath)).toBe(true);
    const written = readFileSync(outPath, "utf-8");
    expect(written).toContain("# Copilot Instructions");
  });

  it("9. changed=false when content unchanged and force=false", () => {
    setupRoot(root);
    // First sync — writes the file
    syncInstructions({ projectRoot: root });
    // Second sync — same content, no force
    const result = syncInstructions({ projectRoot: root, force: false });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
  });

  it("10. changed=true when force=true even if content unchanged", () => {
    setupRoot(root);
    syncInstructions({ projectRoot: root });
    const result = syncInstructions({ projectRoot: root, force: true });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
  });

  it("11. noPrinciples — written file does not contain Project Principles section", () => {
    setupRoot(root);
    syncInstructions({ projectRoot: root, noPrinciples: true });
    const content = readFileSync(join(root, ".github", "copilot-instructions.md"), "utf-8");
    expect(content).not.toContain("## Project Principles");
  });

  it("12. sectionsCount in result matches number of ## headings in output", () => {
    setupRoot(root);
    const result = syncInstructions({ projectRoot: root });
    const content = readFileSync(join(root, ".github", "copilot-instructions.md"), "utf-8");
    const headingCount = (content.match(/^##\s/gm) || []).length;
    expect(result.sectionsCount).toBe(headingCount);
  });
});

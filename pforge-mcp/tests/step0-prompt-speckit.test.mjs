/**
 * Regression tests for Step 0 prompt's Spec Kit import surface.
 *
 * Phase CRUCIBLE-IMPORT-CLI Slice 6.
 *
 * Locks in the slash-command refactor decisions:
 *  1. `pforge crucible import` CLI shortcut is documented in the Spec Kit section.
 *  2. Four import options are offered (spec, plan, constitution, fresh).
 *  3. Crucible frontmatter requirement (v2.37) is documented.
 *  4. The `crucibleId` / `source: speckit` / `lane: full` fields are specified.
 *  5. The `[NEEDS CLARIFICATION]` marker pattern is explained.
 *  6. The XML `<specification>` output block is present.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(
  __dirname,
  "../../.github/prompts/step0-specify-feature.prompt.md"
);

const prompt = readFileSync(PROMPT_PATH, "utf-8");

// ─── 1. CLI shortcut ──────────────────────────────────────────────────────────

describe("step0 prompt — pforge crucible import CLI shortcut", () => {
  it("references 'pforge crucible import' in the Spec Kit section", () => {
    expect(prompt).toContain("pforge crucible import");
  });

  it("specifies the --from=spec-kit flag", () => {
    expect(prompt).toMatch(/pforge crucible import.*--from=spec-kit/);
  });
});

// ─── 2. Spec Kit import options ───────────────────────────────────────────────

describe("step0 prompt — Spec Kit import options", () => {
  it("offers an 'Import spec' option", () => {
    expect(prompt).toMatch(/Import spec/);
  });

  it("offers an 'Import plan' option", () => {
    expect(prompt).toMatch(/Import plan/);
  });

  it("offers an 'Import constitution' option", () => {
    expect(prompt).toMatch(/Import constitution/);
  });

  it("offers a 'Start fresh' option", () => {
    expect(prompt).toMatch(/Start fresh/);
  });

  it("checks for Spec Kit artifacts before asking questions", () => {
    expect(prompt).toMatch(/specs\//);
    expect(prompt).toMatch(/memory\/constitution\.md/);
  });
});

// ─── 3. Crucible frontmatter requirement ──────────────────────────────────────

describe("step0 prompt — Crucible frontmatter requirement (v2.37)", () => {
  it("documents the crucibleId frontmatter field", () => {
    expect(prompt).toMatch(/crucibleId/);
  });

  it("documents source: speckit", () => {
    expect(prompt).toMatch(/source: speckit/);
  });

  it("documents lane: full", () => {
    expect(prompt).toMatch(/lane: full/);
  });

  it("warns that missing frontmatter blocks execution", () => {
    expect(prompt).toMatch(/blocked|enforcement/i);
  });
});

// ─── 4. [NEEDS CLARIFICATION] marker pattern ──────────────────────────────────

describe("step0 prompt — [NEEDS CLARIFICATION] pattern", () => {
  it("uses [NEEDS CLARIFICATION] markers throughout", () => {
    expect(prompt).toMatch(/\[NEEDS CLARIFICATION/);
  });

  it("blocks on unresolved markers before Step 2", () => {
    expect(prompt).toMatch(/resolve.*NEEDS CLARIFICATION|NEEDS CLARIFICATION.*resolve/i);
  });
});

// ─── 5. XML specification output block ───────────────────────────────────────

describe("step0 prompt — XML output block", () => {
  it("includes a <specification> XML output example", () => {
    expect(prompt).toMatch(/<specification/);
  });

  it("includes <acceptance_criteria> in the XML block", () => {
    expect(prompt).toMatch(/<acceptance_criteria>/);
  });

  it("includes a complexity attribute in the <complexity> element", () => {
    expect(prompt).toMatch(/<complexity.*effort=/);
  });
});

// ─── 6. Spec Kit artifact scanning ───────────────────────────────────────────

describe("step0 prompt — artifact discovery", () => {
  it("documents all three Spec Kit artifact types", () => {
    expect(prompt).toMatch(/spec\.md/);
    expect(prompt).toMatch(/plan\.md/);
    expect(prompt).toMatch(/constitution\.md/);
  });

  it("instructs agent to scan before asking questions", () => {
    expect(prompt).toMatch(/Before asking any questions.*scan|scan.*before asking/i);
  });
});

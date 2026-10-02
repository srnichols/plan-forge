/**
 * #301 — preset quality gate.
 *
 * The php and rust presets once shipped Go content, then generated filler (#292);
 * a swift sample labelled bash was Ruby. scripts/audit/preset-quality.mjs fails on
 * those patterns. This suite keeps every shipped preset clean and proves each
 * rule fires.
 */

import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeBlocks, scanPresets } from "../../scripts/audit/preset-quality.mjs";

const SLOW_MS = 180_000;
const tmp = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "pf-preset-quality-"));
  tmp.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, "presets", rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

const BLOCK = "```js\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```\n";
const STEPS = "## Steps\n\n### 1. Run\n\nrun it\n";

describe("shipped presets", () => {
  it("have no preset-quality findings", async () => {
    const { presets, findings, samples } = await scanPresets();
    expect(presets.length).toBeGreaterThanOrEqual(9);
    expect(samples.shell).toBeGreaterThan(100);
    expect(findings.map((f) => `${f.rule} presets/${f.preset}/${f.file}:${f.line} ${f.detail}`)).toEqual([]);
  }, SLOW_MS);
});

describe("rules", () => {
  it("each rule fires, and the allowed cases do not", async () => {
    const root = fixture({
      "fake/.github/instructions/a.instructions.md": `# A\n\n- Use DI [3]\n\n## Done Criteria\n\n${BLOCK}`,
      "fake/.github/instructions/b.instructions.md": `# B\n\n${BLOCK}\nHandlers use net/http.\n\n\`\`\`bash\nif then fi\n\`\`\`\n\n\`\`\`bash\nnpx knex migrate:make <migration_name>\n\`\`\`\n`,
      "fake/.github/prompts/project-principles.prompt.md": "**Go**:\n- Forbidden: goroutine leaks\n",
      "fake/.github/skills/empty/SKILL.md": "---\nname: empty\n---\n\n# Empty\n\nJust prose.\n",
      "fake/.github/skills/ok/SKILL.md": `---\nname: ok\n---\n\n${STEPS}`,
      "go/.github/instructions/c.instructions.md": "Use net/http and slog.\n",
    });
    const { findings } = await scanPresets({ root });
    const got = findings.map((f) => `${f.preset} ${f.rule} ${f.file}:${f.line}`).sort();
    expect(got).toEqual([
      "fake duplicate-block .github/instructions/b.instructions.md:3",
      "fake filler .github/instructions/a.instructions.md:3",
      "fake filler .github/instructions/a.instructions.md:5",
      "fake shell-syntax .github/instructions/b.instructions.md:11",
      "fake skill-no-steps .github/skills/empty/SKILL.md:1",
      "fake wrong-stack .github/instructions/b.instructions.md:9",
    ]);
  }, SLOW_MS);
});

describe("codeBlocks", () => {
  it("returns each fenced block with its language and starting line", () => {
    expect(codeBlocks("intro\n\n```PHP title\n<?php echo 1;\n```\n\n```\nplain\n```\n")).toEqual([
      { lang: "php", body: "<?php echo 1;\n", line: 3 },
      { lang: "", body: "plain\n", line: 7 },
    ]);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Meta-bug #376 — `pforge analyze` scored test coverage differently in the two
 * shells. pforge.ps1 matches each MUST criterion to a test file; pforge.sh only
 * counted test files and MUST criteria, so any plan with at least one of each
 * scored 25/25. The same plan with an untested criterion scored 87/100 on
 * Windows and 100/100 on Linux and macOS, and the bash output never named the
 * criterion, so the CI run passed what the Windows run would have flagged.
 *
 * A criterion is tested when some test file contains at least two of its first
 * three words longer than four characters, case-insensitively. The score is
 * floor(25 * tested / MUST), or 15 when the plan has no MUST criteria.
 *
 * Meta-bug #387 — the checkbox fallback ("- [ ] item" lines under "## Acceptance
 * Criteria", read as MUST criteria when a plan has no MUST or SHOULD line) never
 * ran in pforge.ps1 when the first line under the heading was a checkbox, because
 * a regex pre-check that filled nothing decided to skip it. Both shells now read
 * those criteria, in the Traceability step as well as the Test Coverage step: bash
 * used to leave Traceability at 15 where PowerShell scored 25 for the same plan.
 *
 * Meta-bug #389 — Traceability scored 25/25 in both shells whatever the slices said. It now
 * counts a criterion only when a slice refers to it (meta-389-analyze-traceability.test.mjs),
 * so the reporter's example below, whose exporter criterion no slice mentions, scores 74/100
 * (it scored 87) and the checkbox cases with that criterion score 12 for Traceability.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";

const PLAN_REL = "docs/plans/Phase-9-PARITY-FIXTURE-PLAN.md";
const planWith = (criteria) => [
  "# Phase 9 — Parity Fixture", "", "## Acceptance Criteria", ...criteria, "",
  "### Slice 1 — Items endpoint", "", "**Validation Gate**:", "```bash", "npm test", "```", "",
].join("\n");

const ITEMS = "Items endpoint returns paginated results";
const EXPORTER = "Exporter streams enormous attachments";
const MUST = (text) => `- **MUST**: ${text}`;

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seedRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-376-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(dir, "pforge.ps1"));
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
  return dir;
}

const spawnOpts = (dir) => ({ cwd: dir, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" }, timeout: 180_000 });
const runSh = (dir) => spawnSync(BASH, ["pforge.sh", "analyze", PLAN_REL], spawnOpts(dir));
const runPs1 = (dir) => spawnSync(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "pforge.ps1"), "analyze", PLAN_REL],
  spawnOpts(dir),
);

/** The Test Coverage section, one line per entry with its status glyph removed. */
function testCoverage(result) {
  const text = `${result.stdout}`.replace(/\r/g, "");
  const section = /Test Coverage:\n([\s\S]*?)\n\s*\n/.exec(text)?.[1] ?? "";
  return section.split("\n").map((line) => line.replace(/^[^A-Za-z0-9]+/, "").trim()).filter(Boolean);
}
const testCoverageScore = (result) => Number(/- Test Coverage: (\d+)\/25/.exec(result.stdout)?.[1]);
const traceabilityScore = (result) => Number(/- Traceability: (\d+)\/25/.exec(result.stdout)?.[1]);
const consistencyScore = (result) => Number(/Consistency Score: (\d+)\/100/.exec(result.stdout)?.[1]);

const withItemsTest = { "tests/items.test.mjs": `// ${ITEMS}\n` };

// Each case: the plan's criteria, the project's files, and what the Test Coverage step must say.
const CASES = [
  {
    name: "one of two MUST criteria has a matching test",
    plan: planWith([MUST(ITEMS), MUST(EXPORTER)]),
    files: withItemsTest,
    lines: ["1/2 MUST criteria have matching tests", `No test found for: ${EXPORTER}`, "1 test file(s) found in project"],
    score: 12,
  },
  {
    name: "every MUST criterion has a matching test",
    plan: planWith([MUST(ITEMS), MUST(EXPORTER)]),
    files: { ...withItemsTest, "tests/exporter.test.mjs": `// ${EXPORTER}\n` },
    lines: ["2/2 MUST criteria have matching tests", "2 test file(s) found in project"],
    score: 25,
  },
  {
    name: "test files exist but none matches a criterion",
    plan: planWith([MUST(ITEMS), MUST(EXPORTER)]),
    files: { "tests/other.test.mjs": "// nothing relevant here\n" },
    lines: ["0/2 MUST criteria have matching tests", `No test found for: ${ITEMS}`, `No test found for: ${EXPORTER}`, "1 test file(s) found in project"],
    score: 0,
  },
  {
    name: "the plan has no MUST criteria",
    plan: planWith([]),
    files: withItemsTest,
    lines: ["No MUST criteria to trace (plan may use alternate format)", "1 test file(s) found in project"],
    score: 15,
  },
  {
    name: "checkbox criteria directly under the heading count as MUST (#387)",
    plan: planWith([`- [ ] ${ITEMS}`, `- [x] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["1/2 MUST criteria have matching tests", `No test found for: ${EXPORTER}`, "1 test file(s) found in project"],
    score: 12,
    trace: 12,
  },
  {
    name: "checkbox criteria after a line of prose count as MUST",
    plan: planWith(["", "Every item below must hold.", `- [ ] ${ITEMS}`, `- [x] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["1/2 MUST criteria have matching tests", `No test found for: ${EXPORTER}`, "1 test file(s) found in project"],
    score: 12,
    trace: 12,
  },
  {
    name: "checkbox criteria after blank lines, with an upper-case [X], count as MUST (#387)",
    plan: planWith(["", "", `- [X] ${ITEMS}`, `- [ ] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["1/2 MUST criteria have matching tests", `No test found for: ${EXPORTER}`, "1 test file(s) found in project"],
    score: 12,
    trace: 12,
  },
  {
    name: "checkbox criteria under a sub-heading of the section count as MUST (#387)",
    plan: planWith(["", "### Behaviour", `- [ ] ${ITEMS}`, `- [ ] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["1/2 MUST criteria have matching tests", `No test found for: ${EXPORTER}`, "1 test file(s) found in project"],
    score: 12,
    trace: 12,
  },
  {
    name: "checkboxes after the section ends are not criteria (#387)",
    plan: planWith([`- [ ] ${ITEMS}`, "", "---", "", `- [ ] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["1/1 MUST criteria have matching tests", "1 test file(s) found in project"],
    score: 25,
    trace: 25,
  },
  {
    name: "a MUST line wins over checkboxes in the same section (#387)",
    plan: planWith([MUST(ITEMS), `- [ ] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["1/1 MUST criteria have matching tests", "1 test file(s) found in project"],
    score: 25,
    trace: 25,
  },
  {
    name: "a SHOULD line leaves the checkboxes unread (#387)",
    plan: planWith([`- **SHOULD**: ${ITEMS}`, `- [ ] ${EXPORTER}`]),
    files: withItemsTest,
    lines: ["No MUST criteria to trace (plan may use alternate format)", "1 test file(s) found in project"],
    score: 15,
    trace: 25,
  },
  {
    name: "there are no test files at all",
    plan: planWith([MUST(ITEMS), MUST(EXPORTER)]),
    files: {},
    lines: ["0/2 MUST criteria have matching tests", `No test found for: ${ITEMS}`, `No test found for: ${EXPORTER}`, "No test files found"],
    score: 0,
  },
  {
    name: "a long criterion is cut at 70 characters",
    plan: planWith([MUST("Reconciliation jobs recover abandoned reservations after the scheduler restarts unexpectedly overnight")]),
    files: withItemsTest,
    lines: ["0/1 MUST criteria have matching tests", "No test found for: Reconciliation jobs recover abandoned reservations after the scheduler...", "1 test file(s) found in project"],
    score: 0,
  },
  {
    name: "one of the first three long words is not enough, and case does not matter",
    plan: planWith([MUST("Webhook signatures reject tampered payloads"), MUST("Cache invalidates expired sessions")]),
    files: { "tests/a.test.mjs": "// WEBHOOK handler\n", "tests/b.test.mjs": "// CACHE INVALIDATES everything\n" },
    lines: ["1/2 MUST criteria have matching tests", "No test found for: Webhook signatures reject tampered payloads", "2 test file(s) found in project"],
    score: 12,
  },
  {
    name: "words of four characters or fewer are not keywords",
    plan: planWith([MUST("Add the item to cart quickly with discounts")]),
    files: { "tests/a.test.mjs": "// add the item to cart\n" },
    lines: ["0/1 MUST criteria have matching tests", "No test found for: Add the item to cart quickly with discounts", "1 test file(s) found in project"],
    score: 0,
  },
  {
    name: "a test file anywhere under a test directory is read, whatever its name",
    plan: planWith([MUST(ITEMS)]),
    files: { "tests/fixtures/items-notes.txt": `${ITEMS}\n` },
    lines: ["1/1 MUST criteria have matching tests", "1 test file(s) found in project"],
    score: 25,
  },
];

describe.skipIf(!BASH)("pforge.sh analyze matches each MUST criterion to a test (#376)", () => {
  it.each(CASES)("$name", ({ plan, files, lines, score, trace }) => {
    const dir = seedRepo({ [PLAN_REL]: plan, ...files });
    const result = runSh(dir);
    expect(testCoverage(result), `${result.stdout}\n${result.stderr}`).toEqual(lines);
    expect(testCoverageScore(result)).toBe(score);
    if (trace !== undefined) expect(traceabilityScore(result), result.stdout).toBe(trace);
  });

  it("scores the reporter's example 74/100: Traceability (#389) and Test Coverage each lose the exporter criterion", () => {
    const dir = seedRepo({ [PLAN_REL]: planWith([MUST(ITEMS), MUST(EXPORTER)]), ...withItemsTest });
    const result = runSh(dir);
    expect(result.stdout).toMatch(/Consistency Score: 74\/100/);
  });
});

describe.skipIf(!BASH || !isWin)("pforge.sh and pforge.ps1 agree on the Test Coverage step and the scores (#376, #387)", () => {
  it.each(CASES)("$name", ({ plan, files }) => {
    const dir = seedRepo({ [PLAN_REL]: plan, ...files });
    const sh = runSh(dir);
    const ps1 = runPs1(dir);
    const both = `bash:\n${sh.stdout}\n\npowershell:\n${ps1.stdout}`;
    expect(testCoverage(sh), both).toEqual(testCoverage(ps1));
    expect(testCoverageScore(sh)).toBe(testCoverageScore(ps1));
    expect(traceabilityScore(sh), both).toBe(traceabilityScore(ps1));
    expect(consistencyScore(sh), both).toBe(consistencyScore(ps1));
  }, 400_000);
});

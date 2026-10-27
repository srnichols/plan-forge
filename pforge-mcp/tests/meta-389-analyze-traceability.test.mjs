import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Meta-bug #389 — `pforge analyze` scored "Traceability" 25/25 for every plan that
 * had acceptance criteria, whatever its slices said. pforge.ps1 tested each criterion
 * against the plan it was read from, so its first 40 characters were always there
 * (and any "Traces to:" anywhere in the plan counted every criterion as traced);
 * pforge.sh made no check at all: 25 * total / total.
 *
 * A criterion is traced when some slice refers to it. A slice runs from its
 * "## / ### / #### Slice N" heading to the next heading of the same or a higher
 * level, so the Acceptance Criteria section is never one. A slice refers to a
 * criterion when it contains one of the criterion's significant words: the distinct
 * words of more than four letters, digits or underscores, in any case. The words
 * are split at punctuation, so `getPricing(model)` yields getpricing and model.
 * The Test Coverage rule (two of the first three words, punctuation removed, so the
 * same identifier becomes getPricingmodel) was measured over the 36 plans in
 * docs/plans with criteria the scorer reads, and left 61% of their 785 criteria
 * untraced; this rule leaves 4.5% (35), each a criterion that shares no word with any
 * slice, and the two shells name the same ones for every plan.
 * A criterion with no significant word has nothing to judge by and counts as traced.
 * The score is floor(25 * traced / criteria).
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";

const ps1Source = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf8");
const shSource = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};

const ITEMS = "Items endpoint returns paginated results";
const EXPORTER = "Exporter streams enormous attachments";
const IMPORTER = "Importer rejects malformed archives";

const slice = (n, title, body = [], level = 3) => [`${"#".repeat(level)} Slice ${n} — ${title}`, "", ...body, ""];
const planOf = (blocks, { criteria = [], tail = [] } = {}) =>
  ["# Phase 9 — Fixture", "", "## Acceptance Criteria", ...criteria, "", "## Execution Slices", "", ...blocks.flat(), ...tail].join("\n");

// Each case: a plan, the criteria read from it, and the criteria no slice refers to.
const CASES = [
  {
    name: "names the criterion that no slice shares a word with",
    plan: planOf([slice(1, "Items endpoint")]),
    criteria: [ITEMS, EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "traces every criterion that shares a word with some slice",
    plan: planOf([slice(1, "Items endpoint"), slice(2, "Exporter")]),
    criteria: [ITEMS, EXPORTER],
    untraced: [],
  },
  {
    name: "reads the whole slice, not only its title",
    plan: planOf([slice(1, "Scaffold", ["1. Add the exporter and wire it in."])]),
    criteria: [EXPORTER],
    untraced: [],
  },
  {
    name: "does not count the Acceptance Criteria section as a slice",
    plan: planOf([slice(1, "Items endpoint")], { criteria: [`- **MUST**: ${EXPORTER}`] }),
    criteria: [EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "ends a slice at the next heading of its own level",
    plan: planOf([slice(1, "Items endpoint"), ["### Notes", "", "The exporter streams attachments.", ""]]),
    criteria: [EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "ends a slice at a heading of a higher level",
    plan: planOf([slice(1, "Items endpoint")], { tail: ["## Appendix", "", "The exporter streams attachments."] }),
    criteria: [EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "keeps deeper headings inside the slice",
    plan: planOf([slice(1, "Items endpoint", ["#### Tasks", "", "1. The exporter streams attachments."])]),
    criteria: [EXPORTER],
    untraced: [],
  },
  {
    name: "reads slice headings of level 2 and level 4 as well as level 3",
    plan: planOf([slice(1, "Items endpoint", [], 2), slice(2, "Exporter", [], 4)]),
    criteria: [ITEMS, EXPORTER],
    untraced: [],
  },
  {
    name: "does not read a level 1 heading as a slice, and it ends the slice before it",
    plan: planOf([slice(1, "Items endpoint"), ["# Slice 2 — Importer", "", "Rejects malformed archives.", ""]]),
    criteria: [ITEMS, IMPORTER],
    untraced: [IMPORTER],
  },
  {
    name: "needs a space after the hashes and a number after Slice",
    plan: planOf([["###Slice 1 — Exporter", "", "### Slice A — Importer", ""]]),
    criteria: [EXPORTER, IMPORTER],
    untraced: [EXPORTER, IMPORTER],
  },
  {
    name: "keeps a slice going past a # comment inside a code fence",
    plan: planOf([slice(1, "Items endpoint", ["```bash", "# check the build", "npm test", "```", "", "1. The exporter streams attachments."])]),
    criteria: [EXPORTER],
    untraced: [],
  },
  {
    name: "treats a ~~~ fence like a ``` fence",
    plan: planOf([slice(1, "Items endpoint", ["~~~", "## Notes", "~~~", "", "1. The exporter streams attachments."])]),
    criteria: [EXPORTER],
    untraced: [],
  },
  {
    name: "ends the slice at a heading once the fence has closed",
    plan: planOf([slice(1, "Items endpoint", ["```", "# a comment", "```", "", "## Notes", "", "The exporter streams attachments."])]),
    criteria: [EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "does not read a level 5 heading as a slice",
    plan: planOf([slice(1, "Items endpoint")], { tail: ["## Notes", "", "##### Slice 2 — Importer", "", "Rejects malformed archives."] }),
    criteria: [ITEMS, IMPORTER],
    untraced: [IMPORTER],
  },
  {
    name: "reads the headings the execution-slices count reads: Slice 1a is not one, Slice 2.1 is",
    plan: planOf([["### Slice 1a — Exporter", "", "Streams attachments.", ""], slice("2.1", "Importer")]),
    criteria: [EXPORTER, IMPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "matches without regard to case",
    plan: planOf([slice(1, "WEBHOOK handler", ["1. SIGNATURES are checked."])]),
    criteria: ["webhook signatures reject tampered payloads"],
    untraced: [],
  },
  {
    name: "splits identifiers at punctuation",
    plan: planOf([slice(1, "Add getPricing")]),
    criteria: ["`getPricing(model)` yields results"],
    untraced: [],
  },
  {
    name: "traces a criterion by any of its significant words, not only the first",
    plan: planOf([slice(1, "Handles streams")]),
    criteria: [EXPORTER],
    untraced: [],
  },
  {
    name: "matches a word as a substring of a longer one, as the Test Coverage step does",
    plan: planOf([slice(1, "Exporters")]),
    criteria: ["Exporter configuration"],
    untraced: [],
  },
  {
    name: "counts a criterion with no word longer than four characters as traced",
    plan: planOf([slice(1, "Items endpoint")]),
    criteria: ["Docs ok", "Add the item", EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "takes a word of five characters as significant and one of four as not",
    plan: planOf([slice(1, "Gate")]),
    criteria: ["Gates pass", "Gate pass"],
    untraced: ["Gates pass"],
  },
  {
    name: "traces nothing in a plan with no slices",
    plan: ["# Phase 9 — Fixture", "", "## Acceptance Criteria", `- **MUST**: ${ITEMS}`, ""].join("\n"),
    criteria: [ITEMS],
    untraced: [ITEMS],
  },
  {
    name: "reads Windows line endings",
    plan: planOf([slice(1, "Items endpoint")]).replace(/\n/g, "\r\n"),
    criteria: [ITEMS, EXPORTER],
    untraced: [EXPORTER],
  },
  {
    name: "traces a criterion written inside a slice by that slice",
    plan: planOf([slice(1, "Items endpoint", [`- **MUST**: ${EXPORTER}`])]),
    criteria: [EXPORTER],
    untraced: [],
  },
  {
    name: "lists the untraced criteria in the order given",
    plan: planOf([slice(1, "Items endpoint")]),
    criteria: [EXPORTER, ITEMS, IMPORTER],
    untraced: [EXPORTER, IMPORTER],
  },
];

// ─── helpers: the two implementations, read out of the shell scripts ─────────

function extractPsFunction(name) {
  const start = ps1Source.indexOf(`function ${name} {`);
  expect(start, `pforge.ps1 defines ${name}`).toBeGreaterThan(-1);
  return ps1Source.slice(start, ps1Source.indexOf("\n}\n", start) + 2);
}

function extractShFunction(name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m").exec(shSource);
  expect(match, `pforge.sh defines ${name}`).not.toBeNull();
  return match[0];
}

const posix = (path) => path.replace(/\\/g, "/");

/** Runs Get-AnalyzeSliceTexts and Get-UntracedCriteria over every case in one Windows PowerShell process. */
function runPowerShell(cases) {
  const dir = tempDir("pf-meta-389-ps-");
  const casesFile = join(dir, "cases.json");
  writeFileSync(casesFile, JSON.stringify(cases.map(({ plan, criteria }) => ({ plan, criteria }))));
  const driver = join(dir, "driver.ps1");
  writeFileSync(driver, [
    "$ErrorActionPreference = 'Stop'",
    extractPsFunction("Get-AnalyzeSliceTexts"),
    extractPsFunction("Get-UntracedCriteria"),
    `$cases = Get-Content -LiteralPath '${casesFile}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    "$out = @()",
    "foreach ($case in $cases) {",
    "  $texts = @(Get-AnalyzeSliceTexts $case.plan)",
    "  $untraced = @(Get-UntracedCriteria -Criteria @($case.criteria) -SliceTexts $texts)",
    "  $out += [pscustomobject]@{ untraced = @($untraced) }",
    "}",
    "ConvertTo-Json -InputObject @($out) -Depth 5 -Compress",
  ].join("\n"));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", driver], { encoding: "utf8", timeout: 120_000 });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).pop()).map((entry) => entry.untraced);
}

/** Runs analyze_untraced_criteria on one case. */
function runBash({ plan, criteria }) {
  const dir = tempDir("pf-meta-389-sh-");
  writeFileSync(join(dir, "criteria.txt"), `${criteria.join("\n")}\n`);
  writeFileSync(join(dir, "plan.md"), plan);
  writeFileSync(join(dir, "driver.sh"), `${extractShFunction("analyze_untraced_criteria")}\nanalyze_untraced_criteria "$1" < "$2"\n`);
  const result = spawnSync(BASH, [posix(join(dir, "driver.sh")), posix(join(dir, "criteria.txt")), posix(join(dir, "plan.md"))], { encoding: "utf8", timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.split("\n").filter(Boolean);
}

describe.skipIf(!isWin)("pforge.ps1 traces each acceptance criterion to a slice (#389)", () => {
  it("answers every case", () => {
    const answers = runPowerShell(CASES);
    expect(answers).toHaveLength(CASES.length);
    CASES.forEach(({ name, untraced }, index) => {
      expect(answers[index], name).toEqual(untraced);
    });
  }, 180_000);
});

describe.skipIf(!BASH)("pforge.sh traces each acceptance criterion to a slice (#389)", () => {
  it.each(CASES)("$name", (testCase) => {
    expect(runBash(testCase)).toEqual(testCase.untraced);
  });
});

// ─── analyze, end to end ─────────────────────────────────────────────────────

const PLAN_REL = "docs/plans/Phase-9-TRACE-389-PLAN.md";
const MUST = (text) => `- **MUST**: ${text}`;
const SHOULD = (text) => `- **SHOULD**: ${text}`;
const GATE = ["**Validation Gate**:", "```bash", "npm test", "```"];
const withItemsTest = { "tests/items.test.mjs": `// ${ITEMS}\n` };

const planWithSlices = (criteria, ...titles) =>
  ["# Phase 9 — Trace Fixture", "", "## Acceptance Criteria", ...criteria, "", ...titles.flatMap((title, i) => slice(i + 1, title, GATE))].join("\n");

const E2E = [
  {
    name: "the reporter's example: one of two criteria is traced",
    plan: planWithSlices([MUST(ITEMS), MUST(EXPORTER)], "Items endpoint"),
    lines: ["1/2 acceptance criteria traced to a slice", `No slice mentions: ${EXPORTER}`],
    trace: 12,
  },
  {
    name: "every criterion is traced",
    plan: planWithSlices([MUST(ITEMS), MUST(EXPORTER)], "Items endpoint", "Exporter"),
    lines: ["2/2 acceptance criteria traced to a slice"],
    trace: 25,
  },
  {
    name: "no criterion is traced",
    plan: planWithSlices([MUST(ITEMS), MUST(EXPORTER)], "Scheduler"),
    lines: ["0/2 acceptance criteria traced to a slice", `No slice mentions: ${ITEMS}`, `No slice mentions: ${EXPORTER}`],
    trace: 0,
  },
  {
    name: "SHOULD criteria are traced like MUST criteria, MUST first",
    plan: planWithSlices([SHOULD(EXPORTER), MUST(ITEMS), SHOULD(IMPORTER)], "Importer"),
    lines: ["1/3 acceptance criteria traced to a slice", `No slice mentions: ${ITEMS}`, `No slice mentions: ${EXPORTER}`],
    trace: 8,
  },
  {
    name: "a plan with SHOULD criteria reads those and leaves its checkboxes alone",
    plan: planWithSlices([SHOULD(ITEMS), `- [ ] ${IMPORTER}`], "Items endpoint"),
    lines: ["1/1 acceptance criteria traced to a slice"],
    trace: 25,
  },
  {
    name: "a marker in another case is not a criterion, so there is nothing to judge",
    plan: planWithSlices([`- **Must**: ${ITEMS}`], "Items endpoint"),
    lines: [],
    trace: 15,
  },
  {
    name: "a marker in another case beside one in capitals is left out of the count",
    plan: planWithSlices([MUST(ITEMS), `- **Must**: ${EXPORTER}`, `- **should**: ${IMPORTER}`], "Items endpoint"),
    lines: ["1/1 acceptance criteria traced to a slice"],
    trace: 25,
  },
  {
    name: "reads Windows line endings",
    plan: planWithSlices([MUST(ITEMS), SHOULD(EXPORTER)], "Items endpoint").replace(/\n/g, "\r\n"),
    lines: ["1/2 acceptance criteria traced to a slice", `No slice mentions: ${EXPORTER}`],
    trace: 12,
  },
  {
    name: "checkbox criteria are traced like MUST criteria (#387)",
    plan: planWithSlices([`- [ ] ${ITEMS}`, `- [x] ${EXPORTER}`], "Items endpoint"),
    lines: ["1/2 acceptance criteria traced to a slice", `No slice mentions: ${EXPORTER}`],
    trace: 12,
  },
  {
    name: "a plan with criteria and no slice traces nothing",
    plan: ["# Phase 9 — Trace Fixture", "", "## Acceptance Criteria", MUST(ITEMS), ""].join("\n"),
    lines: ["0/1 acceptance criteria traced to a slice", `No slice mentions: ${ITEMS}`],
    trace: 0,
  },
  {
    name: "a long criterion is cut at 70 characters",
    plan: planWithSlices([MUST("Reconciliation jobs recover abandoned reservations after the scheduler restarts unexpectedly overnight")], "Items endpoint"),
    lines: ["0/1 acceptance criteria traced to a slice", "No slice mentions: Reconciliation jobs recover abandoned reservations after the scheduler..."],
    trace: 0,
  },
  // #407: pforge.ps1 read the pattern after the marker as [:\s]+, which crosses a newline, so a marker with
  // nothing after its colon took the next line as its text.
  {
    name: "a marker line with no text is not a criterion, and the line below it is not its text (#407)",
    plan: planWithSlices(["- **MUST**:", `  - ${ITEMS}`], "Items endpoint"),
    lines: [],
    trace: 15,
  },
  {
    name: "a marker with no text does not take the SHOULD line below it as its text (#407)",
    plan: planWithSlices(["- **MUST**:", SHOULD(ITEMS)], "Items endpoint"),
    lines: ["1/1 acceptance criteria traced to a slice"],
    trace: 25,
  },
  // #408: pforge.sh has always credited "slices defined" (CLI-GUIDE: "criteria exist, slices defined, criteria
  // mapped to slices") with a floor of 10 when there is nothing to trace; pforge.ps1 gave such a plan 0.
  {
    name: "a plan with slices and no criteria earns the floor for slices defined (#408)",
    plan: ["# Phase 9 — Trace Fixture", "", "## Scope", "", "Some prose.", "", "## Execution Slices", "", ...slice(1, "Items endpoint", GATE)].join("\n"),
    lines: [],
    trace: 10,
  },
];

function seedRepo(files) {
  const dir = tempDir("pf-meta-389-");
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

/** The lines the Traceability step adds for this rule, status glyph removed. */
function traceLines(result) {
  const text = `${result.stdout}`.replace(/\r/g, "");
  const section = /Traceability:\n([\s\S]*?)\n\s*\n/.exec(text)?.[1] ?? "";
  return section.split("\n").map((line) => line.replace(/^[^A-Za-z0-9]+/, "").trim()).filter((line) => /acceptance criteria traced to a slice$|^No slice mentions:/.test(line));
}
const scoreOf = (label) => (result) => Number(new RegExp(`- ${label}: (\\d+)/25`).exec(result.stdout)?.[1]);
const traceabilityScore = scoreOf("Traceability");
const consistencyScore = (result) => Number(/Consistency Score: (\d+)\/100/.exec(result.stdout)?.[1]);

describe.skipIf(!BASH)("pforge.sh analyze scores Traceability by slices (#389)", () => {
  it.each(E2E)("$name", ({ plan, lines, trace }) => {
    const result = runSh(seedRepo({ [PLAN_REL]: plan, ...withItemsTest }));
    expect(traceLines(result), `${result.stdout}\n${result.stderr}`).toEqual(lines);
    expect(traceabilityScore(result)).toBe(trace);
  }, 180_000);

  it("scores the reporter's example 74/100, where it was 87", () => {
    const result = runSh(seedRepo({ [PLAN_REL]: E2E[0].plan, ...withItemsTest }));
    expect(consistencyScore(result)).toBe(74);
  }, 180_000);
});

describe.skipIf(!isWin)("pforge.ps1 analyze scores Traceability by slices (#389)", () => {
  it.each(E2E)("$name", ({ plan, lines, trace }) => {
    const result = runPs1(seedRepo({ [PLAN_REL]: plan, ...withItemsTest }));
    expect(traceLines(result), `${result.stdout}\n${result.stderr}`).toEqual(lines);
    expect(traceabilityScore(result)).toBe(trace);
  }, 180_000);

  it("scores the reporter's example 74/100, where it was 87", () => {
    const result = runPs1(seedRepo({ [PLAN_REL]: E2E[0].plan, ...withItemsTest }));
    expect(consistencyScore(result)).toBe(74);
  }, 180_000);
});

describe.skipIf(!BASH || !isWin)("pforge.sh and pforge.ps1 agree on Traceability (#389)", () => {
  it.each(E2E)("$name", ({ plan }) => {
    const dir = seedRepo({ [PLAN_REL]: plan, ...withItemsTest });
    const sh = runSh(dir);
    const ps1 = runPs1(dir);
    const both = `bash:\n${sh.stdout}\n\npowershell:\n${ps1.stdout}`;
    expect(traceLines(sh), both).toEqual(traceLines(ps1));
    expect(traceabilityScore(sh), both).toBe(traceabilityScore(ps1));
    expect(consistencyScore(sh), both).toBe(consistencyScore(ps1));
  }, 400_000);
});

describe("Guard: neither shell searches a criterion in the plan it came from (#389)", () => {
  it("pforge.ps1 no longer lets any Traces to: in the plan trace every criterion", () => {
    expect(ps1Source).not.toMatch(/-match\s+'Traces to:'/);
    expect(ps1Source).not.toContain("$planContent -match [regex]::Escape($shortCriterion)");
  });

  it("pforge.ps1 scores traced criteria through Get-UntracedCriteria", () => {
    expect(ps1Source).toContain("Get-UntracedCriteria -Criteria $allCriteria");
  });

  it("pforge.sh no longer scores traceability as total over total", () => {
    expect(shSource).not.toMatch(/25 \* total_criteria \/ total_criteria/);
  });

  it("pforge.sh scores traced criteria through analyze_untraced_criteria", () => {
    expect(shSource).toContain("analyze_untraced_criteria");
  });
});

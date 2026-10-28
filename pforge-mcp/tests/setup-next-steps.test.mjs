/**
 * The closing "Next steps" of setup.ps1 and setup.sh point only at files the project has.
 *
 * Both installers printed the same nine steps and three prompt pointers for every preset. The `custom`
 * preset installs shared files only, so it has no AGENTS.md and no .github/prompts, agents or skills, and
 * seven of the twelve pointers sent the reader to files that were never created. Each pointer now names the
 * path it depends on and is printed only when that path exists in the project.
 *
 * The helpers are read out of the two scripts and run on their own, because running either installer takes
 * minutes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";
const POWERSHELL = isWin ? "powershell.exe" : (spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0 ? "pwsh" : null);

const ps1Source = readFileSync(join(REPO_ROOT, "setup.ps1"), "utf8");
const shSource = readFileSync(join(REPO_ROOT, "setup.sh"), "utf8");

const PS_HELPERS = ["Select-ExistingPointers", "Get-SetupNextSteps", "Get-SetupOptionalSteps"];
const SH_HELPERS = ["pf_existing_pointers", "pf_setup_next_steps", "pf_setup_optional_steps"];

// Every path a pointer depends on. A printed line must not name one the project lacks.
const TARGETS = [
  ".github/copilot-instructions.md",
  "AGENTS.md",
  ".vscode/settings.json",
  ".github/prompts",
  ".github/agents",
  ".github/skills",
  "docs/plans/DEPLOYMENT-ROADMAP.md",
  "docs/COPILOT-VSCODE-GUIDE.md",
  "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md",
  ".github/prompts/project-profile.prompt.md",
  ".github/prompts/project-principles.prompt.md",
  ".github/prompts/step0-specify-feature.prompt.md",
];

// What `setup.ps1 -Preset custom` leaves in a project (checked by running it), and what a preset with the agentic files adds.
const CUSTOM_FILES = [
  ".github/copilot-instructions.md",
  ".github/instructions/architecture-principles.instructions.md",
  ".vscode/mcp.json",
  ".vscode/settings.json",
  "docs/COPILOT-VSCODE-GUIDE.md",
  "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md",
  "docs/plans/DEPLOYMENT-ROADMAP.md",
  "pforge.ps1",
];
const PROJECTS = {
  custom: CUSTOM_FILES,
  full: [
    ...CUSTOM_FILES,
    "AGENTS.md",
    ".github/prompts/project-profile.prompt.md",
    ".github/prompts/project-principles.prompt.md",
    ".github/prompts/step0-specify-feature.prompt.md",
    ".github/agents/architecture-reviewer.agent.md",
    ".github/skills/test-sweep/SKILL.md",
  ],
  empty: [],
  onlyAgentsFile: ["AGENTS.md"],
  onlyOnePrompt: [".github/prompts/step0-specify-feature.prompt.md"],
};

let root;
const dirs = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pf-next-steps-"));
  for (const [key, files] of Object.entries(PROJECTS)) {
    dirs[key] = join(root, key);
    mkdirSync(dirs[key], { recursive: true });
    for (const file of files) {
      mkdirSync(dirname(join(dirs[key], file)), { recursive: true });
      writeFileSync(join(dirs[key], file), "x\n");
    }
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

// ─── the helpers, read out of the two scripts ────────────────────────────────

function extractPsFunction(name) {
  const start = ps1Source.indexOf(`function ${name}(`);
  expect(start, `setup.ps1 defines ${name}`).toBeGreaterThan(-1);
  return ps1Source.slice(start, ps1Source.indexOf("\n}\n", start) + 3);
}

function extractShFunction(name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m").exec(shSource);
  expect(match, `setup.sh defines ${name}`).not.toBeNull();
  return match[0];
}

const posix = (path) => path.replace(/\\/g, "/");

/** Runs the helpers over every project in one PowerShell process. */
function runPowerShell() {
  const resultFile = join(root, "ps-result.json");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    ...PS_HELPERS.map(extractPsFunction),
    "$out = [ordered]@{}",
    ...Object.entries(dirs).map(([key, dir]) => `$out['${key}'] = [ordered]@{ next = @(Get-SetupNextSteps '${dir}'); optional = @(Get-SetupOptionalSteps '${dir}') }`),
    `[System.IO.File]::WriteAllText('${resultFile}', (ConvertTo-Json -InputObject $out -Depth 5 -Compress), (New-Object System.Text.UTF8Encoding $false))`,
  ].join("\n");
  const driver = join(root, "driver.ps1");
  writeFileSync(driver, `\uFEFF${script}\n`);
  const args = ["-NoProfile", "-NonInteractive", ...(isWin ? ["-ExecutionPolicy", "Bypass"] : []), "-File", driver];
  const result = spawnSync(POWERSHELL, args, { encoding: "utf8", timeout: 120_000 });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(readFileSync(resultFile, "utf8"));
}

/** Runs the helpers over every project in one bash process, under the options setup.sh runs with. */
function runBash() {
  const script = [
    "set -euo pipefail",
    ...SH_HELPERS.map(extractShFunction),
    'while [[ $# -gt 0 ]]; do',
    '  echo "== $1"; echo "[next]"; pf_setup_next_steps "$2"; echo "[optional]"; pf_setup_optional_steps "$2"',
    "  shift 2",
    "done",
  ].join("\n");
  const driver = join(root, "driver.sh");
  writeFileSync(driver, `${script}\n`);
  const args = [posix(driver), ...Object.entries(dirs).flatMap(([key, dir]) => [key, posix(dir)])];
  const result = spawnSync(BASH, args, { encoding: "utf8", timeout: 120_000 });
  expect(result.status, result.stderr).toBe(0);

  const out = {};
  let list;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("== ")) out[line.slice(3)] = { next: [], optional: [] };
    else if (line === "[next]") list = out[Object.keys(out).at(-1)].next;
    else if (line === "[optional]") list = out[Object.keys(out).at(-1)].optional;
    else if (line) list.push(line);
  }
  return out;
}

const IMPLEMENTATIONS = [
  { name: "setup.ps1", available: Boolean(POWERSHELL), run: runPowerShell },
  { name: "setup.sh", available: Boolean(BASH), run: runBash },
].filter(({ available }) => available);

// Each installer's helpers run once, in the first test that needs them.
const SLOW = 180_000;
const outcomes = new Map();
const resultsOf = ({ name, run }) => {
  if (!outcomes.has(name)) outcomes.set(name, run());
  return outcomes.get(name);
};

// ─── the contract ────────────────────────────────────────────────────────────

const named = (line) => TARGETS.filter((target) => line.includes(target));

describe.each(IMPLEMENTATIONS)("$name closing steps", (implementation) => {
  it("points a custom install only at the files it has", () => {
    const { custom } = resultsOf(implementation);
    expect(custom.next).toHaveLength(5);
    expect(custom.optional).toHaveLength(0);
    expect(custom.next.join("\n")).not.toMatch(/AGENTS\.md|\.github\/(prompts|agents|skills)/);
  }, SLOW);

  it("lists every step when the agentic files are there", () => {
    const { full } = resultsOf(implementation);
    expect(full.next).toHaveLength(9);
    expect(full.optional).toHaveLength(3);
  }, SLOW);

  it("lists nothing for a project with none of the files", () => {
    expect(resultsOf(implementation).empty).toEqual({ next: [], optional: [] });
  }, SLOW);

  it("numbers the steps from 1 with no gaps, whichever are left", () => {
    const results = resultsOf(implementation);
    for (const key of ["custom", "full", "onlyAgentsFile", "onlyOnePrompt"]) {
      results[key].next.forEach((line, index) => {
        expect(line.trim().startsWith(`${index + 1}. `), `${key}: ${line}`).toBe(true);
      });
    }
  }, SLOW);

  it("prints a prompt pointer only for a prompt that exists", () => {
    const { onlyOnePrompt } = resultsOf(implementation);
    expect(onlyOnePrompt.optional).toHaveLength(1);
    expect(onlyOnePrompt.optional[0]).toContain("step0-specify-feature.prompt.md");
    expect(onlyOnePrompt.next).toHaveLength(1);
  }, SLOW);

  it("never names a file the project lacks", () => {
    for (const [key, { next, optional }] of Object.entries(resultsOf(implementation))) {
      for (const line of [...next, ...optional]) {
        for (const target of named(line)) {
          expect(existsSync(join(dirs[key], target)), `${key}: "${line.trim()}" names ${target}`).toBe(true);
        }
      }
    }
  }, SLOW);
});

describe.skipIf(IMPLEMENTATIONS.length < 2)("setup.ps1 and setup.sh", () => {
  it("print the same lines for every project", () => {
    const [first, second] = IMPLEMENTATIONS.map(resultsOf);
    expect(second).toEqual(first);
  }, SLOW);
});

// ─── the closing block uses them ─────────────────────────────────────────────

describe("the closing block of each installer", () => {
  const closing = (source) => {
    const at = source.indexOf("Setup Complete!");
    expect(at, "the Setup Complete banner").toBeGreaterThan(-1);
    return source.slice(at);
  };

  it("setup.ps1 prints what the helpers return, not a fixed list", () => {
    const block = closing(ps1Source);
    expect(block).toContain("Get-SetupNextSteps $ProjectPath");
    expect(block).toContain("Get-SetupOptionalSteps $ProjectPath");
    expect(block).not.toMatch(/Review AGENTS\.md|Review \.github\/(prompts|agents|skills)/);
  });

  it("setup.sh prints what the helpers return, not a fixed list", () => {
    const block = closing(shSource);
    expect(block).toContain('pf_setup_next_steps "$PROJECT_PATH"');
    expect(block).toContain('pf_setup_optional_steps "$PROJECT_PATH"');
    expect(block).not.toMatch(/Review AGENTS\.md|Review \.github\/(prompts|agents|skills)/);
  });

  it.each([["setup.ps1", ps1Source], ["setup.sh", shSource]])("%s still ends with the Crucible and GitHub pointers", (_name, source) => {
    const block = closing(source);
    expect(block).toContain("forge_crucible_submit");
    expect(block).toContain("pforge github status");
  });
});

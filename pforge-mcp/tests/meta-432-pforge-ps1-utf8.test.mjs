/**
 * Meta-bug #432 — pforge.ps1 wrote its text in the system code page under Windows PowerShell 5.1.
 *
 * Eleven of its file writes were Set-Content or Add-Content with no -Encoding, which in 5.1 is the system code page: an
 * em dash became byte 0x97 and an arrow or an emoji became "?" in the plan file `new-phase` writes, the roadmap, the
 * .gitignore block and docs/plans/auto/README.md. Five more passed -Encoding UTF8, which in 5.1 adds a byte order mark:
 * `version-bump` put one at the start of VERSION and package.json, `config set` at the start of .forge.json, and
 * `migrate-memory` at the start of a JSONL ledger, which Node's JSON.parse rejects. PowerShell 7 writes UTF-8 without a
 * BOM for all of them, so a pass there says nothing.
 *
 * pforge.ps1 now writes through Write-Utf8File and Add-Utf8Content, the two functions setup.ps1 has (#417), and reads
 * every file as UTF-8, so a file read and written back keeps its text. These run the commands that write the files, in
 * every PowerShell the machine has, and read the bytes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { codeOnly, extractPsFunction } from "./helpers/powershell-source.mjs";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const pforgeBytes = readFileSync(join(REPO_ROOT, "pforge.ps1"));
const pforgeSource = pforgeBytes.toString("utf8").replace(/^\uFEFF/, "");
const setupSource = readFileSync(join(REPO_ROOT, "setup.ps1"), "utf8").replace(/^\uFEFF/, "");

const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const SHELLS = [
  { name: "pwsh", exe: "pwsh", available: PWSH_OK },
  { name: "Windows PowerShell 5.1", exe: "powershell.exe", available: isWin },
].filter((shell) => shell.available);

const DASH = "\u2014";
const ARROW = "\u2192";
const CLIPBOARD = "\u{1F4CB}";
const CHECK = "\u2705";
const CAFE = `Caf\u00e9 ${DASH} Demo`;

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

function gitProject(root, files) {
  mkdirSync(root, { recursive: true });
  writeTree(root, files);
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(root, "pforge.ps1"));
  return root;
}

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-432-"));
  tmpDirs.push(dir);
  return gitProject(dir, files);
}

const run = (exe, dir, ...args) =>
  spawnSync(exe, ["-NoProfile", "-NonInteractive", ...(exe === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : []), "-File", join(dir, "pforge.ps1"), ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 240_000,
  });
const outputOf = (result) => `${result.stdout}${result.stderr}`;

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** A file a command wrote, read strictly: the system code page, or a byte order mark, fails here and says what the bytes were. */
function written(dir, rel) {
  const bytes = readFileSync(join(dir, rel));
  expect([...bytes.subarray(0, 3)], `${rel} must not start with a byte order mark`).not.toEqual([0xef, 0xbb, 0xbf]);
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new Error(`${rel} is not valid UTF-8; it holds ${[...bytes.subarray(0, 80)].map((byte) => byte.toString(16)).join(" ")} ...`);
  }
}

// ─── what the script says about how it reads and writes ──────────────────────

describe("pforge.ps1 reads and writes text as UTF-8 without a byte order mark", () => {
  const code = codeOnly(pforgeSource);
  const helpers = ["Write-Utf8File", "Add-Utf8Content"];
  const outsideHelpers = codeOnly(helpers.reduce((source, name) => source.replace(extractPsFunction(source, name), ""), pforgeSource)).split("\n");

  it("starts with a UTF-8 byte order mark, which is how Windows PowerShell 5.1 knows the file is not in the system code page", () => {
    expect([...pforgeBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it.each(helpers)("has %s, written as it is in setup.ps1", (name) => {
    const text = extractPsFunction(pforgeSource, name);
    expect(text, `pforge.ps1 defines ${name}`).not.toBe("");
    expect(text).toBe(extractPsFunction(setupSource, name));
  });

  it("writes project text through Write-Utf8File and Add-Utf8Content, and only a pid file (ASCII) and the temporary scripts it runs with node by other means", () => {
    const offenders = outsideHelpers.filter((line) => /\b(Set-Content|Add-Content|Out-File|Tee-Object)\b|\s>>?\s*[$"']/.test(line));
    const allowed = (line) => /-Encoding\s+ASCII\b/.test(line) || /Set-Content\s+-Path\s+\$tmpFile2?\s+-Value\s+\$\w+Script\s+-Encoding\s+UTF8\s*$/.test(line.trim());
    expect(offenders.filter((line) => !allowed(line)).map((line) => line.trim())).toEqual([]);
  });

  it("reads every file as UTF-8: the Get-Content default is set before any is used, on a copy of the caller's defaults", () => {
    const copy = pforgeSource.search(/\$PSDefaultParameterValues\s*=\s*@\{\}\s*\+\s*\$PSDefaultParameterValues/);
    const encoding = pforgeSource.search(/\$PSDefaultParameterValues\['Get-Content:Encoding'\]\s*=\s*'UTF8'/);
    expect(copy, "copies the caller's $PSDefaultParameterValues").toBeGreaterThan(-1);
    expect(encoding, "sets the Get-Content encoding").toBeGreaterThan(copy);
    expect(code.search(/\bGet-Content\b/), "uses Get-Content").toBeGreaterThan(-1);
    expect(pforgeSource.slice(0, encoding).split("\n").length, "the default is set near the top, before any function reads").toBeLessThan(60);
    const overrides = code.split("\n").filter((line) => /\bGet-Content\b/.test(line) && /-Encoding\s+(?!UTF8\b)\w+/i.test(line));
    expect(overrides.map((line) => line.trim())).toEqual([]);
  });
});

// ─── the commands that write files, run in every PowerShell the machine has ──

describe.each(SHELLS)("pforge.ps1 under $name writes the files its commands create", ({ exe }) => {
  it("new-phase writes the plan file and the roadmap with their dashes, arrows and emoji", () => {
    const dir = project({ "docs/plans/DEPLOYMENT-ROADMAP.md": `# Roadmap ${DASH} Plan Forge\n\n## Active Phases\n\n## Completed Phases\n\n- Phase 0 ${ARROW} done ${CHECK}\n` });
    const result = run(exe, dir, "new-phase", "Demo");
    expect(result.status, outputOf(result)).toBe(0);

    const plan = written(dir, "docs/plans/Phase-1-DEMO-PLAN.md");
    expect(plan).toContain(`**Status**: ${CLIPBOARD} Planned`);
    expect(plan).toContain(`${ARROW} Phase 1`);
    expect(plan).toContain(`Plan Hardening ${DASH} Step 2`);

    const roadmap = written(dir, "docs/plans/DEPLOYMENT-ROADMAP.md");
    expect(roadmap, "text that was already there survives being read and written back").toContain(`# Roadmap ${DASH} Plan Forge`);
    expect(roadmap).toContain(`- Phase 0 ${ARROW} done ${CHECK}`);
    expect(roadmap).toContain("### Phase 1: Demo");
    expect(roadmap).toContain(`**Status**: ${CLIPBOARD} Planned`);
  }, 300_000);

  it("phase-status writes the roadmap with the new status", () => {
    const dir = project({
      "docs/plans/DEPLOYMENT-ROADMAP.md": `# Roadmap ${DASH} Plan Forge\n\n### Phase 1: Demo ${DASH} thing\n**Goal**: g\n**Plan**: [Phase-1-DEMO-PLAN.md](./Phase-1-DEMO-PLAN.md)\n**Status**: ${CLIPBOARD} Planned\n\n## Completed Phases\n`,
    });
    const result = run(exe, dir, "phase-status", "docs/plans/Phase-1-DEMO-PLAN.md", "complete");
    expect(result.status, outputOf(result)).toBe(0);
    const roadmap = written(dir, "docs/plans/DEPLOYMENT-ROADMAP.md");
    expect(roadmap).toContain(`**Status**: ${CHECK} Complete`);
    expect(roadmap).toContain(`### Phase 1: Demo ${DASH} thing`);
    expect(roadmap).toContain(`# Roadmap ${DASH} Plan Forge`);
  }, 300_000);

  it("ext install merges .vscode/mcp.json and writes extensions.json, and ext remove writes it again", () => {
    const dir = project({
      ".vscode/mcp.json": JSON.stringify({ servers: { existing: { command: "node", description: `Caf\u00e9 ${DASH} existing` } } }, null, 2),
      "ext-src/extension.json": JSON.stringify({ name: "demo-ext", version: "1.0.0", description: "D\u00e9mo", files: { mcp: "mcp.json" } }),
      "ext-src/mcp.json": JSON.stringify({ servers: { demo: { command: "node", description: `D\u00e9mo ${DASH} server` } } }),
    });
    const install = run(exe, dir, "ext", "install", "ext-src");
    expect(install.status, outputOf(install)).toBe(0);
    const mcp = JSON.parse(written(dir, ".vscode/mcp.json"));
    expect(mcp.servers.existing.description).toBe(`Caf\u00e9 ${DASH} existing`);
    expect(mcp.servers.demo.description).toBe(`D\u00e9mo ${DASH} server`);
    expect(JSON.parse(written(dir, ".forge/extensions/extensions.json")).extensions.map((entry) => entry.name)).toEqual(["demo-ext"]);

    const remove = run(exe, dir, "ext", "remove", "demo-ext", "--force");
    expect(remove.status, outputOf(remove)).toBe(0);
    expect(JSON.parse(written(dir, ".forge/extensions/extensions.json")).extensions).toEqual([]);
  }, 300_000);

  it("config set writes .forge.json with no byte order mark and the project's name intact", () => {
    const dir = project({ ".forge.json": JSON.stringify({ projectName: CAFE, updateSource: "auto" }, null, 2) });
    const result = run(exe, dir, "config", "set", "update-source", "github-tags");
    expect(result.status, outputOf(result)).toBe(0);
    expect(JSON.parse(written(dir, ".forge.json"))).toEqual({ projectName: CAFE, updateSource: "github-tags" });
  }, 300_000);

  it("version-bump writes VERSION as the version and nothing else, and package.json that JSON.parse accepts", () => {
    const dir = project({
      VERSION: "3.0.0",
      "package.json": JSON.stringify({ name: "demo", version: "3.0.0" }, null, 2),
      "docs/index.html": "<p>Dogfooded \u00b7 v3.0.0</p>\n",
    });
    const result = run(exe, dir, "version-bump", "3.1.4");
    expect(result.status, outputOf(result)).toBe(0);
    expect(readFileSync(join(dir, "VERSION")), "VERSION holds the version only").toEqual(Buffer.from("3.1.4"));
    expect(JSON.parse(written(dir, "package.json")).version).toBe("3.1.4");
    expect(written(dir, "docs/index.html")).toContain("Dogfooded \u00b7 v3.1.4");
  }, 300_000);

  it("migrate-memory writes the merged ledger with no byte order mark, so its first line parses", () => {
    const dir = project({
      ".forge/drift-history.json": `{"score":1,"note":"Caf\u00e9 ${DASH} one"}\n{"score":2}\n`,
      ".forge/drift-history.jsonl": '{"score":0}\n',
    });
    const result = run(exe, dir, "migrate-memory");
    expect(result.status, outputOf(result)).toBe(0);
    const lines = written(dir, ".forge/drift-history.jsonl").split(/\r?\n/).filter(Boolean);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ score: 0 }, { score: 1, note: `Caf\u00e9 ${DASH} one` }, { score: 2 }]);
  }, 300_000);

  describe("update", () => {
    const OLD_BLOCK = "# >>> plan-forge managed (do not edit between markers) >>>\nstale\n# <<< plan-forge managed <<<\n";

    /** A source one release ahead of a project that has no docs/plans/auto folder and the .gitignore it is given. */
    function updateFixture(gitignore) {
      const base = mkdtempSync(join(tmpdir(), "pf-meta-432-update-"));
      tmpDirs.push(base);
      const source = join(base, "plan-forge");
      writeTree(source, { VERSION: "9.9.10" });
      copyUpdateRuntime(source);
      const dir = gitProject(join(base, "project"), {
        ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "custom", projectName: CAFE }, null, 2),
        ...(gitignore === null ? {} : { ".gitignore": gitignore }),
      });
      return { source, dir };
    }

    function updated(exe, { source, dir }) {
      const result = run(exe, dir, "update", source, "--yes");
      expect(result.status, outputOf(result)).toBe(0);
      expect(outputOf(result)).toContain("Update complete");
      const config = JSON.parse(written(dir, ".forge.json"));
      expect(config.templateVersion).toBe("9.9.10");
      expect(config.projectName, "the project's name survives being read and written back").toBe(CAFE);
      expect(written(dir, "docs/plans/auto/README.md")).toContain(DASH);
      return written(dir, ".gitignore");
    }

    it("refreshes the managed block in .gitignore without touching the lines around it", () => {
      const gitignore = updated(exe, updateFixture(`# mine ${DASH} keep\nbuild/\n\n${OLD_BLOCK}# after ${DASH} block\n`));
      expect(gitignore).toContain(`# mine ${DASH} keep`);
      expect(gitignore).toContain(`# after ${DASH} block`);
      expect(gitignore).toContain(`produced by pforge ${DASH} never commit`);
      expect(gitignore).toContain("**/.forge/");
      expect(gitignore).not.toContain("stale");
    }, 300_000);

    it("appends the managed block to a .gitignore that has none", () => {
      const gitignore = updated(exe, updateFixture(`# mine ${DASH} keep\nbuild/\n`));
      expect(gitignore).toContain(`# mine ${DASH} keep`);
      expect(gitignore).toContain(`produced by pforge ${DASH} never commit`);
      expect(gitignore.endsWith("\n"), "the file ends with a newline, as Add-Content left it").toBe(true);
    }, 300_000);

    it("creates a .gitignore with the managed block when the project has none", () => {
      const gitignore = updated(exe, updateFixture(null));
      expect(gitignore).toContain(`produced by pforge ${DASH} never commit`);
      expect(gitignore).toContain("**/.forge/");
      expect(gitignore.endsWith("\n"), "the file ends with a newline, as Set-Content left it").toBe(true);
    }, 300_000);
  });
});

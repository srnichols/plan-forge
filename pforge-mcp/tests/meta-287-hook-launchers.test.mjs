/**
 * Meta-bug #287 — Windows hook launchers and hook input handling.
 *
 * 1. templates/.github/hooks/plan-forge.json launched every hook's `command`
 *    as a bare `.github/hooks/scripts/*.sh` path. A host that runs `command`
 *    on Windows (the Copilot CLI/SDK format falls back to it when no
 *    `powershell` key exists) hands a bare script path to the shell's file
 *    association — which opened hook scripts as editor tabs. The `windows`
 *    launchers also lacked -NoProfile -NonInteractive -WindowStyle Hidden, so
 *    console windows stole focus from the chat input.
 * 2. Five PowerShell hooks stored stdin in `$input` — PowerShell's automatic
 *    pipeline enumerator. The following native `git` call emptied it, so
 *    forbidden-path and pre-deploy denials returned {}, the unfinished-code
 *    warning never fired, and the Stop hook ignored `stop_hook_active`.
 *
 * Live editor behaviour (tabs, focus) still needs the in-host verification the
 * issue asks for; these tests pin the launch contract and the script behaviour
 * with simulated payloads.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const TEMPLATE_HOOKS = join(REPO_ROOT, "templates", ".github", "hooks");
const SCRIPTS = join(TEMPLATE_HOOKS, "scripts");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

const LIFECYCLE_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"];
const SH_LAUNCH_RE = /^bash \.github\/hooks\/scripts\/([a-z-]+)\.sh$/;
const PS_LAUNCH_RE = /^powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \.github\/hooks\/scripts\/([a-z-]+)\.ps1$/;

const hasTemplate = existsSync(join(TEMPLATE_HOOKS, "plan-forge.json"));

function commandEntries(cfg) {
  const entries = LIFECYCLE_EVENTS.flatMap((ev) => (cfg.hooks[ev] || []).map((entry) => ({ ev, entry, lifecycle: true })));
  for (const entry of cfg.hooks.preCommit?.chain || []) {
    if (entry.type === "command") entries.push({ ev: `preCommit:${entry.name}`, entry, lifecycle: false });
  }
  return entries;
}

describe.skipIf(!hasTemplate)("hook launchers never depend on a script file association (meta #287)", () => {
  const cfg = hasTemplate ? JSON.parse(readFileSync(join(TEMPLATE_HOOKS, "plan-forge.json"), "utf-8")) : { hooks: {} };
  const entries = commandEntries(cfg);

  it("covers every lifecycle event and chain command", () => {
    for (const ev of LIFECYCLE_EVENTS) expect(cfg.hooks[ev]?.length, ev).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });

  for (const { ev, entry, lifecycle } of entries) {
    it(`${ev}: runs bash explicitly and a hidden, non-interactive PowerShell on Windows`, () => {
      const sh = entry.command.match(SH_LAUNCH_RE);
      const ps = entry.windows.match(PS_LAUNCH_RE);
      expect(sh, entry.command).not.toBeNull();
      expect(ps, entry.windows).not.toBeNull();
      expect(ps[1]).toBe(sh[1]);
      expect(existsSync(join(SCRIPTS, `${sh[1]}.sh`))).toBe(true);
      expect(existsSync(join(SCRIPTS, `${ps[1]}.ps1`))).toBe(true);
      // Copilot CLI/SDK hosts read `powershell`, not the VS Code-only `windows` key.
      if (lifecycle) expect(entry.powershell).toBe(entry.windows);
    });
  }
});

describe("Guard: PowerShell hooks never assign the automatic $input variable (meta #287)", () => {
  const dirs = [SCRIPTS, join(REPO_ROOT, ".github", "hooks", "scripts")].filter((d) => existsSync(d));
  for (const dir of dirs) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".ps1"))) {
      it(`${name} in ${dir === SCRIPTS ? "templates" : ".github"}`, () => {
        const src = readFileSync(join(dir, name), "utf-8");
        expect(src).not.toMatch(/^\s*\$input\s*=/m);
        expect(src).not.toMatch(/\$input\s+-match/);
      });
    }
  }
});

// ── Behaviour with simulated host payloads ─────────────────────────────

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Plan text whose Forbidden Actions forbid `forbidden`. */
function planText({ status, heading = "### Forbidden Actions", forbidden = ["infra/**"], extra = [] }) {
  return [
    "# Phase — Fixture",
    status,
    "",
    "## Scope Contract",
    "",
    heading,
    ...forbidden.map((f) => `- Do not modify \`${f}\``),
    "- Never strip the `[parallel-safe]` tag",
    "- Keep `retries` at `0`, `strict` set to `true`, and never `ask` twice",
    "- Never put gates in ```text fences",
    ...extra,
    "",
    "## Execution Slices",
    "",
  ].join("\n");
}

/**
 * A repo with one fixture plan (HARDENED by default) and one committed code file.
 * `extraPlans` adds more docs/plans files; `pointer` writes .forge/active-plan.
 */
function seedRepo({ parentDir = null, planStatus = "**Status**: HARDENED", forbiddenHeading = "### Forbidden Actions", extraForbidden = [], extraPlans = {}, pointer = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), "pf-meta-287-"));
  tmpDirs.push(base);
  const dir = parentDir ? join(base, parentDir, "repo") : base;
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "meta-287@example.invalid");
  git(dir, "config", "user.name", "Meta 287");
  git(dir, "config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "docs", "plans"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "docs", "plans", "Phase-1-FIXTURE-PLAN.md"), planText({ status: planStatus, heading: forbiddenHeading, extra: extraForbidden }));
  for (const [name, text] of Object.entries(extraPlans)) writeFileSync(join(dir, "docs", "plans", name), text);
  if (pointer) {
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(join(dir, ".forge", "active-plan"), pointer + "\n");
  }
  writeFileSync(join(dir, "src", "app.js"), "export const x = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  return dir;
}

function editPayload(filePath) {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "editFiles", tool_input: { filePath } });
}

function runPs(dir, script, stdin) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(SCRIPTS, script)], {
    cwd: dir, input: stdin, encoding: "utf-8", timeout: 60_000,
  });
  return (r.stdout || "").trim();
}

function runSh(dir, script, stdin) {
  const scriptPath = join(SCRIPTS, script).replace(/\\/g, "/");
  const r = spawnSync(BASH, [scriptPath], { cwd: dir, input: stdin, encoding: "utf-8", timeout: 60_000 });
  return (r.stdout || "").trim();
}

const decision = (out) => JSON.parse(out || "{}").hookSpecificOutput?.permissionDecision;

// A shipped plan whose status was never rewritten from HARDENED; it forbids src/**.
const STALE_PLAN = { "Phase-0-STALE-PLAN.md": planText({ status: "---\nstatus: HARDENED\n---", forbidden: ["src/**"] }) };

// The PowerShell and Bash forbidden hooks must reach the same verdict for every
// case (review of #286/#287: they disagreed on heading levels and ```text lines).
const FORBIDDEN_CASES = [
  { name: "denies an edit under a forbidden path", repo: {}, file: "infra/main.tf", deny: true },
  { name: "denies a JSON-escaped absolute Windows path under a forbidden path", repo: {}, file: (dir) => join(dir, "infra", "main.tf"), deny: true },
  { name: "reads a level-2 Forbidden Actions heading", repo: { forbiddenHeading: "## Forbidden Actions" }, file: "infra/main.tf", deny: true },
  { name: "allows unrelated edits despite a bracketed tag", repo: {}, file: "src/app.js", deny: false },
  { name: "does not treat prose tokens as path fragments", repo: {}, file: "src/v10/tasks/trueColor.ts", deny: false },
  { name: "matches a bare-word hint as a whole path segment", repo: {}, file: "src/ask/prompt.ts", deny: true },
  { name: "matches repo-relative paths, not parent folders", repo: { parentDir: "infra" }, file: (dir) => join(dir, "src", "app.js"), deny: false },
  { name: "ignores a completed plan that merely mentions hardening", repo: { planStatus: "**Status**: ✅ Complete — hardened 2026-09-01, shipped" }, file: "infra/main.tf", deny: false },
  { name: "stops the section at a sub-heading", repo: { extraForbidden: ["#### Examples", "- `docs/examples/**`"] }, file: "docs/examples/a.md", deny: false },
  { name: "emits valid JSON when a backslash hint matches", repo: { extraForbidden: ["- Never touch `src\\legacy\\*`"] }, file: "src\\legacy\\Old.cs", deny: true },
  { name: "prefers the only In Progress plan over a stale HARDENED one", repo: { planStatus: "> **Status**: in-progress", extraPlans: STALE_PLAN }, file: "src/app.js", deny: false },
  { name: "enforces the In Progress plan when a stale HARDENED one exists", repo: { planStatus: "> **Status**: in-progress", extraPlans: STALE_PLAN }, file: "infra/main.tf", deny: true },
  { name: "enforces nothing when several plans are HARDENED", repo: { extraPlans: STALE_PLAN }, file: "infra/main.tf", deny: false },
  { name: "follows an explicit .forge/active-plan pointer", repo: { extraPlans: STALE_PLAN, pointer: "docs/plans/Phase-1-FIXTURE-PLAN.md" }, file: "infra/main.tf", deny: true },
];

function expectVerdict(run, script, { repo, file, deny }) {
  const dir = seedRepo(repo);
  const target = typeof file === "function" ? file(dir) : file;
  const out = run(dir, script, editPayload(target));
  if (deny) expect(decision(out), out).toBe("deny");
  else expect(out).toBe("{}");
}

describe.skipIf(!isWin)("PowerShell hooks act on the payload they receive (meta #287)", () => {
  for (const c of FORBIDDEN_CASES) {
    it(`check-forbidden.ps1 ${c.name}`, () => expectVerdict(runPs, "check-forbidden.ps1", c));
  }

  it("check-predeploy denies a deploy-file write while the secret-scan cache reports findings", () => {
    const dir = seedRepo();
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(join(dir, ".forge", "secret-scan-cache.json"), JSON.stringify({ clean: false, findings: [{ file: "a", line: 1 }] }));
    expect(decision(runPs(dir, "check-predeploy.ps1", editPayload("Dockerfile")))).toBe("deny");
  });

  it("post-edit-validate warns about an unfinished-code marker in the edited file", () => {
    const dir = seedRepo();
    const file = join(dir, "src", "app.js");
    writeFileSync(file, "export const x = 1; // TODO wire the real value\n");
    const out = runPs(dir, "post-edit-validate.ps1", JSON.stringify({ tool_name: "editFiles", tool_input: { filePath: file } }));
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toMatch(/Deferred-work markers/);
  });

  it("stop-check-tests honors stop_hook_active even with modified code", () => {
    const dir = seedRepo();
    writeFileSync(join(dir, "src", "app.js"), "export const x = 2;\n");
    expect(runPs(dir, "stop-check-tests.ps1", JSON.stringify({ stop_hook_active: true }))).toBe("{}");
    expect(JSON.parse(runPs(dir, "stop-check-tests.ps1", JSON.stringify({ stop_hook_active: false }))).systemMessage).toMatch(/no test run was detected/);
  });
});

describe.skipIf(!BASH)("check-forbidden.sh reads the Forbidden Actions section (meta #286, #287)", () => {
  for (const c of FORBIDDEN_CASES) {
    it(`check-forbidden.sh ${c.name}`, () => expectVerdict(runSh, "check-forbidden.sh", c));
  }
});

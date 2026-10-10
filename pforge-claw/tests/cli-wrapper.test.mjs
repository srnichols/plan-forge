import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROCESS_TIMEOUT_MS = 30_000;
const CHILD_FAILURE_CODE = 23;
const PLAN_PATH = path.posix.join("docs", "plans", "example plan.md");
const PROBE_SOURCE = [
  'process.stdout.write("WRAPPER_PROBE " + JSON.stringify({',
  "  args: process.argv.slice(2),",
  "  cwd: process.cwd(),",
  "  prepared: process.env.PFORGE_WRAPPER_PREPARED,",
  '}) + "\\n");',
  "process.exitCode = Number(process.env.PFORGE_WRAPPER_EXIT_CODE ?? 0);",
].join("\n");
const WRAPPERS = [
  { name: "PowerShell", command: "pwsh", file: "pforge.ps1", prefix: ["-NoProfile", "-File"] },
  {
    name: "Bash",
    command: process.platform === "win32"
      ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe")
      : "bash",
    file: "pforge.sh",
    prefix: [],
  },
];

let fixtureRoot;

function runWrapper(wrapper, args, env = {}) {
  const child = spawnSync(wrapper.command, [
    ...wrapper.prefix, path.join(fixtureRoot, wrapper.file), ...args,
  ], {
    cwd: fixtureRoot,
    encoding: "utf8",
    timeout: PROCESS_TIMEOUT_MS,
    env: {
      ...process.env,
      PFORGE_CLAW_PATH: fixtureRoot,
      PFORGE_WRAPPER_PREPARED: "prepared-job-environment",
      PFORGE_WRAPPER_EXIT_CODE: "0",
      ...env,
    },
  });
  expect(child.error).toBeUndefined();
  return child;
}

function readProbe(child) {
  const match = child.stdout.match(/^WRAPPER_PROBE (.+)$/m);
  expect(match, child.stdout + child.stderr).not.toBeNull();
  return JSON.parse(match[1]);
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "claw-wrapper-"));
  const directories = [".git", "pforge-claw", "pforge-mcp", path.join("docs", "plans")];
  for (const directory of directories) mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
  for (const wrapper of WRAPPERS) copyFileSync(path.join(REPO_ROOT, wrapper.file), path.join(fixtureRoot, wrapper.file));
  writeFileSync(path.join(fixtureRoot, "pforge-claw", "cli.mjs"), PROBE_SOURCE);
  writeFileSync(path.join(fixtureRoot, "pforge-mcp", "orchestrator.mjs"), PROBE_SOURCE);
  writeFileSync(path.join(fixtureRoot, "docs", "plans", "example plan.md"), "# Test plan\n");
});

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

describe.each(WRAPPERS)("$name CLI wrapper", (wrapper) => {
  it("forwards Claw arguments literally with the prepared environment", () => {
    const args = ["worker", "--job", "job with spaces", "--literal", "$(not-a-command);literal"];
    const child = runWrapper(wrapper, ["claw", ...args]);
    expect(child.status, child.stderr).toBe(0);
    const probe = readProbe(child);
    expect(probe.args).toEqual(args);
    expect(probe.prepared).toBe("prepared-job-environment");
    expect(path.resolve(probe.cwd)).toBe(path.resolve(fixtureRoot));
  });

  it("propagates a Claw child failure", () => {
    const child = runWrapper(wrapper, ["claw", "worker"], {
      PFORGE_WRAPPER_EXIT_CODE: String(CHILD_FAILURE_CODE),
    });
    expect(child.status, child.stderr).toBe(CHILD_FAILURE_CODE);
  });

  it("runs a repository-relative plan in foreground with quorum and resume choices", () => {
    const child = runWrapper(wrapper, [
      "run-plan", PLAN_PATH, "--foreground", "--quorum=power", "--resume-from", "7",
    ]);
    expect(child.status, child.stderr).toBe(0);
    const probe = readProbe(child);
    expect(probe.args[0]).toBe("--run");
    expect(path.resolve(probe.args[1])).toBe(path.join(fixtureRoot, "docs", "plans", "example plan.md"));
    expect(probe.args.slice(2)).toEqual(["--mode", "auto", "--resume-from", "7", "--quorum=power"]);
    expect(probe.prepared).toBe("prepared-job-environment");
  });

  it("propagates a foreground plan failure instead of reporting success", () => {
    const child = runWrapper(wrapper, ["run-plan", PLAN_PATH, "--foreground"], {
      PFORGE_WRAPPER_EXIT_CODE: String(CHILD_FAILURE_CODE),
    });
    expect(child.status, child.stdout + child.stderr).toBe(CHILD_FAILURE_CODE);
  });
});

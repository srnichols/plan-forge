import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const INSTALL_TIMEOUT_MS = 60_000;
const TRAVERSAL_IMAGE = process.env.PFORGE_RUNTIME_TRAVERSAL_IMAGE;
const RUNTIME_PACKAGES = ["pforge-mcp", "pforge-master", "pforge-sdk"];
const RUNTIME_FILES = [
  ["pforge-mcp", "package.json"],
  ["pforge-mcp", "preset-catalog.json"],
  ["pforge-mcp", "server.mjs"],
  ["pforge-mcp", "orchestrator.mjs"],
  ["pforge-mcp", "orchestrator", "sdk-worker.mjs"],
  ["pforge-mcp", "orchestrator", "worker-spawn.mjs"],
  ["pforge-mcp", "capabilities.mjs"],
  ["pforge-mcp", "enums.mjs"],
  ["pforge-master", "package.json"],
  ["pforge-master", "server.mjs"],
  ["pforge-master", "src", "index.mjs"],
  ["pforge-master", "src", "observer-loop.mjs"],
  ["pforge-master", "src", "planner.mjs"],
  ["pforge-master", "src", "provider-keys.mjs"],
  ["pforge-master", "ui", "index.html"],
  ["pforge-sdk", "package.json"],
  ["pforge-sdk", "src", "index.mjs"],
  ["pforge-sdk", "src", "client.mjs"],
  ["pforge-sdk", "src", "tools.mjs"],
  ["pforge-sdk", "src", "hallmark.mjs"],
  ["pforge-sdk", "src", "chunker.mjs"],
  ["pforge-sdk", "src", "run-reader.mjs"],
];
const BENIGN_FILES = [
  ["src", "coverage"],
  ["src", "node_modules"],
  ["src", "node_modules-list.mjs"],
  ["src", "coverage-report.mjs"],
  ["src", "runtime.forge-schema.mjs"],
  ["src", "node_modules-notes", "index.mjs"],
  ["src", "coverage-documents", "index.mjs"],
  ["src", "runtime.forge-guides", "index.mjs"],
];
const CACHE_DIRECTORIES = ["node_modules", ".forge", "coverage"];
const SOURCE_LAYOUTS = [
  { label: "ordinary source", ancestors: ["source"] },
  { label: "source under .forge/audit", ancestors: [".forge", "audit"] },
  { label: "source under node_modules", ancestors: ["node_modules", "checkout"] },
  { label: "source under coverage", ancestors: ["coverage", "checkout"] },
  { label: "source path with spaces and an apostrophe", ancestors: ["source's path with spaces"] },
  { label: "benign ancestor substrings", ancestors: ["node_modules-backups", ".forge-sources", "coverage-reports"] },
];
const CUSTOM_GUIDANCE = "# Custom fixture guidance\nProject: <YOUR PROJECT NAME>\n";
const BENIGN_MODULE = 'export const fixture = "benign runtime content";\n';
const EXCLUDED_CONTENT = '{"fixture":"runtime-local cache, not shipped"}\n';
const bash = process.platform === "win32"
  ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter(Boolean)
    .map((root) => join(root, "Git", "bin", "bash.exe"))
    .find((candidate) => existsSync(candidate))
  : "bash";
const installers = [
  {
    name: "PowerShell",
    command: "pwsh",
    args: ({ source, project }) => [
      "-NoProfile", "-NonInteractive", "-File", join(source, "setup.ps1"),
      "-Preset", "custom", "-ProjectPath", project, "-ProjectName", "Acme", "-NonInteractive",
    ],
  },
  {
    name: "Bash",
    command: bash,
    args: ({ project }) => [
      "setup.sh", "--preset", "custom", "--path", project.split(sep).join("/"),
      "--name", "Acme", "--non-interactive",
    ],
  },
];
const fixtureRoots = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeFixtureFile(root, segments, content, options) {
  const target = join(root, ...segments);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, options);
}

function seedNpmEdge(base) {
  const bin = join(base, "npm edge");
  const script = join(bin, "npm-fixture.mjs");
  const log = join(base, "npm-calls.jsonl");
  // Only npm is stubbed; Node and both complete installers execute unchanged.
  writeFixtureFile(bin, ["npm-fixture.mjs"], [
    'import { appendFileSync } from "node:fs";',
    "const args = process.argv.slice(2);",
    'if (args[0] !== "install") throw new Error("fixture only supports npm install");',
    'const prefix = args.indexOf("--prefix");',
    "const packagePath = prefix < 0 ? process.cwd() : args[prefix + 1];",
    'appendFileSync(process.env.PFORGE_FIXTURE_NPM_LOG, JSON.stringify({ packagePath }) + "\\n");',
    "",
  ].join("\n"));
  writeFixtureFile(bin, ["npm"], '#!/usr/bin/env bash\nexec node "$PFORGE_FIXTURE_NPM" "$@"\n', { mode: 0o755 });
  writeFixtureFile(bin, ["npm.cmd"], '@node "%PFORGE_FIXTURE_NPM%" %*\r\n');
  writeFileSync(log, "");
  const env = { ...process.env, CI: "1", PFORGE_NONINTERACTIVE: "1" };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = [bin, env[pathKey]].join(delimiter);
  env.PFORGE_FIXTURE_NPM = script;
  env.PFORGE_FIXTURE_NPM_LOG = log;
  return { env, log };
}

function seedFixture({ ancestors }) {
  // Keep fixtures inside this checkout, but outside .forge so the ordinary
  // source control does not inherit the very ancestor exclusion under test.
  const base = mkdtempSync(join(REPO_ROOT, ".runtime-install-source-path-"));
  fixtureRoots.push(base);
  const source = join(base, ...ancestors, "plan-forge");
  const project = join(base, "installed project");
  mkdirSync(project, { recursive: true });
  for (const segments of [...RUNTIME_FILES, ["setup.ps1"], ["setup.sh"], ["VERSION"]]) {
    writeFixtureFile(source, segments, readFileSync(join(REPO_ROOT, ...segments)));
  }
  writeFixtureFile(source, [".github", "copilot-instructions.md"], CUSTOM_GUIDANCE);
  writeFixtureFile(source, ["presets", "shared", ".github", "agents", "fixture.agent.md"], "# Stack agent\n");
  writeFixtureFile(source, ["presets", "shared", ".github", "skills", "fixture", "SKILL.md"], "# Stack skill\n");
  writeFixtureFile(source, ["pforge-claw", "package.json"], readFileSync(join(REPO_ROOT, "pforge-claw", "package.json")));

  const shippedFiles = [...RUNTIME_FILES];
  const excludedDirectories = [];
  for (const packageName of RUNTIME_PACKAGES) {
    for (const segments of BENIGN_FILES) {
      const relativePath = [packageName, ...segments];
      writeFixtureFile(source, relativePath, BENIGN_MODULE);
      shippedFiles.push(relativePath);
    }
    for (const cache of CACHE_DIRECTORIES) {
      for (const parent of [[], ["src", "nested cache fixture"]]) {
        const relativePath = [packageName, ...parent, cache];
        const filename = cache === ".forge" ? "secrets.json" : "cached-content.mjs";
        writeFixtureFile(source, [...relativePath, filename], EXCLUDED_CONTENT);
        excludedDirectories.push(relativePath);
      }
    }
  }
  writeFixtureFile(source, [".forge", "secrets.json"], EXCLUDED_CONTENT);
  return { source, project, shippedFiles, excludedDirectories, ...seedNpmEdge(base) };
}

function expectRuntimeInstalled(fixture) {
  const { source, project, shippedFiles, excludedDirectories, log } = fixture;
  const missing = shippedFiles.filter((segments) => !existsSync(join(project, ...segments))).map((segments) => join(...segments));
  expect(missing, "every fixture MCP/Master/SDK runtime asset must arrive").toEqual([]);
  for (const segments of shippedFiles) {
    expect(readFileSync(join(project, ...segments)), join(...segments)).toEqual(readFileSync(join(source, ...segments)));
  }
  for (const segments of excludedDirectories) {
    expect(existsSync(join(project, ...segments)), `excluded package-local directory: ${join(...segments)}`).toBe(false);
  }
  expect(existsSync(join(project, ".forge", "secrets.json"))).toBe(false);
  expect(existsSync(join(project, "pforge-claw"))).toBe(false);
  const npmCalls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(npmCalls.map(({ packagePath }) => basename(packagePath)).sort()).toEqual(["pforge-master", "pforge-mcp"]);
  const config = JSON.parse(readFileSync(join(project, ".forge.json"), "utf8"));
  expect(config.preset).toBe("custom");
  expect(Object.hasOwn(config, "claw")).toBe(false);
  expect(readFileSync(join(project, ".github", "copilot-instructions.md"), "utf8")).toBe(CUSTOM_GUIDANCE.replace("<YOUR PROJECT NAME>", "Acme"));
  expect(existsSync(join(project, ".github", "agents", "fixture.agent.md"))).toBe(false);
  expect(existsSync(join(project, ".github", "skills", "fixture", "SKILL.md"))).toBe(false);
  const mcp = JSON.parse(readFileSync(join(project, ".vscode", "mcp.json"), "utf8"));
  expect(Object.keys(mcp.servers).sort()).toEqual(["forge-master-chat", "plan-forge"]);
  expect(mcp.servers["plan-forge"].args).toEqual([["pforge-mcp", "server.mjs"].join("/")]);
  expect(mcp.servers["forge-master-chat"].args).toEqual([["pforge-master", "server.mjs"].join("/")]);
}

describe.each(installers)("#346 $name runtime install from source paths", (installer) => {
  it.each(SOURCE_LAYOUTS)("copies runtime assets and excludes local caches: $label", (layout) => {
    expect(installer.command, "the real shell must be available; a missing runner is not platform evidence").toBeTruthy();
    const fixture = seedFixture(layout);
    const outcome = spawnSync(installer.command, installer.args(fixture), {
      cwd: fixture.source,
      encoding: "utf8",
      env: fixture.env,
      windowsHide: true,
      timeout: INSTALL_TIMEOUT_MS,
    });
    expect(outcome.error, outcome.error?.message).toBeUndefined();
    expect(outcome.status, outcome.stdout + outcome.stderr).toBe(0);
    expectRuntimeInstalled(fixture);
  }, INSTALL_TIMEOUT_MS);
});

function readBashRuntimeHelper() {
  const source = readFileSync(join(REPO_ROOT, "setup.sh"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("copy_runtime_package() {");
  const end = source.indexOf("\nreplace_placeholders()", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Bash runtime helper traversal failures", () => {
  it("returns the original cd failure without publishing a completed file count", () => {
    const root = mkdtempSync(join(REPO_ROOT, ".runtime-install-source-path-"));
    fixtureRoots.push(root);
    const script = [
      "set -euo pipefail",
      readBashRuntimeHelper(),
      "copied_files=not-complete",
      "status=0",
      'copy_runtime_package "$1" "$2" copied_files || status=$?',
      'printf "FILE_COUNT=%s\\n" "$copied_files"',
      'exit "$status"',
    ].join("\n");
    const outcome = spawnSync(bash, [
      "-c", script, "runtime-traversal-fixture",
      join(root, "missing source").split(sep).join("/"),
      join(root, "destination").split(sep).join("/"),
    ], { encoding: "utf8", windowsHide: true, timeout: INSTALL_TIMEOUT_MS });
    expect(outcome.error, outcome.error?.message).toBeUndefined();
    expect(outcome.status, outcome.stdout + outcome.stderr).toBe(1);
    expect(outcome.stderr).toContain("cd:");
    expect(outcome.stderr).toContain("missing source");
    expect(outcome.stdout).toContain("FILE_COUNT=not-complete");
  }, INSTALL_TIMEOUT_MS);
});

// Explicit opt-in probe: an existing Docker image supplies a real unprivileged
// Linux filesystem; the normal installer packet does not require Docker.
// PFORGE_RUNTIME_TRAVERSAL_IMAGE=node:24-bookworm, then select "unprivileged Linux".
if (TRAVERSAL_IMAGE) {
  describe("Bash runtime helper unprivileged Linux traversal", () => {
    it("propagates a partial find failure and retains its permission diagnostic", () => {
      const script = [
        "set -euo pipefail",
        readBashRuntimeHelper(),
        'printf "UNPRIVILEGED_UID=%s\\n" "$(id -u)"',
        'test "$(id -u)" -ne 0',
        'fixture="$PWD/runtime-traversal-fixture"',
        'mkdir -p "$fixture/source/readable" "$fixture/source/blocked"',
        'trap \'chmod u+rwx "$fixture/source/blocked"; rm -rf -- "$fixture"\' EXIT',
        'printf "readable module\\n" > "$fixture/source/readable/module.mjs"',
        'printf "unreadable module\\n" > "$fixture/source/blocked/module.mjs"',
        'chmod 000 "$fixture/source/blocked"',
        "producer_status=0",
        '(cd -- "$fixture/source" && find . -type f -print0) > "$fixture/producer.paths" 2> "$fixture/producer.stderr" || producer_status=$?',
        'test -s "$fixture/producer.paths"',
        'test -s "$fixture/producer.stderr"',
        'printf "PRODUCER_STATUS=%s\\nPRODUCER_PARTIAL_FILES=1\\n" "$producer_status"',
        "copied_files=not-complete",
        "status=0",
        'copy_runtime_package "$fixture/source" "$fixture/destination" copied_files || status=$?',
        'printf "FILE_COUNT=%s\\n" "$copied_files"',
        'exit "$status"',
      ].join("\n");
      const outcome = spawnSync("docker", [
        "run", "--rm", "--pull=never", "--network", "none", "--user", "1000:1000",
        "--workdir", "/home/node", "-i", TRAVERSAL_IMAGE, "bash", "-s",
      ], { input: script, encoding: "utf8", windowsHide: true, timeout: INSTALL_TIMEOUT_MS });
      expect(outcome.error, outcome.error?.message).toBeUndefined();
      expect(outcome.stdout).toContain("UNPRIVILEGED_UID=1000");
      expect(outcome.stdout).toContain("PRODUCER_STATUS=1");
      expect(outcome.stdout).toContain("PRODUCER_PARTIAL_FILES=1");
      expect(outcome.status, outcome.stdout + outcome.stderr).toBe(1);
      expect(outcome.stderr).toMatch(/find: .*blocked.*Permission denied/);
      expect(outcome.stdout).toContain("FILE_COUNT=not-complete");
    }, INSTALL_TIMEOUT_MS);
  });
}

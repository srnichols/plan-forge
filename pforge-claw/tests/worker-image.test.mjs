import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
const tempDirectories = [];
const BASE_DOCKERFILE = readFileSync(path.join(PACKAGE_ROOT, "deploy", "Dockerfile.worker-base"), "utf8");
const VARIANT_FILES = ["node", "dotnet", "python"].map((variant) => ({
  variant,
  text: readFileSync(path.join(PACKAGE_ROOT, "deploy", "worker-variants", `Dockerfile.${variant}`), "utf8"),
}));
const POWERSHELL_SCRIPT = readFileSync(path.join(PACKAGE_ROOT, "scripts", "build-images.ps1"), "utf8");
const BASH_SCRIPT = readFileSync(path.join(PACKAGE_ROOT, "scripts", "build-images.sh"), "utf8");

function parseDockerfile(text) {
  const continued = text.replace(/\\\r?\n[ \t]*/g, " ");
  return continued
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.match(/^\s*([A-Z]+)\s+(.*?)\s*$/i))
    .filter(Boolean)
    .map(([, instr, args]) => ({ instr: instr.toUpperCase(), args }));
}

function hasSecretDefault(instructions) {
  return instructions.some(({ instr, args }) => {
    if (instr !== "ARG" && instr !== "ENV") return false;
    const assignments = instr === "ARG"
      ? [args.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)].filter(Boolean)
      : [...args.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=([^\s]*)/g)];
    return assignments.some(([, name, value]) => /TOKEN|SECRET|KEY|PASSWORD|PAT/i.test(name) && value.trim() !== "");
  });
}

function executableExists(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function makeTemporaryDirectory() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-worker-image-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (tempDirectories.length) {
    rmSync(tempDirectories.pop(), { recursive: true, force: true });
  }
});

describe("worker base image", () => {
  const instructions = parseDockerfile(BASE_DOCKERFILE);

  it("runs as a dedicated non-root user and does not bake in credentials", () => {
    const users = instructions.filter(({ instr }) => instr === "USER");
    expect(users.at(-1)?.args).toBe("10001:10001");
    expect(hasSecretDefault(instructions)).toBe(false);
  });

  it("does not copy local state, secrets, environments, or dependencies from context", () => {
    const contextCopies = instructions.filter(({ instr }) => instr === "COPY" || instr === "ADD");
    expect(contextCopies.every(({ args }) => !/(?:^|[\s/])(?:\.forge|secrets|\.env|node_modules)(?:$|[\s/])/i.test(args))).toBe(true);
  });

  it("installs the supported shells, GitHub tools, and Copilot CLI", () => {
    expect(instructions.some(({ instr, args }) => instr === "RUN" && /apt-get\s+install[^&]*\bbash\b/i.test(args))).toBe(true);
    expect(instructions.some(({ instr, args }) => instr === "RUN" && /powershell/i.test(args))).toBe(true);
    expect(instructions.some(({ instr, args }) => instr === "RUN" && /\bpwsh\s+-v\b/i.test(args))).toBe(true);
    expect(instructions.some(({ instr, args }) => instr === "RUN" && /\bgh\b/.test(args))).toBe(true);
    expect(instructions.some(({ instr, args }) => instr === "RUN" && /@github\/copilot/.test(args))).toBe(true);
  });

  it("pins the runtime base, uses the one-shot worker entrypoint, and records D4", () => {
    expect(instructions).toContainEqual({ instr: "ARG", args: "NODE_VERSION=24" });
    expect(instructions).toContainEqual({
      instr: "ENTRYPOINT",
      args: '["pforge","claw","worker","--one-shot"]',
    });
    expect(instructions.filter(({ instr }) => instr === "EXPOSE")).toHaveLength(0);
    expect(instructions.some(({ instr, args }) => instr === "LABEL" && /io\.pforge\.claw\.d4=/.test(args))).toBe(true);
  });
});

describe("worker stack variants", () => {
  it.each(VARIANT_FILES)("$variant derives from the supplied image without root runtime or secret defaults", ({ variant, text }) => {
    const instructions = parseDockerfile(text);
    expect(instructions).toContainEqual({ instr: "ARG", args: "BASE_IMAGE" });
    expect(instructions).toContainEqual({ instr: "FROM", args: "${BASE_IMAGE}" });
    expect(instructions.filter(({ instr }) => instr === "USER").at(-1)?.args).not.toMatch(/^(?:root|0(?::0)?)$/);
    expect(hasSecretDefault(instructions)).toBe(false);
    if (variant === "dotnet") expect(instructions.some(({ instr, args }) => instr === "RUN" && /dotnet-install/i.test(args))).toBe(true);
    if (variant === "python") expect(instructions.some(({ instr, args }) => instr === "RUN" && /\bpython3\b/.test(args))).toBe(true);
  });

  it("sets .NET telemetry opt-out", () => {
    const dotnet = parseDockerfile(VARIANT_FILES.find(({ variant }) => variant === "dotnet").text);
    expect(dotnet.some(({ instr, args }) => instr === "ENV" && /DOTNET_CLI_TELEMETRY_OPTOUT=1/.test(args))).toBe(true);
  });
});

describe("image build scripts", () => {
  const powershellFlags = [
    ...POWERSHELL_SCRIPT.matchAll(/^\s*\[(?:string|switch)\]\$(Registry|Namespace|Tag|Variants|Platforms|NodeVersion|Push|DryRun|Load)\b/gim),
  ].map(([, flag]) => `--${flag.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "")}`);
  const bashFlags = [...BASH_SCRIPT.matchAll(/^\s*(--(?:registry|namespace|tag|variants|platforms|node-version|push|dry-run|load))\)/gm)]
    .map(([, flag]) => flag);

  it("supports buildx multi-architecture builds without hardcoded registries or eval", () => {
    for (const source of [POWERSHELL_SCRIPT, BASH_SCRIPT]) {
      expect(source).toMatch(/buildx/i);
      expect(source).toContain("linux/amd64");
      expect(source).toContain("linux/arm64");
      expect(source).not.toMatch(/\b(?:docker\.io|ghcr\.io|azurecr\.io)\b/i);
    }
    expect(POWERSHELL_SCRIPT).not.toMatch(/\bInvoke-Expression\b/i);
    expect(BASH_SCRIPT).not.toMatch(/\beval\b/);
  });

  it("keeps corresponding option sets in sync", () => {
    expect(powershellFlags.sort()).toEqual(bashFlags.sort());
    expect(powershellFlags).toEqual(expect.arrayContaining([
      "--registry", "--namespace", "--tag", "--variants", "--platforms",
      "--node-version", "--push", "--dry-run",
    ]));
  });

  it("produces matching Docker argument lists and rejects missing registries", (context) => {
    if (!executableExists("bash") || !executableExists("pwsh")) {
      context.skip();
      return;
    }

    const directory = makeTemporaryDirectory();
    const argsFile = path.join(directory, "docker-args.txt");
    const fakeDocker = process.platform === "win32"
      ? path.join(directory, "docker.cmd")
      : path.join(directory, "docker");
    const fakeDockerContents = process.platform === "win32"
      ? '@echo off\r\nif "%FAKE_DOCKER_FAIL_BUILDX%"=="1" if "%~1"=="buildx" if "%~2"=="version" exit /b 17\r\nif "%~1"=="buildx" if "%~2"=="version" exit /b 0\r\n>>"%DOCKER_ARGS_FILE%" echo %*\r\nexit /b 0\r\n'
      : '#!/bin/sh\nif [ "$1" = buildx ] && [ "$2" = version ]; then\n  if [ "${FAKE_DOCKER_FAIL_BUILDX:-0}" = 1 ]; then exit 17; fi\n  exit 0\nfi\nprintf "%s\\n" "$@" >> "$DOCKER_ARGS_FILE"\n';
    writeFileSync(fakeDocker, fakeDockerContents, "utf8");
    if (process.platform !== "win32") chmodSync(fakeDocker, 0o755);

    const env = {
      ...process.env,
      DOCKER_ARGS_FILE: argsFile,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    };
    const options = [
      "--registry", "registry.example:5443",
      "--namespace", "team/claw",
      "--tag", "test-21",
      "--variants", "node,dotnet,python",
      "--platforms", "linux/amd64,linux/arm64",
      "--node-version", "24",
    ];

    const bashInvocation = process.platform === "win32"
      ? ["scripts/build-images.sh", ...options, "--dry-run"]
      : ["scripts/build-images.sh", ...options];
    const bashRun = spawnSync("bash", bashInvocation, {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env,
    });
    expect(bashRun.error).toBeUndefined();
    expect(bashRun.status, bashRun.stderr).toBe(0);
    const normalizeArguments = (argumentsList) => argumentsList.map((argument) => argument
      .replace(/^.*[\\/]pforge-claw(?=[\\/]|$)/, "<context>")
      .replace(/\\/g, "/"));
    const bashDockerArguments = normalizeArguments(
      bashRun.stdout.split(/\r?\n/).filter((line) => line.startsWith("  ")).map((line) => line.trim()),
    );

    const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
    const powershellOptions = options.map((argument) => argument.startsWith("--")
      ? `-${argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`
      : quotePowerShell(argument));
    const powershellLauncher = path.join(directory, "run-build.ps1");
    writeFileSync(powershellLauncher, [
      `$env:PATH = ${quotePowerShell(`${directory}${path.delimiter}${process.env.PATH}`)}`,
      `function docker { if ($env:FAKE_DOCKER_FAIL_BUILDX -eq '1' -and $args[0] -eq 'buildx' -and $args[1] -eq 'version') { $global:LASTEXITCODE = 17; return }; & ${quotePowerShell(fakeDocker)} @args }`,
      `. ${quotePowerShell(path.join(PACKAGE_ROOT, "scripts", "build-images.ps1"))} ${powershellOptions.join(" ")}`,
      "",
    ].join(os.EOL), "utf8");
    const powershellRun = spawnSync("pwsh", ["-NoProfile", "-File", powershellLauncher], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env,
    });
    expect(powershellRun.error).toBeUndefined();
    expect(powershellRun.status, powershellRun.stderr).toBe(0);
    expect(existsSync(argsFile), `${powershellRun.stdout}\n${powershellRun.stderr}\n${readFileSync(powershellLauncher, "utf8")}`).toBe(true);
    const powershellLines = readFileSync(argsFile, "utf8").trim().split(/\r?\n/);
    const powershellRawArguments = process.platform === "win32"
      ? powershellLines.flatMap((line) => line.match(/"(?:[^"]*)"|[^\s]+/g) ?? [])
        .map((argument) => argument.replace(/^"(.*)"$/, "$1"))
      : powershellLines;
    const powershellDockerArguments = normalizeArguments(powershellRawArguments);
    expect(powershellDockerArguments).toEqual(bashDockerArguments);

    const missingRegistry = spawnSync("bash", ["scripts/build-images.sh", "--namespace", "team", "--tag", "test"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env,
    });
    expect(missingRegistry.status).not.toBe(0);
    const missingPowerShellRegistry = spawnSync("pwsh", [
      "-NoProfile", "-File", "scripts/build-images.ps1",
      "-Namespace", "team", "-Tag", "test",
    ], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env,
    });
    expect(missingPowerShellRegistry.status).not.toBe(0);

    const invalidBashLoad = spawnSync("bash", [
      "scripts/build-images.sh", "--registry", "registry.example", "--namespace", "team", "--tag", "test",
      "--load", "--dry-run",
    ], { cwd: PACKAGE_ROOT, encoding: "utf8", env });
    expect(invalidBashLoad.status).not.toBe(0);
    const invalidPowerShellVersion = spawnSync("pwsh", [
      "-NoProfile", "-File", "scripts/build-images.ps1",
      "-Registry", "registry.example", "-Namespace", "team", "-Tag", "test", "-NodeVersion", "23", "-DryRun",
    ], { cwd: PACKAGE_ROOT, encoding: "utf8", env });
    expect(invalidPowerShellVersion.status).not.toBe(0);

    const failingBuildxEnv = { ...env, FAKE_DOCKER_FAIL_BUILDX: "1" };
    const failedBashInvocation = process.platform === "win32"
      ? ["-c", 'docker() { return 17; }; source scripts/build-images.sh', "bash", ...options]
      : ["scripts/build-images.sh", ...options];
    const failedBashBuildx = spawnSync("bash", failedBashInvocation, {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env: failingBuildxEnv,
    });
    expect(failedBashBuildx.status).not.toBe(0);
    const failedPowerShellBuildx = spawnSync("pwsh", ["-NoProfile", "-File", powershellLauncher], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env: failingBuildxEnv,
    });
    expect(failedPowerShellBuildx.stderr).toContain("docker buildx is required");
  });
});

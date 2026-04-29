/**
 * Plan Forge — Crucible Repo Command Inference (Phase-35 Slice 1).
 *
 * Detects build/test commands by inspecting the project manifest at `cwd`.
 * Detection order: Node → .NET → Cargo → Python → Go.
 *
 * Hard rule: this module must NEVER invent commands — only return what the
 * manifest evidence supports.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function detectNode(cwd) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }

  let pm = "npm";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) pm = "pnpm";
  else if (existsSync(join(cwd, "yarn.lock"))) pm = "yarn";

  const scripts = pkg.scripts || {};
  const buildCommand = scripts.build ? `${pm} run build` : null;
  const testCommand = scripts.test ? `${pm} test` : null;

  if (buildCommand === null && testCommand === null) return null;

  return { buildCommand, testCommand, manifestFile: "package.json", source: "package.json" };
}

function detectDotnet(cwd) {
  let files;
  try {
    files = readdirSync(cwd);
  } catch {
    return null;
  }

  const sln = files.find((f) => f.endsWith(".sln"));
  const csproj = files.find((f) => f.endsWith(".csproj"));
  const manifestFile = sln || csproj;
  if (!manifestFile) return null;

  return {
    buildCommand: "dotnet build",
    testCommand: "dotnet test",
    manifestFile,
    source: manifestFile,
  };
}

function detectCargo(cwd) {
  if (!existsSync(join(cwd, "Cargo.toml"))) return null;
  return {
    buildCommand: "cargo build",
    testCommand: "cargo test",
    manifestFile: "Cargo.toml",
    source: "Cargo.toml",
  };
}

function detectPython(cwd) {
  const hasPyproject = existsSync(join(cwd, "pyproject.toml"));
  const hasSetupPy = existsSync(join(cwd, "setup.py"));
  if (!hasPyproject && !hasSetupPy) return null;

  let testCommand = "python -m unittest discover";
  if (hasPyproject) {
    try {
      const content = readFileSync(join(cwd, "pyproject.toml"), "utf8");
      if (
        content.includes("[tool.pytest") ||
        /\[project\.optional-dependencies[^\]]*\][\s\S]*?pytest/.test(content) ||
        content.includes('"pytest"') ||
        content.includes("'pytest'")
      ) {
        testCommand = "pytest";
      }
    } catch {
      // ignore read errors — fall through to unittest
    }
  }

  const manifestFile = hasPyproject ? "pyproject.toml" : "setup.py";
  return {
    buildCommand: hasPyproject ? "python -m build" : null,
    testCommand,
    manifestFile,
    source: manifestFile,
  };
}

function detectGo(cwd) {
  if (!existsSync(join(cwd, "go.mod"))) return null;
  return {
    buildCommand: "go build ./...",
    testCommand: "go test ./...",
    manifestFile: "go.mod",
    source: "go.mod",
  };
}

/**
 * Infer build/test commands from the repository at `cwd`.
 *
 * Detection order: Node → .NET → Cargo → Python → Go.
 *
 * @param {string} cwd
 * @returns {{ buildCommand: string|null, testCommand: string|null, manifestFile: string|null, source: string }}
 */
export function inferRepoCommands(cwd) {
  const result =
    detectNode(cwd) ||
    detectDotnet(cwd) ||
    detectCargo(cwd) ||
    detectPython(cwd) ||
    detectGo(cwd);

  return result || { buildCommand: null, testCommand: null, manifestFile: null, source: "none" };
}

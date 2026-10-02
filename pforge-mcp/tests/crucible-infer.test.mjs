/**
 * Plan Forge — crucible-infer.mjs unit tests (Phase-35 Slice 1).
 *
 * Uses mkdtempSync + writeFileSync to build minimal repo fixtures in tmpdir.
 * All fixture dirs are cleaned up in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inferRepoCommands } from "../crucible-infer.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pforge-infer-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function writeJson(dir, filename, obj) {
  writeFileSync(join(dir, filename), JSON.stringify(obj, null, 2));
}

function writeFile(dir, filename, content = "") {
  writeFileSync(join(dir, filename), content);
}

// ─── Node (npm) ───────────────────────────────────────────────────────────────

describe("detectNode — npm", () => {
  it("returns npm commands when package.json has build + test scripts", () => {
    writeJson(tmpDir, "package.json", {
      scripts: { build: "tsc", test: "vitest run" },
    });
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("npm run build");
    expect(result.testCommand).toBe("npm test");
    expect(result.manifestFile).toBe("package.json");
    expect(result.source).toBe("package.json");
  });

  it("returns null buildCommand when scripts.build is absent", () => {
    writeJson(tmpDir, "package.json", { scripts: { test: "vitest run" } });
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBeNull();
    expect(result.testCommand).toBe("npm test");
    expect(result.source).toBe("package.json");
  });

  it("falls through to next detector when package.json has no scripts", () => {
    writeJson(tmpDir, "package.json", { name: "empty" });
    writeFile(tmpDir, "go.mod", "module example.com/app\n\ngo 1.21");
    const result = inferRepoCommands(tmpDir);
    expect(result.source).toBe("go.mod");
  });
});

// ─── Node (pnpm) ──────────────────────────────────────────────────────────────

describe("detectNode — pnpm", () => {
  it("uses pnpm when pnpm-lock.yaml is present", () => {
    writeJson(tmpDir, "package.json", {
      scripts: { build: "tsc", test: "vitest run" },
    });
    writeFile(tmpDir, "pnpm-lock.yaml", "");
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("pnpm run build");
    expect(result.testCommand).toBe("pnpm test");
    expect(result.source).toBe("package.json");
  });
});

// ─── Node (yarn) ──────────────────────────────────────────────────────────────

describe("detectNode — yarn", () => {
  it("uses yarn when yarn.lock is present", () => {
    writeJson(tmpDir, "package.json", {
      scripts: { build: "tsc", test: "jest" },
    });
    writeFile(tmpDir, "yarn.lock", "");
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("yarn run build");
    expect(result.testCommand).toBe("yarn test");
    expect(result.source).toBe("package.json");
  });
});

// ─── .NET ─────────────────────────────────────────────────────────────────────

describe("detectDotnet — csproj", () => {
  it("returns dotnet commands when a .csproj is found", () => {
    writeFile(tmpDir, "MyApp.csproj", "<Project />");
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("dotnet build");
    expect(result.testCommand).toBe("dotnet test");
    expect(result.manifestFile).toBe("MyApp.csproj");
    expect(result.source).toBe("MyApp.csproj");
  });

  it("prefers .sln over .csproj when both are present", () => {
    writeFile(tmpDir, "MyApp.sln", "");
    writeFile(tmpDir, "MyApp.csproj", "<Project />");
    const result = inferRepoCommands(tmpDir);
    expect(result.manifestFile).toBe("MyApp.sln");
    expect(result.source).toBe("MyApp.sln");
  });
});

// ─── Cargo ────────────────────────────────────────────────────────────────────

describe("detectCargo", () => {
  it("returns cargo commands when Cargo.toml is found", () => {
    writeFile(tmpDir, "Cargo.toml", '[package]\nname = "myapp"\nversion = "0.1.0"');
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("cargo build");
    expect(result.testCommand).toBe("cargo test");
    expect(result.manifestFile).toBe("Cargo.toml");
    expect(result.source).toBe("Cargo.toml");
  });
});

// ─── Python — pyproject with pytest ──────────────────────────────────────────

describe("detectPython — pyproject with pytest", () => {
  it("uses pytest when [tool.pytest] section is present", () => {
    writeFile(
      tmpDir,
      "pyproject.toml",
      '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'
    );
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("python -m build");
    expect(result.testCommand).toBe("pytest");
    expect(result.manifestFile).toBe("pyproject.toml");
    expect(result.source).toBe("pyproject.toml");
  });

  it("uses pytest when pytest is listed as an optional dependency", () => {
    writeFile(
      tmpDir,
      "pyproject.toml",
      '[project.optional-dependencies]\ndev = ["pytest", "coverage"]\n'
    );
    const result = inferRepoCommands(tmpDir);
    expect(result.testCommand).toBe("pytest");
  });

  it("falls back to unittest when pyproject has no pytest signal", () => {
    writeFile(tmpDir, "pyproject.toml", "[project]\nname = 'myapp'\n");
    const result = inferRepoCommands(tmpDir);
    expect(result.testCommand).toBe("python -m unittest discover");
    expect(result.buildCommand).toBe("python -m build");
  });

  it("uses setup.py when no pyproject.toml exists", () => {
    writeFile(tmpDir, "setup.py", "from setuptools import setup; setup(name='myapp')");
    const result = inferRepoCommands(tmpDir);
    expect(result.manifestFile).toBe("setup.py");
    expect(result.source).toBe("setup.py");
    expect(result.buildCommand).toBeNull();
    expect(result.testCommand).toBe("python -m unittest discover");
  });
});

// ─── Go ───────────────────────────────────────────────────────────────────────

describe("detectGo", () => {
  it("returns go commands when go.mod is found", () => {
    writeFile(tmpDir, "go.mod", "module example.com/app\n\ngo 1.21");
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBe("go build ./...");
    expect(result.testCommand).toBe("go test ./...");
    expect(result.manifestFile).toBe("go.mod");
    expect(result.source).toBe("go.mod");
  });
});

// ─── No manifest ─────────────────────────────────────────────────────────────

describe("no manifest", () => {
  it("returns null commands and source=none when no known manifest is found", () => {
    const result = inferRepoCommands(tmpDir);
    expect(result.buildCommand).toBeNull();
    expect(result.testCommand).toBeNull();
    expect(result.manifestFile).toBeNull();
    expect(result.source).toBe("none");
  });

  it("returns source=none for a non-existent directory", () => {
    const result = inferRepoCommands(join(tmpDir, "does-not-exist"));
    expect(result.source).toBe("none");
    expect(result.buildCommand).toBeNull();
  });
});

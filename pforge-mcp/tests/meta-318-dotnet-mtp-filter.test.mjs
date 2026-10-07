/**
 * Meta-bug #318 — the impact gate and forge_fix_proposal built every .NET gate as
 * `dotnet test <proj> --filter "FullyQualifiedName~A|FullyQualifiedName~B"`. That is
 * VSTest syntax. A .NET 10 repo that opts `dotnet test` into Microsoft.Testing.Platform
 * (global.json test.runner) and runs xUnit v3 rejects it: xUnit v3's MTP runner takes
 * --filter-class / --filter-method / --filter-trait / --filter-query, and MTP-mode
 * `dotnet test` takes the project through --project. Both call sites now build the
 * command through dotnet-test-command.mjs, which reads the runner and framework.
 * The tempering .NET adapter picks its integration filter the same way and parses
 * the MTP summary block as well as VSTest's summary line.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDotnetTestCommand,
  findDotnetTestProjects,
  isXunitV3MtpProject,
  usesMtpRunner,
} from "../dotnet-test-command.mjs";
import { buildImpactCommands } from "../orchestrator/impact-gate.mjs";
import { _callToolHandler_054_forge_fix_proposal } from "../server/tool-handlers/safety.mjs";
import { parseDotnetSummary, temperingAdapter as dotnetAdapter } from "../tempering/adapters/dotnet.mjs";
import { runScanner } from "../tempering/runner.mjs";
import { EventEmitter } from "node:events";

const MTP_GLOBAL_JSON = JSON.stringify({ sdk: { version: "10.0.100" }, test: { runner: "Microsoft.Testing.Platform" } }, null, 2);
const csproj = (...packages) =>
  `<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n${packages.map((p) => `    <PackageReference Include="${p}" />`).join("\n")}\n  </ItemGroup>\n</Project>\n`;

let repo;
function write(rel, text) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pf-meta-318-"));
  // A root global.json stops the SDK-style lookup from reaching a stray one above the temp dir.
  write("global.json", JSON.stringify({ sdk: { version: "10.0.100" } }));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("runner and framework detection (meta #318)", () => {
  it("reads MTP mode from the nearest global.json, comments and key order included", () => {
    expect(usesMtpRunner(repo)).toBe(false);
    write("global.json", `{\n  // opt in to MTP\n  "test": { "runner": "Microsoft.Testing.Platform" },\n  "sdk": { "version": "10.0.100" }\n}\n`);
    expect(usesMtpRunner(repo)).toBe(true);
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    expect(usesMtpRunner(join(repo, "src", "deep"))).toBe(true);
  });

  it.each([
    ["xunit.v3", true],
    ["xunit.v3.mtp-v2", true],
    ["xunit.v3.core.mtp-v1", true],
    ["xunit.v3.mtp-off", false],
    ["xunit", false],
    ["MSTest", false],
  ])("treats a %s reference as xUnit v3 on MTP: %s", (pkg, expected) => {
    write("tests/Api.Tests/Api.Tests.csproj", csproj(pkg));
    expect(isXunitV3MtpProject(repo, "tests/Api.Tests/Api.Tests.csproj")).toBe(expected);
  });

  it("sees xunit.v3 referenced from a Directory.Build.props above the project", () => {
    write("tests/Directory.Build.props", csproj("xunit.v3"));
    write("tests/Api.Tests/Api.Tests.csproj", csproj("Shouldly"));
    expect(isXunitV3MtpProject(repo, "tests/Api.Tests/Api.Tests.csproj")).toBe(true);
  });

  it("finds test projects and skips build output", () => {
    write("src/Api/Api.csproj", csproj("Serilog"));
    write("tests/Api.Tests/Api.Tests.csproj", csproj("xunit.v3"));
    write("tests/Web.Tests/Web.Tests.csproj", "<Project Sdk=\"MSTest.Sdk/3.8.0\" />\n");
    write("tests/Api.Tests/bin/Debug/Copy.Tests.csproj", csproj("xunit.v3"));
    expect(findDotnetTestProjects(repo)).toEqual(["tests/Api.Tests/Api.Tests.csproj", "tests/Web.Tests/Web.Tests.csproj"]);
  });
});

describe("buildDotnetTestCommand (meta #318)", () => {
  const project = "tests/Api.Tests/Api.Tests.csproj";

  it("keeps VSTest --filter syntax without the global.json opt-in", () => {
    write(project, csproj("xunit.v3", "xunit.runner.visualstudio"));
    expect(buildDotnetTestCommand({ cwd: repo, project, classes: ["ClientServiceTests", "InvoiceTests"] }))
      .toBe('dotnet test "tests/Api.Tests/Api.Tests.csproj" --filter "FullyQualifiedName~ClientServiceTests|FullyQualifiedName~InvoiceTests"');
  });

  it("emits --project and one --filter-class per class for xUnit v3 on MTP", () => {
    write("global.json", MTP_GLOBAL_JSON);
    write(project, csproj("xunit.v3"));
    expect(buildDotnetTestCommand({ cwd: repo, project, classes: ["ClientServiceTests", "InvoiceTests"] }))
      .toBe('dotnet test --project "tests/Api.Tests/Api.Tests.csproj" --filter-class "*ClientServiceTests*" --filter-class "*InvoiceTests*"');
  });

  it("keeps --filter for MSTest on MTP but still passes the project with --project", () => {
    write("global.json", MTP_GLOBAL_JSON);
    write(project, csproj("MSTest"));
    expect(buildDotnetTestCommand({ cwd: repo, project, classes: ["ClientServiceTests"] }))
      .toBe('dotnet test --project "tests/Api.Tests/Api.Tests.csproj" --filter "FullyQualifiedName~ClientServiceTests"');
  });

  it("uses xUnit filters at the solution level only when every test project is xUnit v3 on MTP", () => {
    write("global.json", MTP_GLOBAL_JSON);
    write("tests/Api.Tests/Api.Tests.csproj", csproj("xunit.v3"));
    expect(buildDotnetTestCommand({ cwd: repo, classes: ["Invoice"] })).toBe('dotnet test --filter-class "*Invoice*"');
    write("tests/Web.Tests/Web.Tests.csproj", csproj("MSTest"));
    expect(buildDotnetTestCommand({ cwd: repo, classes: ["Invoice"] })).toBe('dotnet test --filter "FullyQualifiedName~Invoice"');
  });

  it("runs everything when there are no classes", () => {
    write("global.json", MTP_GLOBAL_JSON);
    write(project, csproj("xunit.v3"));
    expect(buildDotnetTestCommand({ cwd: repo, classes: [] })).toBe("dotnet test");
    expect(buildDotnetTestCommand({ cwd: repo, project, classes: [] })).toBe('dotnet test --project "tests/Api.Tests/Api.Tests.csproj"');
  });
});

describe("impact gate on an xUnit v3 + MTP repo (meta #318)", () => {
  it("builds MTP commands per test project", () => {
    write("global.json", MTP_GLOBAL_JSON);
    write("tests/Api.Tests/Api.Tests.csproj", csproj("xunit.v3"));
    const out = buildImpactCommands({
      cwd: repo,
      tests: ["tests/Api.Tests/ClientServiceTests.cs", "tests/Api.Tests/Billing/InvoiceTests.cs"],
      config: { command: null },
    });
    expect(out.commands).toEqual([
      'dotnet test --project "tests/Api.Tests/Api.Tests.csproj" --filter-class "*ClientServiceTests*" --filter-class "*InvoiceTests*"',
    ]);
  });
});

describe("forge_fix_proposal incident gate on an xUnit v3 + MTP repo (meta #318)", () => {
  it("writes an MTP gate into the generated fix plan", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    write("global.json", MTP_GLOBAL_JSON);
    write("Billing.sln", "\n");
    write("tests/Billing.Tests/Billing.Tests.csproj", csproj("xunit.v3"));
    write(".forge/incidents.jsonl", `${JSON.stringify({ id: "INC-318", description: "Invoice totals drift", files: ["src/Billing/InvoiceService.cs"] })}\n`);

    const res = await _callToolHandler_054_forge_fix_proposal(
      { params: { name: "forge_fix_proposal" } },
      { path: repo, source: "incident", incidentId: "INC-318" },
    );
    expect(res.isError, res.content[0].text).toBe(false);
    const plan = readFileSync(join(repo, "docs", "plans", "auto", "LIVEGUARD-FIX-INC-318.md"), "utf8");
    expect(plan).toContain('dotnet test --filter-class "*InvoiceService*"');
    expect(plan).not.toContain("FullyQualifiedName~");
  });
});

describe(".NET tempering adapter on Microsoft.Testing.Platform (meta #318)", () => {
  it("parses the VSTest summary line and the MTP summary block (last aggregate wins)", () => {
    expect(parseDotnetSummary("Failed: 1, Passed: 42, Skipped: 2, Total: 45", "", 1))
      .toEqual({ pass: 42, fail: 1, skipped: 2, coverage: null });
    const mtp = [
      "Test run summary: Failed! - bin/Debug/net10.0/Api.Tests.dll (net10.0|x64)",
      "  total: 5", "  failed: 2", "  succeeded: 3", "  skipped: 0", "  duration: 121ms",
      "Test run summary: Failed!",
      "  total: 12", "  failed: 2", "  succeeded: 9", "  skipped: 1", "  duration: 2s",
    ].join("\n");
    expect(parseDotnetSummary(mtp, "", 1)).toEqual({ pass: 9, fail: 2, skipped: 1, coverage: null });
    expect(parseDotnetSummary("build failed", "", 1)).toEqual({ pass: 0, fail: 1, skipped: 0, coverage: null });
  });

  it("selects integration tests with --filter-query on xUnit v3 + MTP and keeps --filter elsewhere", () => {
    write("tests/Api.Tests/Api.Tests.csproj", csproj("xunit.v3"));
    expect(dotnetAdapter.integration.resolveCmd(repo)).toEqual(dotnetAdapter.integration.cmd);
    expect(dotnetAdapter.integration.cmd).toContain("Category=Integration|FullyQualifiedName~Integration");

    write("global.json", MTP_GLOBAL_JSON);
    expect(dotnetAdapter.integration.resolveCmd(repo)).toEqual([
      "dotnet", "test", "--nologo", "--no-restore",
      "--filter-query", "/[Category=Integration]",
      "--filter-query", "/*/*Integration*",
      "--filter-query", "/*/*/*Integration*",
    ]);
  });

  function fakeSpawn() {
    const calls = [];
    const spawn = (bin, args) => {
      calls.push([bin, ...args]);
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from("  total: 4\n  failed: 0\n  succeeded: 4\n  skipped: 0\n"));
        proc.emit("close", 0, null);
      }, 0);
      return proc;
    };
    spawn.calls = calls;
    return spawn;
  }
  const scannerConfig = { enabled: true, scanners: { integration: true }, runtimeBudgets: { integrationMaxMs: 60_000 } };

  it("runScanner runs and records the command resolveCmd picks for the project", async () => {
    write("global.json", MTP_GLOBAL_JSON);
    write("tests/Api.Tests/Api.Tests.csproj", csproj("xunit.v3"));
    const spawn = fakeSpawn();
    const r = await runScanner({ scanner: "integration", config: scannerConfig, stack: "dotnet", adapter: dotnetAdapter, cwd: repo, spawn });
    expect(spawn.calls[0]).toContain("--filter-query");
    expect(r.cmd).toContain("--filter-query");
    expect(r).toMatchObject({ verdict: "pass", pass: 4, fail: 0 });
  });

  it("runScanner falls back to the static cmd when resolveCmd throws", async () => {
    const spawn = fakeSpawn();
    const adapter = { integration: { supported: true, cmd: ["dotnet", "test"], resolveCmd: () => { throw new Error("boom"); }, parseOutput: parseDotnetSummary } };
    const r = await runScanner({ scanner: "integration", config: scannerConfig, stack: "dotnet", adapter, cwd: repo, spawn });
    expect(spawn.calls[0]).toEqual(["dotnet", "test"]);
    expect(r.cmd).toEqual(["dotnet", "test"]);
  });
});
/**
 * Meta-bug #318 — the impact gate and forge_fix_proposal built every .NET gate as
 * `dotnet test <proj> --filter "FullyQualifiedName~A|FullyQualifiedName~B"`. That is
 * VSTest syntax. A .NET 10 repo that opts `dotnet test` into Microsoft.Testing.Platform
 * (global.json test.runner) and runs xUnit v3 rejects it: xUnit v3's MTP runner takes
 * --filter-class / --filter-method / --filter-trait / --filter-query, and MTP-mode
 * `dotnet test` takes the project through --project. Both call sites now build the
 * command through dotnet-test-command.mjs, which reads the runner and framework.
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

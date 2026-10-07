/**
 * .NET tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * Uses `dotnet test --nologo`. Under VSTest the stdout ends with Microsoft's
 * summary line, which xUnit / NUnit / MSTest all produce:
 *     "Failed: 0, Passed: 42, Skipped: 1, Total: 43"
 * Under Microsoft.Testing.Platform (MTP, the .NET 10 global.json opt-in) the
 * summary is a block of lines instead:
 *     total: 43 / failed: 0 / succeeded: 42 / skipped: 1
 * parseDotnetSummary reads either.
 *
 * The `--no-restore` flag assumes a prior `dotnet restore` ran (or a
 * previous `dotnet build`). Projects that need restore-on-run should
 * override in stackOverrides.
 */

import { dotnetFilterSyntax } from "../../dotnet-test-command.mjs";

const VSTEST_SUMMARY = /Failed:\s*(\d+)[\s,|]+Passed:\s*(\d+)[\s,|]+Skipped:\s*(\d+)/i;
// MTP prints one block per test module and a final aggregate; the last count wins.
const MTP_COUNT = (label) => new RegExp(`^\\s*${label}:\\s*(\\d+)\\s*$`, "gim");

function lastCount(text, label) {
  const matches = [...text.matchAll(MTP_COUNT(label))];
  return matches.length > 0 ? parseInt(matches[matches.length - 1][1], 10) : null;
}

/** Pass/fail/skip counts from VSTest or MTP `dotnet test` output; a bare non-zero exit counts as one failure. */
export function parseDotnetSummary(stdout, stderr, exitCode) {
  const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
  const combined = (stdout || "") + "\n" + (stderr || "");
  const vstest = combined.match(VSTEST_SUMMARY);
  if (vstest) {
    result.fail = parseInt(vstest[1], 10) || 0;
    result.pass = parseInt(vstest[2], 10) || 0;
    result.skipped = parseInt(vstest[3], 10) || 0;
    return result;
  }
  const succeeded = lastCount(combined, "succeeded");
  if (succeeded !== null) {
    result.pass = succeeded;
    result.fail = lastCount(combined, "failed") ?? 0;
    result.skipped = lastCount(combined, "skipped") ?? 0;
    return result;
  }
  if (exitCode !== 0) result.fail = 1;
  return result;
}

const PERCENT = 100;
const STRYKER_STATUS_FIELDS = Object.freeze({ Killed: "killed", Survived: "survived", Timeout: "timeout", NoCoverage: "noCoverage" });

/** The Stryker JSON report embedded in the output, or null when there is none. */
function readStrykerReport(stdout, stderr) {
  const combined = (stdout || "") + "\n" + (stderr || "");
  const start = combined.indexOf("{");
  if (start === -1) return null;
  try {
    const report = JSON.parse(combined.slice(start));
    return report && report.files ? report : null;
  } catch {
    return null;
  }
}

/** Mutant counts and score from `dotnet stryker --reporter json`; without a report, a clean exit scores 100. */
export function parseStrykerReport(stdout, stderr, exitCode) {
  const result = { mutationScore: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0, layers: null };
  const report = readStrykerReport(stdout, stderr);
  if (!report) {
    if (exitCode === 0) result.mutationScore = PERCENT;
    return result;
  }
  for (const fileData of Object.values(report.files)) {
    for (const mutant of fileData?.mutants || []) {
      const status = mutant?.status;
      if (Object.hasOwn(STRYKER_STATUS_FIELDS, status)) result[STRYKER_STATUS_FIELDS[status]]++;
    }
  }
  const total = result.killed + result.survived + result.timeout + result.noCoverage;
  result.mutationScore = total > 0 ? (result.killed / total) * PERCENT : 0;
  return result;
}
const INTEGRATION_BASE_CMD = Object.freeze(["dotnet", "test", "--nologo", "--no-restore"]);
// VSTest: a Category=Integration trait, or "Integration" anywhere in the fully qualified name.
const INTEGRATION_CMD = Object.freeze([...INTEGRATION_BASE_CMD, "--filter", "Category=Integration|FullyQualifiedName~Integration"]);
// xUnit v3 on MTP takes no --filter expression; repeated --filter-query values are OR'd:
// the trait, then "Integration" in the namespace, then in the class name.
const INTEGRATION_XUNIT_MTP_QUERIES = Object.freeze(["/[Category=Integration]", "/*/*Integration*", "/*/*/*Integration*"]);

export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["dotnet", "test", "--nologo", "--no-restore", "--verbosity", "minimal"],
    parseOutput: parseDotnetSummary,
  },
  integration: {
    supported: true,
    // Integration suites are typically separate projects filtered by
    // category or namespace, so xUnit / NUnit / MSTest projects that tag
    // integration tests can be selected.
    cmd: INTEGRATION_CMD,
    resolveCmd(cwd) {
      if (dotnetFilterSyntax({ cwd }) !== "xunit-mtp") return [...INTEGRATION_CMD];
      return [...INTEGRATION_BASE_CMD, ...INTEGRATION_XUNIT_MTP_QUERIES.flatMap((q) => ["--filter-query", q])];
    },
    parseOutput: parseDotnetSummary,
  },
  mutation: {
    supported: true,
    cmd: ["dotnet", "stryker", "--reporter", "json"],
    parseOutput: parseStrykerReport,
  },
};

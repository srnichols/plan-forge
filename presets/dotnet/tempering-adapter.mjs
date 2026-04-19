/**
 * .NET tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * Uses `dotnet test --nologo` so the stdout is dominated by Microsoft's
 * standard summary line:
 *     "Failed: 0, Passed: 42, Skipped: 1, Total: 43"
 * which all test runners (xUnit / NUnit / MSTest) produce.
 *
 * The `--no-restore` flag assumes a prior `dotnet restore` ran (or a
 * previous `dotnet build`). Projects that need restore-on-run should
 * override in stackOverrides.
 */
export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["dotnet", "test", "--nologo", "--no-restore", "--verbosity", "minimal"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      // Handle both comma-separated and pipe-separated variants that
      // dotnet emits across versions.
      const m = combined.match(
        /Failed:\s*(\d+)[\s,|]+Passed:\s*(\d+)[\s,|]+Skipped:\s*(\d+)/i,
      );
      if (m) {
        result.fail = parseInt(m[1], 10) || 0;
        result.pass = parseInt(m[2], 10) || 0;
        result.skipped = parseInt(m[3], 10) || 0;
        return result;
      }
      if (exitCode !== 0) result.fail = 1;
      return result;
    },
  },
  integration: {
    supported: true,
    // Integration suites are typically separate projects filtered by
    // category or namespace. We pass --filter so xUnit / NUnit /
    // MSTest projects that tag integration tests can be selected.
    cmd: ["dotnet", "test", "--nologo", "--no-restore", "--filter", "Category=Integration|FullyQualifiedName~Integration"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      const m = combined.match(
        /Failed:\s*(\d+)[\s,|]+Passed:\s*(\d+)[\s,|]+Skipped:\s*(\d+)/i,
      );
      if (m) {
        result.fail = parseInt(m[1], 10) || 0;
        result.pass = parseInt(m[2], 10) || 0;
        result.skipped = parseInt(m[3], 10) || 0;
        return result;
      }
      if (exitCode !== 0) result.fail = 1;
      return result;
    },
  },
};

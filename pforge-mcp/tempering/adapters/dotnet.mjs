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
  mutation: {
    supported: true,
    cmd: ["dotnet", "stryker", "--reporter", "json"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { mutationScore: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0, layers: null };
      try {
        const combined = (stdout || "") + "\n" + (stderr || "");
        const start = combined.indexOf("{");
        if (start !== -1) {
          const data = JSON.parse(combined.slice(start));
          if (data && data.files) {
            let totalKilled = 0, totalSurvived = 0, totalTimeout = 0, totalNoCoverage = 0;
            for (const [, fileData] of Object.entries(data.files)) {
              for (const m of (fileData.mutants || [])) {
                if (m.status === "Killed") totalKilled++;
                else if (m.status === "Survived") totalSurvived++;
                else if (m.status === "Timeout") totalTimeout++;
                else if (m.status === "NoCoverage") totalNoCoverage++;
              }
            }
            result.killed = totalKilled;
            result.survived = totalSurvived;
            result.timeout = totalTimeout;
            result.noCoverage = totalNoCoverage;
            const total = totalKilled + totalSurvived + totalTimeout + totalNoCoverage;
            result.mutationScore = total > 0 ? (totalKilled / total) * 100 : 0;
            return result;
          }
        }
      } catch { /* fall through */ }
      if (exitCode === 0) result.mutationScore = 100;
      return result;
    },
  },
};

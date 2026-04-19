/**
 * TypeScript / JavaScript tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * Defaults to Vitest's JSON reporter — it's the only reporter that
 * emits a summary block reliably parseable without a file write.
 * Projects using Jest should set `unit.cmd` in their
 * `.forge/tempering/config.json` stackOverrides (landing in a later
 * phase); the default here picks the most popular modern runner.
 *
 * Coverage is deferred to TEMPER-01's scan — this scanner returns
 * `coverage: null` by design; the scan phase owns lcov/istanbul/etc.
 */
export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["npx", "--no-install", "vitest", "run", "--reporter=json"],
    /**
     * Vitest JSON reporter emits a single JSON document on stdout.
     * Shape (truncated): { numTotalTests, numPassedTests,
     * numFailedTests, numPendingTests, numTodoTests, testResults: [...] }
     *
     * @param {string} stdout
     * @param {string} stderr
     * @param {number} exitCode
     */
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      try {
        // Vitest sometimes prefixes output with progress lines. Find the
        // first `{` that begins a JSON object and parse from there.
        const start = stdout.indexOf("{");
        if (start !== -1) {
          const candidate = stdout.slice(start);
          const data = JSON.parse(candidate);
          if (data && typeof data === "object") {
            result.pass = Number.isFinite(data.numPassedTests) ? data.numPassedTests : 0;
            result.fail = Number.isFinite(data.numFailedTests) ? data.numFailedTests : 0;
            result.skipped = (Number.isFinite(data.numPendingTests) ? data.numPendingTests : 0)
              + (Number.isFinite(data.numTodoTests) ? data.numTodoTests : 0);
            return result;
          }
        }
      } catch { /* fall through to exit-code fallback */ }
      // No parseable JSON — trust exit code
      if (exitCode !== 0) result.fail = 1;
      return result;
    },
  },
  integration: {
    supported: true,
    // Integration tests are typically Vitest runs against a different
    // glob; projects that use Jest/Playwright/Cypress for integration
    // should override via stackOverrides in a later phase.
    cmd: ["npx", "--no-install", "vitest", "run", "--reporter=json", "--dir", "tests/integration"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      try {
        const start = stdout.indexOf("{");
        if (start !== -1) {
          const data = JSON.parse(stdout.slice(start));
          if (data && typeof data === "object") {
            result.pass = Number.isFinite(data.numPassedTests) ? data.numPassedTests : 0;
            result.fail = Number.isFinite(data.numFailedTests) ? data.numFailedTests : 0;
            result.skipped = (Number.isFinite(data.numPendingTests) ? data.numPendingTests : 0)
              + (Number.isFinite(data.numTodoTests) ? data.numTodoTests : 0);
            return result;
          }
        }
      } catch { /* fall through */ }
      if (exitCode !== 0) result.fail = 1;
      return result;
    },
  },
};

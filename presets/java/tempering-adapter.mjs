/**
 * Java / Kotlin tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * Defaults to Maven + Surefire since Maven projects dominate the
 * enterprise Java landscape. Gradle projects override in
 * stackOverrides (future slice).
 *
 * Surefire summary format (stable across decades):
 *     "Tests run: 12, Failures: 1, Errors: 0, Skipped: 2"
 */
export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["mvn", "test", "-q", "-Dsurefire.useFile=false"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      // Surefire may emit multiple "Tests run:" lines — the final one
      // is the aggregate. Pick the last match.
      const re = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/gi;
      let match;
      let last = null;
      while ((match = re.exec(combined)) !== null) last = match;
      if (last) {
        const total = parseInt(last[1], 10) || 0;
        const failures = parseInt(last[2], 10) || 0;
        const errors = parseInt(last[3], 10) || 0;
        const skipped = parseInt(last[4], 10) || 0;
        result.fail = failures + errors;
        result.skipped = skipped;
        result.pass = Math.max(0, total - failures - errors - skipped);
        return result;
      }
      if (exitCode !== 0) result.fail = 1;
      return result;
    },
  },
  integration: {
    supported: false,
    reason: "lands-in-TEMPER-02-slice-02.2",
  },
};

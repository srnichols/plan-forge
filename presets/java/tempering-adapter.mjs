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
    supported: true,
    // Maven convention for integration tests is the `verify` phase
    // which runs failsafe (integration) after surefire (unit). We
    // invoke failsafe directly so we don't re-run unit tests.
    cmd: ["mvn", "failsafe:integration-test", "failsafe:verify", "-q"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      // Failsafe uses the same "Tests run" summary format as Surefire.
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
  mutation: {
    supported: true,
    cmd: ["mvn", "org.pitest:pitest-maven:mutationCoverage", "-DoutputFormats=JSON"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { mutationScore: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0, layers: null };
      try {
        const combined = (stdout || "") + "\n" + (stderr || "");
        // PIT summary: ">> Generated N mutations Killed N (XX%)"
        const pitSummary = combined.match(/Generated\s+(\d+)\s+mutations.*?Killed\s+(\d+)\s*\((\d+)%\)/i);
        if (pitSummary) {
          const total = parseInt(pitSummary[1], 10) || 0;
          result.killed = parseInt(pitSummary[2], 10) || 0;
          result.mutationScore = parseInt(pitSummary[3], 10) || 0;
          result.survived = total - result.killed;
          return result;
        }
        // Try JSON parse
        const start = combined.indexOf("[");
        if (start !== -1) {
          const data = JSON.parse(combined.slice(start));
          if (Array.isArray(data)) {
            for (const m of data) {
              if (m.status === "KILLED") result.killed++;
              else if (m.status === "SURVIVED") result.survived++;
              else if (m.status === "TIMED_OUT") result.timeout++;
              else if (m.status === "NO_COVERAGE") result.noCoverage++;
            }
            const total = result.killed + result.survived + result.timeout + result.noCoverage;
            result.mutationScore = total > 0 ? (result.killed / total) * 100 : 0;
            return result;
          }
        }
      } catch { /* fall through */ }
      if (exitCode === 0) result.mutationScore = 100;
      return result;
    },
  },
};

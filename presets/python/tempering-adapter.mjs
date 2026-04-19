/**
 * Python tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * pytest is the de-facto standard. The `--tb=short -q` flags produce
 * a single summary line we can parse:
 *     "3 passed, 1 failed, 2 skipped in 0.45s"
 * unittest-based projects should override in stackOverrides.
 */
export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["pytest", "--tb=short", "-q"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      const pass = combined.match(/(\d+)\s+passed/);
      const fail = combined.match(/(\d+)\s+failed/);
      const error = combined.match(/(\d+)\s+error/);
      const skip = combined.match(/(\d+)\s+skipped/);
      if (pass) result.pass = parseInt(pass[1], 10) || 0;
      if (fail) result.fail = parseInt(fail[1], 10) || 0;
      if (error) result.fail += parseInt(error[1], 10) || 0;
      if (skip) result.skipped = parseInt(skip[1], 10) || 0;
      if (!pass && !fail && !error && !skip && exitCode !== 0) {
        result.fail = 1;
      }
      return result;
    },
  },
  integration: {
    supported: true,
    // pytest convention: integration tests live under tests/integration
    // or are marked with `@pytest.mark.integration`. We try the path
    // first since it's the more explicit convention.
    cmd: ["pytest", "--tb=short", "-q", "tests/integration"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      const pass = combined.match(/(\d+)\s+passed/);
      const fail = combined.match(/(\d+)\s+failed/);
      const error = combined.match(/(\d+)\s+error/);
      const skip = combined.match(/(\d+)\s+skipped/);
      if (pass) result.pass = parseInt(pass[1], 10) || 0;
      if (fail) result.fail = parseInt(fail[1], 10) || 0;
      if (error) result.fail += parseInt(error[1], 10) || 0;
      if (skip) result.skipped = parseInt(skip[1], 10) || 0;
      if (!pass && !fail && !error && !skip && exitCode !== 0) {
        result.fail = 1;
      }
      return result;
    },
  },
};

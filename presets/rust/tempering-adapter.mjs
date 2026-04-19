/**
 * Rust tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * `cargo test` emits a stable final summary per test binary:
 *     "test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out"
 * We sum across all binaries (workspaces produce one per crate).
 */
export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["cargo", "test", "--quiet"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      const re = /test result:\s*\w+\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/gi;
      let match;
      let matched = false;
      while ((match = re.exec(combined)) !== null) {
        matched = true;
        result.pass += parseInt(match[1], 10) || 0;
        result.fail += parseInt(match[2], 10) || 0;
        result.skipped += parseInt(match[3], 10) || 0;
      }
      if (!matched && exitCode !== 0) result.fail = 1;
      return result;
    },
  },
  integration: {
    supported: true,
    // Rust integration tests live under tests/*.rs by convention and
    // are compiled as separate binaries. `cargo test --tests` runs
    // them; `--test '*'` scopes to only integration binaries.
    cmd: ["cargo", "test", "--quiet", "--tests"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const combined = (stdout || "") + "\n" + (stderr || "");
      const re = /test result:\s*\w+\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/gi;
      let match;
      let matched = false;
      while ((match = re.exec(combined)) !== null) {
        matched = true;
        result.pass += parseInt(match[1], 10) || 0;
        result.fail += parseInt(match[2], 10) || 0;
        result.skipped += parseInt(match[3], 10) || 0;
      }
      if (!matched && exitCode !== 0) result.fail = 1;
      return result;
    },
  },
};

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
  mutation: {
    supported: true,
    cmd: ["cargo", "mutants", "--json"],
    parseOutput(stdout, stderr, exitCode) {
      const result = { mutationScore: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0, layers: null };
      try {
        // cargo-mutants JSON: array of outcome objects
        const lines = (stdout || "").split(/\r?\n/);
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.charAt(0) !== "{") continue;
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          if (!evt || typeof evt !== "object") continue;
          const outcome = (evt.outcome || evt.status || "").toLowerCase();
          if (outcome === "killed" || outcome === "caught") result.killed++;
          else if (outcome === "survived" || outcome === "missed") result.survived++;
          else if (outcome === "timeout") result.timeout++;
          else if (outcome === "unviable") result.noCoverage++;
        }
      } catch { /* fall through */ }
      const total = result.killed + result.survived + result.timeout + result.noCoverage;
      result.mutationScore = total > 0 ? (result.killed / total) * 100 : null;
      if (result.mutationScore == null && exitCode === 0) result.mutationScore = 100;
      return result;
    },
  },
};

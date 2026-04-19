/**
 * Go tempering adapter (Phase TEMPER-02 Slice 02.1)
 *
 * `go test -json ./...` streams newline-delimited JSON events. Each
 * event has `{ Action: "pass"|"fail"|"skip"|"run"|"output", Test, Package }`.
 * We count Action events that carry a Test name (ignoring package-level
 * aggregates). This matches Go's test count as reported by `-v`.
 */
export const temperingAdapter = {
  unit: {
    supported: true,
    cmd: ["go", "test", "-json", "./..."],
    parseOutput(stdout, stderr, exitCode) {
      const result = { pass: 0, fail: 0, skipped: 0, coverage: null };
      const lines = (stdout || "").split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.charAt(0) !== "{") continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (!evt || typeof evt !== "object" || !evt.Test) continue;
        // Sub-tests are distinct entries; counting every Action with a
        // Test gives the right total.
        if (evt.Action === "pass") result.pass++;
        else if (evt.Action === "fail") result.fail++;
        else if (evt.Action === "skip") result.skipped++;
      }
      if (result.pass === 0 && result.fail === 0 && result.skipped === 0 && exitCode !== 0) {
        result.fail = 1;
      }
      return result;
    },
  },
  integration: {
    supported: false,
    reason: "lands-in-TEMPER-02-slice-02.2",
  },
};

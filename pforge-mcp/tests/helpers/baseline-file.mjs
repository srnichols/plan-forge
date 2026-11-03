import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Set to 1 to re-record the committed baselines instead of comparing with them. */
export const UPDATE_BASELINES_ENV = "PFORGE_UPDATE_BASELINES";

const DEFAULT_IO = Object.freeze({
  exists: existsSync,
  read: (file) => readFileSync(file, "utf8"),
  write: (file, text) => writeFileSync(file, text),
});

const encode = (record) => `${JSON.stringify(record, null, 2)}\n`;

function differences(expected = [], actual) {
  return {
    missing: expected.filter((line) => !actual.includes(line)),
    unexpected: actual.filter((line) => !expected.includes(line)),
  };
}

/**
 * Compare what each shell reported with the baseline committed at `file`.
 *
 * Only the shells in `results` are compared, so a machine that can run one shell does not fail for the other. A
 * run never changes the file; it is re-recorded only when PFORGE_UPDATE_BASELINES=1, and then each shell that ran
 * replaces its own entry while the others keep theirs.
 *
 * @param {{ file: string, results: Record<string, string[]>, env?: NodeJS.ProcessEnv, io?: typeof DEFAULT_IO }} options
 * @returns {{ updated: boolean, mismatches: Array<{ shell: string, missing: string[], unexpected: string[] }> }}
 */
export function checkBaseline({ file, results, env = process.env, io = DEFAULT_IO }) {
  const committed = io.exists(file) ? JSON.parse(io.read(file)) : {};
  if (env[UPDATE_BASELINES_ENV] === "1") {
    io.write(file, encode({ ...committed, ...results }));
    return { updated: true, mismatches: [] };
  }
  const mismatches = Object.entries(results)
    .map(([shell, lines]) => ({ shell, ...differences(committed[shell], lines) }))
    .filter(({ missing, unexpected }) => missing.length > 0 || unexpected.length > 0);
  return { updated: false, mismatches };
}

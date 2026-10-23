import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

/**
 * Meta-bug #379 — three TypeScript preset files taught `pnpm test -- --run` as
 * the way to run tests without watch mode. pnpm forwards the literal `--`, and
 * Vitest treats everything after it as pass-through options, so `--run` is not
 * the run flag and the command can still start watch mode. #344 added the gate
 * lint `pnpm-forwarded-separator` and fixed the example plan; these docs were
 * missed. The guidance must not teach what the linter rejects.
 *
 * Measured when it was added: 610 files in the shipped surfaces, 3 lines.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SURFACES = [".github", "presets", "templates", "plugins"];
const TEXT_FILE = /\.(md|mdc|json|ya?ml|txt|sh|ps1)$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const RULE = "pnpm-forwarded-separator";

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path)
    .filter((name) => !SKIPPED_DIRECTORIES.has(name))
    .flatMap((name) => filesUnder(join(path, name)));
}

/** The commands a documentation line shows: its inline code spans, and the line itself minus a trailing `# comment`. */
function commandsIn(line) {
  const spans = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  return [line.replace(/\s+#.*$/, "").trim(), ...spans].filter((text) => /\bpnpm\b/.test(text));
}

const files = SURFACES.flatMap((surface) => filesUnder(join(REPO_ROOT, surface))).filter((file) => TEXT_FILE.test(file));
const shown = files.flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/).flatMap((text, index) => (
  commandsIn(text).map((command) => ({ where: `${relative(REPO_ROOT, file).replace(/\\/g, "/")}:${index + 1}`, command }))
)));

const rejectedByLinter = (command) => lintGateCommands({ slices: [{ number: "1", validationGate: command }] })
  .warnings.some((warning) => warning.rule === RULE);

describe("shipped guidance does not teach the pnpm forwarded-separator form (#379)", () => {
  it("looks at a real corpus, so an empty scan cannot pass", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(shown.length).toBeGreaterThan(5);
  });

  it("recognises the form it is looking for", () => {
    expect(rejectedByLinter("pnpm test -- --run")).toBe(true);
    expect(rejectedByLinter("pnpm exec vitest run")).toBe(false);
  });

  it("shows no command the gate linter rejects for it", () => {
    const rejected = shown.filter(({ command }) => rejectedByLinter(command)).map(({ where, command }) => `${where}: ${command}`);
    expect(rejected).toEqual([]);
  });
});

// Regression guard for bug #217: production code must never build a shell
// command by interpolating values into an exec()/execSync() template literal.
// Those constructs invoke a shell and let any interpolated value inject
// arbitrary commands. The safe form is execFileSync(file, [args], opts), which
// passes each argument verbatim to the kernel with no shell involved.
//
// The offending shape is `exec(` or `execSync(` immediately followed by a
// backtick template that contains a `${...}` interpolation. We assemble the
// matcher with RegExp from pieces (never a literal of that shape) so this
// guard file does not match itself.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const PKG_ROOT = resolve(import.meta.dirname, "..");
const BACKTICK = String.fromCharCode(96);
// exec( or execSync( → whitespace → backtick → any non-backtick chars → ${
const SHELL_INTERP_EXEC = new RegExp(
  ["exec", "(?:Sync)?", "\\(", "\\s*", BACKTICK, "[^" + BACKTICK + "]*", "\\$\\{"].join(""),
);

/** Recursively collect production .mjs files, skipping node_modules and tests. */
function collectSourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "tests") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (name.endsWith(".mjs")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("bug #217 — no shell-injection exec() in production code", () => {
  it("no production .mjs builds a shell command from an interpolated template", () => {
    const offenders = [];
    for (const file of collectSourceFiles(PKG_ROOT)) {
      const src = readFileSync(file, "utf-8");
      src.split(/\r?\n/).forEach((line, i) => {
        if (SHELL_INTERP_EXEC.test(line)) {
          offenders.push(`${file.replace(PKG_ROOT, "pforge-mcp")}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `shell-injection exec() sites found:\n${offenders.join("\n")}`).toEqual([]);
  });
});

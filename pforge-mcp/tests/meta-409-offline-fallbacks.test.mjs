import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Meta-bug #409 — pforge.sh runs under `set -euo pipefail`, and `x=$(curl -sf ...)` ends the script when the
 * request fails (offline, rate-limited, timed out, nothing listening). Two commands wrote a fallback after
 * such a request that therefore never ran:
 *
 *   - `pforge smith` stopped at "Version Currency:" when the GitHub releases API call failed (the test of
 *     that is smith-auto-update-status.test.mjs), and
 *   - `pforge org-rules export` ended right after its banner, with exit 7, when the local MCP server was not
 *     running, instead of reading the project's own rules (the "Fallback: inline Node.js").
 *
 * pforge.ps1 has try/catch in both places and always worked.
 */

const REPO = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const hasScript = existsSync(join(REPO, "pforge.sh"));
// A proxy nothing listens on: curl fails at once, and nothing on this machine, a running MCP server included, is reached.
const DEAD_PROXY = "http://127.0.0.1:1";
const OFFLINE = { https_proxy: DEAD_PROXY, HTTPS_PROXY: DEAD_PROXY, http_proxy: DEAD_PROXY, HTTP_PROXY: DEAD_PROXY, no_proxy: "", NO_PROXY: "" };

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function project() {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-409-"));
  dirs.push(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  copyFileSync(join(REPO, "pforge.sh"), join(dir, "pforge.sh"));
  writeFileSync(join(dir, ".forge.json"), JSON.stringify({ projectName: "x", preset: "custom", templateVersion: "9.9.8" }));
  return dir;
}

const diagnose = (run) => `exit ${run.status}${run.signal ? ` (signal ${run.signal})` : ""}; output:\n${`${run.stdout}${run.stderr}`.split(/\r?\n/).slice(-8).join("\n")}`;

/**
 * The curl or wget calls of a shell script that a failure ends the script on, as "line: text". Under
 * `set -e` a failing call is safe only as a condition (`if`, `while`, `until`, `elif`) or when a `||` or
 * `&&` follows it in its statement; a statement continues over lines that end in a backslash.
 */
const FETCH = /(?:^|\$\(|`|[;&|{]|\b(?:then|do|else)\b)\s*(?:eval\s+)?(?:curl|wget)\b/;
const IN_CONDITION = /^\s*(?:if|elif|while|until)\b[^;]*$/;
function unguardedFetches(source) {
  const lines = source.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].search(FETCH);
    if (at === -1 || /^\s*#/.test(lines[i]) || IN_CONDITION.test(lines[i].slice(0, at))) continue;
    let end = i;
    while (end < lines.length - 1 && /\\\s*$/.test(lines[end])) end++;
    const statement = [lines[i].slice(at), ...lines.slice(i + 1, end + 1)].join("\n");
    if (!/\|\||&&/.test(statement)) found.push(`${i + 1}: ${lines[i].trim()}`);
  }
  return found;
}

describe.skipIf(!BASH || !hasScript)("pforge.sh keeps the fallback it documents when a request fails (#409)", () => {
  it("org-rules export reads the project's own rules when the MCP server cannot be reached", () => {
    const dir = project();
    mkdirSync(join(dir, ".github", "instructions"), { recursive: true });
    writeFileSync(join(dir, ".github", "instructions", "alpha.instructions.md"), "---\napplyTo: '**'\n---\n\nRULE-ALPHA keeps the layers apart.\n");
    writeFileSync(join(dir, "PROJECT-PRINCIPLES.md"), "RULE-BETA never skips the tests.\n");
    const r = spawnSync(BASH, ["pforge.sh", "org-rules", "export", "--output", "out.md"], { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env, ...OFFLINE } });
    expect(r.status, diagnose(r)).toBe(0);
    expect(r.stdout, diagnose(r)).toContain("Exported to: out.md");
    const exported = readFileSync(join(dir, "out.md"), "utf8");
    expect(exported).toContain("RULE-ALPHA keeps the layers apart.");
    expect(exported).toContain("RULE-BETA never skips the tests.");
  }, 130_000);
});

describe.skipIf(!hasScript)("pforge.sh has no request that a failure can end the script on (#409)", () => {
  it("every curl or wget call is guarded", () => {
    expect(unguardedFetches(readFileSync(join(REPO, "pforge.sh"), "utf8"))).toEqual([]);
  });

  it("the scan reports an unguarded call and accepts a guarded one", () => {
    expect(unguardedFetches('x="$(curl -sf "$u")"\n')).toHaveLength(1);
    expect(unguardedFetches('x=$(curl -s -o f -w "%{http_code}" \\\n    --max-time 5 2>/dev/null)\n')).toHaveLength(1);
    expect(unguardedFetches('x=$(eval curl -sf "$u")\n')).toHaveLength(1);
    expect(unguardedFetches('x=`curl -sf "$u"`\n')).toHaveLength(1);
    expect(unguardedFetches('curl -sf "$u" > f\n')).toHaveLength(1);
    expect(unguardedFetches('wget -q "$u"\n')).toHaveLength(1);
    expect(unguardedFetches('echo ok; curl -s "$u" >/dev/null\n')).toHaveLength(1);
    expect(unguardedFetches('foo || x=$(curl -sf "$u")\n')).toHaveLength(1);
    expect(unguardedFetches('if [ -f x ]; then curl -sf "$u" > f; fi\n')).toHaveLength(1);
    expect(unguardedFetches('x="$(curl -sf "$u")" || x=""\n')).toEqual([]);
    expect(unguardedFetches('x=$(curl -sf -X POST "$u" \\\n    -d "$b") || {\n  echo e\n}\n')).toEqual([]);
    expect(unguardedFetches('x=$(eval curl -sf "$u" \\\n    ${auth}) || exit 1\n')).toEqual([]);
    expect(unguardedFetches('x=$(curl -s "$u" --max-time 30 2>/dev/null || echo "000")\n')).toEqual([]);
    expect(unguardedFetches('curl -sf "$u" > f || exit 1\n')).toEqual([]);
    expect(unguardedFetches('curl -sf "$u" >/dev/null 2>&1 && echo up\n')).toEqual([]);
    expect(unguardedFetches('if curl -sf "$u" >/dev/null; then :; fi\n')).toEqual([]);
    expect(unguardedFetches('if x=$(curl -sf "$u"); then :; fi\n')).toEqual([]);
    expect(unguardedFetches('while ! x=$(curl -sf "$u"); do sleep 1; done\n')).toEqual([]);
    expect(unguardedFetches('if a; then :\nelif x=$(curl -sf "$u"); then :; fi\n')).toEqual([]);
    expect(unguardedFetches('until x=$(curl -sf "$u"); do sleep 1; done\n')).toEqual([]);
    expect(unguardedFetches('# wait for it; curl -s "$u" polls\n')).toEqual([]);
    expect(unguardedFetches('if ! command -v curl >/dev/null; then echo "curl not found"; fi\n# curl is optional\n')).toEqual([]);
  });
});

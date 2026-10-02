/**
 * Plan Forge — is this Node.js supported? Used by `pforge smith` in both shells.
 *
 *   node node-support.mjs [--package <pforge-mcp/package.json>] [--fields]
 *
 * Prints one JSON line: { version, floor, status, eol, daysLeft } where status is
 *   ok            at or above the floor and not near end of life
 *   below-floor   older than plan-forge-mcp's engines.node
 *   eol           the release line's end-of-life date has passed
 *   eol-soon      end of life within EOL_WARN_DAYS
 * The floor comes from engines.node so it cannot drift from package.json.
 *
 * @module node-support
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Used when package.json is missing or its engines.node is not a plain ">=X.Y.Z". */
export const FALLBACK_FLOOR = "22.12.0";
export const EOL_WARN_DAYS = 180;
const DAY_MS = 86_400_000;
const SEMVER_PARTS = 3;

/** End of life per release line, from the Node.js release schedule (nodejs.org/en/about/previous-releases). */
export const NODE_EOL = Object.freeze({
  18: "2025-04-30",
  20: "2026-04-30",
  22: "2027-04-30",
  24: "2028-04-30",
  26: "2029-04-30",
});

function parts(version) {
  return String(version).replace(/^v/, "").split(/[.-]/).slice(0, SEMVER_PARTS).map((p) => Number.parseInt(p, 10) || 0);
}

export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** plan-forge-mcp's engines.node floor as "X.Y.Z". */
export function readFloor(packagePath) {
  try {
    const range = JSON.parse(readFileSync(packagePath, "utf8")).engines?.node ?? "";
    const m = /^>=\s*(\d+\.\d+\.\d+)$/.exec(range.trim());
    return m ? m[1] : FALLBACK_FLOOR;
  } catch {
    return FALLBACK_FLOOR;
  }
}

export function assessNode({ version, floor, now = Date.now() }) {
  const major = parts(version)[0];
  const eol = NODE_EOL[major] ?? null;
  const daysLeft = eol ? Math.floor((Date.parse(eol) - now) / DAY_MS) : null;
  let status = "ok";
  if (compareVersions(version, floor) < 0) status = "below-floor";
  else if (daysLeft !== null && daysLeft < 0) status = "eol";
  else if (daysLeft !== null && daysLeft <= EOL_WARN_DAYS) status = "eol-soon";
  return { version: String(version).replace(/^v/, ""), floor, status, eol, daysLeft };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--package");
  const pkg = at > 0 ? process.argv[at + 1] : join(dirname(fileURLToPath(import.meta.url)), "package.json");
  const floor = existsSync(pkg) ? readFloor(pkg) : FALLBACK_FLOOR;
  const r = assessNode({ version: process.versions.node, floor });
  // --fields: "status|floor|eol|daysLeft" for shells without a JSON parser.
  const out = process.argv.includes("--fields") ? [r.status, r.floor, r.eol ?? "", r.daysLeft ?? ""].join("|") : JSON.stringify(r);
  process.stdout.write(`${out}\n`);
}

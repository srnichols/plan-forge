/** Plan Forge — Phase-55 S1: architecture-guardrails sub-module (extracted from run-plan.mjs) */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { parseSlices, loadPlanParserConfig } from "../plan-parser.mjs";

// ─── Architecture Guardrail Rules ────────────────────────────────────
const GUARDRAIL_RULES = [
  { id: "empty-catch",     pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*)?\s*\}|catch\s*(?:\([^)]*\))?\s*\{\s*\/\*[^*]*\*\/\s*\}/g, severity: "high",     description: "Empty catch block — must log or handle the error (comments alone don't count)" },
  { id: "any-type",        pattern: /:\s*any\b|<any>|as\s+any\b/g,                             severity: "medium",   description: "Avoid 'any' type — use explicit types" },
  { id: "sync-over-async", pattern: /\.(Result|Wait\(\))\b/g,                                  severity: "high",     description: "Sync-over-async (.Result/.Wait()) — use await instead" },
  { id: "sql-injection",   pattern: /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^`]*\$\{/gi, severity: "critical", description: "SQL string interpolation — use parameterized queries" },
  { id: "deferred-work",   pattern: /\b(TODO|FIXME|HACK)\b/g,                                  severity: "low",      description: "Deferred work marker in production code" },
];

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".cs", ".py"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "bin", "obj", "dist", ".forge", "vendor", "coverage", ".next", "out"]);

/** Framework paths that belong to Plan Forge itself, not the user's application code. */
const FRAMEWORK_PATHS = ["pforge-mcp", "pforge.ps1", "pforge.sh", "setup.ps1", "setup.sh", "validate-setup.ps1", "validate-setup.sh"];

/**
 * Scan source files for architecture guardrail violations.
 * Called by forge_drift_report to score the codebase without spawning a subprocess.
 * Separates app code violations from framework (Plan Forge) code violations.
 *
 * @param {object} options
 * @param {string} [options.path="."]   - Directory to scan (relative to cwd)
 * @param {string} [options.mode="file"] - Analysis mode (currently only "file" is used)
 * @param {string[]|null} [options.rules=null] - Rule IDs to run; null = all rules
 * @param {string} [options.cwd=process.cwd()] - Project root
 * @returns {Promise<{violations: Array<{file,rule,severity,line,description,framework?:boolean}>, frameworkViolations: Array, filesScanned: number}>}
 */
export async function runAnalyze({ mode = "file", path: targetPath = ".", rules = null, cwd = process.cwd(), planPath = null } = {}) {
  const activeRules = rules
    ? GUARDRAIL_RULES.filter(r => rules.includes(r.id))
    : GUARDRAIL_RULES;

  const rootPath = resolve(cwd, targetPath);
  const violations = [];
  const frameworkViolations = [];
  let filesScanned = 0;

  function isFrameworkPath(relPath) {
    const normalized = relPath.replace(/\\/g, "/");
    return FRAMEWORK_PATHS.some(fp => normalized === fp || normalized.startsWith(fp + "/"));
  }

  function scanDir(dirPath) {
    let entries;
    try { entries = readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) scanDir(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        filesScanned++;
        let content;
        try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
        const relPath = relative(cwd, fullPath);
        const isFramework = isFrameworkPath(relPath);
        const applicableRules = isFramework
          ? activeRules.filter(r => r.id !== "sql-injection") // Skip SQL injection in framework/client-side code
          : activeRules;
        for (const rule of applicableRules) {
          const re = new RegExp(rule.pattern.source, rule.pattern.flags);
          let match;
          while ((match = re.exec(content)) !== null) {
            const line = content.substring(0, match.index).split("\n").length;
            const violation = { file: relPath, rule: rule.id, severity: rule.severity, line, description: rule.description };
            if (isFramework) {
              frameworkViolations.push({ ...violation, framework: true });
            } else {
              violations.push(violation);
            }
          }
        }
      }
    }
  }

  scanDir(rootPath);

  // Phase-31 Slice 2 — plan-parser lint advisories.
  // When planPath is provided, parse the plan and emit an advisory for every
  // slice that has bash code blocks but no explicit **Validation Gate**: marker.
  // Advisory is suppressed when runtime.planParser.implicitGates is true because
  // in that mode parseSlices captures bare bash blocks as the validation gate.
  // Note: we resolve planPath against cwd (not process.cwd()) and call parseSlices
  // directly rather than parsePlan(), which resolves paths against process.cwd().
  const advisories = [];
  if (planPath) {
    try {
      const fullPlanPath = resolve(cwd, planPath);
      const content = readFileSync(fullPlanPath, "utf-8");
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      const { implicitGates } = loadPlanParserConfig(cwd);
      const slices = parseSlices(lines, { implicitGates });
      for (const slice of slices) {
        const bashCount = slice._bashBlockCount || 0;
        if (bashCount > 0 && !slice.validationGate) {
          const blockWord = bashCount === 1 ? "bash block" : "bash blocks";
          advisories.push(
            `ADVISORY plan-parser-gate-missing: Slice ${slice.number} (${slice.title}) has ${bashCount} ${blockWord} but no **Validation Gate**: marker. Add a validation gate or set runtime.planParser.implicitGates = true to suppress.`
          );
        }
      }
    } catch { /* best-effort — missing plan file should not crash runAnalyze */ }
  }

  return { violations, frameworkViolations, filesScanned, advisories };
}

/**
 * Parse the consistency score from `pforge analyze` stdout.
 * Exported for testing — see tests/auto-analyze-issue-189.test.mjs.
 *
 * Looks for either "Consistency Score: NN/100", "NN/100", or "Score: NN".
 * Returns null when no recognizable score line is present.
 */
export function parseAnalyzeScore(output) {
  if (typeof output !== "string" || output.length === 0) return null;
  const match = output.match(/(\d+)\s*\/\s*100|Score:\s*(\d+)/i);
  if (!match) return null;
  const n = parseInt(match[1] || match[2], 10);
  return Number.isFinite(n) ? n : null;
}

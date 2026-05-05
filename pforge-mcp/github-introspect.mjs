/**
 * Plan Forge — GitHub Stack Introspection (Phase GITHUB-A).
 *
 * Inspects a project directory for the GitHub-native AI surface Plan-Forge
 * integrates with: .github/copilot-instructions.md, AGENTS.md,
 * .github/instructions/*, .github/prompts/*, .vscode/mcp.json, GitHub Actions,
 * a github.com remote, and the gh CLI.
 *
 * Strictly read-only and offline by default. Network-backed checks are gated
 * behind an explicit `ghToken` opt-in.
 *
 * Separation of concerns:
 *   - This module does filesystem checks + structured reporting only.
 *   - CLI rendering (✓ / ⚠ / ✗ / ⊘ glyphs, colors, exit codes) lives in the
 *     CLI dispatcher invocation at the bottom of this file.
 *   - MCP tool wrapping lives in server.mjs (added in Slice 4).
 *
 * @module github-introspect
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

/**
 * @typedef {Object} CheckResult
 * @property {string} id - Stable check identifier (e.g. "copilot-instructions")
 * @property {string} label - Human-readable short label
 * @property {"pass"|"warn"|"fail"|"na"} status - Check outcome
 * @property {string} detail - One-line detail about the finding
 * @property {string} [fixHint] - One-line actionable hint when warn/fail
 */

/**
 * @typedef {Object} InspectionResult
 * @property {string} projectRoot - The absolute path that was inspected
 * @property {CheckResult[]} checks - Ordered check results
 * @property {{ pass: number, warn: number, fail: number, na: number, total: number }} summary
 */

/**
 * Order matters — this is the order the CLI prints rows.
 * Keep stable for downstream JSON consumers.
 */
const CHECK_ORDER = [
  "copilot-instructions",
  "agents-md",
  "instructions-dir",
  "prompts-dir",
  "vscode-mcp",
  "actions-workflows",
  "github-remote",
  "gh-cli",
  "copilot-coding-agent-assignable",
];

/**
 * Inspect a project directory's GitHub-native AI surface.
 *
 * @param {string} projectRoot - Absolute path to the project root to inspect
 * @param {{ ghToken?: string|null, extra?: boolean }} [opts]
 *   - `ghToken`: Reserved for Phase GITHUB-B network-backed checks (currently unused).
 *   - `extra`: When true, also runs the SHOULD-tier checks (instruction depth, applyTo usage).
 * @returns {InspectionResult}
 */
export function inspectGithubStack(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const checks = [];

  checks.push(checkCopilotInstructions(root));
  checks.push(checkAgentsMd(root));
  checks.push(checkInstructionsDir(root));
  checks.push(checkPromptsDir(root));
  checks.push(checkVscodeMcp(root));
  checks.push(checkActionsWorkflows(root));
  checks.push(checkGithubRemote(root));
  checks.push(checkGhCli());
  checks.push(checkCopilotCodingAgentAssignable(root, opts));

  if (opts.extra) {
    checks.push(checkCopilotInstructionsDepth(root));
    checks.push(checkInstructionsApplyTo(root));
  }

  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status]++;
      acc.total++;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, na: 0, total: 0 }
  );

  return { projectRoot: root, checks, summary };
}

// ─── individual checks ──────────────────────────────────────────────────────

/** @returns {CheckResult} */
function checkCopilotInstructions(root) {
  const p = join(root, ".github", "copilot-instructions.md");
  if (existsSync(p)) {
    return {
      id: "copilot-instructions",
      label: ".github/copilot-instructions.md",
      status: "pass",
      detail: "present",
    };
  }
  return {
    id: "copilot-instructions",
    label: ".github/copilot-instructions.md",
    status: "fail",
    detail: "file missing",
    fixHint: "Run setup.ps1 / setup.sh to scaffold the GitHub-native surface.",
  };
}

/** @returns {CheckResult} */
function checkAgentsMd(root) {
  const p = join(root, "AGENTS.md");
  if (existsSync(p)) {
    return { id: "agents-md", label: "AGENTS.md", status: "pass", detail: "present at repo root" };
  }
  return {
    id: "agents-md",
    label: "AGENTS.md",
    status: "warn",
    detail: "missing — open agent standard not adopted",
    fixHint: "Run setup.ps1 / setup.sh, or copy templates/AGENTS.md to the repo root.",
  };
}

/** @returns {CheckResult} */
function checkInstructionsDir(root) {
  const dir = join(root, ".github", "instructions");
  if (!existsSync(dir) || !isDir(dir)) {
    return {
      id: "instructions-dir",
      label: ".github/instructions/*.instructions.md",
      status: "fail",
      detail: "directory missing",
      fixHint: "Run setup.ps1 / setup.sh to scaffold path-scoped instruction files.",
    };
  }
  const files = safeReaddir(dir).filter((f) => f.endsWith(".instructions.md"));
  if (files.length === 0) {
    return {
      id: "instructions-dir",
      label: ".github/instructions/*.instructions.md",
      status: "warn",
      detail: "directory exists but contains no *.instructions.md files",
      fixHint: "Add at least one *.instructions.md (see /manual/instructions-agents.html).",
    };
  }
  return {
    id: "instructions-dir",
    label: ".github/instructions/*.instructions.md",
    status: "pass",
    detail: `${files.length} instruction file${files.length === 1 ? "" : "s"} found`,
  };
}

/** @returns {CheckResult} */
function checkPromptsDir(root) {
  const dir = join(root, ".github", "prompts");
  if (!existsSync(dir) || !isDir(dir)) {
    return {
      id: "prompts-dir",
      label: ".github/prompts/*.prompt.md",
      status: "warn",
      detail: "directory missing",
      fixHint: "Run setup.ps1 / setup.sh to scaffold the pipeline prompt files.",
    };
  }
  const files = safeReaddir(dir).filter((f) => f.endsWith(".prompt.md"));
  if (files.length === 0) {
    return {
      id: "prompts-dir",
      label: ".github/prompts/*.prompt.md",
      status: "warn",
      detail: "directory exists but contains no *.prompt.md files",
      fixHint: "Add at least one *.prompt.md (see /manual/your-first-plan.html).",
    };
  }
  return {
    id: "prompts-dir",
    label: ".github/prompts/*.prompt.md",
    status: "pass",
    detail: `${files.length} prompt file${files.length === 1 ? "" : "s"} found`,
  };
}

/** @returns {CheckResult} */
function checkVscodeMcp(root) {
  const p = join(root, ".vscode", "mcp.json");
  if (!existsSync(p)) {
    return {
      id: "vscode-mcp",
      label: ".vscode/mcp.json",
      status: "warn",
      detail: "missing — MCP server not registered for VS Code",
      fixHint: "Run setup.ps1 / setup.sh, or see /manual/mcp-server-quickstart.html.",
    };
  }
  let raw;
  try {
    raw = readFileSync(p, "utf-8");
  } catch {
    return {
      id: "vscode-mcp",
      label: ".vscode/mcp.json",
      status: "warn",
      detail: "file present but unreadable",
      fixHint: "Verify file permissions and JSON syntax.",
    };
  }
  // Loose match — Plan-Forge MCP entries reference plan-forge or pforge-mcp
  const hasPlanForgeEntry = /plan[-_ ]?forge|pforge[-_ ]?mcp/i.test(raw);
  if (!hasPlanForgeEntry) {
    return {
      id: "vscode-mcp",
      label: ".vscode/mcp.json",
      status: "warn",
      detail: "present but no Plan-Forge MCP server entry detected",
      fixHint: "Add a Plan-Forge MCP server entry; see /manual/mcp-server-quickstart.html.",
    };
  }
  return {
    id: "vscode-mcp",
    label: ".vscode/mcp.json",
    status: "pass",
    detail: "Plan-Forge MCP server registered",
  };
}

/** @returns {CheckResult} */
function checkActionsWorkflows(root) {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir) || !isDir(dir)) {
    return {
      id: "actions-workflows",
      label: ".github/workflows/",
      status: "warn",
      detail: "no GitHub Actions workflows present",
      fixHint: "Add a workflow under .github/workflows/ to enable CI on this repo.",
    };
  }
  const files = safeReaddir(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  if (files.length === 0) {
    return {
      id: "actions-workflows",
      label: ".github/workflows/",
      status: "warn",
      detail: "directory exists but contains no .yml workflows",
      fixHint: "Add a workflow under .github/workflows/ to enable CI on this repo.",
    };
  }
  return {
    id: "actions-workflows",
    label: ".github/workflows/",
    status: "pass",
    detail: `${files.length} workflow file${files.length === 1 ? "" : "s"} found`,
  };
}

/** @returns {CheckResult} */
function checkGithubRemote(root) {
  const cfg = join(root, ".git", "config");
  if (!existsSync(cfg)) {
    return {
      id: "github-remote",
      label: "git remote → github.com",
      status: "na",
      detail: "no .git directory found (not a clone)",
    };
  }
  let txt;
  try {
    txt = readFileSync(cfg, "utf-8");
  } catch {
    return {
      id: "github-remote",
      label: "git remote → github.com",
      status: "warn",
      detail: ".git/config unreadable",
      fixHint: "Check filesystem permissions on .git/config.",
    };
  }
  if (/github\.com/i.test(txt)) {
    return {
      id: "github-remote",
      label: "git remote → github.com",
      status: "pass",
      detail: "github.com remote configured",
    };
  }
  return {
    id: "github-remote",
    label: "git remote → github.com",
    status: "warn",
    detail: "no github.com remote in .git/config",
    fixHint: "Add a github.com remote: git remote add origin https://github.com/<owner>/<repo>.git",
  };
}

/** @returns {CheckResult} */
function checkGhCli() {
  try {
    // Cross-platform "is command available?" — use `--version` so output is bounded.
    execSync("gh --version", {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    });
    return {
      id: "gh-cli",
      label: "gh CLI on PATH",
      status: "pass",
      detail: "gh CLI available",
    };
  } catch {
    return {
      id: "gh-cli",
      label: "gh CLI on PATH",
      status: "warn",
      detail: "gh CLI not found on PATH",
      fixHint: "Install GitHub CLI: https://cli.github.com — unlocks issue / PR / GHAS workflows.",
    };
  }
}

// ─── extra (SHOULD) checks ──────────────────────────────────────────────────

/** @returns {CheckResult} */
function checkCopilotCodingAgentAssignable(root, opts) {
  if (!opts.ghToken) {
    return {
      id: "copilot-coding-agent-assignable",
      label: "Copilot coding agent assignable",
      status: "na",
      detail: "requires ghToken — pass opts.ghToken to enable this network check",
    };
  }
  // Network-backed check (Phase GITHUB-B): verify the repo has Copilot coding
  // agent enabled and that the authenticated user can assign it to issues/PRs.
  // Implementation deferred to Phase GITHUB-B once the REST endpoint is stable.
  return {
    id: "copilot-coding-agent-assignable",
    label: "Copilot coding agent assignable",
    status: "na",
    detail: "network check not yet implemented for this token scope",
  };
}

// ─── extra (SHOULD) checks ──────────────────────────────────────────────────

/** @returns {CheckResult} */
function checkCopilotInstructionsDepth(root) {
  const p = join(root, ".github", "copilot-instructions.md");
  if (!existsSync(p)) {
    return {
      id: "copilot-instructions-depth",
      label: "copilot-instructions.md depth",
      status: "na",
      detail: "file not present (see prior check)",
    };
  }
  let lines;
  try {
    lines = readFileSync(p, "utf-8").split(/\r?\n/).length;
  } catch {
    return {
      id: "copilot-instructions-depth",
      label: "copilot-instructions.md depth",
      status: "warn",
      detail: "file unreadable",
      fixHint: "Check file permissions.",
    };
  }
  if (lines < 50) {
    return {
      id: "copilot-instructions-depth",
      label: "copilot-instructions.md depth",
      status: "warn",
      detail: `only ${lines} lines — likely a stub`,
      fixHint: "Expand with project-specific architecture, conventions, and quick commands.",
    };
  }
  return {
    id: "copilot-instructions-depth",
    label: "copilot-instructions.md depth",
    status: "pass",
    detail: `${lines} lines of context`,
  };
}

/** @returns {CheckResult} */
function checkInstructionsApplyTo(root) {
  const dir = join(root, ".github", "instructions");
  if (!existsSync(dir) || !isDir(dir)) {
    return {
      id: "instructions-applyto",
      label: "instructions use applyTo path-scoping",
      status: "na",
      detail: "instructions directory missing (see prior check)",
    };
  }
  const files = safeReaddir(dir).filter((f) => f.endsWith(".instructions.md"));
  if (files.length === 0) {
    return {
      id: "instructions-applyto",
      label: "instructions use applyTo path-scoping",
      status: "na",
      detail: "no instruction files (see prior check)",
    };
  }
  let withApplyTo = 0;
  for (const f of files) {
    try {
      const txt = readFileSync(join(dir, f), "utf-8");
      if (/^\s*applyTo\s*:/m.test(txt)) withApplyTo++;
    } catch { /* skip unreadable */ }
  }
  if (withApplyTo === 0) {
    return {
      id: "instructions-applyto",
      label: "instructions use applyTo path-scoping",
      status: "warn",
      detail: `0 of ${files.length} files use applyTo: frontmatter`,
      fixHint: "Add 'applyTo: \"src/**/*.ts\"' (or similar) to scope instructions to file paths.",
    };
  }
  return {
    id: "instructions-applyto",
    label: "instructions use applyTo path-scoping",
    status: "pass",
    detail: `${withApplyTo} of ${files.length} files use applyTo:`,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

/**
 * CLI entrypoint. Invoked by pforge.ps1 / pforge.sh as:
 *   node pforge-mcp/github-introspect.mjs --project <root> [--json] [--doctor] [--extra]
 *
 * Exit codes:
 *   0 — no failures (warns and N/A allowed)
 *   1 — at least one failure, OR --help printed nothing actionable
 *   2 — invalid arguments
 */
function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.error) {
    process.stderr.write(`pforge github: ${args.error}\n`);
    printHelp(process.stderr);
    return 2;
  }

  const result = inspectGithubStack(args.project, { extra: args.extra });

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    renderHuman(result, { doctor: args.doctor });
  }
  return result.summary.fail > 0 ? 1 : 0;
}

function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    json: false,
    doctor: false,
    extra: false,
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--doctor") {
      out.doctor = true;
    } else if (a === "--extra") {
      out.extra = true;
    } else if (a === "--project") {
      const v = argv[++i];
      if (!v) {
        out.error = "--project requires a path argument";
        return out;
      }
      out.project = v;
    } else if (a.startsWith("--project=")) {
      out.project = a.slice("--project=".length);
    } else {
      out.error = `unknown argument: ${a}`;
      return out;
    }
  }
  return out;
}

function printHelp(stream = process.stdout) {
  stream.write(
`Usage: node github-introspect.mjs [options]

Inspect a project's GitHub-native AI surface (Copilot, AGENTS.md, MCP, GHAS).

Options:
  --project <dir>   Project root to inspect (default: cwd)
  --json            Emit structured JSON to stdout
  --doctor          Include one-line fix hints for warn/fail rows
  --extra           Run optional depth checks (instruction-file applyTo, etc.)
  --help, -h        Show this help

Exit codes:
  0   no failures
  1   at least one fail
  2   invalid arguments
`
  );
}

function renderHuman(result, { doctor }) {
  const glyph = { pass: "✓", warn: "⚠", fail: "✗", na: "⊘" };
  const out = [];
  out.push("");
  out.push(`GitHub stack readiness — ${result.projectRoot}`);
  out.push("─".repeat(72));
  for (const c of result.checks) {
    out.push(`  ${glyph[c.status]} ${c.label}`);
    out.push(`      ${c.detail}`);
    if (doctor && c.fixHint && (c.status === "warn" || c.status === "fail")) {
      out.push(`      → ${c.fixHint}`);
    }
  }
  out.push("─".repeat(72));
  const s = result.summary;
  out.push(
    `  ${s.pass} pass · ${s.warn} warn · ${s.fail} fail · ${s.na} n/a  (${s.total} checks)`
  );
  if (s.fail > 0 && !doctor) {
    out.push("");
    out.push("  Hint: re-run with `pforge github doctor` for one-line fix suggestions.");
  } else if (s.fail === 0 && s.warn === 0) {
    out.push("");
    out.push("  All checks pass — GitHub-native surface is fully wired up.");
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

// Run CLI when invoked directly (not when imported).
const entryPath = typeof process.argv[1] === "string" ? process.argv[1] : "";
const invokedDirectly =
  entryPath.length > 0 &&
  (import.meta.url === `file://${entryPath.replace(/\\/g, "/")}` ||
    import.meta.url.endsWith(entryPath.replace(/\\/g, "/")));
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}

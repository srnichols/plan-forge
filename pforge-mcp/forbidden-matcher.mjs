/**
 * Plan Forge — Forbidden Actions Matcher
 *
 * Core matching logic shared conceptually by the PreToolUse hook scripts
 * (check-forbidden.sh / check-forbidden.ps1). Exported as a JS module so
 * it can be unit-tested and reused by orchestration code.
 */

/** Tool names that perform file edits and must be checked. */
export const EDIT_TOOLS = new Set([
  "editFiles",
  "create_file",
  "replace_string_in_file",
  "insert_edit_into_file",
  "multi_replace_string_in_file",
]);

/**
 * Parse the tool name and file path out of a hook JSON input string.
 * Handles the same JSON shape produced by the Claude hooks runtime.
 *
 * @param {string} jsonInput  Raw JSON string from stdin
 * @returns {{ toolName: string, filePath: string }}
 */
export function parseForbiddenRequest(jsonInput) {
  let parsed;
  try {
    parsed = JSON.parse(jsonInput);
  } catch {
    return { toolName: "", filePath: "" };
  }
  const toolName = String(parsed?.tool_name ?? "");
  const filePath = String(parsed?.filePath ?? "");
  return { toolName, filePath };
}

/**
 * Extract backtick-wrapped path patterns from the Forbidden Actions section
 * of a plan Markdown file.
 *
 * Recognises the heading `### Forbidden Actions` (case-insensitive) and reads
 * until the next `##`-level heading or end of file. Returns every token that
 * appears between backticks in that region.
 *
 * @param {string} planContent  Full Markdown content of the plan file
 * @returns {string[]}          Array of forbidden path patterns (no backticks)
 */
export function extractForbiddenPaths(planContent) {
  const lines = planContent.replace(/\r\n/g, "\n").split("\n");
  let inSection = false;
  const sectionLines = [];

  for (const line of lines) {
    if (/^###\s+Forbidden\s+Actions/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      // Stop at next ## or ### heading
      if (/^#{2,3}\s/.test(line)) break;
      sectionLines.push(line);
    }
  }

  if (sectionLines.length === 0) return [];

  const section = sectionLines.join("\n");
  const paths = [];
  const backtickRe = /`([^`]+)`/g;
  let m;
  while ((m = backtickRe.exec(section)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/**
 * Determine whether a given file path matches any forbidden pattern.
 *
 * Matching mirrors the hook scripts: a path is blocked when the forbidden
 * pattern appears as a **substring** of the normalised file path.
 * Both strings are normalised to forward-slash separators before comparison
 * so Windows paths (`src\foo.ts`) and POSIX paths (`src/foo.ts`) are treated
 * equivalently.
 *
 * @param {string}   filePath        The path the agent is trying to edit
 * @param {string[]} forbiddenPaths  Patterns extracted by extractForbiddenPaths
 * @returns {{ matched: boolean, pattern: string | null }}
 */
export function matchesForbiddenPath(filePath, forbiddenPaths) {
  const normalised = filePath.replace(/\\/g, "/");
  for (const pattern of forbiddenPaths) {
    const normPattern = pattern.replace(/\\/g, "/");
    if (normalised.includes(normPattern)) {
      return { matched: true, pattern };
    }
  }
  return { matched: false, pattern: null };
}

/**
 * Build the deny response JSON that the Claude hooks runtime expects.
 *
 * @param {string} filePath   The file path that was blocked
 * @param {string} pattern    The forbidden pattern it matched
 * @returns {string}          JSON string
 */
export function buildDenyResponse(filePath, pattern) {
  const reason =
    `BLOCKED: '${filePath}' matches Forbidden Action '${pattern}' ` +
    `in the active plan's Scope Contract. Modifying this path is not allowed.`;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

/** The allow response sent when no forbidden path matched. */
export const ALLOW_RESPONSE = "{}";

/**
 * The plan-level "Stop Conditions" section (meta-bug #365).
 *
 * The hardener's template puts `## Stop Conditions` at plan level, after the
 * slices. A slice body ends at the next h1/h2 heading (#251), so no slice owns
 * the section and a worker never saw it: only a per-slice `**Stop Condition**:`
 * line reached one. The section is read here and travels with every slice's
 * plan context instead.
 *
 * The sections in use are bullet lists under an intro line, tables of condition
 * / reason / recovery, or prose, so this keeps the author's lines rather than
 * parsing one shape that would read the others as nothing.
 */

const STOP_SECTION_HEADING_RE = /^#{1,2}\s+Stop\s+Conditions?\b/i;
/** Same boundary as the slice parser's: a plan-level heading is h1 or h2. */
const PLAN_LEVEL_HEADING_RE = /^#{1,2}\s/;
const CODE_FENCE_RE = /^\s*(?:```|~~~)/;
/** A horizontal rule such as `---`, `***` or `- - -`. */
const RULE_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_SEPARATOR_RE = /^\|[\s:|-]+$/;
/** Between the cells of a table row, so a row reads as one sentence. */
const CELL_JOINER = " — ";

function isTableSeparator(text) {
  return TABLE_SEPARATOR_RE.test(text) && text.includes("-");
}

function tableRowText(text) {
  return text
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(CELL_JOINER);
}

/**
 * The text a line of the section contributes, or "" when it is only layout: a
 * rule, a table's separator or header row (the row before its separator), or a
 * row of empty cells.
 */
function conditionText(line, nextLine) {
  const text = line.trim();
  if (RULE_RE.test(text)) return "";
  if (!text.startsWith("|")) return line;
  if (isTableSeparator(text) || isTableSeparator(String(nextLine ?? "").trim())) return "";
  return tableRowText(text);
}

/**
 * The lines of every plan-level `## Stop Conditions` section of a plan, in
 * order. Blank lines and layout are dropped and a table row becomes its cells
 * joined into one line; everything else is kept as written, indentation
 * included, so a nested bullet stays nested.
 *
 * @param {string[]} lines - the plan file, split into lines
 * @returns {string[]} empty when the plan has no such section
 */
export function parseStopConditions(lines) {
  const conditions = [];
  let inSection = false;
  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trimEnd();
    if (CODE_FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && PLAN_LEVEL_HEADING_RE.test(line)) {
      inSection = STOP_SECTION_HEADING_RE.test(line);
      continue;
    }
    if (!inSection || line.trim() === "") continue;
    const condition = inFence ? line : conditionText(line, lines[index + 1]);
    if (condition) conditions.push(condition);
  }
  return conditions;
}

/**
 * Reading PowerShell source in a test: a scan for what the code does, and one function cut out of a script.
 * Used by the suites that hold setup.ps1 and pforge.ps1 to the same text rules (#417, #432).
 */

/** Source text with here-strings, comments and quoted strings blanked, so a scan sees only code. */
export function codeOnly(source) {
  return source
    .replace(/@"[\s\S]*?"@/g, '""')
    .replace(/@'[\s\S]*?'@/g, "''")
    .replace(/<#[\s\S]*?#>/g, "")
    .replace(/"(?:`.|[^"`\r\n])*"/g, '""')
    .replace(/'(?:''|[^'\r\n])*'/g, "''")
    .replace(/#[^\r\n]*/g, "");
}

/** The text of `function <name>(...) { ... }` in `source`, up to the line that closes it, or "" when there is none. */
export function extractPsFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}

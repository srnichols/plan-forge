/**
 * chunker-pureJs.mjs — Pure-JavaScript file chunker (no native deps).
 *
 * Uses regex and brace/indent counting to detect top-level functions and
 * classes in JS/TS/MJS and Python files. Returns CodeChunker-compatible
 * records as defined in chunker.mjs.
 */

import { createHash } from 'node:crypto';

// ─── Capability metadata ──────────────────────────────────────────────────────

export const languages = ['js', 'ts', 'mjs', 'py', 'sql', 'md'];
export const kinds = ['file', 'function', 'class'];
export const version = '1.0.0';

// ─── Internal helpers ─────────────────────────────────────────────────────────

const EXT_TO_LANG = { js: 'js', ts: 'ts', mjs: 'mjs', py: 'py', sql: 'sql', md: 'md' };

function detectLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'unknown';
}

function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Build a byte-offset array: offsets[i] = byte start of line i (0-based).
 * '\n' is always a single byte (0x0a) in UTF-8, so this is O(n) and exact.
 */
function buildLineOffsets(content) {
  const buf = Buffer.from(content, 'utf8');
  const offsets = [0];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) offsets.push(i + 1);
  }
  return { buf, offsets };
}

/**
 * Return the byte range [startByte, endByte) for lines [startLi, endLi]
 * inclusive (0-based line indices). endByte is the start of the line after
 * endLi, or buf.length when endLi is the last line.
 */
function lineRange(offsets, buf, startLi, endLi) {
  const startByte = offsets[startLi];
  const endByte = endLi + 1 < offsets.length ? offsets[endLi + 1] : buf.length;
  return { startByte, endByte };
}

// ─── JS/TS/MJS brace counting ─────────────────────────────────────────────────

/**
 * Find the 0-based line index that contains the closing `}` matching the first
 * `{` seen from startLi. Ignores braces inside single-quoted, double-quoted,
 * and template-literal strings, and line comments. Returns -1 if not found.
 */
function findClosingBraceLine(lines, startLi) {
  let depth = 0;
  for (let i = startLi; i < lines.length; i++) {
    let inString = false;
    let strChar = '';
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (!inString && ch === '/' && line[j + 1] === '/') break; // line comment
      if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
        inString = true;
        strChar = ch;
      } else if (inString && ch === strChar && line[j - 1] !== '\\') {
        inString = false;
      }
      if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) return i;
        }
      }
    }
  }
  return -1;
}

// ─── JS/TS/MJS patterns ───────────────────────────────────────────────────────

const JS_PATTERNS = [
  // function declaration (sync, async, generator, exported)
  [/^(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/, 'function'],
  // class declaration (exported, abstract TS)
  [/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s|[{<(])/, 'class'],
  // const/let/var arrow or function expression
  [/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)/, 'function'],
];

function extractJsConstructs(filePath, lang, lines, offsets, buf) {
  const chunks = [];
  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trimStart();
    let name = null;
    let kind = null;

    for (const [pat, k] of JS_PATTERNS) {
      const m = pat.exec(trimmed);
      if (m) { name = m[1]; kind = k; break; }
    }
    if (!name) continue;

    const closeLi = findClosingBraceLine(lines, li);
    if (closeLi === -1) continue;

    const { startByte, endByte } = lineRange(offsets, buf, li, closeLi);
    const text = buf.slice(startByte, endByte).toString('utf8');

    chunks.push({
      filePath, language: lang, kind, name,
      startByte, endByte,
      startLine: li + 1, endLine: closeLi + 1,
      contentHash: sha256(text),
      declares: [name],
      references: [],
    });

    li = closeLi; // skip past the matched construct
  }
  return chunks;
}

// ─── Python indent counting ───────────────────────────────────────────────────

const PY_PATTERNS = [
  [/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/, 'function'],
  [/^(\s*)class\s+(\w+)[\s:(]/, 'class'],
];

/**
 * Find the last line (0-based) that belongs to the body of a Python construct
 * starting at startLi with body indent > baseIndent.
 */
function findPyBodyEnd(lines, startLi, baseIndent) {
  let lastContentLi = startLi;
  for (let i = startLi + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue; // skip blank lines
    const indent = lines[i].length - lines[i].trimStart().length;
    if (indent <= baseIndent) return lastContentLi;
    lastContentLi = i;
  }
  return lastContentLi;
}

function extractPyConstructs(filePath, lines, offsets, buf) {
  const chunks = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let name = null;
    let kind = null;
    let baseIndent = 0;

    for (const [pat, k] of PY_PATTERNS) {
      const m = pat.exec(line);
      if (m) { baseIndent = m[1].length; name = m[2]; kind = k; break; }
    }
    if (!name) continue;

    const endLi = findPyBodyEnd(lines, li, baseIndent);
    const { startByte, endByte } = lineRange(offsets, buf, li, endLi);
    const text = buf.slice(startByte, endByte).toString('utf8');

    chunks.push({
      filePath, language: 'py', kind, name,
      startByte, endByte,
      startLine: li + 1, endLine: endLi + 1,
      contentHash: sha256(text),
      declares: [name],
      references: [],
    });

    li = endLi; // skip past the matched construct
  }
  return chunks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunk a source file into CodeChunker-compatible records.
 *
 * Always emits a `file`-kind chunk for the whole file, plus `function` and
 * `class` chunks for detected top-level constructs in supported languages.
 *
 * @param {{ filePath: string, content: string, language?: string }} options
 * @returns {Array<object>} Chunk records conforming to the CodeChunker contract.
 */
export function chunkFile({ filePath, content, language }) {
  const lang = language ?? detectLanguage(filePath);
  const { buf, offsets } = buildLineOffsets(content);

  // Strip the phantom empty element that split() adds after a trailing '\n'
  const rawLines = content.split('\n');
  const lines = content.endsWith('\n') ? rawLines.slice(0, -1) : rawLines;

  const fileChunk = {
    filePath, language: lang, kind: 'file', name: '',
    startByte: 0, endByte: buf.length,
    startLine: 1, endLine: Math.max(lines.length, 1),
    contentHash: sha256(content),
    declares: [], references: [],
  };

  const subChunks =
    ['js', 'ts', 'mjs'].includes(lang) ? extractJsConstructs(filePath, lang, lines, offsets, buf) :
    lang === 'py' ? extractPyConstructs(filePath, lines, offsets, buf) :
    [];

  return [fileChunk, ...subChunks];
}

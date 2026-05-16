/**
 * lattice-chunker-treesitter.mjs — High-fidelity code chunker using tree-sitter.
 *
 * Lazy-loads `tree-sitter` and per-language grammars only when first needed. If
 * the packages are not installed the module transparently falls back to the
 * pure-JS chunker and emits a single one-time warning to stderr so the caller
 * always receives valid CodeChunker-compatible records.
 *
 * Scope: pforge-mcp/lattice-chunker-treesitter.mjs (Slice 3 of Phase-LATTICE)
 */

import { createHash } from 'node:crypto';

// ─── Capability metadata ──────────────────────────────────────────────────────

/** Languages supported when tree-sitter grammars are present. */
export const languages = ['js', 'ts', 'mjs', 'py'];

/** Chunk kinds produced (superset of the pure-JS chunker — adds "method"). */
export const kinds = ['file', 'function', 'class', 'method'];

export const version = '1.0.0';

// ─── Lazy-loading state ───────────────────────────────────────────────────────

/** @type {null | false | Map<string, object>} */
let _parsers = null;
let _warnedFallback = false;

/**
 * Attempt to load tree-sitter and grammars on first use. Returns a parser Map
 * on success, or `false` if any package is absent.
 */
async function ensureParsers() {
  if (_parsers !== null) return _parsers;

  try {
    const { default: Parser } = await import('tree-sitter');
    const { default: JavaScript } = await import('tree-sitter-javascript');
    const tsModule = await import('tree-sitter-typescript');
    // tree-sitter-typescript exports { typescript, tsx } or a default with those props
    const TypeScriptGrammars = tsModule.default ?? tsModule;
    const { default: Python } = await import('tree-sitter-python');

    const jsParser = new Parser();
    jsParser.setLanguage(JavaScript);

    const tsParser = new Parser();
    tsParser.setLanguage(TypeScriptGrammars.typescript);

    const pyParser = new Parser();
    pyParser.setLanguage(Python);

    _parsers = new Map([
      ['js', jsParser],
      ['mjs', jsParser],
      ['ts', tsParser],
      ['py', pyParser],
    ]);
    return _parsers;
  } catch {
    if (!_warnedFallback) {
      process.stderr.write(
        '[lattice-chunker-treesitter] tree-sitter or grammar packages not installed; ' +
          'falling back to pure-JS chunker. ' +
          'Install with: npm install tree-sitter tree-sitter-javascript ' +
          'tree-sitter-typescript tree-sitter-python\n',
      );
      _warnedFallback = true;
    }
    _parsers = false;
    return false;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Map a file-path extension to the language key used by the parser map. */
function detectLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map = { js: 'js', mjs: 'mjs', ts: 'ts', tsx: 'ts', py: 'py' };
  return map[ext] ?? 'unknown';
}

/**
 * Walk a tree-sitter SyntaxNode recursively and collect names of called
 * functions / methods into a Set.
 */
function collectCallRefs(node, refs = new Set()) {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const name =
        fn.type === 'member_expression'
          ? fn.childForFieldName('property')?.text
          : fn.text;
      if (name && /^\w/.test(name)) refs.add(name);
    }
  }
  for (const child of node.namedChildren) {
    collectCallRefs(child, refs);
  }
  return refs;
}

/**
 * Build a CodeChunker record from a tree-sitter SyntaxNode.
 *
 * NOTE: tree-sitter indices are character-position–based when parsing a plain
 * string. For ASCII-only content (all current fixtures) these equal UTF-8 byte
 * offsets. Full multi-byte support can be added by pre-converting the source
 * to a Buffer before parsing.
 */
function makeChunk({ filePath, language, kind, name, node, content }) {
  const startByte = node.startIndex;
  const endByte = node.endIndex;
  const text = content.slice(startByte, endByte);
  const startLine = node.startPosition.row + 1; // convert 0-based row → 1-indexed
  const endLine = node.endPosition.row + 1;

  return {
    filePath,
    language,
    kind,
    name,
    startByte,
    endByte,
    startLine,
    endLine,
    contentHash: sha256(text),
    declares: name ? [name] : [],
    references: [...collectCallRefs(node)],
  };
}

// ─── Language-specific AST walkers ───────────────────────────────────────────

/**
 * Extract function, class, and method chunks from the root of a JS/TS/MJS
 * parse tree. Only top-level declarations and class body methods are walked;
 * nested functions inside function bodies are intentionally not emitted (they
 * would cause overlapping byte ranges).
 */
function extractJsChunks(filePath, language, rootNode, content) {
  const chunks = [];

  for (const node of rootNode.namedChildren) {
    // Named function declarations: function foo() {}
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text ?? '';
      chunks.push(makeChunk({ filePath, language, kind: 'function', name, node, content }));

    // Class declarations — also walk the body for methods
    } else if (node.type === 'class_declaration') {
      const className = node.childForFieldName('name')?.text ?? '';
      chunks.push(makeChunk({ filePath, language, kind: 'class', name: className, node, content }));

      const body = node.childForFieldName('body');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'method_definition') {
            const methodName = member.childForFieldName('name')?.text ?? '';
            chunks.push(
              makeChunk({ filePath, language, kind: 'method', name: methodName, node: member, content }),
            );
          }
        }
      }

    // const/let/var arrow functions and function expressions
    } else if (
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration'
    ) {
      for (const declarator of node.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue;
        const nameNode = declarator.childForFieldName('name');
        const valueNode = declarator.childForFieldName('value');
        if (
          nameNode &&
          valueNode &&
          (valueNode.type === 'arrow_function' ||
            valueNode.type === 'function_expression' ||
            valueNode.type === 'generator_function')
        ) {
          chunks.push(
            makeChunk({
              filePath,
              language,
              kind: 'function',
              name: nameNode.text,
              node: declarator,
              content,
            }),
          );
        }
      }
    }
  }

  return chunks;
}

/**
 * Extract function and class chunks from the root of a Python parse tree.
 * Methods inside classes are emitted with kind "method".
 */
function extractPyChunks(filePath, rootNode, content) {
  const chunks = [];

  for (const node of rootNode.namedChildren) {
    if (node.type === 'function_definition') {
      const name = node.childForFieldName('name')?.text ?? '';
      chunks.push(makeChunk({ filePath, language: 'py', kind: 'function', name, node, content }));

    } else if (node.type === 'class_definition') {
      const className = node.childForFieldName('name')?.text ?? '';
      chunks.push(makeChunk({ filePath, language: 'py', kind: 'class', name: className, node, content }));

      const body = node.childForFieldName('body');
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'function_definition') {
            const methodName = child.childForFieldName('name')?.text ?? '';
            chunks.push(
              makeChunk({ filePath, language: 'py', kind: 'method', name: methodName, node: child, content }),
            );
          }
        }
      }
    }
  }

  return chunks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunk a source file into CodeChunker-compatible records using tree-sitter.
 *
 * When tree-sitter or required grammar packages are absent the function falls
 * back to the pure-JS chunker (which always produces valid records) and emits
 * a one-time warning to stderr.
 *
 * @param {{ filePath: string, content: string, language?: string }} options
 * @returns {Promise<Array<object>>} Chunk records conforming to the CodeChunker contract.
 */
export async function chunkFile({ filePath, content, language }) {
  const lang = language ?? detectLanguage(filePath);
  const contentBuf = Buffer.from(content, 'utf8');

  // Build the file-level chunk — always present regardless of impl.
  const rawLines = content.split('\n');
  const lineCount = content.endsWith('\n') ? rawLines.length - 1 : rawLines.length;
  const fileChunk = {
    filePath,
    language: lang,
    kind: 'file',
    name: '',
    startByte: 0,
    endByte: contentBuf.length,
    startLine: 1,
    endLine: Math.max(lineCount, 1),
    contentHash: sha256(content),
    declares: [],
    references: [],
  };

  const parsers = await ensureParsers();

  if (!parsers) {
    // tree-sitter unavailable — delegate entirely to pure-JS chunker.
    const { chunkFile: pureJsChunkFile } = await import('../pforge-sdk/src/chunker-pureJs.mjs');
    return pureJsChunkFile({ filePath, content, language });
  }

  const parser = parsers.get(lang);
  if (!parser) {
    // Language not supported by the loaded grammars — return file chunk only.
    return [fileChunk];
  }

  const tree = parser.parse(content);
  let subChunks = [];

  if (lang === 'js' || lang === 'mjs' || lang === 'ts') {
    subChunks = extractJsChunks(filePath, lang, tree.rootNode, content);
  } else if (lang === 'py') {
    subChunks = extractPyChunks(filePath, tree.rootNode, content);
  }

  return [fileChunk, ...subChunks];
}

// ─── Test backdoor ────────────────────────────────────────────────────────────

/**
 * Reset lazy-loading state. Exported for use by test files only — do not call
 * in production code.
 */
export function _resetForTesting() {
  _parsers = null;
  _warnedFallback = false;
}

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outFile = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw', 'grep-matrix-report.json');
const includeRoots = ['pforge-mcp', 'pforge-master'];
const excludedDirNames = new Set(['tests', 'node_modules', 'ui']);
const codeLikePattern = /\b(?:if\s*\(|const\s+|return\s+|function\s+)/;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walk(dirPath, results) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirNames.has(entry.name)) {
        continue;
      }
      walk(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      results.push(fullPath);
    }
  }
}

function scanCommentedCodeBlocks(lines, file) {
  const blocks = [];
  let current = [];

  const flush = () => {
    if (current.length > 3) {
      blocks.push({
        file,
        startLine: current[0].line,
        endLine: current[current.length - 1].line,
        lineCount: current.length,
        preview: current.map((entry) => entry.text.trim()).slice(0, 3)
      });
    }
    current = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const commentMatch = trimmed.match(/^\/\/\s?(.*)$/);
    if (commentMatch && codeLikePattern.test(commentMatch[1])) {
      current.push({ line: index + 1, text: commentMatch[1] });
      return;
    }
    flush();
  });

  flush();
  return blocks;
}

function writeJson(payload) {
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

try {
  const files = [];
  for (const includeRoot of includeRoots) {
    const absoluteRoot = path.join(root, includeRoot);
    if (fs.existsSync(absoluteRoot)) {
      walk(absoluteRoot, files);
    }
  }

  const report = {
    consoleLogs: {
      count: 0,
      bulkNote: 'All console.log hits are bulk-triaged as one CLI-output advisory rather than individual findings.'
    },
    todos: [],
    fixmes: [],
    hacks: [],
    xxxs: [],
    commentedCodeBlocks: []
  };

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativeFile = toPosix(path.relative(root, filePath));
    const lines = source.split(/\r?\n/);
    const consoleHits = source.match(/\bconsole\.log\b/g);
    report.consoleLogs.count += consoleHits ? consoleHits.length : 0;

    lines.forEach((line, index) => {
      const entry = { file: relativeFile, line: index + 1, text: line.trim() };
      if (/^\s*\/\/\s*TODO:/.test(line)) {
        report.todos.push(entry);
      }
      if (/^\s*\/\/\s*FIXME:/.test(line)) {
        report.fixmes.push(entry);
      }
      if (/^\s*\/\/\s*HACK:/.test(line)) {
        report.hacks.push(entry);
      }
      if (/^\s*\/\/\s*XXX:/.test(line)) {
        report.xxxs.push(entry);
      }
    });

    report.commentedCodeBlocks.push(...scanCommentedCodeBlocks(lines, relativeFile));
  }

  writeJson(report);
} catch (error) {
  writeJson({
    consoleLogs: { count: 0, bulkNote: 'Error while scanning console.log hits.' },
    todos: [],
    fixmes: [],
    hacks: [],
    xxxs: [],
    commentedCodeBlocks: [],
    error: error instanceof Error ? error.message : String(error)
  });
}

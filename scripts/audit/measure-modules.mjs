import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outFile = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw', 'module-metrics.json');
const scanRoots = [
  { dir: 'pforge-mcp', exclude: new Set(['tests', 'node_modules', 'ui']) },
  { dir: 'pforge-master', exclude: new Set(['tests', 'node_modules', 'ui']) },
  { dir: 'scripts', exclude: new Set(['audit']) }
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walk(dirPath, excludedNames, results) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (excludedNames.has(entry.name)) {
        continue;
      }
      walk(fullPath, excludedNames, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      results.push(fullPath);
    }
  }
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function measureFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split(/\r?\n/);
  const blank = lines.filter((line) => line.trim().length === 0).length;
  const comment = lines.filter((line) => line.trim().startsWith('//')).length;
  const loc = lines.length;
  const functions = countMatches(source, /\bfunction\s+\w+\s*\(/g) + countMatches(source, /\w+\s*=\s*(?:async\s+)?\(/g);
  let g14Severity = null;
  if (loc > 3000) {
    g14Severity = 'high-severity';
  } else if (loc > 1000) {
    g14Severity = 'medium';
  }

  return {
    file: toPosix(path.relative(root, filePath)),
    loc,
    blank,
    comment,
    functions,
    g14Severity
  };
}

function writeJson(payload) {
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

try {
  const files = [];
  for (const scanRoot of scanRoots) {
    const absoluteRoot = path.join(root, scanRoot.dir);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    walk(absoluteRoot, scanRoot.exclude, files);
  }

  const report = files.map((filePath) => measureFile(filePath)).sort((left, right) => right.loc - left.loc);
  writeJson(report);
} catch (error) {
  writeJson({
    error: error instanceof Error ? error.message : String(error),
    files: []
  });
}

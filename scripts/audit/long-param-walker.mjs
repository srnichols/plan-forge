import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outFile = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw', 'long-param-report.json');
const excludedDirNames = new Set(['tests', 'node_modules', 'ui']);

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

function calleeToString(node) {
  if (!node) {
    return '<unknown>';
  }
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'ThisExpression':
      return 'this';
    case 'Super':
      return 'super';
    case 'PrivateIdentifier':
      return `#${node.name}`;
    case 'MemberExpression': {
      const objectPart = calleeToString(node.object);
      const propertyPart = node.computed ? '[computed]' : calleeToString(node.property);
      return `${objectPart}.${propertyPart}`;
    }
    case 'CallExpression':
      return `${calleeToString(node.callee)}()`;
    default:
      return node.type || '<unknown>';
  }
}

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (typeof node.type === 'string') {
    visit(node);
  }
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walkAst(item, visit);
      }
      continue;
    }
    walkAst(value, visit);
  }
}

function regexFallback(source, relativeFile) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  const callPattern = /([A-Za-z_$][\w$.]*)\s*\(([^)]{100,})\)/g;

  lines.forEach((line, index) => {
    let match;
    while ((match = callPattern.exec(line)) !== null) {
      const argCount = (match[2].match(/,/g)?.length ?? 0) + 1;
      if (argCount > 5) {
        findings.push({
          file: relativeFile,
          line: index + 1,
          col: match.index + 1,
          callee: match[1],
          argCount,
          parser: 'regex-fallback'
        });
      }
    }
  });

  return findings;
}

function writeJson(payload) {
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

try {
  const files = [];
  for (const includeRoot of ['pforge-mcp', 'pforge-master']) {
    const absoluteRoot = path.join(root, includeRoot);
    if (fs.existsSync(absoluteRoot)) {
      walk(absoluteRoot, files);
    }
  }

  let acornParse = null;
  try {
    ({ parse: acornParse } = await import('acorn'));
  } catch {
    acornParse = null;
  }

  const findings = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativeFile = toPosix(path.relative(root, filePath));

    if (!acornParse) {
      findings.push(...regexFallback(source, relativeFile));
      continue;
    }

    try {
      const ast = acornParse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
        allowHashBang: true
      });

      walkAst(ast, (node) => {
        if (node.type !== 'CallExpression') {
          return;
        }
        if ((node.arguments?.length ?? 0) <= 5) {
          return;
        }
        findings.push({
          file: relativeFile,
          line: node.loc?.start?.line ?? 1,
          col: node.loc?.start?.column ?? 0,
          callee: calleeToString(node.callee),
          argCount: node.arguments.length
        });
      });
    } catch {
      findings.push(...regexFallback(source, relativeFile));
    }
  }

  writeJson(findings);
} catch (error) {
  writeJson({
    error: error instanceof Error ? error.message : String(error),
    findings: []
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw');
const outFile = path.join(outDir, 'duplication-report.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json') && fullPath !== outFile) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeReport(report) {
  if (!report) {
    return { duplicates: [], statistics: {} };
  }
  if (Array.isArray(report)) {
    return { duplicates: report, statistics: {} };
  }
  if (Array.isArray(report.duplicates)) {
    return {
      duplicates: report.duplicates,
      statistics: report.statistics ?? report.statistic ?? {}
    };
  }
  if (Array.isArray(report.clones)) {
    return {
      duplicates: report.clones,
      statistics: report.statistics ?? report.statistic ?? {}
    };
  }
  if (report.reporters && Array.isArray(report.reporters.json)) {
    return {
      duplicates: report.reporters.json,
      statistics: report.statistics ?? report.statistic ?? {}
    };
  }
  return {
    duplicates: [],
    statistics: report.statistics ?? report.statistic ?? {},
    meta: report
  };
}

function writeJson(payload) {
  ensureDir(outDir);
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

try {
  ensureDir(outDir);
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    'jscpd',
    '--reporters',
    'json',
    '--min-tokens',
    '75',
    '--output',
    outDir,
    '--ignore',
    '**/node_modules/**,**/tests/**,**/ui/**',
    'pforge-mcp',
    'pforge-master',
    'pforge.ps1',
    'pforge.sh'
  ];

  const result = spawnSync(npxBin, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });

  const candidateFiles = listJsonFiles(outDir).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);

  let parsed = null;
  for (const candidate of candidateFiles) {
    try {
      parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      break;
    } catch {
      // Keep scanning.
    }
  }

  if (!parsed && result.stdout?.trim()) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // Ignore non-JSON stdout.
    }
  }

  const normalized = normalizeReport(parsed);
  const payload = {
    ...normalized,
    tool: 'jscpd',
    tokenThreshold: 75,
    exitCode: result.status,
    stderr: result.stderr?.trim() || undefined
  };

  if (!Array.isArray(payload.duplicates) || payload.duplicates.length === 0) {
    writeJson({ duplicates: [], statistics: {} });
  } else {
    writeJson(payload);
  }
} catch (error) {
  writeJson({
    duplicates: [],
    statistics: {},
    error: error instanceof Error ? error.message : String(error)
  });
}

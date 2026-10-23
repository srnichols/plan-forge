import fs from 'node:fs';
import path from 'node:path';
import { auditRawDir } from './raw-dir.mjs';
import { runInstalledBin } from './run-installed-bin.mjs';
import { auditRoots } from './scan-roots.mjs';

const root = process.cwd();
const outDir = auditRawDir(root);
const outFile = path.join(outDir, 'duplication-report.json');
// The one file jscpd's json reporter writes into --output.
const jscpdReportFile = path.join(outDir, 'jscpd-report.json');
const TOKEN_THRESHOLD = 75;

function writeJson(payload) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

// Reads exactly jscpd's report. Picking "the largest JSON file in the
// directory" once took eslint-report.json for it and wrote 1,180 lint rows as
// clone pairs (meta-bug #349).
function readJscpdReport() {
  if (!fs.existsSync(jscpdReportFile)) {
    return { error: 'jscpd did not write jscpd-report.json' };
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(jscpdReportFile, 'utf8'));
  } catch (error) {
    return { error: `jscpd-report.json is not valid JSON: ${error.message}` };
  }
  if (!Array.isArray(report?.duplicates)) {
    return { error: 'jscpd-report.json is not a jscpd report (no duplicates array)' };
  }
  const notPairs = report.duplicates.filter((row) => !(row?.firstFile && row?.secondFile));
  if (notPairs.length > 0) {
    return { error: `jscpd-report.json holds ${notPairs.length} rows that are not clone pairs` };
  }
  return { duplicates: report.duplicates, statistics: report.statistics ?? {} };
}

function scanForDuplicates() {
  // A report left by an earlier run must not stand in for this one.
  fs.rmSync(jscpdReportFile, { force: true });

  const result = runInstalledBin({
    root,
    pkg: 'jscpd',
    args: [
      '--reporters',
      'json',
      '--min-tokens',
      String(TOKEN_THRESHOLD),
      '--output',
      outDir,
      '--ignore',
      '**/node_modules/**,**/tests/**,**/ui/**',
      ...auditRoots('run-jscpd'),
      'pforge.ps1',
      'pforge.sh'
    ]
  });
  const base = {
    tool: 'jscpd',
    tokenThreshold: TOKEN_THRESHOLD,
    exitCode: result.status,
    stderr: result.stderr?.trim() || undefined
  };
  const outcome = result.ok ? readJscpdReport() : { error: result.error };
  if (outcome.error) {
    return { ok: false, payload: { duplicates: [], statistics: {}, ...base, error: outcome.error } };
  }
  return { ok: true, payload: { duplicates: outcome.duplicates, statistics: outcome.statistics, ...base } };
}

try {
  const { ok, payload } = scanForDuplicates();
  writeJson(payload);
  if (!ok) {
    // The report is kept as evidence, but a scan that did not run must not pass.
    console.error(`jscpd duplication scan failed: ${payload.error}`);
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeJson({ duplicates: [], statistics: {}, error: message });
  console.error(`jscpd duplication scan failed: ${message}`);
  process.exitCode = 1;
}

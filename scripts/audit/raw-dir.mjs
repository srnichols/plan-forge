import path from 'node:path';

// Single source of truth for where audit scanners write their reports.
// PFORGE_AUDIT_RAW_DIR lets a caller redirect output so a run never dirties the
// tracked repo — the no-regression test sets it to a temp dir.
export function auditRawDir(root = process.cwd()) {
  return process.env.PFORGE_AUDIT_RAW_DIR
    || path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw');
}

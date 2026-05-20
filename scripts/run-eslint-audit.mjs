import { ESLint } from 'eslint';
import path from 'node:path';

const root = process.cwd();

const eslint = new ESLint({
  overrideConfigFile: path.join(root, 'scripts/audit/eslint-clean-code.config.mjs'),
  cwd: root
});

const results = await eslint.lintFiles([
  'pforge-mcp/**/*.mjs',
  'pforge-master/**/*.mjs'
]);

let totalErrors = 0;
const fileErrors = {};

for (const r of results) {
  const errors = r.messages.filter(m => m.severity === 2);
  if (errors.length > 0) {
    totalErrors += errors.length;
    const rel = r.filePath.replace(root + path.sep, '').replace(root + '/', '');
    fileErrors[rel] = errors.map(e => ({ rule: e.ruleId, line: e.line, msg: e.message.slice(0, 120) }));
  }
}

const summary = {
  totalErrors,
  fileCount: Object.keys(fileErrors).length,
  files: Object.entries(fileErrors).map(([f, errs]) => ({ file: f, count: errs.length, errors: errs }))
};

console.log(JSON.stringify(summary, null, 2));

// Which first-party code each clean-code audit script scans, in one place.
//
// Each script used to carry its own copy of this list, and the copies disagreed:
// pforge-sdk, an npm workspace, was missing from all of them but dep-boundaries
// (meta-bug #382). A package is now either scanned by a script or exempted from it
// below, with the reason, and pforge-mcp/tests/audit-scan-roots.test.mjs fails for
// any workspace package that is neither, so a new package cannot be left out by
// accident.

const PACKAGES = ['pforge-mcp', 'pforge-master', 'pforge-sdk'];

export const AUDIT_ROOTS = Object.freeze({
  'run-eslint-clean-code': Object.freeze([...PACKAGES, 'scripts']),
  'clean-code-delta': Object.freeze([...PACKAGES, 'scripts']),
  'measure-modules': Object.freeze([...PACKAGES, 'scripts']),
  'grep-matrix': Object.freeze([...PACKAGES]),
  'long-param-walker': Object.freeze([...PACKAGES]),
  'run-jscpd': Object.freeze([...PACKAGES]),
  'scan-architecture': Object.freeze([...PACKAGES]),
  'dead-exports': Object.freeze(['pforge-mcp', 'pforge-master', 'scripts']),
  'frozen-arrays-drift': Object.freeze([...PACKAGES, 'scripts', 'extensions']),
  'test-smells': Object.freeze(['pforge-mcp/tests', 'pforge-master/tests', 'pforge-sdk/tests', 'tests']),
});

/** Packages a script deliberately does not scan: script name, then package, then why. */
export const AUDIT_EXEMPTIONS = Object.freeze({
  'dead-exports': Object.freeze({
    'pforge-sdk':
      'Every SDK module is a public subpath in package.json "exports", so an export that nothing in this ' +
      'repository imports is still API for SDK consumers; the scanner reported createClient and chunkFile.',
  }),
});

function rootsFor(script) {
  const roots = AUDIT_ROOTS[script];
  if (!roots) throw new Error(`scan-roots.mjs has no roots for audit script "${script}"`);
  return roots;
}

/** The directories an audit script scans, relative to the repository root. */
export function auditRoots(script) {
  return [...rootsFor(script)];
}

/** The same directories as ESLint-style globs over their .mjs files. */
export function auditGlobs(script) {
  return rootsFor(script).map((root) => `${root}/**/*.mjs`);
}

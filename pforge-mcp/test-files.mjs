/**
 * Test-file detection shared by the impact gate and the regression guard's
 * blast radius. A leaf module (no imports), so either can use it without an
 * import cycle.
 */

/** Runnable test files, by file name. */
const RUNNABLE_TEST_PATTERNS = Object.freeze([
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /_test\.go$/,
  /[a-z0-9]Tests?\.cs$/,
  /_spec\.rb$/,
]);
/** Directories whose contents count as test code (helpers and fixtures included). */
const TEST_DIR_PATTERN = /(^|\/)(tests?|__tests?__|spec)\//;

const toPosix = (p) => p.replace(/\\/g, "/");

/** A file whose name marks it as a test a runner can execute. */
export function isRunnableTestFile(path) {
  const p = toPosix(path);
  return RUNNABLE_TEST_PATTERNS.some((re) => re.test(p));
}

/** Test code: a runnable test, or anything under a test directory. */
export function isTestFile(path) {
  return isRunnableTestFile(path) || TEST_DIR_PATTERN.test(toPosix(path));
}

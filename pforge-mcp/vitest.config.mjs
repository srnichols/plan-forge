import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

/** Strip shebang lines from source files — required for Vite's AsyncFunction runtime */
const stripShebang = {
  name: "strip-shebang",
  transform(code) {
    if (code.startsWith("#!")) {
      return { code: "//" + code.slice(2) };
    }
    return null;
  },
};

// Resolve root relative to this config file so vitest works regardless of the
// invoker's CWD (e.g. `npx --prefix pforge-mcp vitest run` from repo root).
const configDir = fileURLToPath(new URL(".", import.meta.url));

// Sibling-package source roots (forward slashes for Vite alias replacements).
// pforge-mcp's vitest already runs ../pforge-sdk/tests/**, and a handful of
// pforge-mcp tests import the peer packages via their PUBLIC entry
// (`pforge-sdk/chunker`, `@pforge/pforge-master`). CI installs dependencies
// from pforge-mcp/ in isolation (npm stops at the first package.json and never
// links the sibling workspaces), so those bare specifiers do not resolve there.
// Map them to the peers' source here so resolution is deterministic across both
// the workspace-linked local run and CI's isolated install — without declaring
// a file: dependency that would churn the shared lockfile. The test sources
// keep their public-entry imports, so the bug-219 deep-import guard stays green.
const sdkSrc = fileURLToPath(new URL("../pforge-sdk/src/", import.meta.url)).replace(/\\/g, "/");
const masterRoot = fileURLToPath(new URL("../pforge-master/", import.meta.url)).replace(/\\/g, "/");

// `pforge self-update` ships pforge-mcp/tests/** but not the source-repo tooling those
// suites exercise, so a healthy consumer install saw `npm test` go red (#249). Each entry
// maps a repo-root asset to the suites that need it; a suite is excluded only when its
// asset is genuinely absent. In this repo every asset exists, so SOURCE_ONLY_EXCLUDES is
// empty and nothing is skipped — a typo'd path would drop real coverage here, which
// tests/consumer-test-surface.test.mjs asserts against.
const SOURCE_ONLY_SUITES = {
  "../scripts/audit": [
    "tests/audit-cli-parity.test.mjs",
    "tests/clean-code-delta.test.mjs",
    "tests/clean-code-no-regression.test.mjs",
    "tests/dependency-direction.test.mjs",
    "tests/test-smells-scanner.test.mjs",
    "tests/testbed-happypath.test.mjs",
  ],
  "../scripts/forge-home-cleanup.mjs": ["tests/forge-home-cleanup.test.mjs"],
  "../pforge-master": [
    "tests/auditor-automation-baseline.test.mjs",
    "tests/forge-master.advisory.test.mjs",
    "tests/plan-health-auditor.test.mjs",
    "tests/testbed-auditor-automation.test.mjs",
  ],
  "../pforge-sdk": [
    "tests/lattice-chunker-treesitter.test.mjs",
    "tests/notifications-stubs.test.mjs",
    "tests/notifications-webhook.test.mjs",
    // Validates Plan Forge's own CHANGELOG against its own VERSION. In a consuming
    // project both files exist but describe the consumer's app, so the comparison is
    // meaningless there — keyed to a dev-only marker rather than to its own inputs.
    "tests/changelog-format.test.mjs",
  ],
  "../docs/manual": ["tests/manual-chapter-headings.test.mjs"],
  "../docs/capabilities.md": [
    "tests/capabilities-doc-sync.test.mjs",
    "tests/orchestrator-complexity.test.mjs",
  ],
  "../docs/plans/testbed-scenarios": ["tests/testbed-dashboard-ui.test.mjs"],
  "../templates": [
    "tests/baselines.test.mjs",
    "tests/forbidden-matcher.test.mjs",
    "tests/full-suite-regression.test.mjs",
  ],
  "../presets": ["tests/tempering-runner.test.mjs"],
};

export const SOURCE_ONLY_EXCLUDES = Object.entries(SOURCE_ONLY_SUITES)
  .filter(([asset]) => !existsSync(fileURLToPath(new URL(asset, import.meta.url))))
  .flatMap(([, suites]) => suites);

export default defineConfig({
  plugins: [stripShebang],
  resolve: {
    alias: [
      { find: /^@pforge\/pforge-master$/, replacement: `${masterRoot}src/index.mjs` },
      { find: /^@pforge\/pforge-master\/(.*)$/, replacement: `${masterRoot}$1` },
      { find: /^pforge-sdk$/, replacement: `${sdkSrc}index.mjs` },
      { find: /^pforge-sdk\/(.*)$/, replacement: `${sdkSrc}$1.mjs` },
    ],
  },
  test: {
    environment: "node",
    // Use forked processes to avoid Windows libuv UV_HANDLE_CLOSING assertions
    // and Rollup parallel-transform races that occur with the default threads pool.
    pool: "forks",
    root: configDir,
    include: ["tests/**/*.test.mjs", "../pforge-sdk/tests/**/*.test.mjs"],
    exclude: ["**/.forge/**", "**/node_modules/**", ...SOURCE_ONLY_EXCLUDES],
    hookTimeout: 30000,
    // Matches hookTimeout: much of this suite shells out to real CLI probes
    // (detectWorkers, probeQuorumModelAvailability, spawnWorker), which the
    // 5000ms default could not cover once vitest 4 added per-test overhead.
    testTimeout: 30000,
  },
});

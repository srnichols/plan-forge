import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
    exclude: ["**/.forge/**", "**/node_modules/**"],
    hookTimeout: 30000,
  },
});

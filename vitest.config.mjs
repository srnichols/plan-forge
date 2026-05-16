import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Repo-root vitest config — used when invoking vitest from the repo root
// (e.g. `npx --prefix pforge-mcp vitest run`).
// The canonical entry point is `npm --prefix pforge-mcp test` (changes CWD
// to pforge-mcp/ and picks up pforge-mcp/vitest.config.mjs directly).
const mcpRoot = fileURLToPath(new URL("pforge-mcp", import.meta.url));

/** Strip shebang lines from source files — required for files like orchestrator.mjs
 *  that start with #!/usr/bin/env node. Needed when running pforge-mcp tests from repo root. */
const stripShebang = {
  name: "strip-shebang",
  transform(code) {
    if (code.startsWith("#!")) {
      return { code: "//" + code.slice(2) };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [stripShebang],
  test: {
    environment: "node",
    root: mcpRoot,
    include: ["tests/**/*.test.mjs"],
    exclude: ["**/.forge/**", "**/node_modules/**"],
  },
});

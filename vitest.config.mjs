import { defineConfig } from "vitest/config";

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
  },
});

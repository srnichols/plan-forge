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

export default defineConfig({
  plugins: [stripShebang],
  test: {
    environment: "node",
    root: configDir,
    include: ["tests/**/*.test.mjs", "../pforge-sdk/tests/**/*.test.mjs"],
    exclude: ["**/.forge/**", "**/node_modules/**"],
    hookTimeout: 30000,
  },
});

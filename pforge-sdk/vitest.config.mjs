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

// Pin the root to this config file's directory so vitest does not traverse
// up into pforge-mcp and pick up its broader include patterns + wrong CWD.
const configDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [stripShebang],
  test: {
    environment: "node",
    pool: "forks",
    root: configDir,
    include: ["tests/**/*.test.mjs"],
    exclude: ["**/.forge/**", "**/node_modules/**"],
    hookTimeout: 30000,
  },
});

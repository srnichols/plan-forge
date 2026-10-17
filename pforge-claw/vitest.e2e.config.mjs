import { defineConfig } from "vitest/config";

const stripShebang = {
  name: "strip-shebang",
  transform(code) {
    return code.startsWith("#!") ? { code: `//${code.slice(2)}` } : null;
  },
};

export default defineConfig({
  plugins: [stripShebang],
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.mjs"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: false,
  },
});

import { defineConfig } from "vitest/config";

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
    include: ["tests/**/*.test.mjs"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});

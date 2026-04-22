import { defineConfig } from "vitest/config";

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

export default defineConfig({
  plugins: [stripShebang],
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs", "src/**/__tests__/**/*.test.mjs"],
  },
});

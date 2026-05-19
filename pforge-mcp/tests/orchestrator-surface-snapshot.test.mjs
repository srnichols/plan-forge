import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildOrchestratorSurface } from "../orchestrator.mjs";

describe("orchestrator surface snapshot", () => {
  it("matches golden fixture byte-for-byte", () => {
    const golden = readFileSync(new URL("./fixtures/orchestrator-surface.golden.json", import.meta.url), "utf8");
    const actual = `${JSON.stringify(buildOrchestratorSurface(), null, 2)}\n`;
    expect(actual).toBe(golden.replace(/\r\n/g, "\n"));
  });
});

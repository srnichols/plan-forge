import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildServerSurface } from "../server.mjs";

describe("server surface snapshot", () => {
  it("matches golden fixture byte-for-byte", () => {
    const golden = readFileSync(new URL("./fixtures/server-surface.golden.json", import.meta.url), "utf8");
    const actual = `${JSON.stringify(buildServerSurface(), null, 2)}\n`;
    expect(actual).toBe(golden.replace(/\r\n/g, "\n"));
  });
});

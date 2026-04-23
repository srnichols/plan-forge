import { describe, it, expect } from "vitest";
import { LANE_TOOLS, LANES } from "../src/intent-router.mjs";

describe("forge_graph_query lane placement", () => {
  it("is in advisory lane", () => {
    expect(LANE_TOOLS[LANES.ADVISORY]).toContain("forge_graph_query");
  });
  it("is NOT in operational lane", () => {
    expect(LANE_TOOLS[LANES.OPERATIONAL]).not.toContain("forge_graph_query");
  });
  it("is NOT in troubleshoot lane", () => {
    expect(LANE_TOOLS[LANES.TROUBLESHOOT]).not.toContain("forge_graph_query");
  });
  it("is NOT in build lane", () => {
    expect(LANE_TOOLS[LANES.BUILD]).not.toContain("forge_graph_query");
  });
});

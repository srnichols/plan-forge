/**
 * Tests for Forge-Master tab integration in pforge-mcp dashboard (Phase-29).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = resolve(__dirname, "../dashboard/index.html");

describe("forge-master dashboard tab", () => {
  it("dashboard HTML includes forge-master tab button", () => {
    const html = readFileSync(DASHBOARD_HTML, "utf-8");
    expect(html).toContain('data-tab="forge-master"');
    expect(html).toContain("Forge-Master");
  });

  it("dashboard HTML includes forge-master tab content section", () => {
    const html = readFileSync(DASHBOARD_HTML, "utf-8");
    expect(html).toContain('id="tab-forge-master"');
  });

  it("dashboard HTML loads forge-master.js script", () => {
    const html = readFileSync(DASHBOARD_HTML, "utf-8");
    expect(html).toContain("forge-master.js");
  });
});

describe("forge-master routes adapter", () => {
  it("registerForgeMasterRoutes registers routes on express app", async () => {
    const routes = [];
    const mockApp = {
      get(path) { routes.push({ method: "GET", path }); },
      post(path) { routes.push({ method: "POST", path }); },
      put(path) { routes.push({ method: "PUT", path }); },
      use(path) { routes.push({ method: "USE", path }); },
    };
    const { registerForgeMasterRoutes } = await import("../forge-master-routes.mjs");
    await registerForgeMasterRoutes(mockApp);
    expect(routes.some(r => r.path === "/api/forge-master/prompts")).toBe(true);
    expect(routes.some(r => r.path === "/api/forge-master/capabilities")).toBe(true);
  });

  it("/api/forge-master/capabilities returns expected shape", async () => {
    const { getForgeMasterCapabilitiesSummary } = await import("../forge-master-routes.mjs");
    const caps = await getForgeMasterCapabilitiesSummary();
    // May be null if pforge-master not found, but if present should have shape
    if (caps !== null) {
      expect(typeof caps.promptCategories).toBe("number");
      expect(typeof caps.promptCount).toBe("number");
    }
  });
});

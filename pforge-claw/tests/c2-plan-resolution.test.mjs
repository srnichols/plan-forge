import { randomUUID } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePlanResolveRequest, resolvePlan, validatePlanResolution } from "../src/jobs/plan-resolution.mjs";
import { HOME_PLAN_RESOLVE_TOOL } from "../src/enums.mjs";

const directories = [];
async function fixture(names = ["Phase-One-PLAN.md"]) {
  const directory = path.resolve(".forge", "c2-plan-resolution", randomUUID());
  directories.push(directory);
  const root = path.join(directory, "repo");
  await mkdir(path.join(root, "docs", "plans"), { recursive: true });
  for (const name of names) await writeFile(path.join(root, "docs", "plans", name), "# Fixture plan\n");
  return { root, directory };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("C2 authenticated home plan resolver DTO", () => {
  it("uses the coordinator canonical operation and validates only input/exact/limit request fields", () => {
    expect(HOME_PLAN_RESOLVE_TOOL).toBe("claw.plan.resolve");
    expect(parsePlanResolveRequest({ input: " One " })).toEqual({ input: "One", exact: false, limit: 20 });
    expect(parsePlanResolveRequest({ input: "docs\\plans\\Phase-One-PLAN.md", exact: true, limit: 50 }))
      .toEqual({ input: "docs/plans/Phase-One-PLAN.md", exact: true, limit: 50 });
    for (const input of [
      null, {}, { input: "" }, { input: "x", limit: 0 }, { input: "x", limit: 51 },
      { input: "x", limit: "2" }, { input: "x", exact: "yes" },
      { input: "x", root: "untrusted-root" }, { input: "x", signal: {} }, { input: "x", paths: [] },
    ]) expect(() => parsePlanResolveRequest(input)).toThrow("PLAN_RESOLVE_INVALID");
  });

  it("resolves exact repository-relative first and otherwise unique case-insensitive docs/plans names", async () => {
    const f = await fixture(["Phase-One-PLAN.md", "Phase-Two-PLAN.md"]);
    await writeFile(path.join(f.root, "One"), "# Exact file\n");
    expect(await resolvePlan({ root: f.root, input: "One" }))
      .toMatchObject({ kind: "exact", candidates: ["One"], total: 1, truncated: false, limit: 20, message: expect.any(String) });
    expect(await resolvePlan({ root: f.root, input: "pHaSe-OnE" }))
      .toMatchObject({ kind: "unique", candidates: ["docs/plans/Phase-One-PLAN.md"], total: 1, truncated: false });
    expect(await resolvePlan({ root: f.root, input: "docs\\plans\\Phase-Two-PLAN.md", exact: true }))
      .toMatchObject({ kind: "exact", candidates: ["docs/plans/Phase-Two-PLAN.md"] });
  });

  it("bounds ambiguous replies without ever converting a truncated single returned candidate into unique", async () => {
    const f = await fixture(["Phase-One-PLAN.md", "Phase-Two-PLAN.md"]);
    const result = await resolvePlan({ root: f.root, input: "Phase", limit: 1 });
    expect(result).toMatchObject({
      kind: "multiple", candidates: ["docs/plans/Phase-One-PLAN.md"], total: 2,
      truncated: true, limit: 1, message: expect.stringMatching(/exact|narrow/i),
    });
    expect(JSON.stringify(result)).not.toContain(f.root);
    const many = await fixture(Array.from({ length: 25 }, (_, index) => `Phase-${String(index).padStart(2, "0")}-PLAN.md`));
    const bounded = await resolvePlan({ root: many.root, input: "Phase" });
    expect(bounded).toMatchObject({ kind: "multiple", total: 25, limit: 20, truncated: true });
    expect(bounded.candidates).toHaveLength(20);
  });

  it("reports explicit empty states and does not name-match after an exact selection disappears", async () => {
    const f = await fixture();
    expect(await resolvePlan({ root: f.root, input: "missing" }))
      .toMatchObject({ kind: "none", candidates: [], total: 0, truncated: false, message: expect.stringContaining("No plan found") });
    expect(await resolvePlan({ root: f.root, input: "Phase-One-PLAN.md", exact: true }))
      .toMatchObject({ kind: "none", candidates: [], total: 0 });
  });

  it.each(["../outside-PLAN.md", "docs/../outside-PLAN.md", "/outside-PLAN.md", "C:\\outside-PLAN.md", "C:outside", "\\\\host\\share\\plan.md"])(
    "rejects absolute/traversal requests before accessing any supplied root: %s", async (input) => {
      await expect(resolvePlan({ root: "unavailable", input })).rejects.toThrow("PLAN_PATH_ESCAPE");
    },
  );

  it("rejects a real directory symlink/junction escape and verifies the canonical home root", async () => {
    const f = await fixture();
    const outside = path.join(f.directory, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "Phase-Escape-PLAN.md"), "# Outside\n");
    await symlink(outside, path.join(f.root, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(resolvePlan({ root: f.root, input: "escape/Phase-Escape-PLAN.md", exact: true })).rejects.toThrow("PLAN_PATH_ESCAPE");
    await expect(resolvePlan({ root: path.join(f.directory, "missing-root"), input: "One" })).rejects.toThrow("PLAN_ROOT_UNAVAILABLE");
  });

  it("rejects an out-of-band pre-abort before root inspection", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolvePlan({ root: "unavailable", input: "One", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates the home result DTO rather than accepting legacy plans arrays or false unique truncation", () => {
    const result = {
      kind: "unique", candidates: ["docs/plans/Phase-One-PLAN.md"], total: 1,
      truncated: false, limit: 20, message: "One plan.",
    };
    expect(validatePlanResolution(result)).toBe(result);
    for (const invalid of [
      { plans: [] }, { ...result, candidates: ["/absolute/plan.md"] },
      { ...result, candidates: ["../outside.md"] }, { ...result, candidates: ["docs\\plans\\plan.md"] },
      { ...result, total: 2, truncated: true }, { ...result, message: "" },
    ]) expect(() => validatePlanResolution(invalid)).toThrow("PLAN_RESOLVE_BAD_RESULT");
  });
});

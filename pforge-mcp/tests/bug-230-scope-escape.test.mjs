import { describe, it, expect } from "vitest";
import {
  parseNameStatus,
  detectScopeEscape,
} from "../orchestrator/git-safety.mjs";

/**
 * Meta-bug #230 — false-green run: 14/14 slices reported PASSED but every
 * promised in-scope feature file was MISSING. Every slice commit touched ONLY
 * out-of-scope `.github/instructions/*.md` files (workers wrote docs describing
 * the admin surfaces instead of building them), yet the orchestrator did not
 * enforce scope.
 *
 * The fix adds a scope-escape detector: when a slice declares a non-empty file
 * scope but NONE of its committed paths match that scope, the entire diff
 * landed outside the slice's mandate — the worker did not build what it was
 * told to. The slice is failed so retry/rollback machinery can recover.
 *
 * Pure function — operates on the slice and a parsed name-status list so it can
 * be unit-tested without a git repo.
 */

describe("detectScopeEscape (#230)", () => {
  const slice = {
    number: "1",
    title: "Admin recurring-donations API",
    scope: [
      "apps/api/src/modules/admin/admin-donations.routes.ts",
      "apps/web/src/app/admin/recurring-donations/**",
    ],
  };

  it("flags a slice whose entire diff landed outside its declared scope", () => {
    const nameStatus = parseNameStatus(
      "A\t.github/instructions/api-patterns.instructions.md\n" +
      "M\t.github/instructions/testing.instructions.md"
    );
    const result = detectScopeEscape({ slice, nameStatus });
    expect(result.applicable).toBe(true);
    expect(result.escaped).toBe(true);
    expect(result.offending).toContain(".github/instructions/api-patterns.instructions.md");
  });

  it("does NOT flag a slice that touched at least one in-scope file", () => {
    const nameStatus = parseNameStatus(
      "A\tapps/api/src/modules/admin/admin-donations.routes.ts\n" +
      "M\t.github/instructions/api-patterns.instructions.md"
    );
    const result = detectScopeEscape({ slice, nameStatus });
    expect(result.applicable).toBe(true);
    expect(result.escaped).toBe(false);
    expect(result.offending).toEqual([]);
  });

  it("matches `**` globs in the declared scope", () => {
    const nameStatus = parseNameStatus(
      "A\tapps/web/src/app/admin/recurring-donations/page.tsx"
    );
    const result = detectScopeEscape({ slice, nameStatus });
    expect(result.escaped).toBe(false);
  });

  it("is not applicable when the slice declares no scope", () => {
    const result = detectScopeEscape({
      slice: { number: "2", title: "x", scope: [] },
      nameStatus: parseNameStatus("A\tanything.ts"),
    });
    expect(result.applicable).toBe(false);
    expect(result.escaped).toBe(false);
  });

  it("is not applicable when the diff is empty", () => {
    const result = detectScopeEscape({ slice, nameStatus: [] });
    expect(result.applicable).toBe(false);
    expect(result.escaped).toBe(false);
  });

  it("normalizes Windows backslash paths before matching", () => {
    const nameStatus = [
      { status: "A", path: "apps\\api\\src\\modules\\admin\\admin-donations.routes.ts" },
    ];
    const result = detectScopeEscape({ slice, nameStatus });
    expect(result.escaped).toBe(false);
  });
});

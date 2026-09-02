/**
 * Issue #258 — the plan self-check asks whether a slice HAS a validation gate,
 * never whether that gate is CAPABLE OF FAILING. Two command forms the
 * templates themselves teach are not.
 *
 * Only one of the two is shipped here as a mechanical rule, because I measured
 * both against this repo rather than trusting the report:
 *
 *  (1) `vitest run <missing path>` — reported as exiting 0 with
 *      "No test files found". On vitest 4.1.10 in this repo it exits **1**,
 *      with or without --passWithNoTests=false. The trap is real but
 *      VERSION-DEPENDENT. A textual rule would have flagged 138 of 592 real
 *      gate command lines here (23.3%) to warn about behaviour this repo does
 *      not have. That belongs in the hardener self-check, where a human
 *      applies judgement, not in a linter that fires on a quarter of all
 *      gates. Deliberately NOT implemented as a rule.
 *
 *  (2) `pnpm --filter <pkg> <script>` — exits 0 when the script does not
 *      exist. Version-independent, textually detectable, and it flags 0 of
 *      592 existing gate lines, so it is pure signal here. Shipped.
 *
 * Also shipped: `git diff ... HEAD~N` blindness to untracked files, which is
 * defect (C) of meta-bug #256 — a gate counting brand-new files reads 0 until
 * they are committed, and the slice cannot commit on an unrun gate.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

function lintGate(command) {
  return lintGateCommands({ slices: [{ number: "1", validationGate: command }] });
}

function rulesFor(command) {
  const r = lintGate(command);
  return [...r.errors, ...r.warnings].map((f) => f.rule);
}

describe("pnpm --filter <script> cannot fail on a missing script (#258)", () => {
  it("warns on the long-flag form", () => {
    expect(rulesFor("pnpm --filter @acme/api test:unit")).toContain("gate-cannot-fail");
  });

  it("warns on the -F short form", () => {
    expect(rulesFor("pnpm -F @acme/api lint")).toContain("gate-cannot-fail");
  });

  it("names the failing behaviour and the fix in the message", () => {
    const finding = lintGate("pnpm --filter @acme/api test:unit")
      .warnings.find((w) => w.rule === "gate-cannot-fail");
    expect(finding.message).toMatch(/exits 0/);
    expect(finding.message).toMatch(/ERR_PNPM_NO_SCRIPT/);
  });

  it("does not warn on 'pnpm --filter <pkg> exec <cmd>' — exec propagates the exit code", () => {
    expect(rulesFor("pnpm --filter @acme/web exec tsc --noEmit")).not.toContain("gate-cannot-fail");
  });

  it("does not warn on 'pnpm --filter <pkg> run <script>'", () => {
    expect(rulesFor("pnpm --filter @acme/api run test")).not.toContain("gate-cannot-fail");
  });

  it("does not warn on a plain pnpm invocation", () => {
    expect(rulesFor("pnpm test")).not.toContain("gate-cannot-fail");
  });
});

describe("git diff HEAD~N is blind to untracked files (#256 C, via #258)", () => {
  it("warns when a gate diffs against HEAD~1", () => {
    expect(rulesFor("git diff --name-only HEAD~1 -- prisma/migrations")).toContain("git-diff-misses-untracked");
  });

  it("warns for any HEAD~N depth", () => {
    expect(rulesFor("git diff --name-only HEAD~3")).toContain("git-diff-misses-untracked");
  });

  it("suggests a form that does see new files", () => {
    const finding = lintGate("git diff --name-only HEAD~1")
      .warnings.find((w) => w.rule === "git-diff-misses-untracked");
    expect(finding.message).toMatch(/--exclude-standard|--porcelain/);
  });

  it("does not warn on git status --porcelain", () => {
    expect(rulesFor("git status --porcelain")).not.toContain("git-diff-misses-untracked");
  });

  it("does not warn on a working-tree diff", () => {
    expect(rulesFor("git diff --name-only")).not.toContain("git-diff-misses-untracked");
  });
});

describe("Guard: no blanket vitest rule was added (#258)", () => {
  it("an ordinary vitest gate lints clean", () => {
    // 138 of 592 real gate lines in docs/plans are this shape. A rule firing on
    // them would be noise: vitest 4 already exits 1 on a path that matches
    // nothing, measured in this repo.
    const result = lintGate("cd pforge-mcp && npx vitest run tests/anvil.test.mjs");
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.rule)).not.toContain("gate-cannot-fail");
  });
});

describe("the self-check asks whether a gate can fail (#258)", () => {
  const templates = [
    resolve(import.meta.dirname, "..", "..", ".github", "prompts", "step2-harden-plan.prompt.md"),
    resolve(import.meta.dirname, "..", "..", "docs", "plans", "AI-Plan-Hardening-Runbook-Instructions.md"),
  ];

  for (const path of templates) {
    const name = path.split(/[\\/]/).pop();

    it(`${name} asks whether every gate can fail`, () => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/actually\s+fail/i);
    });

    it(`${name} names both measured traps`, () => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/passWithNoTests/);
      expect(src).toMatch(/pnpm\s+(?:--filter|run)/);
    });

    it(`${name} says the vitest trap is version-dependent`, () => {
      // The report measured exit 0; vitest 4 exits 1. A self-check that states
      // it flatly would teach the wrong thing on a current toolchain.
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/vitest 4|version-dependent|installed version/i);
    });

    it(`${name} covers the untracked-file and pre-satisfied-count traps`, () => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/untracked/i);
      expect(src).toMatch(/git ls-files/);
    });

    it(`${name} asks whether a gate can also PASS (#256)`, () => {
      // #256's unsatisfiable gate: it forbade ALTER TABLE while the plan
      // mandated five foreign keys, which Prisma always emits that way.
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/ALTER TABLE/);
      expect(src).toMatch(/red step/i);
    });
  }
});

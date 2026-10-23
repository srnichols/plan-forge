import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTaskFilesOutsideScope } from "../orchestrator/task-scope-lint.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

/**
 * Meta-bug #380 — about ten plan-defect meta-bugs shared one cause: a slice's task
 * text names a file to create or edit that its `[scope:]` list does not allow, so
 * the scope guard blocks or reverts the worker's own change. Nothing in the plan
 * linter compared the two.
 *
 * The lint is deliberately narrow, because it warns and a noisy lint gets muted:
 * a path counts only when it is the object of a write verb, only when it is a
 * file with a known extension, and only when no scope entry covers it, read
 * suffix-aware (scope `pforge-claw/src/**`, task `src/router.mjs`). Runtime
 * paths are skipped. Measured on docs/plans before it was written: a naive
 * check flagged 13% of slices, and most hits were package-relative paths or
 * runtime state.
 */

const slice = (tasks, scope = ["src/other.mjs"], extra = {}) => ({
  number: "1", title: "Work", tasks: Array.isArray(tasks) ? tasks : [tasks], scope, contextFiles: [], ...extra,
});
const flagged = (plan) => lintTaskFilesOutsideScope({ slices: [].concat(plan) });
const pathsOf = (warnings) => warnings.flatMap((w) => [...w.message.matchAll(/`([^`]+)`/g)].map((m) => m[1]));

describe("a task that changes a file outside the slice's scope (#380)", () => {
  it("warns, as a warning, naming the slice and the path", () => {
    const [warning, ...rest] = flagged(slice("Update `docs/manual/cli-reference.html` with the new command.", ["docs/PFORGE-CLAW-GUIDE.md"]));
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ slice: "1", command: null, rule: "task-file-outside-scope", severity: "warn" });
    expect(warning.message).toContain('Slice 1 ("Work")');
    expect(warning.message).toContain("`docs/manual/cli-reference.html`");
    expect(warning.message).toContain("docs/PFORGE-CLAW-GUIDE.md");
  });

  it.each([
    ["create", "Create `src/new-thing.mjs` exporting the router."],
    ["add a section to", "Add a section to `README.md` describing the flag."],
    ["append to", "Append the entry to `CHANGELOG.md`."],
    ["rewrite", "Rewrite `src/old.mjs` around the new contract."],
    ["regenerate", "Regenerate `tools.json` with the validate command."],
    ["a verb after a clause break", "Read the design first. Then edit `src/second.mjs`."],
  ])("flags a path that is the object of: %s", (_name, task) => {
    expect(pathsOf(flagged(slice(task)))).toHaveLength(1);
  });

  it("flags every path of a coordinated list in one warning", () => {
    const warnings = flagged(slice("Update `src/other.mjs` and `docs/b.md`, `c.md`."));
    expect(warnings).toHaveLength(1);
    expect(pathsOf(warnings)).toEqual(expect.arrayContaining(["docs/b.md", "c.md"]));
    expect(pathsOf(warnings)).not.toContain("src/other.mjs");
  });

  it("finds a path in the lines written under a task", () => {
    expect(pathsOf(flagged(slice("Build the part:\n   - Edit `src/deep.mjs`\n   - Add `docs/x.md`")))).toEqual(
      expect.arrayContaining(["src/deep.mjs", "docs/x.md"]),
    );
  });

  it("gives one warning per slice and bounds how many paths it lists", () => {
    const task = `Create ${Array.from({ length: 9 }, (_v, i) => `\`new/f${i}.mjs\``).join(", ")}.`;
    const warnings = flagged(slice(task));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/\+4 more/);
    expect(warnings[0].message.length).toBeLessThan(900);
  });

  it("does not exempt a file that is only a Context File: that list is read-only", () => {
    expect(flagged(slice("Update `docs/x.md`.", ["src/a.mjs"], { contextFiles: ["docs/x.md"] }))).toHaveLength(1);
  });

  // The two shapes of this defect that were filed against real plans and name their files.
  it("catches the shape of #113: the scope lists only instruction files while the tasks change routes and add a test", () => {
    const warnings = flagged(slice(
      [
        "Modify `apps/api/src/modules/me/me.routes.ts` and `apps/api/src/modules/me/me.schema.ts` to add the preferences routes.",
        "Create `apps/api/src/modules/me/me.preferences.integration.test.ts` covering each route.",
      ],
      [".github/instructions/api-patterns.instructions.md", ".github/instructions/auth.instructions.md"],
    ));
    expect(pathsOf(warnings)).toEqual(expect.arrayContaining([
      "apps/api/src/modules/me/me.routes.ts",
      "apps/api/src/modules/me/me.schema.ts",
      "apps/api/src/modules/me/me.preferences.integration.test.ts",
    ]));
  });

  it("catches the shape of #325: a slice limited to docs whose task edits the tool metadata file", () => {
    const warnings = flagged(slice(
      "Edit `pforge-mcp/capabilities/tool-metadata.mjs`: update the `forge_master_ask` examples and its one-line description.",
      ["docs/capabilities.md", "CHANGELOG.md", "docs/plans/Phase-61-PLAN.md"],
    ));
    expect(pathsOf(warnings)).toContain("pforge-mcp/capabilities/tool-metadata.mjs");
  });
});

describe("what the lint leaves alone (#380)", () => {
  it.each([
    ["an exact scope entry", "Edit `src/a.mjs`.", ["src/a.mjs"]],
    ["a directory scope entry", "Edit `src/lanes/a.mjs`.", ["src/lanes"]],
    ["a glob scope entry", "Create `src/lanes/a.mjs`.", ["src/lanes/**"]],
    ["a path relative to the package the scope is in", "Create `src/router.mjs`.", ["pforge-claw/src/**"]],
    ["a bare file name under a concrete scope file", "Edit `router.mjs`.", ["pforge-claw/src/router.mjs"]],
    ["a path relative to its package, with a concrete scope file", "Edit `src/router.mjs`.", ["pforge-claw/src/router.mjs"]],
    ["a file name relative to the scope's own directory", "Update `cli-reference.html` for the new command.", ["docs/manual/*"]],
    ["a file name relative to a recursive scope's directory", "Update `cli-reference.html`.", ["docs/manual/**"]],
    ["a backslash path", "Edit `src\\lanes\\a.mjs`.", ["src/lanes/**"]],
    ["a leading ./", "Edit `./src/a.mjs`.", ["src/a.mjs"]],
  ])("allows %s", (_name, task, scope) => {
    expect(flagged(slice(task, scope))).toEqual([]);
  });

  it("resolves a path against a directory the same task names", () => {
    const task = "Create `scripts/audit/preset-build/rust/scaffold/` (a `Cargo.toml` with the pinned crates, plus `src/main.rs`).";
    expect(flagged(slice(task, ["scripts/audit/preset-build/rust/**"]))).toEqual([]);
  });

  it.each([
    ["reads", "Read `docs/DESIGN.md` before editing."],
    ["cites", "Follow the shape of `src/other-module.mjs`."],
    ["refers", "Per `docs/DECISIONS.md`, keep the names stable."],
    ["runs", "Run `scripts/check.sh` and fix any failure it reports."],
    ["names a helper", "Uses fixture repos (`tests/helpers/fixture-repos.mjs`) for the checks."],
    ["describes a tool", "The webhook is managed by `cli.mjs` and bound to the dispatcher."],
    ["documents", "Document `extract.mjs` and `run.mjs` in the README."],
    ["quotes a value", "Add a test that `setup-preset-defaults.test.mjs` passes."],
    ["describes what the code does", "It writes `config.json` from the examples and runs doctor."],
    ["describes a past fix", "The port is fixed in `pforge.sh` for the job's duration."],
    ["describes what a command creates", "The command creates `out/report.json` and exits."],
    ["names a generated file the task says is not committed", "Regenerate `tools.json` and `cli-schema.json`; `cli-schema.json` is gitignored and is not committed."],
  ])("ignores a task that %s a file", (_name, task) => {
    expect(pathsOf(flagged(slice(task, ["tools.json"])))).toEqual([]);
  });

  it.each([
    ["do not", "Do not edit `package.json`."],
    ["never", "Never modify `docs/index.html` here."],
    ["no", "No change to `src/frozen.mjs`."],
    ["without", "Write the module without touching `src/legacy.mjs`."],
    ["a parenthetical not", "Create `src/a.mjs` (not `src/b.mjs`)."],
  ])("ignores a path a task says not to change: %s", (_name, task) => {
    expect(pathsOf(flagged(slice(task, ["src/a.mjs"])))).toEqual([]);
  });

  it.each([
    [".forge/secrets.json"], ["state/offsets.json"], [".vscode/mcp.json"], ["node_modules/x/index.js"],
    [".git/config.json"], ["dist/app.js"], ["coverage/lcov.json"],
  ])("skips the runtime path %s", (path) => {
    expect(flagged(slice(`Write \`${path}\` when it starts.`))).toEqual([]);
  });

  it.each([
    ["a config key", "Add `http.bind` to the config."],
    ["an event name", "Emit `job.finished` after each run."],
    ["an address", "Update the listener to bind `127.0.0.1`."],
    ["a model name", "Append flagship `grok-4.5` to the list."],
    ["a property", "Edit the `from.id` check."],
    ["a glob", "Create `src/lanes/*.mjs` for each lane."],
    ["a directory", "Create `src/lanes/` for the lanes."],
    ["a command", "Update `npm test` in the docs."],
    ["a flag", "Add `--dry-run` support."],
  ])("ignores %s", (_name, task) => {
    expect(flagged(slice(task))).toEqual([]);
  });

  it("does not judge a slice that declares no scope", () => {
    expect(flagged(slice("Create `src/new.mjs`.", []))).toEqual([]);
    expect(flagged({ number: "2", title: "T", tasks: ["Create `src/new.mjs`."] })).toEqual([]);
    expect(flagged({ number: "3", title: "T", scope: ["src/a.mjs"] })).toEqual([]);
  });

  it("returns nothing for a plan with no slices", () => {
    expect(lintTaskFilesOutsideScope({ slices: [] })).toEqual([]);
    expect(lintTaskFilesOutsideScope({})).toEqual([]);
  });
});

describe("the plan linter reports it as a warning (#380)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-380-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function lint(...body) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      "### Slice 1: Docs [scope: docs/GUIDE.md]", "",
      ...body, "",
      "**Validation Gate**:", "```bash", "npm test", "```", "",
    ].join("\n"));
    return lintGateCommands(planPath, dir);
  }

  it("warns without failing the plan", () => {
    const result = lint("1. Update `docs/manual/cli-reference.html` with the new command.");
    expect(result.warnings.filter((w) => w.rule === "task-file-outside-scope")).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("is quiet when the task stays inside the scope", () => {
    const result = lint("1. Update `docs/GUIDE.md` with the new command.");
    expect(result.warnings.filter((w) => w.rule === "task-file-outside-scope")).toEqual([]);
  });

  it("reads a path written under the task", () => {
    const result = lint("1. Update the docs:", "   - Edit `docs/manual/cli-reference.html`");
    expect(result.warnings.filter((w) => w.rule === "task-file-outside-scope")).toHaveLength(1);
  });
});

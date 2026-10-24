import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATE_ALLOWED_PREFIXES, resolveGateCommandToken, gateCommandWords } from "../orchestrator/constants.mjs";
import { parseGateAllowedPrefixes, loadGateAllowedPrefixes, isGateLineAllowed, gateAllowlistEntryFor, gateAllowlistAdvice } from "../orchestrator/gate-allowlist.mjs";
import { parsePlan, loadPlanParserConfig } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands, isGateCommandAllowed, regressionGuard } from "../orchestrator/gate-helpers.mjs";
import { runGate } from "../orchestrator/gate-runner.mjs";
import { CONFIG_SCHEMA } from "../capabilities/schemas.mjs";

/**
 * Meta-bug #367 — the gate command allow-list was a constant with no way for a
 * project to extend it. It lacked `az`, `terraform` and `Invoke-Pester`, which
 * the azure-iac preset's own testing and deploy instructions name, so a gate
 * that used them was an error from the lint and refused at run time, and the
 * message told a plan author to edit `GATE_ALLOWED_PREFIXES`, a source constant
 * in the framework. Authors wrapped the command in `pwsh -Command` instead,
 * which passes because only the first token is read.
 *
 * The list is not a sandbox: it already admits `rm`, `curl`, `bash`, `node` and
 * `npx`, each of which runs anything. The regression guard adds a short
 * blocklist of destructive patterns that no entry overrides; a run's own gates
 * have no such check. So this adds `invoke-pester` to the defaults
 * (a test runner, like pytest and vitest) and a `.forge.json` key,
 * `gateAllowedPrefixes`, for the rest: an entry is a command or a command and
 * subcommand, so a project can allow `terraform validate` without `terraform apply`.
 */

describe("the default allowlist (#367)", () => {
  it("allows Invoke-Pester, a test runner like pytest and vitest", () => {
    expect(GATE_ALLOWED_PREFIXES).toContain("invoke-pester");
    expect(isGateCommandAllowed("Invoke-Pester -Path ./tests -Output Detailed")).toBe(true);
  });

  it("still leaves az and terraform to the project", () => {
    expect(GATE_ALLOWED_PREFIXES).not.toContain("az");
    expect(GATE_ALLOWED_PREFIXES).not.toContain("terraform");
    expect(isGateCommandAllowed("az bicep build --file infra/main.bicep")).toBe(false);
    expect(isGateCommandAllowed("terraform validate")).toBe(false);
  });
});

describe("gateCommandWords and resolveGateCommandToken (#367)", () => {
  it.each([
    ["npm test", ["npm", "test"]],
    ["  NPM   Test ", ["npm", "test"]],
    ["NODE_ENV=test npm test", ["npm", "test"]],
    ["A=1 B=2 az bicep build", ["az", "bicep", "build"]],
    ["$p = Get-Content x", ["get-content", "x"]],
    ["$p=Get-Content x", ["get-content", "x"]],
    ["", []],
    ["   ", []],
    [null, []],
  ])("reads the words of %j from the command on", (line, words) => {
    expect(gateCommandWords(line)).toEqual(words);
  });

  it.each([
    ["npm test", "npm"],
    ["NODE_ENV=test npm test", "npm"],
    ["$p = Get-Content x", "get-content"],
    ["$p=Get-Content x", "get-content"],
    ["FOO=1 BAR=2", "foo=1"],
    ["", ""],
    [undefined, ""],
    ["Invoke-Pester -Path t", "invoke-pester"],
  ])("still resolves the command token of %j to %j", (line, token) => {
    expect(resolveGateCommandToken(line)).toBe(token);
  });
});

describe("parseGateAllowedPrefixes (#367)", () => {
  it("normalises each entry: trimmed, single-spaced, lower case", () => {
    expect(parseGateAllowedPrefixes(["  AZ   Bicep ", "terraform validate", "Helm"])).toEqual(["az bicep", "terraform validate", "helm"]);
  });

  it("drops an entry that is not a plain command", () => {
    expect(parseGateAllowedPrefixes([
      "", "   ", 42, null, { a: 1 }, ["x"],
      "az; rm -rf /", "terraform && ls", "a | b", "echo $HOME", "`id`", "$(id)", 'say "hi"', "it's", "a > b", "a < b", "(x)", "a\\b", "*", "a*",
      "one two three four", `${"x".repeat(81)}`, "-flag", "c:/tools/x",
    ])).toEqual([]);
  });

  it("keeps a path-like entry, a dotted one and a hyphenated one", () => {
    expect(parseGateAllowedPrefixes(["./scripts/check", "node_modules/.bin/tflint", "docker-compose", "g++"])).toEqual([
      "./scripts/check", "node_modules/.bin/tflint", "docker-compose", "g++",
    ]);
  });

  it("removes duplicates and holds the list to 100 entries", () => {
    expect(parseGateAllowedPrefixes(["az", "AZ", " az "])).toEqual(["az"]);
    const many = Array.from({ length: 150 }, (_v, i) => `tool${i}`);
    expect(parseGateAllowedPrefixes(many)).toHaveLength(100);
  });

  it.each([undefined, null, "az", 7, { az: true }, true])("is empty for %j, which is not a list", (value) => {
    expect(parseGateAllowedPrefixes(value)).toEqual([]);
  });
});

describe("loadGateAllowedPrefixes (#367)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-367-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads gateAllowedPrefixes from the project's .forge.json", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["az bicep", "Terraform Validate"] }));
    expect(loadGateAllowedPrefixes(dir)).toEqual(["az bicep", "terraform validate"]);
  });

  it("is empty with no .forge.json, an unreadable one, no key, or a key that is not a list", () => {
    expect(loadGateAllowedPrefixes(dir)).toEqual([]);
    writeFileSync(join(dir, ".forge.json"), "{ not json");
    expect(loadGateAllowedPrefixes(dir)).toEqual([]);
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ projectName: "x" }));
    expect(loadGateAllowedPrefixes(dir)).toEqual([]);
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: "az" }));
    expect(loadGateAllowedPrefixes(dir)).toEqual([]);
  });
});

describe("isGateLineAllowed (#367)", () => {
  it("allows what the defaults allow, with or without extras", () => {
    expect(isGateLineAllowed("npm test")).toBe(true);
    expect(isGateLineAllowed("npm test", ["az"])).toBe(true);
    expect(isGateLineAllowed("terraform validate")).toBe(false);
  });

  it("lets a one-word entry allow every use of that command", () => {
    const extra = ["az"];
    expect(isGateLineAllowed("az bicep build --file infra/main.bicep", extra)).toBe(true);
    expect(isGateLineAllowed("AZ account show", extra)).toBe(true);
    expect(isGateLineAllowed("/usr/bin/az bicep lint", extra)).toBe(true);
    expect(isGateLineAllowed("AZURE_CONFIG_DIR=/tmp/x az bicep lint", extra)).toBe(true);
    expect(isGateLineAllowed("$out = az bicep lint", extra)).toBe(true);
  });

  it("lets a subcommand entry allow that subcommand and nothing else of the command", () => {
    const extra = ["terraform validate"];
    expect(isGateLineAllowed("terraform validate", extra)).toBe(true);
    expect(isGateLineAllowed("terraform validate -json", extra)).toBe(true);
    expect(isGateLineAllowed("TERRAFORM   Validate", extra)).toBe(true);
    expect(isGateLineAllowed("terraform apply -auto-approve", extra)).toBe(false);
    expect(isGateLineAllowed("terraform", extra)).toBe(false);
    expect(isGateLineAllowed("terraform -chdir=infra validate", extra)).toBe(false);
  });

  it("matches whole words, and only at the start of the command", () => {
    expect(isGateLineAllowed("terraformer import", ["terraform"])).toBe(false);
    expect(isGateLineAllowed("az2 bicep", ["az"])).toBe(false);
    expect(isGateLineAllowed("wget az bicep", ["az bicep"])).toBe(false);
    expect(isGateLineAllowed("az bicepx build", ["az bicep"])).toBe(false);
  });

  it("is false for an empty line", () => {
    expect(isGateLineAllowed("", ["az"])).toBe(false);
    expect(isGateLineAllowed(null, ["az"])).toBe(false);
  });
});

describe("isGateCommandAllowed with a project's entries (#367)", () => {
  it("allows a configured command, and refuses it without the entry", () => {
    expect(isGateCommandAllowed("terraform validate")).toBe(false);
    expect(isGateCommandAllowed("terraform validate", ["terraform validate"])).toBe(true);
  });

  it("never lets an entry override the blocklist of destructive patterns", () => {
    expect(isGateCommandAllowed("mkfs.ext4 /dev/sdb1", ["mkfs.ext4"])).toBe(false);
    expect(isGateCommandAllowed("rm -rf /", ["rm"])).toBe(false);
    expect(isGateCommandAllowed("dd if=/dev/zero of=/dev/sda", ["dd"])).toBe(false);
  });
});

describe("gateAllowlistEntryFor (#367)", () => {
  it.each([
    ["az bicep build --file infra/main.bicep", "az bicep"],
    ["terraform validate", "terraform validate"],
    ["helm lint ./chart", "helm lint"],
    ["kubectl", "kubectl"],
    ["terraform -chdir=infra validate", "terraform"],
    ["/usr/local/bin/tflint --recursive", "tflint"],
    ["AZURE_CONFIG_DIR=/x az account show", "az account"],
    ["Invoke-Whatever -Path x", "invoke-whatever"],
    ["tool ./relative/path", "tool"],
  ])("suggests the entry for %j", (line, entry) => {
    expect(gateAllowlistEntryFor(line)).toBe(entry);
  });

  it("suggests nothing for a command that could not be an entry", () => {
    expect(gateAllowlistEntryFor("$(id) now")).toBe("");
    expect(gateAllowlistEntryFor("")).toBe("");
  });
});

describe("gateAllowlistAdvice (#367)", () => {
  it("shows the entry to add, in the form .forge.json takes", () => {
    expect(gateAllowlistAdvice("az bicep build --file x")).toBe(
      'Allow it with "gateAllowedPrefixes": ["az bicep"] in .forge.json (an entry is a command, or a command and subcommand)',
    );
  });

  it("names the key without an example when no entry can be made of the line", () => {
    expect(gateAllowlistAdvice("$(id) now")).toBe('Allow it with "gateAllowedPrefixes" in .forge.json (an entry is a command, or a command and subcommand)');
  });
});

describe("the gate linter (#367)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-367-lint-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function lint(gateLines, forgeJson) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- x", "## Execution Slices", "### Slice 1: Infra", "1. Do it", "",
      "**Validation Gate**:", "```bash", ...gateLines, "```", "",
    ].join("\n"));
    if (forgeJson !== undefined) writeFileSync(join(dir, ".forge.json"), JSON.stringify(forgeJson));
    return lintGateCommands(planPath, dir);
  }
  const blocked = (result) => result.errors.filter((error) => error.rule === "blocked-command");

  it("tells the author how to allow the command, not to edit a constant in the framework", () => {
    const [error] = blocked(lint(["az bicep build --file infra/main.bicep"]));
    expect(error).toBeDefined();
    expect(error.message).toContain("'az' is not in the gate allowlist");
    expect(error.message).toContain('"gateAllowedPrefixes"');
    expect(error.message).toContain(".forge.json");
    expect(error.message).toContain('"az bicep"');
    expect(error.message).toMatch(/or rewrite the command/);
    expect(error.message).not.toContain("GATE_ALLOWED_PREFIXES");
  });

  it("accepts a command the project allows, and still refuses the rest", () => {
    const result = lint(["az bicep build --file infra/main.bicep", "terraform apply -auto-approve", "terraform validate"], { gateAllowedPrefixes: ["az", "terraform validate"] });
    expect(blocked(result).map((error) => error.command)).toEqual(["terraform apply -auto-approve"]);
  });

  it("accepts Invoke-Pester with no configuration", () => {
    expect(blocked(lint(["Invoke-Pester -Path ./tests -Output Detailed"]))).toEqual([]);
  });
});

describe("runGate (#367)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-367-run-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses a command the project has not allowed, and says how to allow it", () => {
    const result = runGate("whoami", dir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in allowlist/);
    expect(result.error).toContain("Allowed:");
    expect(result.error).toContain('"gateAllowedPrefixes"');
    expect(result.error).toContain(".forge.json");
    expect(result.error).toContain('"whoami"');
  });

  it("runs the command once the project allows it", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["whoami"] }));
    const result = runGate("whoami", dir);
    expect(result.error).toBe("");
    expect(result.success).toBe(true);
  });

  it("lists the project's entries beside the defaults when it refuses a command", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["terraform validate"] }));
    const result = runGate("terraform apply", dir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("terraform validate");
  });

  it("reads the project's entries from the project root, even for a gate run in a package inside it", () => {
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["whoami"] }));
    expect(runGate("whoami", dir, { workdir: "pkg" }).success).toBe(true);
  });

  it("still blocks a destructive pattern whatever the project allows", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["rm"] }));
    expect(isGateCommandAllowed("rm -rf /", loadGateAllowedPrefixes(dir))).toBe(false);
  });
});

describe("the plan parser (#367)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-367-parse-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const planWith = (gateLine) => {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, ["# Plan", "## Scope Contract", "### In Scope", "- x", "## Execution Slices", "### Slice 1: Infra", "1. Do it", gateLine, ""].join("\n"));
    return planPath;
  };

  it("reports the project's entries with the rest of its parser config", () => {
    expect(loadPlanParserConfig(dir).gateAllowedPrefixes).toEqual([]);
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["Terraform Validate"] }));
    expect(loadPlanParserConfig(dir)).toMatchObject({ implicitGates: false, gateAllowedPrefixes: ["terraform validate"] });
  });

  it("still reads implicitGates from runtime.planParser, and only a literal true turns it on", () => {
    const write = (config) => writeFileSync(join(dir, ".forge.json"), typeof config === "string" ? config : JSON.stringify(config));
    write({ runtime: { planParser: { implicitGates: true } } });
    expect(loadPlanParserConfig(dir).implicitGates).toBe(true);
    for (const config of [
      { runtime: { planParser: { implicitGates: "true" } } },
      { runtime: { planParser: { implicitGates: 1 } } },
      { runtime: { planParser: {} } },
      { runtime: { planParser: "yes" } },
      { runtime: "x" },
      { planParser: { implicitGates: true } },
      "{ not json",
    ]) {
      write(config);
      expect(loadPlanParserConfig(dir).implicitGates, JSON.stringify(config)).toBe(false);
    }
  });

  it("reads an inline gate command the project allows, instead of taking it for prose", () => {
    const line = "**Validation Gate**: `terraform validate`";
    expect(parsePlan(planWith(line), dir).slices[0]).toMatchObject({ validationGate: null, validationGateDescription: "`terraform validate`" });
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["terraform validate"] }));
    expect(parsePlan(planWith(line), dir).slices[0].validationGate).toBe("terraform validate");
  });

  it("keeps reading a gate with a default command exactly as before", () => {
    expect(parsePlan(planWith("**Validation Gate**: `npm test`"), dir).slices[0].validationGate).toBe("npm test");
  });
});

describe("the regression guard (#367)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-367-guard-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function project(forgeJson) {
    const plans = join(dir, "docs", "plans");
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(plans, "Phase-1-PLAN.md"), [
      "# Plan", "## Scope Contract", "### In Scope", "- x", "## Execution Slices", "### Slice 1: Who", "1. Do it", "**Validation Gate**:", "```bash", "whoami", "```", "",
    ].join("\n"));
    if (forgeJson) writeFileSync(join(dir, ".forge.json"), JSON.stringify(forgeJson));
  }

  it("blocks a gate the project has not allowed", async () => {
    project(null);
    const result = await regressionGuard([], { cwd: dir });
    expect(result).toMatchObject({ gatesChecked: 1, blocked: 1, passed: 0 });
  });

  it("runs the gate once the project allows it", async () => {
    project({ gateAllowedPrefixes: ["whoami"] });
    const result = await regressionGuard([], { cwd: dir });
    expect(result).toMatchObject({ gatesChecked: 1, blocked: 0, passed: 1 });
  });

  it("lets a project's entry win over the prose heuristic, as the built-in list does", async () => {
    // "gantt" opens a Mermaid diagram, so a line that starts with it reads as prose, unless the project allows it.
    const gate = "gantt render chart.txt";
    const writePlan = () => {
      const plans = join(dir, "docs", "plans");
      mkdirSync(plans, { recursive: true });
      writeFileSync(join(plans, "Phase-1-PLAN.md"), ["# Plan", "## Scope Contract", "### In Scope", "- x", "## Execution Slices", "### Slice 1: Chart", "1. Do it", "**Validation Gate**:", "```bash", gate, "```", ""].join("\n"));
    };
    writePlan();
    expect((await regressionGuard([], { cwd: dir })).skipped).toBe(1);
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateAllowedPrefixes: ["gantt"] }));
    const result = await regressionGuard([], { cwd: dir });
    expect(result).toMatchObject({ skipped: 0, blocked: 0 });
    expect(result.results[0].status).toBe("failed");
  });
});

describe(".forge.json schema (#367)", () => {
  it("declares gateAllowedPrefixes as a list of strings and says what an entry may be", () => {
    const entry = CONFIG_SCHEMA.properties.gateAllowedPrefixes;
    expect(entry).toMatchObject({ type: "array", items: { type: "string" }, default: [] });
    expect(entry.description).toMatch(/subcommand/);
    expect(entry.description).toMatch(/terraform validate/);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  applyUpdates,
  classifyFile,
  contentHash,
  normalizeText,
  parseList,
  planUpdates,
  readPlaceholderValues,
  renderPlaceholders,
  runCli,
  unrenderPlaceholders,
  INDEX_FILE,
  DEFAULT_INDEX_PATH,
  loadShippedHashes,
} from "../update-guard.mjs";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "pf-update-guard-"));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const VALUES = { projectName: "Acme Orders", stack: "Node.js / TypeScript", setupDate: "2026-05-01" };
const V1 = "# Workflow\n\nSearch memory for project: \"<YOUR PROJECT NAME>\" (stack <YOUR TECH STACK>, since <DATE>).\n";
const V2 = "# Workflow\n\nSearch memory for project: \"<YOUR PROJECT NAME>\" before each slice.\n";

describe("text helpers", () => {
  it("normalizes BOM and every CR so Windows checkouts hash like the shipped text", () => {
    expect(normalizeText("\uFEFFa\r\nb\rc")).toBe("a\nbc");
    expect(contentHash("\uFEFFline\r\n")).toBe(contentHash("line\n"));
    expect(contentHash("x")).toHaveLength(16);
  });

  it("renders and unrenders placeholders as an exact round trip", () => {
    const rendered = renderPlaceholders(V1, VALUES);
    expect(rendered).not.toMatch(/<YOUR |<DATE>/);
    expect(rendered).toContain("Acme Orders");
    expect(unrenderPlaceholders(rendered, VALUES)).toBe(V1);
  });

  it("leaves a token alone when .forge.json has no value for it", () => {
    expect(renderPlaceholders(V1, { projectName: "Acme" })).toContain("<YOUR TECH STACK>");
  });

  it("reads placeholder values from .forge.json and ignores non-string or empty ones", () => {
    const project = tree({ ".forge.json": JSON.stringify({ projectName: "Acme", stack: "", setupDate: 3, preset: "dotnet" }) });
    expect(readPlaceholderValues(project)).toEqual({ projectName: "Acme" });
    expect(readPlaceholderValues(tree({}))).toEqual({});
  });
});

describe("classifyFile", () => {
  const shipped = new Set([contentHash(V1), contentHash(V2)]);
  const classify = (projectText, sourceText = V2) => classifyFile({ sourceText, projectText, isMarkdown: true, values: VALUES, shippedHashes: shipped });

  it("adds a file the project does not have, rendered", () => {
    const r = classify(null);
    expect(r.action).toBe("new");
    expect(r.content).toContain("Acme Orders");
  });

  it("reports nothing to do when the project has the rendered new version (even with CRLF)", () => {
    expect(classify(renderPlaceholders(V2, VALUES).replace(/\n/g, "\r\n")).action).toBe("same");
  });

  it("updates an unmodified older version that setup rendered", () => {
    const r = classify(renderPlaceholders(V1, VALUES));
    expect(r.action).toBe("update");
    expect(r.content).not.toMatch(/<YOUR |<DATE>/);
  });

  it("updates an older version still carrying raw tokens", () => {
    expect(classify(V1).action).toBe("update");
  });

  it("keeps a file the project changed", () => {
    expect(classify(renderPlaceholders(V1, VALUES) + "\n- Our rule: path-limited commits only.\n").action).toBe("customized");
  });

  it("compares non-Markdown files byte-for-byte without rendering", () => {
    const hook = "echo <DATE>\n";
    const r = classifyFile({ sourceText: hook, projectText: "echo old\n", isMarkdown: false, values: VALUES, shippedHashes: new Set([contentHash("echo old\n")]) });
    expect(r).toEqual({ action: "update", content: hook });
  });
});

describe("planUpdates + applyUpdates", () => {
  function seed() {
    const source = tree({
      [`pforge-mcp/${INDEX_FILE}`]: JSON.stringify({ hashes: [contentHash(V1), contentHash(V2), contentHash("echo v1\n"), contentHash("echo v2\n")] }),
      ".github/prompts/step3.prompt.md": V2,
      "presets/shared/.github/instructions/git-workflow.instructions.md": V2,
      ".github/instructions/new.instructions.md": V2,
      "templates/.github/hooks/scripts/check.sh": "echo v2\n",
    });
    const project = tree({
      ".forge.json": JSON.stringify(VALUES),
      ".github/prompts/step3.prompt.md": renderPlaceholders(V1, VALUES),
      ".github/instructions/git-workflow.instructions.md": "# Our own git rules\n",
      ".github/hooks/scripts/check.sh": "echo v1\r\n",
    });
    const entries = parseList([
      ".github/prompts/step3.prompt.md\t.github/prompts/step3.prompt.md",
      "presets/shared/.github/instructions/git-workflow.instructions.md\t.github/instructions/git-workflow.instructions.md",
      ".github/instructions/new.instructions.md\t.github/instructions/new.instructions.md",
      "templates/.github/hooks/scripts/check.sh\t.github/hooks/scripts/check.sh",
    ].join("\r\n"));
    return { source, project, entries };
  }

  it("plans new, update and customized files without writing anything", () => {
    const { source, project, entries } = seed();
    const plan = planUpdates(entries, { sourceRoot: source, projectRoot: project, shippedHashes: new Set(JSON.parse(readFileSync(join(source, "pforge-mcp", INDEX_FILE), "utf8")).hashes) });
    expect(plan.map((p) => [p.projectPath, p.action])).toEqual([
      [".github/prompts/step3.prompt.md", "update"],
      [".github/instructions/git-workflow.instructions.md", "customized"],
      [".github/instructions/new.instructions.md", "new"],
      [".github/hooks/scripts/check.sh", "update"],
    ]);
    expect(existsSync(join(project, ".forge/update-pending"))).toBe(false);
  });

  it("keeps customized files, saves the new version as pending, and renders what it writes", () => {
    const { source, project, entries } = seed();
    const shippedHashes = new Set(JSON.parse(readFileSync(join(source, "pforge-mcp", INDEX_FILE), "utf8")).hashes);
    const results = applyUpdates(planUpdates(entries, { sourceRoot: source, projectRoot: project, shippedHashes }), { sourceRoot: source, projectRoot: project });
    expect(results.map((r) => r.result)).toEqual(["updated", "kept", "added", "updated"]);
    expect(readFileSync(join(project, ".github/prompts/step3.prompt.md"), "utf8")).toBe(renderPlaceholders(V2, VALUES));
    expect(readFileSync(join(project, ".github/instructions/git-workflow.instructions.md"), "utf8")).toBe("# Our own git rules\n");
    expect(readFileSync(join(project, ".forge/update-pending/.github/instructions/git-workflow.instructions.md"), "utf8")).toBe(renderPlaceholders(V2, VALUES));
    expect(readFileSync(join(project, ".github/hooks/scripts/check.sh"), "utf8")).toBe("echo v2\n");
  });

  it("with --overwrite-customized backs the project's version up before replacing it", () => {
    const { source, project, entries } = seed();
    const shippedHashes = new Set(JSON.parse(readFileSync(join(source, "pforge-mcp", INDEX_FILE), "utf8")).hashes);
    const results = applyUpdates(planUpdates(entries, { sourceRoot: source, projectRoot: project, shippedHashes }), { sourceRoot: source, projectRoot: project, overwriteCustomized: true, stamp: "T1" });
    const overwrote = results.find((r) => r.result === "overwrote");
    expect(overwrote.detail).toBe(".forge/update-backups/T1/.github/instructions/git-workflow.instructions.md");
    expect(readFileSync(join(project, overwrote.detail), "utf8")).toBe("# Our own git rules\n");
    expect(readFileSync(join(project, ".github/instructions/git-workflow.instructions.md"), "utf8")).toBe(renderPlaceholders(V2, VALUES));
  });
});

describe("CLI", () => {
  function capture() {
    let out = "";
    let err = "";
    return { io: { stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } }, out: () => out, err: () => err };
  }

  it("prints a tab-separated plan", () => {
    const source = tree({ [`pforge-mcp/${INDEX_FILE}`]: JSON.stringify({ hashes: [] }), "a.md": "x\n" });
    const project = tree({});
    const list = join(project, "list.tsv");
    writeFileSync(list, "a.md\t.github/instructions/a.instructions.md\n");
    const c = capture();
    expect(runCli(["plan", "--source", source, "--project", project, "--list", list, "--index", join(source, "pforge-mcp", INDEX_FILE)], c.io)).toBe(0);
    expect(c.out()).toBe("new\t.github/instructions/a.instructions.md\n");
  });

  it("reads the index next to the module by default, so a project's installed guard works with any source", () => {
    expect(DEFAULT_INDEX_PATH).toBe(join(import.meta.dirname, "..", INDEX_FILE));
    expect(loadShippedHashes().size).toBeGreaterThan(0);
  });

  it("fails with exit 3 when the shipped index is missing, and exit 2 on bad usage", () => {
    const c = capture();
    const missing = join(tree({}), INDEX_FILE);
    expect(runCli(["plan", "--source", tree({}), "--project", tree({}), "--list", "x", "--index", missing], c.io)).toBe(3);
    expect(c.err()).toMatch(INDEX_FILE);
    expect(runCli(["bogus"], capture().io)).toBe(2);
  });
});

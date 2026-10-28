/**
 * Meta-bug #435 — `pforge update` rolled back the dependency ranges a project had raised itself.
 *
 * pforge-mcp, pforge-master and pforge-sdk are copied into a project, so their package.json files sit in the
 * project's own repository, where Dependabot or a maintainer raises a range. Update compared the manifest byte for
 * byte and replaced it with the release's copy, so the bump was undone and an advisory it had closed came back.
 *
 * The manifests now go through the update guard with a merge: for each dependency the release declares, the higher
 * range wins; everything else in the file is the release's. Nothing here reads the network or the lock. These cases
 * hold the merge itself (manifest-merge.mjs), the guard that applies it, and the plan that offers it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyManifest, compareVersions, isPackageManifest, lowestVersion, mergePackageManifest } from "../manifest-merge.mjs";
import { classifyFile, runCli } from "../update-guard.mjs";
import { buildPlan } from "../update-plan.mjs";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "pf-manifest-merge-"));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const manifest = (fields, { indent = 2, eol = "\n" } = {}) => `${JSON.stringify(fields, null, indent).replace(/\n/g, eol)}${eol}`;

const RELEASE = {
  name: "plan-forge-mcp",
  version: "9.9.10",
  scripts: { test: "vitest run" },
  dependencies: { express: "^5.2.1", ws: "^8.22.0", dotenv: "^18.0.8", undici: "^7.30.1" },
  devDependencies: { vitest: "^5.0.5" },
  optionalDependencies: { playwright: "^1.64.1" },
};

describe("lowestVersion", () => {
  it.each([
    ["^5.3.0", [5, 3, 0, []]],
    ["~1.2.3", [1, 2, 3, []]],
    [">=22.12.0", [22, 12, 0, []]],
    ["1.2.3", [1, 2, 3, []]],
    ["=1.2.3", [1, 2, 3, []]],
    ["v1.2.3", [1, 2, 3, []]],
    ["^1.2", [1, 2, 0, []]],
    ["1.x", [1, 0, 0, []]],
    ["^1", [1, 0, 0, []]],
    [" >= 1.2.3 ", [1, 2, 3, []]],
    ["^1.2.3+build.5", [1, 2, 3, []]],
    ["^4.15.0-beta.1", [4, 15, 0, ["beta", "1"]]],
  ])("reads %j as the lowest version %j", (range, [major, minor, patch, pre]) => {
    expect(lowestVersion(range)).toEqual({ major, minor, patch, pre });
  });

  it.each(["latest", "*", "x", "", "  ", "file:../x", "github:owner/repo#tag", "npm:other@^1.0.0", "workspace:*", "^1 || ^2", ">=1 <2", "1.2.3 - 2.3.4", "^1.2.3 ^1.2.4", 42, null, undefined])(
    "does not read %j: it is not one of the plain forms",
    (range) => {
      expect(lowestVersion(range)).toBeNull();
    },
  );
});

describe("compareVersions", () => {
  const v = (range) => lowestVersion(range);
  it.each([
    ["5.3.0", "5.2.1", 1],
    ["5.2.1", "5.3.0", -1],
    ["5.2.1", "5.2.1", 0],
    ["10.0.0", "9.9.9", 1],
    ["1.10.0", "1.9.0", 1],
    ["1.0.10", "1.0.9", 1],
    ["1.0.0", "1.0.0-beta.1", 1],
    ["1.0.0-beta.1", "1.0.0", -1],
    ["1.0.0-beta.2", "1.0.0-beta.1", 1],
    ["1.0.0-beta.11", "1.0.0-beta.2", 1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0-beta", "1.0.0-beta.1", -1],
    ["1.0.0-beta.1", "1.0.0-beta", 1],
  ])("%s against %s is %i", (a, b, expected) => {
    expect(compareVersions(v(a), v(b))).toBe(expected);
  });
});

describe("isPackageManifest", () => {
  it("names the package.json of each framework package, and nothing else", () => {
    for (const path of ["pforge-mcp/package.json", "pforge-master/package.json", "pforge-sdk/package.json"]) expect(isPackageManifest(path)).toBe(true);
    for (const path of ["package.json", "pforge-mcp/package-lock.json", "pforge-mcp/tests/package.json", "pforge-mcp/node_modules/x/package.json", "docs/package.json"]) {
      expect(isPackageManifest(path)).toBe(false);
    }
  });
});

describe("mergePackageManifest", () => {
  const release = manifest(RELEASE);

  it("is the release's text, byte for byte, when the project is not ahead of it anywhere", () => {
    const older = manifest({ ...RELEASE, version: "9.9.9", dependencies: { express: "^5.0.0", ws: "^8.18.0", dotenv: "^18.0.8", undici: "^7.0.0" }, devDependencies: { vitest: "^4.1.12" } });
    const merged = mergePackageManifest(release, older);
    expect(merged.kept).toEqual([]);
    expect(merged.text).toBe(release);
  });

  it("is the release's text as it is when no range is kept, even in a layout JSON.stringify would not write", () => {
    const odd = '{\n  "name": "plan-forge-mcp",\n  "files": ["a","b"],\n  "description": "Caf\\u00e9",\n  "dependencies": {"express": "^5.2.1"}\n}\n';
    const merged = mergePackageManifest(odd, manifest({ name: "plan-forge-mcp", dependencies: { express: "^5.2.1" } }));
    expect(merged.kept).toEqual([]);
    expect(merged.text).toBe(odd);
  });

  it("keeps a range the project raised, in each of the three dependency sections, and says which", () => {
    const project = manifest({
      ...RELEASE,
      version: "9.9.9",
      dependencies: { ...RELEASE.dependencies, express: "^5.4.0" },
      devDependencies: { vitest: "^5.1.0" },
      optionalDependencies: { playwright: "^1.70.0" },
    });
    const merged = mergePackageManifest(release, project);
    expect(merged.kept).toEqual([
      { section: "dependencies", name: "express", project: "^5.4.0", release: "^5.2.1" },
      { section: "devDependencies", name: "vitest", project: "^5.1.0", release: "^5.0.5" },
      { section: "optionalDependencies", name: "playwright", project: "^1.70.0", release: "^1.64.1" },
    ]);
    expect(JSON.parse(merged.text)).toEqual({
      ...RELEASE,
      dependencies: { ...RELEASE.dependencies, express: "^5.4.0" },
      devDependencies: { vitest: "^5.1.0" },
      optionalDependencies: { playwright: "^1.70.0" },
    });
  });

  it("takes the release's range where it is higher, and keeps the project's where it is", () => {
    const project = manifest({ ...RELEASE, dependencies: { express: "^5.4.0", ws: "^8.18.0", dotenv: "^18.0.8", undici: "^7.30.1" } });
    const merged = mergePackageManifest(release, project);
    expect(JSON.parse(merged.text).dependencies).toEqual({ express: "^5.4.0", ws: "^8.22.0", dotenv: "^18.0.8", undici: "^7.30.1" });
    expect(merged.kept.map((entry) => entry.name)).toEqual(["express"]);
  });

  it("takes everything else from the release: version, scripts, and the dependencies it adds", () => {
    const project = manifest({
      name: "plan-forge-mcp",
      version: "9.9.9",
      scripts: { test: "echo mine" },
      dependencies: { express: "^5.4.0" },
    });
    const merged = JSON.parse(mergePackageManifest(release, project).text);
    expect(merged.version).toBe("9.9.10");
    expect(merged.scripts).toEqual({ test: "vitest run" });
    expect(merged.dependencies).toEqual({ express: "^5.4.0", ws: "^8.22.0", dotenv: "^18.0.8", undici: "^7.30.1" });
    expect(merged.devDependencies).toEqual({ vitest: "^5.0.5" });
  });

  it("drops a dependency only the project has, so the release defines which packages there are", () => {
    const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, "left-pad": "^9.0.0" } });
    const merged = mergePackageManifest(release, project);
    expect(JSON.parse(merged.text).dependencies).toEqual(RELEASE.dependencies);
    expect(merged.kept).toEqual([]);
  });

  it("does not move a dependency from one section to another", () => {
    const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, vitest: "^9.0.0" } });
    expect(JSON.parse(mergePackageManifest(release, project).text).devDependencies).toEqual({ vitest: "^5.0.5" });
  });

  it("leaves a range alone when its lowest version is the same: only the operator differs", () => {
    const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "~5.2.1" } });
    const merged = mergePackageManifest(release, project);
    expect(merged.kept).toEqual([]);
    expect(merged.text).toBe(release);
  });

  it.each([["latest"], ["*"], ["file:../express"], ["github:expressjs/express#main"], ["^5.9.0 || ^6.0.0"], [">=5.9.0 <6"]])(
    "takes the release's range when the project's, %j, cannot be compared with it",
    (range) => {
      const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: range } });
      const merged = mergePackageManifest(release, project);
      expect(merged.kept).toEqual([]);
      expect(merged.text).toBe(release);
    },
  );

  it("keeps a higher pre-release range, and not a lower one", () => {
    const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "^5.3.0-beta.1", ws: "^8.22.0-rc.1" } });
    const merged = mergePackageManifest(release, project);
    expect(JSON.parse(merged.text).dependencies.express).toBe("^5.3.0-beta.1");
    expect(JSON.parse(merged.text).dependencies.ws).toBe("^8.22.0");
  });

  it("writes the merged file in the release's own layout: its indent, its line endings and its final newline", () => {
    const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "^5.4.0" } });
    const tabs = mergePackageManifest(manifest(RELEASE, { indent: "\t" }), project).text;
    expect(tabs).toContain('\n\t"name"');
    const crlf = mergePackageManifest(manifest(RELEASE, { eol: "\r\n" }), project).text;
    expect(crlf).toContain('"express": "^5.4.0"');
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
    expect(crlf.endsWith("\r\n")).toBe(true);
    const bare = mergePackageManifest(release.trimEnd(), project).text;
    expect(bare.endsWith("\n")).toBe(false);
    expect(bare.endsWith("}")).toBe(true);
  });

  it("keeps the release's key order", () => {
    const project = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "^5.4.0" } });
    const merged = JSON.parse(mergePackageManifest(release, project).text);
    expect(Object.keys(merged)).toEqual(Object.keys(RELEASE));
    expect(Object.keys(merged.dependencies)).toEqual(Object.keys(RELEASE.dependencies));
  });

  it("reads a project manifest that starts with a byte order mark", () => {
    const project = `\uFEFF${manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "^5.4.0" } })}`;
    expect(mergePackageManifest(release, project).kept).toHaveLength(1);
  });

  it("answers null when either side is not a JSON object, so the caller can fall back to the release's text", () => {
    expect(mergePackageManifest(release, "{ not json")).toBeNull();
    expect(mergePackageManifest(release, "[]")).toBeNull();
    expect(mergePackageManifest(release, "null")).toBeNull();
    expect(mergePackageManifest("{ not json", release)).toBeNull();
  });
});

describe("classifyManifest", () => {
  const release = manifest(RELEASE);

  it("is new when the project has no manifest, and the release's text", () => {
    expect(classifyManifest({ sourceText: release, projectText: null })).toMatchObject({ action: "new", content: release });
  });

  it("is same when the project's manifest is the release's", () => {
    expect(classifyManifest({ sourceText: release, projectText: release }).action).toBe("same");
  });

  it("is same when only the formatting differs: line endings, indent, key order", () => {
    expect(classifyManifest({ sourceText: release, projectText: manifest(RELEASE, { eol: "\r\n" }) }).action).toBe("same");
    expect(classifyManifest({ sourceText: release, projectText: manifest(RELEASE, { indent: 4 }) }).action).toBe("same");
    const reordered = { version: RELEASE.version, ...RELEASE };
    expect(classifyManifest({ sourceText: release, projectText: manifest(reordered) }).action).toBe("same");
  });

  it("is same when the project is ahead of the release everywhere there is a difference", () => {
    const project = manifest({ ...RELEASE, dependencies: { express: "^5.4.0", ws: "^8.30.0", dotenv: "^18.1.0", undici: "^7.31.0" }, devDependencies: { vitest: "^5.1.0" }, optionalDependencies: { playwright: "^1.70.0" } });
    expect(classifyManifest({ sourceText: release, projectText: project }).action).toBe("same");
  });

  it("is an update, with the merged text, when the project is behind the release anywhere", () => {
    const project = manifest({ ...RELEASE, version: "9.9.9", dependencies: { ...RELEASE.dependencies, express: "^5.4.0", ws: "^8.18.0" } });
    const result = classifyManifest({ sourceText: release, projectText: project });
    expect(result.action).toBe("update");
    expect(JSON.parse(result.content).dependencies).toMatchObject({ express: "^5.4.0", ws: "^8.22.0" });
    expect(result.kept.map((entry) => entry.name)).toEqual(["express"]);
    expect(result.releaseText).toBe(release);
  });

  it("is an update to the release's text when the project's manifest is not JSON", () => {
    expect(classifyManifest({ sourceText: release, projectText: "{ not json" })).toMatchObject({ action: "update", content: release, kept: [] });
  });

  it("is the same merge twice: a second update finds nothing to do", () => {
    const project = manifest({ ...RELEASE, version: "9.9.9", dependencies: { ...RELEASE.dependencies, express: "^5.4.0", ws: "^8.18.0" } });
    const first = classifyManifest({ sourceText: release, projectText: project });
    expect(classifyManifest({ sourceText: release, projectText: first.content }).action).toBe("same");
  });
});

describe("the update guard", () => {
  const release = manifest(RELEASE);
  const ahead = manifest({ ...RELEASE, version: "9.9.9", dependencies: { ...RELEASE.dependencies, express: "^5.4.0", ws: "^8.18.0" } });

  function run(mode, { project, extra = [] }) {
    const root = tree({
      "source/pforge-mcp/package.json": release,
      "project/pforge-mcp/package.json": project,
      "list.tsv": "pforge-mcp/package.json\tpforge-mcp/package.json\n",
      "index.json": '{"hashes":[]}\n',
    });
    const lines = [];
    const code = runCli([mode, "--source", join(root, "source"), "--project", join(root, "project"), "--list", join(root, "list.tsv"), "--index", join(root, "index.json"), ...extra], {
      stdout: { write: (text) => lines.push(text) },
      stderr: { write: (text) => lines.push(text) },
    });
    return { code, lines: lines.join("").split("\n").filter(Boolean), projectManifest: () => readFileSync(join(root, "project/pforge-mcp/package.json"), "utf8"), root };
  }

  it("plans a manifest that the merge changes as an update", () => {
    const planned = run("plan", { project: ahead });
    expect(planned.code).toBe(0);
    expect(planned.lines).toEqual(["update\tpforge-mcp/package.json"]);
    expect(planned.projectManifest()).toBe(ahead);
  });

  it("plans nothing to do for a manifest that is ahead of the release", () => {
    const planned = run("plan", { project: manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "^5.4.0" } }) });
    expect(planned.lines).toEqual(["same\tpforge-mcp/package.json"]);
  });

  it("writes the merge, and names the ranges it kept", () => {
    const applied = run("apply", { project: ahead });
    expect(applied.lines).toEqual(["updated\tpforge-mcp/package.json\tkept your newer ranges: express ^5.4.0"]);
    const written = JSON.parse(applied.projectManifest());
    expect(written.version).toBe("9.9.10");
    expect(written.dependencies).toEqual({ express: "^5.4.0", ws: "^8.22.0", dotenv: "^18.0.8", undici: "^7.30.1" });
  });

  it("writes the release's text unchanged, with nothing to say, when it kept no range", () => {
    const behind = manifest({ ...RELEASE, version: "9.9.9", dependencies: { express: "^5.0.0", ws: "^8.18.0", dotenv: "^18.0.8", undici: "^7.0.0" } });
    const applied = run("apply", { project: behind });
    expect(applied.lines).toEqual(["updated\tpforge-mcp/package.json\t"]);
    expect(applied.projectManifest()).toBe(release);
  });

  it("names at most five kept ranges and counts the rest", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const wide = (range, version) => manifest({ ...RELEASE, version, dependencies: Object.fromEntries(names.map((name) => [name, range])) });
    const root = tree({
      "source/pforge-mcp/package.json": wide("^1.0.0", "9.9.10"),
      "project/pforge-mcp/package.json": wide("^2.0.0", "9.9.9"),
      "list.tsv": "pforge-mcp/package.json\tpforge-mcp/package.json\n",
      "index.json": '{"hashes":[]}\n',
    });
    const lines = [];
    runCli(["apply", "--source", join(root, "source"), "--project", join(root, "project"), "--list", join(root, "list.tsv"), "--index", join(root, "index.json")], { stdout: { write: (t) => lines.push(t) }, stderr: { write: () => {} } });
    expect(lines.join("")).toBe("updated\tpforge-mcp/package.json\tkept your newer ranges: a ^2.0.0, b ^2.0.0, c ^2.0.0, d ^2.0.0, e ^2.0.0 and 2 more\n");
  });

  it("adds a manifest the project does not have", () => {
    const root = tree({
      "source/pforge-mcp/package.json": release,
      "list.tsv": "pforge-mcp/package.json\tpforge-mcp/package.json\n",
      "index.json": '{"hashes":[]}\n',
    });
    const lines = [];
    runCli(["apply", "--source", join(root, "source"), "--project", join(root, "project"), "--list", join(root, "list.tsv"), "--index", join(root, "index.json")], { stdout: { write: (t) => lines.push(t) }, stderr: { write: () => {} } });
    expect(lines.join("")).toBe("added\tpforge-mcp/package.json\t\n");
    expect(readFileSync(join(root, "project/pforge-mcp/package.json"), "utf8")).toBe(release);
  });

  it("with --overwrite-customized, replaces a manifest that is ahead with the release's, after backing up the project's", () => {
    const applied = run("apply", { project: ahead, extra: ["--overwrite-customized"] });
    expect(applied.lines).toHaveLength(1);
    const [result, path, backup] = applied.lines[0].split("\t");
    expect([result, path]).toEqual(["overwrote", "pforge-mcp/package.json"]);
    expect(backup).toMatch(/^\.forge\/update-backups\/.+\/pforge-mcp\/package\.json$/);
    expect(applied.projectManifest()).toBe(release);
    expect(readFileSync(join(applied.root, "project", backup), "utf8")).toBe(ahead);
  });

  it("with --overwrite-customized, still merges a manifest that is only behind: there is nothing of the project's to replace", () => {
    const behind = manifest({ ...RELEASE, version: "9.9.9", dependencies: { express: "^5.0.0", ws: "^8.18.0", dotenv: "^18.0.8", undici: "^7.0.0" } });
    const applied = run("apply", { project: behind, extra: ["--overwrite-customized"] });
    expect(applied.lines).toEqual(["updated\tpforge-mcp/package.json\t"]);
    expect(applied.projectManifest()).toBe(release);
  });

  it("classifies a file that is not a manifest as before, so the merge is only for the framework packages' manifests", () => {
    const text = "# T\n";
    expect(classifyFile({ sourceText: text, projectText: null, isMarkdown: true, values: {}, shippedHashes: new Set() }).action).toBe("new");
    expect(classifyFile({ sourceText: release, projectText: ahead, isMarkdown: false, values: {}, shippedHashes: new Set() }).action).toBe("customized");
  });
});

describe("the update plan", () => {
  const release = manifest(RELEASE);

  function plan(sourceFiles, projectFiles) {
    const sourceRoot = tree({ VERSION: "9.9.10", ...sourceFiles });
    const projectRoot = tree({ ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "custom" }), ...projectFiles });
    return buildPlan({ sourceRoot, projectRoot, presetsOverride: ["custom"] }).operations;
  }
  const manifestOps = (operations) => operations.filter((op) => op.dst.endsWith("package.json"));

  it("offers a manifest the merge changes as a guided update, so both shells send it through the guard", () => {
    const project = manifest({ ...RELEASE, version: "9.9.9", dependencies: { ...RELEASE.dependencies, express: "^5.4.0", ws: "^8.18.0" } });
    expect(manifestOps(plan({ "pforge-mcp/package.json": release }, { "pforge-mcp/package.json": project }))).toEqual([
      { category: "mcp", action: "update", src: "pforge-mcp/package.json", dst: "pforge-mcp/package.json", guided: true },
    ]);
  });

  it("offers a manifest the project lacks as a guided new file", () => {
    expect(manifestOps(plan({ "pforge-master/package.json": release }, {}))).toEqual([
      { category: "master", action: "new", src: "pforge-master/package.json", dst: "pforge-master/package.json", guided: true },
    ]);
  });

  it("offers nothing for a manifest that is the release's, or ahead of it everywhere", () => {
    expect(manifestOps(plan({ "pforge-mcp/package.json": release }, { "pforge-mcp/package.json": release }))).toEqual([]);
    const ahead = manifest({ ...RELEASE, dependencies: { ...RELEASE.dependencies, express: "^5.4.0" } });
    expect(manifestOps(plan({ "pforge-mcp/package.json": release }, { "pforge-mcp/package.json": ahead }))).toEqual([]);
  });

  it("offers nothing for a manifest that differs only in line endings", () => {
    expect(manifestOps(plan({ "pforge-mcp/package.json": release }, { "pforge-mcp/package.json": manifest(RELEASE, { eol: "\r\n" }) }))).toEqual([]);
  });

  it("still offers a lock file as a plain update: the release's lock is what npm install starts from", () => {
    const operations = plan(
      { "pforge-mcp/package.json": release, "pforge-mcp/package-lock.json": '{"lockfileVersion":3,"name":"release"}\n' },
      { "pforge-mcp/package.json": release, "pforge-mcp/package-lock.json": '{"lockfileVersion":3,"name":"project"}\n' },
    );
    expect(operations.filter((op) => op.dst.endsWith("package-lock.json"))).toEqual([
      { category: "mcp", action: "update", src: "pforge-mcp/package-lock.json", dst: "pforge-mcp/package-lock.json", guided: false },
    ]);
  });

  it("treats the three framework packages alike", () => {
    const old = manifest({ ...RELEASE, version: "9.9.9" });
    const operations = plan(
      Object.fromEntries(["pforge-mcp", "pforge-master", "pforge-sdk"].map((pkg) => [`${pkg}/package.json`, release])),
      Object.fromEntries(["pforge-mcp", "pforge-master", "pforge-sdk"].map((pkg) => [`${pkg}/package.json`, old])),
    );
    expect(manifestOps(operations).map((op) => [op.dst, op.guided])).toEqual([
      ["pforge-mcp/package.json", true],
      ["pforge-sdk/package.json", true],
      ["pforge-master/package.json", true],
    ]);
  });

  it("does not offer a manifest the release does not ship", () => {
    expect(manifestOps(plan({}, { "pforge-mcp/package.json": release }))).toEqual([]);
  });
});

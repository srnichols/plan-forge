import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Meta-bug #414 — behind a package mirror, `npm update` writes the mirror's host into each new entry's
 * `resolved` in package-lock.json, and `npm ci` then fails for everyone outside that network. While
 * preparing 3.35.1 the three packages that were updated carried a private feed's URL in both locks, and
 * nothing in the repository would have caught it.
 *
 * scripts/lock-registry.mjs reports a tracked lockfile that resolves from anywhere but the public
 * registry, and with --write rewrites a mirror's URL for a tarball to the public URL of the same tarball.
 */

const REPO = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO, "scripts", "lock-registry.mjs");
const sourceRepo = existsSync(join(REPO, "scripts", "release", "release-checks.json"));

const MIRROR = "https://feed.example.internal/_packaging/npm/registry";
const lockText = (entries, eol = "\n") => JSON.stringify({
  name: "fixture", lockfileVersion: 3, requires: true,
  packages: { "": { name: "fixture", version: "1.0.0" }, ...entries },
}, null, 2).replace(/\n/g, eol) + eol;

const FAST_URI = { version: "3.1.9", resolved: `${MIRROR}/fast-uri/-/fast-uri-3.1.9.tgz`, integrity: "sha512-aaa" };
const SCOPED = { version: "4.13.2", resolved: `${MIRROR}/@azure/identity/-/identity-4.13.2.tgz`, integrity: "sha512-bbb" };
const PUBLIC = { version: "8.18.0", resolved: "https://registry.npmjs.org/ajv/-/ajv-8.18.0.tgz", integrity: "sha512-ccc" };

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempLock = (text) => {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-414-"));
  dirs.push(dir);
  const file = join(dir, "package-lock.json");
  writeFileSync(file, text);
  return file;
};
const lib = () => import(pathToFileURL(SCRIPT).href);
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 60_000 });

describe("the public URL of a tarball", () => {
  it("names a package and a scoped package the way the public registry does", async () => {
    const { publicTarballUrl } = await lib();
    expect(publicTarballUrl("fast-uri", "3.1.9")).toBe("https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz");
    expect(publicTarballUrl("@azure/identity", "4.13.2")).toBe("https://registry.npmjs.org/@azure/identity/-/identity-4.13.2.tgz");
  });
});

describe("which entries resolve from somewhere else", () => {
  it("lists a mirror's entries and leaves public ones, the root, workspace links and local entries out", async () => {
    const { nonPublicResolved } = await lib();
    const lock = JSON.parse(lockText({
      "node_modules/fast-uri": FAST_URI,
      "node_modules/ajv": PUBLIC,
      "node_modules/pforge-mcp": { resolved: "pforge-mcp", link: true },
      "pforge-mcp": { name: "plan-forge-mcp", version: "1.0.0" },
    }));
    expect(nonPublicResolved(lock)).toEqual([{ key: "node_modules/fast-uri", resolved: FAST_URI.resolved }]);
  });

  it("does not take another host for the public registry because its name starts the same", async () => {
    const { nonPublicResolved } = await lib();
    const lock = JSON.parse(lockText({
      "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org.mirror.example/a/-/a-1.0.0.tgz" },
      "node_modules/b": { version: "1.0.0", resolved: "http://registry.npmjs.org/b/-/b-1.0.0.tgz" },
      "node_modules/c": { version: "1.0.0", resolved: "https://registry.npmjs.org/c/-/c-1.0.0.tgz" },
    }));
    expect(nonPublicResolved(lock).map((entry) => entry.key)).toEqual(["node_modules/a", "node_modules/b"]);
  });

  it("does not take a URL that only mentions the public registry for the public registry", async () => {
    const { nonPublicResolved } = await lib();
    const lock = JSON.parse(lockText({
      "node_modules/a": { version: "1.0.0", resolved: "https://proxy.example/fetch?url=https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
    }));
    expect(nonPublicResolved(lock).map((entry) => entry.key)).toEqual(["node_modules/a"]);
  });
});

describe("rewriting a mirror's URLs", () => {
  it("rewrites a package and a scoped package, and changes nothing else in the text", async () => {
    const { normalizeLockText } = await lib();
    const text = lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/@azure/identity": SCOPED, "node_modules/ajv": PUBLIC });
    const result = normalizeLockText(text);
    expect(result.unfixable).toEqual([]);
    expect(result.changed.map((c) => `${c.name}@${c.version}`)).toEqual(["fast-uri@3.1.9", "@azure/identity@4.13.2"]);
    expect(result.text).toBe(text
      .replace(FAST_URI.resolved, "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz")
      .replace(SCOPED.resolved, "https://registry.npmjs.org/@azure/identity/-/identity-4.13.2.tgz"));
  });

  it("rewrites every entry that shares a tarball, such as a nested copy", async () => {
    const { normalizeLockText } = await lib();
    const result = normalizeLockText(lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/x/node_modules/fast-uri": FAST_URI }));
    expect(result.unfixable).toEqual([]);
    expect(result.text).not.toContain(MIRROR);
    expect(result.text.split("https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz")).toHaveLength(3);
  });

  it("keeps Windows line endings", async () => {
    const { normalizeLockText } = await lib();
    const result = normalizeLockText(lockText({ "node_modules/fast-uri": FAST_URI }, "\r\n"));
    expect(result.text).not.toMatch(/[^\r]\n/);
    expect(result.text).toContain("https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz");
  });

  it("leaves an entry alone when its URL is not the tarball of that name and version", async () => {
    const { normalizeLockText } = await lib();
    const entries = {
      "node_modules/git-dep": { version: "1.0.0", resolved: "git+ssh://git@git.example/org/git-dep.git#abc123" },
      "node_modules/local": { version: "1.0.0", resolved: "file:../local" },
      "node_modules/other": { version: "1.0.0", resolved: `${MIRROR}/something-else/-/something-else-1.0.0.tgz` },
      "node_modules/wrong-version": { version: "2.0.0", resolved: `${MIRROR}/wrong-version/-/wrong-version-1.0.0.tgz` },
      "node_modules/http-feed": { version: "1.0.0", resolved: "http://feed.example.internal/http-feed/-/http-feed-1.0.0.tgz" },
    };
    const text = lockText(entries);
    const result = normalizeLockText(text);
    expect(result.changed).toEqual([]);
    expect(result.text).toBe(text);
    expect(result.unfixable.map((entry) => entry.key).sort()).toEqual(Object.keys(entries).sort());
  });

  it("rewrites an aliased package by the name of the package it installs", async () => {
    const { normalizeLockText } = await lib();
    const aliased = { name: "real-pkg", version: "1.2.3", resolved: `${MIRROR}/real-pkg/-/real-pkg-1.2.3.tgz`, integrity: "sha512-ddd" };
    const result = normalizeLockText(lockText({ "node_modules/my-alias": aliased }));
    expect(result.unfixable).toEqual([]);
    expect(result.changed.map((c) => `${c.name}@${c.version}`)).toEqual(["real-pkg@1.2.3"]);
    expect(result.text).toContain("https://registry.npmjs.org/real-pkg/-/real-pkg-1.2.3.tgz");
  });

  it("reports every entry of a URL it cannot find in the text, such as one written with escaped slashes", async () => {
    const { normalizeLockText } = await lib();
    const text = lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/x/node_modules/fast-uri": FAST_URI }).replace(/\//g, "\\/");
    const result = normalizeLockText(text);
    expect(result.changed).toEqual([]);
    expect(result.text).toBe(text);
    expect(result.unfixable.map((entry) => entry.key).sort()).toEqual(["node_modules/fast-uri", "node_modules/x/node_modules/fast-uri"]);
  });

  it("does nothing the second time", async () => {
    const { normalizeLockText } = await lib();
    const once = normalizeLockText(lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/@azure/identity": SCOPED }));
    const twice = normalizeLockText(once.text);
    expect(twice.changed).toEqual([]);
    expect(twice.text).toBe(once.text);
  });
});

describe("scripts/lock-registry.mjs on the command line", () => {
  it("passes a lockfile that resolves only from the public registry", () => {
    const file = tempLock(lockText({ "node_modules/ajv": PUBLIC }));
    const run = cli(file);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain("public registry");
  });

  it("fails a mirror's lockfile, names the packages and the command that fixes it, and writes nothing", () => {
    const text = lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/@azure/identity": SCOPED });
    const file = tempLock(text);
    const run = cli(file);
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(run.stdout + run.stderr).toContain("node_modules/fast-uri");
    expect(run.stdout + run.stderr).toContain("node_modules/@azure/identity");
    expect(run.stdout + run.stderr).toContain("--write");
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  it("rewrites with --write, keeps the file's line endings, and then passes", () => {
    const file = tempLock(lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/ajv": PUBLIC }, "\r\n"));
    const write = cli("--write", file);
    expect(write.status, write.stdout + write.stderr).toBe(0);
    expect(write.stdout).toContain("fast-uri@3.1.9");
    const after = readFileSync(file, "utf8");
    expect(after).toContain("https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz");
    expect(after).not.toMatch(/[^\r]\n/);
    expect(cli(file).status).toBe(0);
  });

  it("with --write still fails for an entry it cannot rewrite, and says which", () => {
    const file = tempLock(lockText({ "node_modules/fast-uri": FAST_URI, "node_modules/git-dep": { version: "1.0.0", resolved: "git+ssh://git@git.example/org/git-dep.git#abc" } }));
    const run = cli("--write", file);
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(run.stdout + run.stderr).toContain("node_modules/git-dep");
    expect(readFileSync(file, "utf8")).toContain("https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz");
  });

  it("fails on a file that is not a lockfile", () => {
    const run = cli(tempLock("not json"));
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toContain("cannot read it as a lockfile");
  });

  it("fails on a lockfile with no packages map, which a check that read nothing would pass", () => {
    for (const text of [JSON.stringify({ lockfileVersion: 1, dependencies: { "fast-uri": { version: "3.1.9", resolved: FAST_URI.resolved } } }), JSON.stringify({ packages: null }), "null", "[]"]) {
      const run = cli(tempLock(text));
      expect(run.status, text).toBe(1);
      expect(run.stdout + run.stderr, text).toContain("cannot read it as a lockfile");
      expect(run.stdout + run.stderr, text).toContain("packages");
    }
  });

  it("fails when any one of several lockfiles resolves from elsewhere, and names each file", () => {
    const good = tempLock(lockText({ "node_modules/ajv": PUBLIC }));
    const bad = tempLock(lockText({ "node_modules/fast-uri": FAST_URI }));
    const run = cli(good, bad);
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(run.stdout).toContain(`${good}: resolves only from the public registry`);
    expect(run.stdout).toContain(`${bad}: 1 package(s) resolve from elsewhere`);
  });

  it("refuses an option it does not know instead of ignoring it", () => {
    const run = cli("--wirte", tempLock(lockText({ "node_modules/fast-uri": FAST_URI })));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("unknown option: --wirte");
  });
});

describe("finding the tracked lockfiles", () => {
  it("lists every package-lock.json and npm-shrinkwrap.json a repository tracks, nested ones too", async () => {
    const { trackedLockfiles } = await lib();
    const repo = mkdtempSync(join(tmpdir(), "pf-meta-414-git-"));
    dirs.push(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    for (const file of ["package-lock.json", "packages/a/package-lock.json", "npm-shrinkwrap.json", "docs/npm-shrinkwrap.json", "package.json", "notes/lock.txt"]) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), "{}");
    }
    execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
    expect(trackedLockfiles(repo).sort()).toEqual(["docs/npm-shrinkwrap.json", "npm-shrinkwrap.json", "package-lock.json", "packages/a/package-lock.json"]);
  });
});

describe.skipIf(!sourceRepo)("the tracked lockfiles resolve only from the public registry (#414)", () => {
  it("every package-lock.json and npm-shrinkwrap.json in the repository", async () => {
    const { nonPublicResolved, trackedLockfiles } = await lib();
    const tracked = trackedLockfiles();
    expect(tracked.length, "the repository tracks at least the workspace lock and the standalone pforge-mcp lock").toBeGreaterThanOrEqual(2);
    const wrong = tracked.flatMap((file) => nonPublicResolved(JSON.parse(readFileSync(join(REPO, file), "utf8"))).map((entry) => `${file}: ${entry.key} resolves from ${entry.resolved}`));
    expect(wrong, "run `node scripts/lock-registry.mjs --write` to rewrite a mirror's URLs").toEqual([]);
  });

  it("is what `node scripts/lock-registry.mjs` with no arguments checks", async () => {
    const { trackedLockfiles } = await lib();
    const run = cli();
    expect(run.status, run.stdout + run.stderr).toBe(0);
    for (const file of trackedLockfiles()) expect(run.stdout, file).toContain(`${file}: resolves only from the public registry`);
  });
});

/**
 * #421 — pforge-master ships a lockfile.
 *
 * Without one, `npm install` in a project's pforge-master/ crashed with "Cannot read properties of null
 * (reading 'edgesOut')" while npm resolved the peer set of vitest. Every Bash installer job of Validate Setup
 * reported it and the project was left without node_modules. With a lock, npm reads a resolved tree instead
 * of resolving one. These checks keep the lock present, in step with the manifest, and complete enough that
 * npm accepts it with no registry to ask.
 *
 * The lock is made with a plain `npm install --package-lock-only` (with vitest 4 that crashed the same way and needed
 * `--legacy-peer-deps`, which with vitest 5 leaves vite out of the lock) and then
 * `node scripts/lock-registry.mjs --write`; see docs/RELEASE-CHECKLIST.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE_DIR = join(REPO, "pforge-master");
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
const LOCK_PATH = join(PACKAGE_DIR, "package-lock.json");
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const NPM_TIMEOUT_MS = 270_000;
const TEST_TIMEOUT_MS = 300_000;

function readLock() {
  expect(existsSync(LOCK_PATH), "pforge-master/package-lock.json is missing; npm install there crashes without it (#421)").toBe(true);
  return JSON.parse(readFileSync(LOCK_PATH, "utf8"));
}

/** Does `version` satisfy a caret range such as ^4.1.10? The manifest uses nothing else, so anything else fails loudly. */
function satisfiesCaret(version, range) {
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!caret) throw new Error(`unsupported range ${range}: extend satisfiesCaret`);
  const [major, minor, patch] = caret.slice(1).map(Number);
  if (version.includes("-")) return false;
  const [haveMajor, haveMinor, haveMinorPatch] = version.split(".").map(Number);
  if (haveMajor !== major) return false;
  return haveMinor > minor || (haveMinor === minor && haveMinorPatch >= patch);
}

/** Lock-only and offline: npm may read the lock but has nothing to fetch, so anything it must resolve fails. */
function lockOnlyInstall(dir) {
  const command = `npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund --cache "${join(dir, ".npm-cache")}"`;
  return spawnSync(command, { cwd: dir, shell: true, encoding: "utf8", timeout: NPM_TIMEOUT_MS });
}

describe("pforge-master/package-lock.json", () => {
  it("exists next to the manifest", () => {
    readLock();
  });

  it("is a v3 lock whose root entry mirrors the manifest", () => {
    const lock = readLock();
    const root = lock.packages[""];
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe(MANIFEST.name);
    expect(root.dependencies).toEqual(MANIFEST.dependencies);
    expect(root.devDependencies).toEqual(MANIFEST.devDependencies);
    expect(root.engines).toEqual(MANIFEST.engines);
  });

  it.each(Object.entries({ ...MANIFEST.dependencies, ...MANIFEST.devDependencies }))(
    "locks %s at a version its range %s allows",
    (name, range) => {
      const entry = readLock().packages[`node_modules/${name}`];
      expect(entry, `${name} is not locked`).toBeDefined();
      expect(satisfiesCaret(entry.version, range), `${name} is locked at ${entry.version}`).toBe(true);
    },
  );

  it("pins every package to the public registry with a sha512 integrity hash", () => {
    const entries = Object.entries(readLock().packages).filter(([key]) => key !== "");
    expect(entries.length).toBeGreaterThan(0);
    const unpinned = entries
      .filter(([, entry]) => !(entry.resolved?.startsWith(PUBLIC_REGISTRY) && /^sha512-/.test(entry.integrity ?? "")))
      .map(([key]) => key);
    expect(unpinned).toEqual([]);
  });
});

describe("npm accepts the lock without a registry", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pf-master-lock-"));
    copyFileSync(join(PACKAGE_DIR, "package.json"), join(dir, "package.json"));
    readLock();
    copyFileSync(LOCK_PATH, join(dir, "package-lock.json"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const lockedVersions = (file) =>
    Object.fromEntries(Object.entries(JSON.parse(readFileSync(file, "utf8")).packages).map(([key, entry]) => [key, entry.version]));

  it("leaves an in-sync lock with the same packages, resolving nothing", { timeout: TEST_TIMEOUT_MS }, () => {
    const before = lockedVersions(join(dir, "package-lock.json"));
    const result = lockOnlyInstall(dir);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(lockedVersions(join(dir, "package-lock.json"))).toEqual(before);
  });

  it("refuses a lock that is missing a dependency, so the check above is not vacuous", { timeout: TEST_TIMEOUT_MS }, () => {
    const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
    delete lock.packages["node_modules/ws"];
    writeFileSync(join(dir, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    expect(lockOnlyInstall(dir).status).not.toBe(0);
  });
});

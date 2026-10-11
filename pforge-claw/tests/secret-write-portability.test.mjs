import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnrollment, SECRET_PREFIX } from "../src/protocol/enrollment.mjs";
import { createSecrets } from "../src/secrets.mjs";

const filesystem = vi.hoisted(() => ({ current: null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const native = await importOriginal();
  const paths = await import("node:path");
  const ownedPath = (file) => typeof file === "string" && filesystem.current
    && paths.dirname(paths.resolve(file)) === filesystem.current.directory;
  const failure = (code, syscall) => Object.assign(new Error(code), { code, syscall });
  return {
    ...native,
    async readFile(file, ...options) {
      if (!ownedPath(file)) return native.readFile(file, ...options);
      const boundary = filesystem.current;
      const contents = boundary.files.get(paths.resolve(file));
      if (contents === undefined) throw failure("ENOENT", "open");
      if (file === boundary.resolverFile && !boundary.heldRead
        && boundary.replacements === boundary.holdAfterReplacement) {
        boundary.heldRead = true;
        boundary.readerOpen = true;
        boundary.events.push("refresh-open");
        boundary.readerOpened();
        await new Promise((resolve) => setTimeout(resolve, 1));
        boundary.readerOpen = false;
        boundary.events.push("refresh-close");
      }
      return contents;
    },
    async mkdir(directory, ...options) {
      if (paths.resolve(directory) === filesystem.current?.directory) return;
      return native.mkdir(directory, ...options);
    },
    async writeFile(file, contents, options) {
      if (!ownedPath(file)) return native.writeFile(file, contents, options);
      const boundary = filesystem.current;
      if (boundary.replacements === boundary.holdAfterReplacement) {
        await boundary.whenReaderOpened;
      }
      if (options.flag === "wx" && boundary.files.has(paths.resolve(file))) {
        throw failure("EEXIST", "open");
      }
      boundary.creations.push(options);
      boundary.files.set(paths.resolve(file), contents);
    },
    async rename(source, target) {
      if (!ownedPath(target)) return native.rename(source, target);
      const boundary = filesystem.current;
      boundary.renameAttempts += 1;
      if (boundary.readerOpen || boundary.renameAttempts === boundary.denyReplacement) {
        boundary.events.push("replacement-denied");
        throw failure("EPERM", "rename");
      }
      boundary.files.set(paths.resolve(target), boundary.files.get(paths.resolve(source)));
      boundary.files.delete(paths.resolve(source));
      boundary.replacements += 1;
      boundary.events.push("replaced");
    },
    async unlink(file) {
      if (!ownedPath(file)) return native.unlink(file);
      if (!filesystem.current.files.delete(paths.resolve(file))) throw failure("ENOENT", "unlink");
    },
  };
});

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_ACCESS_MASK = 0o077;
const nativeDirectories = [];

afterEach(async () => {
  filesystem.current = null;
  vi.useRealTimers();
  await Promise.all(nativeDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function filesystemBoundary({ holdAfterReplacement = null, denyReplacement = null } = {}) {
  const directory = path.join(TEST_DIRECTORY, `.secret-write-edge-${randomUUID()}`);
  const secretFile = path.join(directory, "secrets.json");
  let readerOpened;
  const whenReaderOpened = new Promise((resolve) => { readerOpened = resolve; });
  const boundary = {
    directory, secretFile, resolverFile: path.relative(process.cwd(), secretFile),
    files: new Map(), creations: [], events: [], replacements: 0, renameAttempts: 0,
    heldRead: false, readerOpen: false, holdAfterReplacement, denyReplacement,
    readerOpened, whenReaderOpened,
  };
  filesystem.current = boundary;
  return boundary;
}

async function enrollmentFixture(secretFile, resolverFile = secretFile) {
  const entries = [];
  const store = {
    append: (_stream, entry) => entries.push(structuredClone(entry)),
    fold: (_stream, reduce, initial) => entries.reduce(reduce, initial),
  };
  const secrets = await createSecrets({ env: {}, file: resolverFile });
  return { store, entries, secrets, enrollment: createEnrollment({ store, secretFile, secrets }) };
}

function fulfilledChanges(changes) {
  return changes.map((change) => {
    if (change.status === "rejected") throw change.reason;
    return change.value;
  });
}

describe("Windows secret replacement ordering", () => {
  it("serializes concurrent registrations through a held refresh reader across enrollment instances", async () => {
    vi.useFakeTimers();
    const boundary = filesystemBoundary({ holdAfterReplacement: 1 });
    const fixture = await enrollmentFixture(boundary.secretFile, boundary.resolverFile);
    const secondEnrollment = createEnrollment({
      store: fixture.store, secretFile: boundary.secretFile, secrets: fixture.secrets,
    });
    const registrations = Promise.allSettled([
      fixture.enrollment.register({ workerId: "w_first", laneId: "remote", secret: "first-portability-canary" }),
      secondEnrollment.register({ workerId: "w_second", laneId: "remote", secret: "second-portability-canary" }),
    ]);
    await vi.runAllTimersAsync();
    expect(fulfilledChanges(await registrations)).toEqual([
      { workerId: "w_first", laneId: "remote" }, { workerId: "w_second", laneId: "remote" },
    ]);
    expect(boundary.events).toEqual(["replaced", "refresh-open", "refresh-close", "replaced"]);
    expect(fixture.secrets.get(`${SECRET_PREFIX}w_first`)).toBe("first-portability-canary");
    expect(fixture.secrets.get(`${SECRET_PREFIX}w_second`)).toBe("second-portability-canary");
    expect([...boundary.files.keys()]).toEqual([boundary.secretFile]);
    expect(boundary.creations).toEqual([
      { mode: 0o600, flag: "wx" }, { mode: 0o600, flag: "wx" },
    ]);
  });

  it("finishes revocation refresh before a concurrent registration replaces the secret file", async () => {
    vi.useFakeTimers();
    const boundary = filesystemBoundary();
    const fixture = await enrollmentFixture(boundary.secretFile, boundary.resolverFile);
    await fixture.enrollment.register({ workerId: "w_revoked", laneId: "remote", secret: "revoked-portability-canary" });
    boundary.holdAfterReplacement = 2;
    const changes = Promise.allSettled([
      fixture.enrollment.revoke("w_revoked"),
      fixture.enrollment.register({ workerId: "w_new", laneId: "remote", secret: "new-portability-canary" }),
    ]);
    await vi.runAllTimersAsync();
    expect(fulfilledChanges(await changes)).toEqual([
      { revoked: true }, { workerId: "w_new", laneId: "remote" },
    ]);
    expect(boundary.events).toEqual(["replaced", "replaced", "refresh-open", "refresh-close", "replaced"]);
    expect(fixture.enrollment.status("w_revoked")).toBe("revoked");
    expect(fixture.secrets.get(`${SECRET_PREFIX}w_revoked`)).toBeNull();
    expect(fixture.secrets.get(`${SECRET_PREFIX}w_new`)).toBe("new-portability-canary");
    expect(fixture.secrets.redact("revoked-portability-canary")).not.toContain("revoked-portability-canary");
  });

  it("fails a denied replacement closed and permits the next registration without retrying", async () => {
    const boundary = filesystemBoundary({ denyReplacement: 1 });
    boundary.files.set(boundary.secretFile, JSON.stringify({ EXISTING_CALLER_KEY: "existing-caller-canary" }));
    const fixture = await enrollmentFixture(boundary.secretFile, boundary.resolverFile);
    const changes = await Promise.allSettled([
      fixture.enrollment.register({ workerId: "w_denied", laneId: "remote", secret: "denied-portability-canary" }),
      fixture.enrollment.register({ workerId: "w_allowed", laneId: "remote", secret: "allowed-portability-canary" }),
    ]);
    expect(changes[0]).toMatchObject({
      status: "rejected", reason: { code: "SECRET_WRITE_FAILED", details: { name: `${SECRET_PREFIX}w_denied` } },
    });
    expect(changes[1].status).toBe("fulfilled");
    expect(boundary.renameAttempts).toBe(2);
    expect([...boundary.files.keys()]).toEqual([boundary.secretFile]);
    expect(fixture.entries.map(({ op, workerId }) => ({ op, workerId }))).toEqual([
      { op: "register-failed", workerId: "w_denied" }, { op: "registered", workerId: "w_allowed" },
    ]);
    expect(fixture.secrets.get(`${SECRET_PREFIX}w_denied`)).toBeNull();
    expect(fixture.secrets.get(`${SECRET_PREFIX}w_allowed`)).toBe("allowed-portability-canary");
    expect(fixture.secrets.get("EXISTING_CALLER_KEY")).toBe("existing-caller-canary");
    expect(Object.keys(JSON.parse(boundary.files.get(boundary.secretFile))).sort()).toEqual([
      "EXISTING_CALLER_KEY", `${SECRET_PREFIX}w_allowed`,
    ]);
  });

  it("retains concurrent credentials on native filesystems with private file creation", async () => {
    const directory = await mkdtemp(path.join(TEST_DIRECTORY, ".secret-write-portability-"));
    nativeDirectories.push(directory);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const secretFile = path.join(directory, `secrets-${attempt}.json`);
      const fixture = await enrollmentFixture(secretFile);
      await Promise.all([
        fixture.enrollment.register({ workerId: "w_first", laneId: "remote", secret: "first-native-canary" }),
        fixture.enrollment.register({ workerId: "w_second", laneId: "remote", secret: "second-native-canary" }),
      ]);
      expect(Object.keys(JSON.parse(await readFile(secretFile, "utf8"))).sort()).toEqual([
        `${SECRET_PREFIX}w_first`, `${SECRET_PREFIX}w_second`,
      ]);
      expect(fixture.secrets.get(`${SECRET_PREFIX}w_first`)).toBe("first-native-canary");
      expect(fixture.secrets.get(`${SECRET_PREFIX}w_second`)).toBe("second-native-canary");
      if (process.platform !== "win32") expect((await stat(secretFile)).mode & PRIVATE_ACCESS_MASK).toBe(0);
    }
  });
});

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecrets } from "../src/secrets.mjs";
import { createStore, STALE_LOCK_GRACE_MS } from "../src/state/store.mjs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    appendFileSync: vi.fn(actual.appendFileSync),
    fsyncSync: vi.fn(actual.fsyncSync),
    ftruncateSync: vi.fn(actual.ftruncateSync),
    openSync: vi.fn(actual.openSync),
    readFileSync: vi.fn(actual.readFileSync),
    renameSync: vi.fn(actual.renameSync),
    writeSync: vi.fn(actual.writeSync),
  };
});

const actualFs = await vi.importActual("node:fs");
const directories = [];
const fixedTime = new Date("2026-10-07T16:00:00.000Z");
const makeDirectory = () => {
  const directory = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), "store-recovery-fixture-"));
  directories.push(directory);
  return directory;
};
const makeStore = (directory, options = {}) => createStore(directory, {
  now: () => new Date(fixedTime),
  ...options,
});
const sum = (total, record) => total + record.value;
const collect = (items, record) => [...items, record.text];
const recoveryNames = (directory) => readdirSync(directory).filter(
  (name) => name.startsWith("events.recovery-") && name.endsWith(".json"),
);
const recoveryRecords = (directory) => recoveryNames(directory).map(
  (name) => JSON.parse(readFileSync(join(directory, name), "utf8")),
);
const makeTornStream = (fragment = Buffer.from('{"unfinished":')) => {
  const directory = makeDirectory();
  const file = join(directory, "events.jsonl");
  const prefix = Buffer.from('{"value":1,"text":"«é»🌲"}\n{"value":2}\n');
  const original = Buffer.concat([prefix, fragment]);
  writeFileSync(file, original);
  return { directory, file, prefix, fragment, original, store: makeStore(directory) };
};
const failIo = () => {
  throw Object.assign(new Error("fixture-private-io-marker"), { code: "EIO" });
};
const failOpenMode = (mode) => openSync.mockImplementation((target, flags, permissions) => {
  if (flags === mode) failIo();
  return actualFs.openSync(target, flags, permissions);
});

afterEach(() => {
  vi.resetAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("append-only state store", () => {
  it("adds version and injected timestamp and preserves append order", () => {
    const store = makeStore(makeDirectory());
    const first = store.append("events", { value: 1 });
    const second = store.append("events", { value: 2 });
    expect(first).toMatchObject({ v: 1, ts: fixedTime.toISOString() });
    expect([...store.read("events")].map(({ record }) => record.value)).toEqual([1, 2]);
  });

  it("skips a torn tail on read and preserves it separately before repairing on append", () => {
    const directory = makeDirectory();
    const store = makeStore(directory);
    const file = join(directory, "events.jsonl");
    writeFileSync(file, '{"value":1}\n{"value":2}\n{"a":');
    expect(store.fold("events", sum, 0)).toBe(3);
    store.append("events", { value: 4 });
    expect(readFileSync(file, "utf8")).not.toContain('{"a":');
    expect(store.fold("events", sum, 0)).toBe(7);
    expect(recoveryRecords(directory)).toHaveLength(1);
    expect(Buffer.from(recoveryRecords(directory)[0].fragmentBase64, "base64")).toEqual(Buffer.from('{"a":'));
  });

  it("appends after a tolerated torn tail and reopens without poisoning complete rows", () => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const completeRows = '{"value":1}\n{"value":2}\n';
    writeFileSync(file, `${completeRows}{"a":`);
    const store = makeStore(directory);
    expect(store.fold("events", sum, 0)).toBe(3);

    store.append("events", { value: 4 });
    const reopened = makeStore(directory);
    expect(reopened.fold("events", sum, 0)).toBe(7);
    expect([...reopened.read("events")].map(({ record }) => record.value)).toEqual([1, 2, 4]);
    expect(readFileSync(file, "utf8").startsWith(completeRows)).toBe(true);
  });

  it("rejects a corrupt complete interior line without exposing its contents", () => {
    const directory = makeDirectory();
    const store = makeStore(directory);
    const privateLine = "sensitive-corruption-marker";
    appendFileSync(join(directory, "events.jsonl"), `{"value":1}\n${privateLine}\n{"value":2}\n`);
    try {
      store.fold("events", sum, 0);
      throw new Error("expected corrupt stream");
    } catch (error) {
      expect(error.code).toBe("STORE_CORRUPT");
      expect(error.details).toEqual({ stream: "events", line: 2 });
      expect(error.message).not.toContain(privateLine);
    }
  });

  it("redacts nested strings and arrays without mutating the caller record", async () => {
    const canary = 'sk-canary"\\x1';
    const secrets = await createSecrets({
      env: { CANARY_TOKEN: canary },
      trackNames: ["CANARY_TOKEN"],
    });
    const directory = makeDirectory();
    const store = makeStore(directory, { redact: secrets.redact });
    const record = { nested: { token: canary }, values: [canary] };
    store.append("events", record);
    const raw = readFileSync(join(directory, "events.jsonl"), "utf8");
    expect(raw).not.toContain(canary);
    expect(raw.match(/«redacted:CANARY_TOKEN»/g)).toHaveLength(2);
    expect(record).toEqual({ nested: { token: canary }, values: [canary] });
  });

  it("folds snapshots with multibyte tail records and atomically replaces snapshots", () => {
    const directory = makeDirectory();
    const store = makeStore(directory);
    for (const value of [1, 2, 3]) {
      store.append("numbers", { value, text: `«é»${value}` });
      store.append("events", { value, text: `«é»${value}` });
    }
    const firstNumbersSnapshot = store.snapshot("numbers", sum, 0);
    const firstEventsSnapshot = store.snapshot("events", collect, []);
    const numbersSnapshotFile = join(directory, "numbers.snapshot.json");
    const eventsSnapshotFile = join(directory, "events.snapshot.json");
    const originalNumbersSnapshot = readFileSync(numbersSnapshotFile);
    const originalEventsSnapshot = readFileSync(eventsSnapshotFile);
    for (const value of [4, 5]) {
      store.append("numbers", { value, text: `«é»${value}` });
      store.append("events", { value, text: `«é»${value}` });
    }
    expect(store.fold("numbers", sum, 0)).toBe(15);
    expect(store.fold("events", collect, [])).toEqual(["«é»1", "«é»2", "«é»3", "«é»4", "«é»5"]);
    unlinkSync(numbersSnapshotFile);
    unlinkSync(eventsSnapshotFile);
    expect(store.fold("numbers", sum, 0)).toBe(15);
    expect(store.fold("events", collect, [])).toEqual(["«é»1", "«é»2", "«é»3", "«é»4", "«é»5"]);
    writeFileSync(numbersSnapshotFile, originalNumbersSnapshot);
    writeFileSync(eventsSnapshotFile, originalEventsSnapshot);
    const replacement = store.snapshot("numbers", sum, 0);
    expect(replacement).toEqual({
      offset: statSync(join(directory, "numbers.jsonl")).size,
      count: 5,
    });
    expect(replacement.offset).toBeGreaterThan(firstNumbersSnapshot.offset);
    expect(firstEventsSnapshot.count).toBe(3);
    expect(JSON.parse(readFileSync(numbersSnapshotFile, "utf8")).state).toBe(15);
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each([
    ["offset beyond stream", { v: 1, stream: "events", offset: 99, state: 100 }],
    ["stream mismatch", { v: 1, stream: "other", offset: 0, state: 100 }],
  ])("ignores an invalid snapshot: %s", (_label, snapshot) => {
    const directory = makeDirectory();
    const store = makeStore(directory);
    store.append("events", { value: 7 });
    writeFileSync(join(directory, "events.snapshot.json"), JSON.stringify(snapshot));
    expect(store.fold("events", sum, 0)).toBe(7);
  });

  it("rejects live locks and reclaims only stale locks", () => {
    const directory = makeDirectory();
    const owner = makeStore(directory, { pid: 101 });
    const release = owner.lock();
    expect(() => makeStore(directory, { pid: 202, kill: () => {} }).lock())
      .toThrowError(expect.objectContaining({ code: "STATE_LOCKED" }));
    release();

    const staleFile = join(directory, "dispatcher.lock");
    writeFileSync(staleFile, JSON.stringify({ pid: 303 }));
    const missingProcess = () => {
      const error = new Error("process no longer exists");
      error.code = "ESRCH";
      throw error;
    };
    const reclaim = makeStore(directory, { pid: 202, kill: missingProcess }).lock();
    reclaim();

    writeFileSync(staleFile, JSON.stringify({ pid: 404 }));
    const permissionDenied = () => {
      const error = new Error("permission denied");
      error.code = "EPERM";
      throw error;
    };
    expect(() => makeStore(directory, { kill: permissionDenied }).lock()).toThrowError(
      expect.objectContaining({ code: "STATE_LOCKED", details: { pid: 404 } }),
    );
  });

  it("keeps recent malformed locks but reclaims malformed locks beyond the grace period", () => {
    const directory = makeDirectory();
    const file = join(directory, "dispatcher.lock");
    writeFileSync(file, "");
    utimesSync(file, fixedTime, fixedTime);
    expect(() => makeStore(directory).lock()).toThrowError(
      expect.objectContaining({ code: "STATE_LOCKED", details: { pid: null } }),
    );
    const oldTime = new Date(fixedTime.getTime() - STALE_LOCK_GRACE_MS - 1000);
    utimesSync(file, oldTime, oldTime);
    const release = makeStore(directory, { pid: 505 }).lock();
    expect(existsSync(file)).toBe(true);
    release();
    expect(existsSync(file)).toBe(false);
  });

  it("does not release a lock now owned by another process", () => {
    const directory = makeDirectory();
    const file = join(directory, "dispatcher.lock");
    const release = makeStore(directory, { pid: 606 }).lock();
    writeFileSync(file, JSON.stringify({ pid: 707 }), { flag: "w" });
    release();
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(707);
  });

  it.each(["../x", "A", "a/b", ""])("rejects invalid stream names: %s", (stream) => {
    const store = makeStore(makeDirectory());
    expect(() => [...store.read(stream)]).toThrowError(expect.objectContaining({
      code: "STORE_BAD_STREAM",
    }));
  });

  it("rejects non-plain and unserializable records", () => {
    const store = makeStore(makeDirectory());
    expect(() => store.append("events", [])).toThrowError(expect.objectContaining({
      code: "STORE_BAD_RECORD",
    }));
    expect(() => store.append("events", { value: 1n })).toThrowError(expect.objectContaining({
      code: "STORE_BAD_RECORD",
    }));
  });
});

describe("torn-tail preservation and replay", () => {
  it.each(["\n", "\r\n"])("preserves UTF-8 prefix bytes and exact fragment with %j rows", (newline) => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const prefix = Buffer.from(`{"value":1,"text":"«é»🌲漢字"}${newline}${newline}{"value":2}${newline}`);
    const fragment = Buffer.from('{"text":"private-fragment-é');
    writeFileSync(file, Buffer.concat([prefix, fragment]));
    const store = makeStore(directory);

    const appended = store.append("events", { value: 4 });
    expect(readFileSync(file)).toEqual(Buffer.concat([prefix, Buffer.from(`${JSON.stringify(appended)}\n`)]));
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
    const [recovery] = recoveryRecords(directory);
    expect(recovery).toEqual({
      v: 1,
      stream: "events",
      source: "events.jsonl",
      reason: "invalid-unterminated-tail",
      offset: prefix.length,
      sourceSize: prefix.length + fragment.length,
      byteLength: fragment.length,
      sha256: createHash("sha256").update(fragment).digest("hex"),
      fragmentBase64: fragment.toString("base64"),
      ts: fixedTime.toISOString(),
    });
    expect(recoveryNames(directory)).toEqual([`events.recovery-${prefix.length}-${recovery.sha256}.json`]);
  });

  it("preserves a tail ending inside a multibyte UTF-8 sequence without replacement characters", () => {
    const fragment = Buffer.concat([Buffer.from('{"text":"é'), Buffer.from([0xf0, 0x9f, 0x8c])]);
    const { directory, file, prefix, store } = makeTornStream(fragment);
    const appended = store.append("events", { value: 4 });
    expect(readFileSync(file)).toEqual(Buffer.concat([prefix, Buffer.from(`${JSON.stringify(appended)}\n`)]));
    const [recovery] = recoveryRecords(directory);
    expect(recovery.offset).toBe(prefix.length);
    expect(recovery.byteLength).toBe(fragment.length);
    expect(Buffer.from(recovery.fragmentBase64, "base64")).toEqual(fragment);
    expect(recovery.sha256).toBe(createHash("sha256").update(fragment).digest("hex"));
  });

  it("recovers a stream containing only an incomplete fragment at byte zero", () => {
    const directory = makeDirectory();
    const fragment = Buffer.from('{"value":');
    writeFileSync(join(directory, "events.jsonl"), fragment);
    const store = makeStore(directory);
    expect([...store.read("events")]).toEqual([]);
    store.append("events", { value: 4 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(4);
    expect(recoveryRecords(directory)[0]).toMatchObject({
      offset: 0,
      byteLength: fragment.length,
      fragmentBase64: fragment.toString("base64"),
    });
  });

  it.each(["", "\r"])("delimits a valid unterminated JSON row with suffix %j without quarantining it", (suffix) => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const prefix = Buffer.from(`{"value":1,"text":"«é»🌲"}${suffix}`);
    writeFileSync(file, prefix);
    const store = makeStore(directory);
    expect(store.fold("events", sum, 0)).toBe(1);
    const appended = store.append("events", { value: 4 });
    expect(readFileSync(file)).toEqual(Buffer.concat([prefix, Buffer.from(`\n${JSON.stringify(appended)}\n`)]));
    expect(makeStore(directory).fold("events", sum, 0)).toBe(5);
    expect(recoveryNames(directory)).toEqual([]);
  });

  it("keeps successful quarantine bytes unchanged across retries and reopen", () => {
    const { directory, file, store } = makeTornStream();
    store.append("events", { value: 4 });
    const [name] = recoveryNames(directory);
    const quarantine = readFileSync(join(directory, name));
    const reopened = makeStore(directory);
    reopened.append("events", { value: 8 });
    expect(reopened.fold("events", sum, 0)).toBe(15);
    expect(recoveryNames(directory)).toEqual([name]);
    expect(readFileSync(join(directory, name))).toEqual(quarantine);

    const nextOffset = statSync(file).size;
    const nextFragment = Buffer.from('{"next":');
    appendFileSync(file, nextFragment);
    makeStore(directory).append("events", { value: 16 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(31);
    expect(recoveryRecords(directory)).toHaveLength(2);
    expect(recoveryRecords(directory).find((record) => record.offset === nextOffset))
      .toMatchObject({ fragmentBase64: nextFragment.toString("base64") });
    expect(readFileSync(join(directory, name))).toEqual(quarantine);
  });

  it("preserves a snapshot and makes snapshot-plus-recovered-tail equal a full fold", () => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const store = makeStore(directory);
    store.append("events", { value: 1, text: "«é»🌲" });
    store.append("events", { value: 2 });
    const snapshot = store.snapshot("events", sum, 0);
    const snapshotFile = join(directory, "events.snapshot.json");
    const snapshotBytes = readFileSync(snapshotFile);
    store.append("events", { value: 4, text: "漢字" });
    const prefix = readFileSync(file);
    appendFileSync(file, '{"next":');
    expect(store.fold("events", sum, 0)).toBe(7);

    store.append("events", { value: 8 });
    const reopened = makeStore(directory);
    expect(reopened.fold("events", sum, 0)).toBe(15);
    expect([...reopened.read("events")].reduce((total, { record }) => sum(total, record), 0)).toBe(15);
    expect([...reopened.read("events", { fromByte: snapshot.offset })].map(({ record }) => record.value))
      .toEqual([4, 8]);
    expect(readFileSync(snapshotFile)).toEqual(snapshotBytes);
    expect(readFileSync(file).subarray(0, prefix.length)).toEqual(prefix);
    expect(recoveryRecords(directory)[0].offset).toBe(prefix.length);
  });

  it("keeps a valid unterminated row and snapshot equivalent after adding its delimiter", () => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const original = Buffer.from('{"value":1,"text":"«é»🌲"}\n{"value":2,"text":"漢字"}');
    writeFileSync(file, original);
    const store = makeStore(directory);
    const snapshot = store.snapshot("events", sum, 0);
    const snapshotFile = join(directory, "events.snapshot.json");
    const snapshotBytes = readFileSync(snapshotFile);
    expect(snapshot).toEqual({ offset: original.length, count: 2 });
    expect(store.fold("events", sum, 0)).toBe(3);

    const appended = store.append("events", { value: 4 });
    const reopened = makeStore(directory);
    expect(readFileSync(file)).toEqual(Buffer.concat([original, Buffer.from(`\n${JSON.stringify(appended)}\n`)]));
    expect(reopened.fold("events", sum, 0)).toBe(7);
    expect([...reopened.read("events")].reduce((total, { record }) => sum(total, record), 0)).toBe(7);
    expect([...reopened.read("events", { fromByte: snapshot.offset })].map(({ record }) => record.value))
      .toEqual([4]);
    expect(readFileSync(snapshotFile)).toEqual(snapshotBytes);
    expect(recoveryNames(directory)).toEqual([]);
  });

  it("does not quarantine or truncate a corrupt complete row before an incomplete tail", () => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const original = Buffer.from('{"value":1}\nprivate-interior-marker\n{"unfinished":');
    writeFileSync(file, original);
    const store = makeStore(directory);
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_CORRUPT", details: { stream: "events", line: 2 },
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
  });

  it.each(["\n", "\r\n"])("continues to reject terminated corruption ending in %j", (newline) => {
    const directory = makeDirectory();
    const file = join(directory, "events.jsonl");
    const original = Buffer.from(`{"value":1}${newline}private-complete-marker${newline}`);
    writeFileSync(file, original);
    expect(() => makeStore(directory).fold("events", sum, 0)).toThrowError(expect.objectContaining({
      code: "STORE_CORRUPT", details: { stream: "events", line: 2 },
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
  });

  it("does not repair a tail before rejecting an unserializable append record", () => {
    const { directory, file, original, store } = makeTornStream();
    expect(() => store.append("events", { value: 1n })).toThrowError(expect.objectContaining({
      code: "STORE_BAD_RECORD",
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
  });
});

describe("recovery writer-lock ownership", () => {
  it("borrows its existing dispatcher lock and rejects another store's recovery attempt", () => {
    const { directory, file, original } = makeTornStream();
    const owner = makeStore(directory, { pid: 101 });
    const release = owner.lock();
    const lockFile = join(directory, "dispatcher.lock");
    const lockBytes = readFileSync(lockFile);
    const other = makeStore(directory, { pid: 202, kill: () => {} });
    expect(() => other.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STATE_LOCKED", details: { pid: 101 },
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
    owner.append("events", { value: 4 });
    expect(readFileSync(lockFile)).toEqual(lockBytes);
    release();
    expect(existsSync(lockFile)).toBe(false);
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
  });

  it("does not treat another store with the same PID as its lock owner", () => {
    const { directory, file, original } = makeTornStream();
    const owner = makeStore(directory, { pid: 101 });
    const release = owner.lock();
    const other = makeStore(directory, { pid: 101, kill: () => {} });
    expect(() => other.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STATE_LOCKED",
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
    release();
  });

  it("refuses recovery after its dispatcher lock has been replaced", () => {
    const { directory, file, original, store } = makeTornStream();
    const release = store.lock();
    const lockFile = join(directory, "dispatcher.lock");
    writeFileSync(lockFile, JSON.stringify({ pid: 707 }));
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STATE_LOCKED",
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
    release();
    expect(JSON.parse(readFileSync(lockFile, "utf8")).pid).toBe(707);
  });

  it("rechecks ownership after quarantine and refuses to truncate under a replacement lock", () => {
    const { directory, file, original, store } = makeTornStream();
    const release = store.lock();
    const lockFile = join(directory, "dispatcher.lock");
    renameSync.mockImplementationOnce((from, to) => {
      actualFs.renameSync(from, to);
      writeFileSync(lockFile, JSON.stringify({ pid: 707 }));
    });
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STATE_LOCKED",
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryRecords(directory)).toHaveLength(1);
    release();
    expect(JSON.parse(readFileSync(lockFile, "utf8")).pid).toBe(707);
  });

  it("does not let an old release callback remove a newly acquired lock", () => {
    const directory = makeDirectory();
    const store = makeStore(directory);
    const oldRelease = store.lock();
    oldRelease();
    const newRelease = store.lock();
    oldRelease();
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(true);
    newRelease();
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
  });
});

describe("recovery filesystem failures", () => {
  it("retains the sole fragment when the read-only tail probe fails", () => {
    const { directory, file, original, store } = makeTornStream();
    failOpenMode("r");
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED", details: { stream: "events", operation: "append" },
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
    vi.resetAllMocks();
    makeStore(directory).append("events", { value: 4 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
  });

  it.each([
    ["quarantine open", () => failOpenMode("wx")],
    ["quarantine write", () => writeSync.mockImplementationOnce(failIo)],
    ["quarantine sync", () => fsyncSync.mockImplementationOnce(failIo)],
    ["quarantine rename", () => renameSync.mockImplementationOnce(failIo)],
    ["non-progressing quarantine write", () => writeSync.mockImplementationOnce(() => 0)],
  ])("keeps the sole original fragment and refuses append on %s failure", (_label, injectFailure) => {
    const { directory, file, original, store } = makeTornStream();
    const release = store.lock();
    injectFailure();
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED", details: { stream: "events", operation: "quarantine" },
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toEqual([]);
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    release();
    vi.resetAllMocks();
    makeStore(directory).append("events", { value: 4 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
  });

  it.each([1, 2])("refuses repair when quarantine read %i fails and preserves every evidence copy", (readNumber) => {
    const { directory, file, original, fragment, store } = makeTornStream();
    let recoveryReads = 0;
    readFileSync.mockImplementation((target, ...options) => {
      if (typeof target === "string" && target.includes("events.recovery-")) {
        recoveryReads += 1;
        if (recoveryReads === readNumber) failIo();
      }
      return actualFs.readFileSync(target, ...options);
    });
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED", details: { stream: "events", operation: "quarantine" },
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(recoveryNames(directory)).toHaveLength(readNumber - 1);
    const priorRecovery = recoveryNames(directory).map((name) => [name, readFileSync(join(directory, name))]);
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
    vi.resetAllMocks();
    makeStore(directory).append("events", { value: 4 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
    expect(Buffer.from(recoveryRecords(directory)[0].fragmentBase64, "base64")).toEqual(fragment);
    for (const [name, bytes] of priorRecovery) expect(readFileSync(join(directory, name))).toEqual(bytes);
  });

  it("completes short quarantine writes before it truncates any original bytes", () => {
    const { directory, file, prefix, fragment, store } = makeTornStream();
    writeSync.mockImplementation((descriptor, bytes, offset, length) => actualFs.writeSync(
      descriptor, bytes, offset, Math.min(length, 3),
    ));
    store.append("events", { value: 4 });
    expect(Buffer.from(recoveryRecords(directory)[0].fragmentBase64, "base64")).toEqual(fragment);
    expect(readFileSync(file).subarray(0, prefix.length)).toEqual(prefix);
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
    expect(writeSync.mock.calls.length).toBeGreaterThan(1);
  });

  it.each([
    ["repair open", () => failOpenMode("r+")],
    ["repair truncate", () => ftruncateSync.mockImplementationOnce(failIo)],
  ])("preserves the stream and reuses the immutable quarantine after %s failure", (_label, injectFailure) => {
    const { directory, file, original, fragment, store } = makeTornStream();
    injectFailure();
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED", details: { stream: "events", operation: "repair" },
    }));
    expect(readFileSync(file)).toEqual(original);
    const [name] = recoveryNames(directory);
    const quarantine = readFileSync(join(directory, name));
    expect(Buffer.from(recoveryRecords(directory)[0].fragmentBase64, "base64")).toEqual(fragment);
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
    vi.resetAllMocks();
    makeStore(directory).append("events", { value: 4 });
    expect(recoveryNames(directory)).toEqual([name]);
    expect(readFileSync(join(directory, name))).toEqual(quarantine);
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
  });

  it("reports repair sync failure without appending and retains the preserved fragment", () => {
    const { directory, file, prefix, fragment, store } = makeTornStream();
    ftruncateSync.mockImplementationOnce((descriptor, offset) => {
      actualFs.ftruncateSync(descriptor, offset);
      fsyncSync.mockImplementationOnce(failIo);
    });
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED", details: { stream: "events", operation: "repair" },
    }));
    expect(readFileSync(file)).toEqual(prefix);
    expect(Buffer.from(recoveryRecords(directory)[0].fragmentBase64, "base64")).toEqual(fragment);
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
    makeStore(directory).append("events", { value: 4 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
  });

  it("reports append failure after repair rather than returning a success record", () => {
    const { directory, file, prefix, fragment, store } = makeTornStream();
    appendFileSync.mockImplementationOnce(failIo);
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED", details: { stream: "events", operation: "append" },
    }));
    expect(readFileSync(file)).toEqual(prefix);
    expect(Buffer.from(recoveryRecords(directory)[0].fragmentBase64, "base64")).toEqual(fragment);
    expect(existsSync(join(directory, "dispatcher.lock"))).toBe(false);
    makeStore(directory).append("events", { value: 4 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(7);
    expect(recoveryNames(directory)).toHaveLength(1);
  });

  it("recovers again if a failed append leaves a new incomplete fragment", () => {
    const { directory, file, prefix, fragment, store } = makeTornStream();
    const nextFragment = Buffer.from('{"value":');
    appendFileSync.mockImplementationOnce((target) => {
      actualFs.appendFileSync(target, nextFragment);
      failIo();
    });
    expect(() => store.append("events", { value: 4 })).toThrowError(expect.objectContaining({
      code: "STORE_WRITE_FAILED",
    }));
    expect(readFileSync(file)).toEqual(Buffer.concat([prefix, nextFragment]));
    makeStore(directory).append("events", { value: 8 });
    expect(makeStore(directory).fold("events", sum, 0)).toBe(11);
    const preserved = recoveryRecords(directory).map((record) => Buffer.from(record.fragmentBase64, "base64"));
    expect(preserved).toEqual(expect.arrayContaining([fragment, nextFragment]));
    expect(preserved).toHaveLength(2);
  });

  it("fails closed rather than overwriting mismatched quarantine provenance", () => {
    const { directory, file, original, store } = makeTornStream();
    store.append("events", { value: 4 });
    const [name] = recoveryNames(directory);
    const recoveryFile = join(directory, name);
    const altered = { ...recoveryRecords(directory)[0], fragmentBase64: "d3Jvbmc=" };
    writeFileSync(recoveryFile, JSON.stringify(altered));
    const quarantine = readFileSync(recoveryFile);
    writeFileSync(file, original);
    expect(() => makeStore(directory).append("events", { value: 8 })).toThrowError(expect.objectContaining({
      code: "STORE_CORRUPT",
    }));
    expect(readFileSync(file)).toEqual(original);
    expect(readFileSync(recoveryFile)).toEqual(quarantine);
  });

  it("keeps diagnostics bounded and sanitized while preserving private bytes only in quarantine", () => {
    const marker = "fixture-private-fragment-marker";
    const { directory, file, original, fragment, store } = makeTornStream(Buffer.from(`{"text":"${marker}`));
    renameSync.mockImplementationOnce(failIo);
    let failure;
    try {
      store.append("events", { value: 4 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: "ClawError", code: "STORE_WRITE_FAILED" });
    expect(failure.message).toBe("STORE_WRITE_FAILED");
    expect(JSON.stringify(failure)).not.toContain(marker);
    expect(JSON.stringify(failure)).not.toContain("fixture-private-io-marker");
    expect(JSON.stringify(failure).length).toBeLessThan(256);
    expect(readFileSync(file)).toEqual(original);
    const redactingStore = makeStore(directory, { redact: (text) => text.replaceAll(marker, "redacted-fixture") });
    redactingStore.append("events", { value: 4, text: marker });
    const [recovery] = recoveryRecords(directory);
    expect(Buffer.from(recovery.fragmentBase64, "base64")).toEqual(fragment);
    expect(readFileSync(file, "utf8")).not.toContain(marker);
    expect(readFileSync(file, "utf8")).toContain("redacted-fixture");
    const { fragmentBase64: _preserved, ...provenance } = recovery;
    expect(JSON.stringify(provenance)).not.toContain(marker);
    expect(JSON.stringify(provenance).length).toBeLessThan(512);
    if (process.platform !== "win32") {
      expect(statSync(join(directory, recoveryNames(directory)[0])).mode & 0o777).toBe(0o600);
    }
  });
});

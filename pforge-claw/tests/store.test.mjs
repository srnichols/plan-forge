import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSecrets } from "../src/secrets.mjs";
import { createStore, STALE_LOCK_GRACE_MS } from "../src/state/store.mjs";

const directories = [];
const fixedTime = new Date("2026-10-07T16:00:00.000Z");
const makeDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "claw-store-"));
  directories.push(directory);
  return directory;
};
const makeStore = (directory, options = {}) => createStore(directory, {
  now: () => new Date(fixedTime),
  ...options,
});
const sum = (total, record) => total + record.value;
const collect = (items, record) => [...items, record.text];

afterEach(() => {
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

  it("skips a torn tail on read, repairs it on append, and detects it after repair", () => {
    const directory = makeDirectory();
    const store = makeStore(directory);
    const file = join(directory, "events.jsonl");
    writeFileSync(file, '{"value":1}\n{"value":2}\n{"a":');
    expect(store.fold("events", sum, 0)).toBe(3);
    store.append("events", { value: 4 });
    expect(readFileSync(file, "utf8")).toContain('{"a":\n{"value":4,');
    expect(() => store.fold("events", sum, 0)).toThrowError(expect.objectContaining({
      code: "STORE_CORRUPT",
    }));
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "../../src/enums.mjs";
import { COMMANDS, toMetadata, validateRegistry } from "../../src/commands/index.mjs";
import commandsCli from "../../src/cli/commands.mjs";

const EXPECTED = {
  help: 5, ask: 6, new: 6, run: 9, skill: 9, task: 9, status: 16, jobs: 9,
  budget: 11, remember: 7, recall: 7, idea: 7, bug: 7, abort: 12, retry: 12,
  lane: 23, lanes: 23, fanout: 16, forget: 24,
};

afterEach(() => vi.restoreAllMocks());

describe("command registry contract", () => {
  it("contains the exact command inventory and owning slices", () => {
    expect(Object.fromEntries(COMMANDS.map(({ name, sinceSlice }) => [name, sinceSlice]))).toEqual(EXPECTED);
    expect(COMMANDS).toHaveLength(19);
  });

  it("limits viewer metadata to help, ask and status", () => {
    const viewers = COMMANDS.filter(({ roles }) => roles.includes(ROLES[2])).map(({ name }) => name).sort();
    expect(viewers).toEqual(["ask", "help", "status"]);
    expect(COMMANDS.find(({ name }) => name === "help").aliases).toContain("start");
  });

  it("exports metadata without functions", () => {
    const metadata = COMMANDS.map(toMetadata);
    expect(metadata).toHaveLength(COMMANDS.length);
    expect(metadata.every((entry) => Object.values(entry).every((value) => typeof value !== "function"))).toBe(true);
  });

  it("rejects duplicate command names and aliases", () => {
    expect(() => validateRegistry([...COMMANDS, COMMANDS[0]])).toThrow(/duplicate command token/i);
  });

  it("lists every command in text, markdown and JSON CLI formats", () => {
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(commandsCli.run([])).toBe(0);
    expect(writes.mock.calls[0][0]).toContain("sinceSlice");
    expect(writes.mock.calls[0][0]).toContain("forget");
    writes.mockClear();
    expect(commandsCli.run(["--markdown"])).toBe(0);
    expect(writes.mock.calls[0][0]).toContain("| name | aliases |");
    writes.mockClear();
    expect(commandsCli.run(["--json"])).toBe(0);
    const parsed = JSON.parse(writes.mock.calls[0][0]);
    expect(parsed).toHaveLength(COMMANDS.length);
    expect(parsed.some(({ available }) => !available)).toBe(true);
  });

  it("rejects unknown and conflicting CLI output flags", () => {
    const writes = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(commandsCli.run(["--bad"])).toBe(1);
    expect(commandsCli.run(["--markdown", "--json"])).toBe(1);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(writes.mock.calls[0][0]).toContain("Usage:");
  });
});

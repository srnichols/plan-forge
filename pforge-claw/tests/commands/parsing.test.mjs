import { describe, expect, it } from "vitest";
import { findCommand, parseText } from "../../src/commands/index.mjs";

describe("chat command parsing", () => {
  it.each([
    ["/run X speed", {}, { kind: "command", name: "run", argsText: "X speed", args: ["X", "speed"] }],
    ["/START", {}, { kind: "command", name: "help", argsText: "", args: [] }],
    ["/help@clawbot", { botUsername: "clawbot" }, { kind: "command", name: "help", argsText: "", args: [] }],
    ["/help@other", { botUsername: "clawbot" }, { kind: "other-bot" }],
    ["  /run X  speed  ", {}, { kind: "command", name: "run", argsText: "X  speed", args: ["X", "speed"] }],
    ["   ", {}, { kind: "empty" }],
    ["/lane w1 on", {}, { kind: "command", name: "lane", argsText: "w1 on", args: ["w1", "on"] }],
    ["help run", {}, { kind: "help-text", topic: "run" }],
  ])("parses %s without changing argument text", (text, options, expected) => {
    expect(parseText(text, options)).toMatchObject(expected);
  });

  it("keeps mixed-case argument spelling and internal spacing", () => {
    expect(parseText("/task Keep MiXeD  Case").argsText).toBe("Keep MiXeD  Case");
  });

  it("strips bot addressing and resolves aliases in direct lookup", () => {
    expect(findCommand("/help@clawbot").name).toBe("help");
    expect(findCommand("/START").name).toBe("help");
    expect(findCommand("/missing")).toBeUndefined();
  });
});

/**
 * forge_tool_profile end to end over MCP: the server lists the core profile,
 * loading a profile sends notifications/tools/list_changed and widens the
 * list, and an unlisted tool stays callable by name.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_PROFILES } from "../server/tool-profiles.mjs";

delete process.env.PFORGE_TOOL_PROFILE;
const { server } = await import("../server/mcp-handler.mjs");
const { TOOLS } = await import("../server/tool-definitions.mjs");

const parse = (result) => JSON.parse(result.content[0].text);

describe("forge_tool_profile over MCP", () => {
  let client;
  let listChanged = 0;

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "tool-profile-test", version: "1.0.0" });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { listChanged++; });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it("advertises list_changed support", () => {
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
  });

  it("lists the core profile by default", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_PROFILES.core].sort());
    expect(tools.length).toBeLessThan(TOOLS.length);
  });

  it("describes the profiles when called without arguments", async () => {
    const payload = parse(await client.callTool({ name: "forge_tool_profile", arguments: {} }));
    expect(payload.active).toEqual(["core"]);
    expect(payload.changed).toBe(false);
    expect(payload.profiles.map((p) => p.name)).toContain("liveguard");
    expect(payload.message).toMatch(/Load more/);
  });

  it("loads a profile, notifies the client, and lists its tools", async () => {
    const before = listChanged;
    const payload = parse(await client.callTool({ name: "forge_tool_profile", arguments: { load: ["bugs"] } }));
    expect(payload).toMatchObject({ active: ["core", "bugs"], changed: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(listChanged).toBe(before + 1);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("forge_bug_list");
  });

  it("reports an unknown profile as an error without changing anything", async () => {
    const result = await client.callTool({ name: "forge_tool_profile", arguments: { load: ["nope"] } });
    expect(result.isError).toBe(true);
    expect(parse(result).unknown).toEqual(["nope"]);
  });

  it("unloads back to core", async () => {
    const payload = parse(await client.callTool({ name: "forge_tool_profile", arguments: { unload: ["bugs"] } }));
    expect(payload.active).toEqual(["core"]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("forge_bug_list");
  });
});

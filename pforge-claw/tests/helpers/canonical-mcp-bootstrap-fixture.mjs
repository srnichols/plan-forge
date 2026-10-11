import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { HOME_MCP_BOOTSTRAP_TOOL } from "../../src/jobs/bootstrap-mcp.mjs";

export const CANONICAL_MCP_BOOTSTRAP = Object.freeze({
  v: 1,
  serverName: "plan-forge",
  command: "node",
  args: Object.freeze(["${workspaceFolder}/pforge-mcp/server.mjs"]),
  cwd: "${workspaceFolder}",
  env: Object.freeze({ API_TOKEN: "${env:API_TOKEN}" }),
  toolProfile: "full",
});

/**
 * Seed the real configured home before its metadata is collected and signed.
 * @param {string} repoPath
 * @returns {Promise<void>}
 */
export async function seedCanonicalMcpConfig(repoPath) {
  const directory = path.join(repoPath, ".vscode");
  const { serverName, command, args, cwd, env } = CANONICAL_MCP_BOOTSTRAP;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "mcp.json"), JSON.stringify({
    servers: { [serverName]: { type: "stdio", command, args, cwd, env } },
  }));
}

/**
 * Assert the exact canonical read, allowing only the registry-owned request identity.
 * @param {{reads: Array<{projectId: string, tool: string, args: Record<string, never>, requestId: string}>, projectId: string}} options
 * @returns {void}
 */
export function expectCanonicalMcpReads({ reads, projectId }) {
  expect(reads.map(({ requestId, ...request }) => request))
    .toEqual([{ projectId, tool: HOME_MCP_BOOTSTRAP_TOOL, args: {} }]);
  expect(reads.every(({ requestId }) => typeof requestId === "string" && requestId.length > 0)).toBe(true);
}

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { FIXTURE_HTTP_STATUS, FIXTURE_TCP_PORT_MAX } from "./k8s-fixture-common.mjs";

const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 2000;
const START_BYTES_LIMIT = 1024;

/** External project MCP HTTP edge used by the real pod finalizer's spawn. */
export async function startFixtureProjectHttp({ notify = false } = {}) {
  const { values } = parseArgs({ options: { port: { type: "string" } } });
  const port = Number(values.port);
  if (!Number.isSafeInteger(port) || port < 0 || port > FIXTURE_TCP_PORT_MAX) throw new Error("K8S_E2E_MCP_PORT_INVALID");
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(request.url === "/mcp" ? FIXTURE_HTTP_STATUS.OK : FIXTURE_HTTP_STATUS.NOT_FOUND, { "content-type": "application/json" });
    response.end('{"fixture":true}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const stop = () => { server.closeAllConnections(); server.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (notify) process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
  return server;
}

function awaitReady(child) {
  return new Promise((resolve, reject) => {
    let bytes = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("K8S_E2E_MCP_START_FAILED"));
    }, START_TIMEOUT_MS);
    const fail = () => { clearTimeout(timer); reject(new Error("K8S_E2E_MCP_START_FAILED")); };
    child.once("error", fail);
    child.once("close", fail);
    child.stdout.on("data", (chunk) => {
      bytes += chunk;
      if (Buffer.byteLength(bytes) > START_BYTES_LIMIT) { child.kill(); fail(); return; }
      if (!bytes.includes("\n")) return;
      try {
        const { port } = JSON.parse(bytes.slice(0, bytes.indexOf("\n")));
        if (!Number.isSafeInteger(port) || port < 1 || port > FIXTURE_TCP_PORT_MAX) throw new Error("invalid port");
        clearTimeout(timer);
        child.removeListener("close", fail);
        resolve(port);
      } catch { child.kill(); fail(); }
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, STOP_TIMEOUT_MS);
    child.once("close", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

/** Spawn/probe a real external MCP fixture without ever probing a shared operator port. */
export async function startFixturePodMcp({ repoDir, env, spawnFn = spawn }) {
  const child = spawnFn(process.execPath, [
    fileURLToPath(new URL("./k8s-project-http.mjs", import.meta.url)), "--port", "0",
  ], { cwd: repoDir, env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  try {
    const port = await awaitReady(child);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(START_TIMEOUT_MS) });
    if (!response.ok || (await response.json()).fixture !== true) throw new Error("K8S_E2E_MCP_START_FAILED");
    return { stop: () => stopChild(child) };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await startFixtureProjectHttp({ notify: true });
  } catch {
    process.stderr.write("K8S_E2E_MCP_START_FAILED\n");
    process.exitCode = 1;
  }
}

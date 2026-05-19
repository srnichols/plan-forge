import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { captureMemory as _captureMemoryCore } from "../memory.mjs";
import { resolveFrameworkVersion } from "../update-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot({ env, argv, serverDir, cwd }) {
  if (env.PLAN_FORGE_PROJECT) {
    return { resolved: resolve(env.PLAN_FORGE_PROJECT), source: "env" };
  }

  const projectFlagIdx = argv.indexOf("--project");
  if (projectFlagIdx !== -1 && argv[projectFlagIdx + 1]) {
    return { resolved: resolve(argv[projectFlagIdx + 1]), source: "--project" };
  }

  const STRONG_MARKERS = [".forge.json", ".git"];
  const WEAK_MARKERS = ["package.json"];
  const startDirs = [cwd, serverDir];

  for (const startDir of startDirs) {
    let dir = resolve(startDir);
    while (true) {
      for (const marker of STRONG_MARKERS) {
        if (existsSync(join(dir, marker))) {
          return { resolved: dir, source: `marker:${marker}` };
        }
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }

  for (const startDir of startDirs) {
    let dir = resolve(startDir);
    while (true) {
      for (const marker of WEAK_MARKERS) {
        if (existsSync(join(dir, marker))) {
          return { resolved: dir, source: `marker:${marker}` };
        }
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }

  return { resolved: cwd, source: "fallback-cwd", warning: "no .git/.forge.json/package.json marker found" };
}

export const { resolved: PROJECT_DIR, source: PROJECT_DIR_SOURCE } = resolveProjectRoot({
  env: process.env,
  argv: process.argv,
  serverDir: resolve(__dirname, ".."),
  cwd: process.cwd(),
});
export const HTTP_PORT = parseInt(process.env.PLAN_FORGE_HTTP_PORT || "3100", 10);
export const IS_WINDOWS = process.platform === "win32";
export const PFORGE = IS_WINDOWS ? "powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1" : "bash pforge.sh";
export const FRAMEWORK_VERSION = resolveFrameworkVersion({ serverDir: resolve(__dirname, "..") });
export const _SERVER_CODE_HASH = FRAMEWORK_VERSION || "server-unknown";

export let activeAbortController = null;
export let _planPathAliasWarned = false;
export let activeRunPromise = null;
export let activeHub = null;
export let activeBridge = null;
export let activeEventWatcher = null;
export let _studioClient = null;
export let server = null;
export const _approvedRunIds = new Set();

export function setActiveAbortController(value) {
  activeAbortController = value;
  return activeAbortController;
}

export function setPlanPathAliasWarned(value) {
  _planPathAliasWarned = value;
  return _planPathAliasWarned;
}

export function setActiveRunPromise(value) {
  activeRunPromise = value;
  return activeRunPromise;
}

export function setActiveHub(value) {
  activeHub = value;
  return activeHub;
}

export function setActiveBridge(value) {
  activeBridge = value;
  return activeBridge;
}

export function setActiveEventWatcher(value) {
  activeEventWatcher = value;
  return activeEventWatcher;
}

export function setStudioClient(value) {
  _studioClient = value;
  return _studioClient;
}

export function setServer(value) {
  server = value;
  return server;
}

export async function getOrSpawnStudioChild() {
  if (_studioClient?.ready) return _studioClient;
  const studioPath = resolve(__dirname, "../../pforge-master/server.mjs");
  if (!existsSync(studioPath)) return null;
  try {
    const { McpClient } = await import("../../pforge-master/src/mcp-client.mjs");
    const client = new McpClient({ logger: console });
    await client.connect({ serverPath: studioPath });
    setStudioClient(client);
    try {
      const forgeDir = resolve(PROJECT_DIR, ".forge");
      if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });
    } catch {}
    return client;
  } catch (err) {
    console.error(`forge-master: failed to spawn studio child: ${err.message} — using in-process fallback`);
    return null;
  }
}

export async function broadcastLiveGuard(tool, status, durationMs, summary = {}) {
  const ts = new Date().toISOString();
  const clientCount = activeHub?.clients?.size || 0;

  try {
    const logDir = resolve(PROJECT_DIR, ".forge");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(resolve(logDir, "liveguard-broadcast.log"), `${ts} ${tool} hub=${!!activeHub} clients=${clientCount} status=${status}\n`);
  } catch {}

  if (!activeHub) {
    console.error(`[liveguard] broadcastLiveGuard(${tool}) — hub not initialized, event dropped`);
    return;
  }
  activeHub.broadcast({ type: "liveguard-tool-completed", tool, status, durationMs, timestamp: ts });
  activeHub.broadcast({ type: "liveguard", tool: tool.replace("forge_", "").replace(/_/g, "-"), status, ...summary, timestamp: ts });
  console.error(`[liveguard] ${tool} → ${clientCount} client(s)`);

  await new Promise((r) => setImmediate(r));
}

export function captureMemory(content, type, source, cwd) {
  return _captureMemoryCore(content, type, source, cwd, {
    onCapture: (thought, deduped) => {
      try {
        activeHub?.broadcast({
          type: "memory-captured",
          thought,
          deduped,
          timestamp: thought.captured_at,
        });
      } catch {}
    },
  });
}

export function _legacyCaptureMemoryUnused(content, type, source, cwd) {
  void content;
  void type;
  void source;
  void cwd;
}

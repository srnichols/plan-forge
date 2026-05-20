import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROJECT_DIR, HTTP_PORT, FRAMEWORK_VERSION, activeHub, activeBridge, activeEventWatcher, _studioClient, setActiveHub, setActiveBridge, setActiveEventWatcher, setStudioClient } from "./state.mjs";
import { TOOLS } from "./tool-definitions.mjs";
import { server } from "./mcp-handler.mjs";
import { createExpressApp } from "./rest-api.mjs";
import { runDrainPass, __shouldDrainOnInit } from "./openbrain-bridge.mjs";
import { createHub } from "../hub.mjs";
import { createBridge } from "../bridge.mjs";
import { startEventFileWatcher } from "./helpers.mjs";
import { checkForUpdate, detectCorruptInstall } from "../update-check.mjs";
import { writeToolsJson, writeCliSchema } from "../capabilities.mjs";

const __dirname = resolve(fileURLToPath(new URL("..", import.meta.url)));

const DASHBOARD_ONLY = process.argv.includes("--dashboard-only") || process.argv.includes("--dashboard");
const VALIDATE_ONLY = process.argv.includes("--validate");

function _emitCorruptInstallEvent(current, r, corrupt) {
  try {
    if (activeHub && typeof activeHub.broadcast === "function") {
      activeHub.broadcast({
        type: "install:corrupt", severity: "high", current, latest: r.latest,
        reason: corrupt.reason, recommendedAction: corrupt.recommendedAction,
        detectedAt: new Date().toISOString(),
      });
    }
  } catch { /* silent */ }
  try {
    const forgeDir = resolve(PROJECT_DIR, ".forge");
    if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "install-health.json"), JSON.stringify({
      isCorrupt: true, current, latest: r.latest,
      reason: corrupt.reason, recommendedAction: corrupt.recommendedAction,
      detectedAt: new Date().toISOString(),
    }, null, 2), "utf-8");
  } catch { /* silent */ }
}

function _handleUpdateResult(current, r) {
  if (r && r.isNewer) {
    console.error(`[update-check] A newer Plan Forge release is available: v${r.latest} (you are on v${r.current}). ${r.url}`);
  }
  if (!r || !r.latest) return;
  const corrupt = detectCorruptInstall({ currentVersion: current, latestVersion: r.latest });
  if (corrupt.isCorrupt) {
    console.error("");
    console.error("  ┌──────────────────────────────────────────────────────────────┐");
    console.error("  │  ⚠  CORRUPT INSTALL DETECTED                                 │");
    console.error("  ├──────────────────────────────────────────────────────────────┤");
    console.error(`  │  Local VERSION: ${current.padEnd(44)} │`);
    console.error(`  │  Latest release: v${r.latest.padEnd(43)} │`);
    console.error("  │                                                              │");
    console.error("  │  Your install is from a broken release tarball that shipped  │");
    console.error("  │  with a '-dev' VERSION file. Self-heal with:                 │");
    console.error("  │                                                              │");
    console.error("  │      pforge self-update --force                              │");
    console.error("  │                                                              │");
    console.error("  └──────────────────────────────────────────────────────────────┘");
    console.error("");
    _emitCorruptInstallEvent(current, r, corrupt);
  } else {
    try {
      const statePath = resolve(PROJECT_DIR, ".forge", "install-health.json");
      if (existsSync(statePath)) {
        writeFileSync(statePath, JSON.stringify({ isCorrupt: false, current, latest: r.latest, healedAt: new Date().toISOString() }, null, 2), "utf-8");
      }
    } catch { /* silent */ }
  }
}

function _runValidateMode() {
  try {
    const toolNames = TOOLS.map((t) => t.name);
    if (!toolNames.length) throw new Error("No tools registered");
    writeToolsJson(TOOLS, __dirname);
    writeCliSchema(__dirname);
    console.error(`[validate] OK — ${toolNames.length} tools registered, capabilities generated`);
    process.exit(0);
  } catch (err) {
    console.error(`[validate] FAIL — ${err.message}`);
    process.exit(1);
  }
}

function _generateCapabilities() {
  try {
    writeToolsJson(TOOLS, __dirname);
    writeCliSchema(__dirname);
    console.error("[capabilities] tools.json + cli-schema.json generated");
  } catch (err) {
    console.error(`[capabilities] Auto-generation failed: ${err.message} (non-fatal)`);
  }
}

function _startHttpServer() {
  try {
    const app = createExpressApp();
    app.listen(HTTP_PORT, "127.0.0.1", () => {
      console.error(`Plan Forge Dashboard at http://127.0.0.1:${HTTP_PORT}/dashboard`);
    });
  } catch (err) {
    console.error(`[http] Express server failed to start: ${err.message} (non-fatal)`);
  }
}

function _scheduleUpdateCheck() {
  try {
    const current = FRAMEWORK_VERSION && FRAMEWORK_VERSION !== "unknown" ? FRAMEWORK_VERSION : null;
    if (!current) return;
    setTimeout(() => {
      checkForUpdate({ currentVersion: current, projectDir: PROJECT_DIR })
        .then((r) => _handleUpdateResult(current, r))
        .catch(() => { /* silent */ });
    }, 2000).unref?.();
  } catch { /* silent */ }
}

async function _startHubServices() {
  try {
    setActiveHub(await createHub({ cwd: PROJECT_DIR }));
    console.error(`Plan Forge WebSocket hub running on port ${activeHub.port}`);
    setActiveEventWatcher(startEventFileWatcher(activeHub, PROJECT_DIR));
  } catch (err) {
    console.error(`[hub] WebSocket hub failed to start: ${err.message} (non-fatal)`);
  }
}

async function _startTransport() {
  if (!DASHBOARD_ONLY) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Plan Forge MCP server running (stdio transport)");
    return;
  }
  console.error("Plan Forge Dashboard-only mode (no MCP stdio)");
}

function _scheduleInitialDrain() {
  try {
    if (__shouldDrainOnInit()) {
      setTimeout(() => {
        runDrainPass(PROJECT_DIR, "initialize-drain", activeHub)
          .then((r) => console.error(`[drain] initialize-drain: ${JSON.stringify(r)}`))
          .catch((e) => console.error(`[drain] initialize-drain failed: ${e.message || e}`));
      }, 3000);
    }
  } catch { /* setTimeout registration must never crash startup */ }
}

function _startBridge() {
  try {
    setActiveBridge(createBridge({ cwd: PROJECT_DIR, port: activeHub?.port }));
    if (activeBridge) {
      console.error("[bridge] Bridge manager started");
    }
  } catch (err) {
    console.error(`[bridge] Bridge failed to start: ${err.message} (non-fatal)`);
  }
}

export async function runServerMain() {
  // --validate: quick startup check — verify imports, tool list, and exit
  if (VALIDATE_ONLY) {
    _runValidateMode();
  }

  // Auto-generate tools.json + cli-schema.json on startup
  _generateCapabilities();

  if (!process.env.PFORGE_CHILD_MODE) {
    // Start Express HTTP server for dashboard + REST API
    _startHttpServer();
  }

  if (!process.env.PFORGE_CHILD_MODE) {
    // Phase UPDATE-01 — non-blocking, best-effort update check.
    // Runs once per boot, cached 24h. Honors PFORGE_NO_UPDATE_CHECK=1.
    // Failures are silent so a bad network never impedes startup.
    //
    // Issue #106: report the install's VERSION (FRAMEWORK_VERSION), NOT
    // PROJECT_DIR/VERSION. The boot log message
    //   "[update-check] A newer Plan Forge release is available: ... (you are on vX.Y.Z)"
    // is about the FRAMEWORK, so the comparison must use the framework's own
    // VERSION — otherwise misresolved PROJECT_DIRs (issues #105/#125) cause
    // the log to claim the user is on an unrelated number from their cwd.
    _scheduleUpdateCheck();
  }

  if (!process.env.PFORGE_CHILD_MODE) {
    // Start WebSocket hub BEFORE stdio transport — ensures activeHub is set before any tool calls arrive
    await _startHubServices();
  }

  // MCP stdio transport — AFTER hub so broadcastLiveGuard has a hub to send to
  await _startTransport();

  if (!process.env.PFORGE_CHILD_MODE) {
    // Phase-28.4: schedule background drain of OpenBrain queue ~3s after start
    _scheduleInitialDrain();
  }

  // Start Bridge (connects to hub as a WS client; activates if bridge config present)
  _startBridge();

  // Graceful shutdown
  process.on("SIGTERM", () => {
    if (activeEventWatcher) activeEventWatcher.stop();
    if (activeHub) activeHub.close();
    if (activeBridge) activeBridge.stop();
    if (_studioClient) _studioClient.close().catch(() => {});
  });
  process.on("SIGINT", () => {
    if (activeEventWatcher) activeEventWatcher.stop();
    if (activeHub) activeHub.close();
    if (activeBridge) activeBridge.stop();
    if (_studioClient) _studioClient.close().catch(() => {});
  });
}

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, watchFile, unwatchFile } from "node:fs";
import { resolve, join, extname } from "node:path";
import { PROJECT_DIR, PFORGE } from "./state.mjs";

export const ANALYZE_MODES = Object.freeze(["plan", "file"]);
const PLAN_FILE_EXTENSIONS = Object.freeze([".md", ".markdown"]);

/**
 * Resolve forge_analyze's mode: an explicit mode wins; otherwise plans are
 * Markdown and anything else is a source file (meta-bug #319 — a "Program.cs"
 * target used to fall through to the plan scorer).
 * @returns {{ mode: "plan"|"file" } | { error: string }}
 */
export function resolveAnalyzeMode({ plan, mode } = {}) {
  if (typeof plan !== "string" || !plan.trim()) {
    return { error: "plan is required: the path of the plan or source file to analyze" };
  }
  if (mode !== undefined && mode !== null && mode !== "") {
    return ANALYZE_MODES.includes(mode)
      ? { mode }
      : { error: `mode must be one of ${ANALYZE_MODES.map((m) => `"${m}"`).join(", ")} (got "${mode}")` };
  }
  return { mode: PLAN_FILE_EXTENSIONS.includes(extname(plan).toLowerCase()) ? "plan" : "file" };
}

export function analyzeFileModeNeedsQuorumMessage(target) {
  return [
    `forge_analyze without quorum scores plan files only, so it did not analyze "${target}" (mode "file").`,
    "For a code review of a source file, call forge_analyze with quorum: true (a multi-model review that spends tokens),",
    "or forge_diagnose for a bug investigation. To score a Markdown file as a plan, pass mode: \"plan\".",
  ].join(" ");
}

/**
 * Event File Watcher — tails events.log from the latest run dir and broadcasts
 * new events to the WebSocket hub. This bridges the orchestrator (standalone CLI
 * process writing to files) with the dashboard (WebSocket client).
 *
 * On startup: finds the latest run, reads ALL events from it (so the hub history
 * buffer has them for late-connecting dashboard clients).
 * On new run: detects the new events.log, replays it from the start, detaches
 * the old file watcher.
 */
export function startEventFileWatcher(hub, cwd) {
  const runsDir = resolve(cwd, ".forge", "runs");
  let currentLogFile = null;
  let fileOffset = 0;
  let scanInterval = null;

  function findLatestEventsLog() {
    if (!existsSync(runsDir)) return null;
    const dirs = readdirSync(runsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
    for (const dir of dirs) {
      const logPath = resolve(runsDir, dir, "events.log");
      if (existsSync(logPath)) return logPath;
    }
    return null;
  }

  function processNewLines(logPath) {
    try {
      const stat = statSync(logPath);
      if (stat.size <= fileOffset) return;
      const fd = openSync(logPath, "r");
      const buf = Buffer.alloc(stat.size - fileOffset);
      readSync(fd, buf, 0, buf.length, fileOffset);
      closeSync(fd);
      fileOffset = stat.size;

      const lines = buf.toString("utf-8").split("\n").filter(l => l.trim());
      for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\]\s+(\S+):\s+(.*)$/);
        if (!match) continue;
        try {
          const [, timestamp, type, jsonStr] = match;
          const data = JSON.parse(jsonStr);
          hub.broadcast({ type, data, timestamp, source: "file-watcher" });
        } catch {
          // Skip malformed event lines
        }
      }
    } catch {
      // File may be temporarily locked by the orchestrator
    }
  }

  function detachWatcher() {
    if (currentLogFile) {
      try { unwatchFile(currentLogFile); } catch { /* ignore */ }
    }
  }

  function attachWatcher(logPath) {
    try {
      watchFile(logPath, { interval: 1000 }, () => {
        processNewLines(logPath);
      });
    } catch {
      // watchFile not supported — polling covers it
    }
  }

  // Poll every 2 seconds: check for latest events.log and process new lines
  scanInterval = setInterval(() => {
    const logPath = findLatestEventsLog();
    if (!logPath) return;

    if (logPath !== currentLogFile) {
      // New or different run — detach old watcher, reset offset, replay from start
      detachWatcher();
      currentLogFile = logPath;
      fileOffset = 0;
      attachWatcher(logPath);
      console.error(`[event-watcher] Tracking new run: ${logPath}`);
    }

    processNewLines(logPath);
  }, 2000);

  // Initial scan — replay ALL events from the latest run so hub has history
  const initial = findLatestEventsLog();
  if (initial) {
    currentLogFile = initial;
    fileOffset = 0; // Start from beginning — replay full history into hub
    processNewLines(initial);
    attachWatcher(initial);
    console.error(`[event-watcher] Loaded ${initial} (replayed into hub history)`);
  }

  return {
    stop() {
      if (scanInterval) clearInterval(scanInterval);
      detachWatcher();
    },
  };
}

export function runPforge(args, cwd = PROJECT_DIR) {
  const cmd = `${PFORGE} ${args}`;
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || "").trim(),
      error: (err.stderr || err.message || "").trim(),
      exitCode: err.status,
    };
  }
}

export function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = resolve(dir, "..");
  }
  return startDir;
}

export function resolveProjectRoot({ env, argv, serverDir, cwd }) {
  // 1. Env var takes highest precedence
  if (env.PLAN_FORGE_PROJECT) {
    return { resolved: resolve(env.PLAN_FORGE_PROJECT), source: "env" };
  }

  // 2. --project CLI flag
  const projectFlagIdx = argv.indexOf("--project");
  if (projectFlagIdx !== -1 && argv[projectFlagIdx + 1]) {
    return { resolved: resolve(argv[projectFlagIdx + 1]), source: "--project" };
  }

  // 3. Walk up from cwd, then serverDir, looking for STRONG markers first
  // (.forge.json, .git). Only fall back to package.json (a WEAK marker)
  // when neither strong marker is found anywhere up the tree.
  //
  // Issues #105 / #125: previously the marker check was a single tier
  // — [".forge.json", ".git", "package.json"] — which meant launching
  // from `pforge-mcp/` (which has its own package.json) anchored
  // PROJECT_DIR to `pforge-mcp/` instead of walking up to the actual
  // project containing `.git` / `.forge.json`. Splitting into tiers
  // ensures `.git` always wins over a sub-package's package.json.
  const STRONG_MARKERS = [".forge.json", ".git"];
  const WEAK_MARKERS = ["package.json"];
  const startDirs = [cwd, serverDir];

  // Pass 1: look for any strong marker in any ancestor of any start dir.
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

  // Pass 2: no strong marker found anywhere — fall back to nearest weak marker.
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

  // 4. Fallback to cwd
  return { resolved: cwd, source: "fallback-cwd", warning: "no .git/.forge.json/package.json marker found" };
}

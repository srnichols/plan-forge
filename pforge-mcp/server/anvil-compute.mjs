import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withAnvil } from "../anvil.mjs";
import { handleScan as temperingHandleScan } from "../tempering.mjs";
import { PROJECT_DIR } from "./state.mjs";
import { findProjectRoot, runPforge } from "./helpers.mjs";
import { resolveFrameworkVersion } from "../update-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// `codeHashSeed` defaults to `_SERVER_CODE_HASH` (FRAMEWORK_VERSION), so the
// cache is automatically invalidated on every release.
const _SERVER_CODE_HASH = resolveFrameworkVersion({ serverDir: resolve(__dirname, "..") }) || "server-unknown";

// ─── Anvil-wrapped compute helpers (Phase ANVIL Slice 5) ─────────────────────
//
// Each helper wraps a pure, read-only compute step in `withAnvil`, enabling
// Δ-only memoization. `deps` provides injectable overrides for unit tests.

/**
 * Runs `pforge sweep` wrapped in the Anvil cache.
 * @param {object} args - MCP tool arguments (`path`, etc.)
 * @param {object} [deps] - Injectable overrides: `_runPforge`, `_withAnvil`, `_codeHash`, `_cwd`
 * @returns {Promise<object>} Annotated sweep result with `anvil` metadata
 */
export async function _sweepAnvilCompute(args = {}, deps = {}) {
  const {
    _runPforge = runPforge,
    _withAnvil = withAnvil,
    _codeHash = _SERVER_CODE_HASH,
    _cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR),
  } = deps;

  const raw = await _withAnvil(
    () => {
      const r = _runPforge("sweep", _cwd);
      if (r.success) {
        const out = (r.output || "").trim();
        const hasMarkers = /FOUND \d+ deferred-work marker/i.test(out)
          || /FOUND \d+ \w+ marker/i.test(out);
        if (!hasMarkers) {
          r.output = out
            ? `${out}\n\n✓ No TODO/FIXME/HACK/stub/placeholder markers found in app code. Code is complete!`
            : "✓ No TODO/FIXME/HACK/stub/placeholder markers found in app code. Code is complete!";
          r.markersFound = 0;
        } else {
          const m = out.match(/FOUND (\d+) deferred-work marker/i);
          r.markersFound = m ? Number(m[1]) : null;
        }
      }
      return r;
    },
    { toolName: "forge_sweep", inputs: { cwd: _cwd }, codeHashSeed: _codeHash },
  );
  return raw;
}

/**
 * Runs `pforge analyze` (non-quorum) wrapped in the Anvil cache.
 * @param {object} args - MCP tool arguments (`plan`, `path`, etc.)
 * @param {object} [deps] - Injectable overrides: `_runPforge`, `_withAnvil`, `_codeHash`, `_cwd`
 * @returns {Promise<object>} Analyze result with `anvil` metadata
 */
export async function _analyzeAnvilCompute(args = {}, deps = {}) {
  const {
    _runPforge = runPforge,
    _withAnvil = withAnvil,
    _codeHash = _SERVER_CODE_HASH,
    _cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR),
  } = deps;

  return _withAnvil(
    () => _runPforge(`analyze "${args.plan}"`, _cwd),
    { toolName: "forge_analyze", inputs: { cwd: _cwd, plan: args.plan }, codeHashSeed: _codeHash },
  );
}

/**
 * Runs `forge_tempering_scan` wrapped in the Anvil cache.
 * @param {object} args - MCP tool arguments (`path`, `correlationId`, etc.)
 * @param {object} [deps] - Injectable overrides: `_handleScan`, `_withAnvil`, `_codeHash`, `_cwd`, `_hub`
 * @returns {Promise<object>} Scan result with `anvil` metadata
 */
export async function _temperingScanAnvilCompute(args = {}, deps = {}) {
  const {
    _handleScan = temperingHandleScan,
    _withAnvil = withAnvil,
    _codeHash = _SERVER_CODE_HASH,
    _cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR),
    _hub = null,
  } = deps;

  return _withAnvil(
    () => _handleScan({ projectDir: _cwd, hub: _hub, correlationId: args.correlationId || null }),
    {
      toolName: "forge_tempering_scan",
      inputs: { cwd: _cwd, correlationId: args.correlationId || null },
      codeHashSeed: _codeHash,
    },
  );
}

/**
 * Runs `forge_hotspot` (git log analysis) wrapped in the Anvil cache.
 * @param {object} args - MCP tool arguments (`path`, `top`, `since`)
 * @param {object} [deps] - Injectable overrides: `_execSync`, `_withAnvil`, `_codeHash`, `_cwd`
 * @returns {Promise<object>} Hotspot result with `anvil` metadata
 */
export async function _hotspotAnvilCompute(args = {}, deps = {}) {
  const {
    _execSync = execSync,
    _withAnvil = withAnvil,
    _codeHash = _SERVER_CODE_HASH,
    _cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR),
  } = deps;

  const top = Math.max(1, Math.min(100, args.top ?? 10));
  const since = args.since || "6 months ago";

  return _withAnvil(
    () => {
      const raw = _execSync(`git log --format=format: --name-only --since="${since}"`, {
        cwd: _cwd, encoding: "utf-8", timeout: 30_000,
      });
      const counts = {};
      for (const line of raw.split("\n")) {
        const f = line.trim();
        if (f && !f.startsWith(".forge/")) counts[f] = (counts[f] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const hotspots = sorted.map(([file, commits]) => ({ file, commits }));
      const payload = {
        generatedAt: new Date().toISOString(),
        since,
        totalFiles: hotspots.length,
        hotspots,
      };
      return { ...payload, hotspots: payload.hotspots.slice(0, top), showing: Math.min(top, payload.hotspots.length) };
    },
    { toolName: "forge_hotspot", inputs: { cwd: _cwd, since, top }, codeHashSeed: _codeHash },
  );
}

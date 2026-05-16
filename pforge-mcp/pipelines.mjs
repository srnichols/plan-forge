/**
 * Plan Forge — Pipelines Registry (Phase-ANVIL Slice 6)
 *
 * Enumerates the four standing capture pipelines and reports their
 * last-write timestamps plus Anvil hit rates.
 *
 * The four pipelines are hand-curated (Decision 11) — auto-discovery
 * is over-engineering for v1.
 *
 * @module pipelines
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { anvilStat } from "./anvil.mjs";

// ─── Standing pipeline registry ─────────────────────────────────────────────

/** @type {Array<{ id: string, label: string, artifact: string }>} */
const PIPELINES = [
  {
    id: "orchestrator-memory",
    label: "Orchestrator → Memory",
    artifact: ".forge/openbrain-queue.jsonl",
  },
  {
    id: "watcher-drift",
    label: "Watcher → Drift",
    artifact: ".forge/events.log",
  },
  {
    id: "hub-session-replay",
    label: "Hub → Session Replay",
    artifact: ".forge/runs",
  },
  {
    id: "crucible-thoughts",
    label: "Crucible → Thoughts",
    artifact: ".forge/crucible",
  },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List the four standing capture pipelines with artifact presence and
 * last-write timestamps (resolved from artifact mtime).
 *
 * @param {{ cwd?: string }} [deps]
 * @returns {Array<{ id: string, label: string, artifact: string, artifactExists: boolean, lastWriteAt: string|null }>}
 */
export function pipelinesList(deps = {}) {
  const cwd = deps.cwd || process.cwd();
  return PIPELINES.map((p) => {
    const artifactPath = resolve(cwd, p.artifact);
    const artifactExists = existsSync(artifactPath);
    let lastWriteAt = null;
    if (artifactExists) {
      try {
        const st = statSync(artifactPath);
        lastWriteAt = new Date(st.mtimeMs).toISOString();
      } catch {
        // best-effort — leave null
      }
    }
    return { id: p.id, label: p.label, artifact: p.artifact, artifactExists, lastWriteAt };
  });
}

/**
 * Return pipeline list + aggregated Anvil cache stats.
 *
 * @param {{ cwd?: string }} [deps]
 * @returns {{
 *   pipelines: ReturnType<typeof pipelinesList>,
 *   anvil: { entries: number, totalBytes: number, perTool: Record<string, { hits: number, misses: number, count: number }> }
 * }}
 */
export function pipelinesStats(deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const anvil = anvilStat({ cwd });
  return {
    pipelines: pipelinesList({ cwd }),
    anvil: {
      entries: anvil.entries,
      totalBytes: anvil.totalBytes,
      perTool: anvil.perTool,
    },
  };
}

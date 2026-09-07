import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MILLISECONDS_PER_DAY = 86_400_000;

function compactRunIndex(runsDir, prunedIds) {
  if (prunedIds.length === 0) return;
  const indexPath = resolve(runsDir, "index.jsonl");
  if (!existsSync(indexPath)) return;
  const pruned = new Set(prunedIds);
  try {
    const kept = readFileSync(indexPath, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => {
        try {
          const entry = JSON.parse(line);
          return !pruned.has(entry.dir) && !pruned.has(entry.runId);
        } catch {
          return true;
        }
      });
    writeFileSync(indexPath, kept.length ? kept.join("\n") + "\n" : "");
  } catch (error) {
    console.warn(`[run-retention] Could not compact the run index: ${error.message}`);
  }
}

/**
 * Prune by count and age, retaining the newest run unless a legacy caller opts out.
 * @param {string} [cwd]
 * @param {{ maxAgeDays?: number, maxRuns?: number, dryRun?: boolean, keepNewest?: boolean }} [opts]
 * @returns {{ kept: string[], pruned: string[], errors: Array<{runId: string, error: string}>, dryRun: boolean }}
 */
export function pruneForgeRuns(cwd = process.cwd(), opts = {}) {
  const { maxAgeDays = 30, maxRuns = 50, dryRun = false, keepNewest = true } = opts;
  const runsDir = resolve(cwd, ".forge", "runs");
  const result = { kept: [], pruned: [], errors: [], dryRun };
  if (!existsSync(runsDir)) return result;

  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    result.errors.push({ runId: "<runs-dir>", error: error.message });
    return result;
  }

  const cutoffMs = Date.now() - maxAgeDays * MILLISECONDS_PER_DAY;
  for (const [index, runId] of entries.entries()) {
    const runPath = resolve(runsDir, runId);
    let shouldPrune = index >= maxRuns;
    if (!shouldPrune) {
      try {
        shouldPrune = statSync(runPath).mtimeMs < cutoffMs;
      } catch (error) {
        result.errors.push({ runId, error: error.message });
        continue;
      }
    }
    if (index === 0 && keepNewest) shouldPrune = false;
    if (shouldPrune) {
      if (!dryRun) {
        try {
          rmSync(runPath, { recursive: true, force: true });
        } catch (error) {
          result.errors.push({ runId, error: error.message });
          continue;
        }
      }
      result.pruned.push(runId);
    } else {
      result.kept.push(runId);
    }
  }
  if (!dryRun) compactRunIndex(runsDir, result.pruned);
  return result;
}
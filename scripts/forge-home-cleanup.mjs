#!/usr/bin/env node
/**
 * forge-home-cleanup.mjs — Issue #203
 *
 * Moves ephemeral / orphaned files from .forge/ to .forge/archive/<YYYY-MM>/
 * and optionally deletes archive entries older than 90 days.
 *
 * Usage:
 *   node scripts/forge-home-cleanup.mjs [--dry-run] [--no-confirm] [--max-age-days=90]
 *
 * Flags:
 *   --dry-run        Print what would happen; don't move or delete anything.
 *   --no-confirm     Skip the interactive confirmation prompts.
 *   --max-age-days   Archive entries older than N days are eligible for deletion
 *                    (default: 90). Pass 0 to disable deletion entirely.
 *   --cwd            Project root to scan (default: process.cwd()).
 */

import { existsSync, readdirSync, statSync, mkdirSync, renameSync, rmSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { createInterface } from "readline";

// ─── Config ─────────────────────────────────────────────────────────────────

const EPHEMERAL_PATTERNS = [
  /^release-notes-v[\d.]+.*\.(md|txt)$/,
  /^chain-runner.*\.log$/,
  /^run-phase-.*\.log$/,
  /^harden-.*\.log$/,
  /^fm-.*\.(log|txt)$/,
  /^fm-experiment-/,
  /^fm-dashboard-.*\.log$/,
  /^mcp-hammer.*\.(log|err\.log)$/,
  /^mcp-val\..*\.log$/,
  /^sequencer-.*\.log$/,
  /^load-sim.*\.(log|json)$/,
  /^meta-bug-.*\.(md|txt|json)$/,
  /^gate-tmp\./,
  /^tmp[-_]/,
  /^tmp\//,
  /^served-app.*\.js$/,
  /\.pid$/,
  /^liveguard-broadcast\.log$/,
];

// Directories under .forge/ that are ephemeral-candidate (contents only — the
// dir itself is kept so live processes don't get confused).
const EPHEMERAL_DIRS_SCAN = [
  // intentionally empty — we only archive top-level files, not subdirs
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function isEphemeral(name) {
  return EPHEMERAL_PATTERNS.some((re) => re.test(name));
}

function yyyymm(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function parseArgs(argv) {
  const args = { dryRun: false, noConfirm: false, maxAgeDays: 90, cwd: process.cwd() };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-confirm") args.noConfirm = true;
    else if (arg.startsWith("--max-age-days=")) args.maxAgeDays = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--cwd=")) args.cwd = arg.split("=").slice(1).join("=");
  }
  return args;
}

function collectArchiveCandidates(forgeDir) {
  const candidates = [];
  for (const entry of readdirSync(forgeDir)) {
    if (entry.startsWith(".")) continue;
    const fullPath = join(forgeDir, entry);
    let st;
    try { st = statSync(fullPath); } catch { continue; }
    if (st.isDirectory()) continue;
    if (!isEphemeral(entry)) continue;
    candidates.push({ name: entry, fullPath, size: st.size, mtime: st.mtime });
  }
  return candidates;
}

function logArchiveCandidates(candidates) {
  console.log(`Found ${candidates.length} ephemeral file(s) to archive:\n`);
  for (const candidate of candidates) {
    const kb = (candidate.size / 1024).toFixed(1);
    console.log(`  ${candidate.name}  (${kb} KB, modified ${candidate.mtime.toISOString().slice(0, 10)})`);
  }
  console.log();
}

function buildArchiveSlot(forgeDir, now = new Date()) {
  return { now, slotName: yyyymm(now), slotPath: join(forgeDir, "archive", yyyymm(now)) };
}

function archiveCandidates(candidates, archiveSlot) {
  mkdirSync(archiveSlot.slotPath, { recursive: true });
  let moved = 0;
  for (const candidate of candidates) {
    const dest = join(archiveSlot.slotPath, candidate.name);
    try {
      renameSync(candidate.fullPath, dest);
      moved++;
    } catch (err) {
      console.warn(`  ⚠ Could not move ${candidate.name}: ${err.message}`);
    }
  }
  console.log(`✓ Moved ${moved} file(s) → .forge/archive/${archiveSlot.slotName}/\n`);
}

function collectOldArchiveSlots(archiveDir, cutoff) {
  const old = [];
  for (const slot of readdirSync(archiveDir)) {
    const slotPath = join(archiveDir, slot);
    let st;
    try { st = statSync(slotPath); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (st.mtime < cutoff) {
      const files = readdirSync(slotPath);
      old.push({ slot, slotPath, fileCount: files.length });
    }
  }
  return old;
}

function logOldArchiveSlots(old, maxAgeDays) {
  const totalFiles = old.reduce((n, slot) => n + slot.fileCount, 0);
  console.log(`Found ${old.length} archive slot(s) older than ${maxAgeDays} days (${totalFiles} file(s)):\n`);
  for (const slot of old) {
    console.log(`  .forge/archive/${slot.slot}/  (${slot.fileCount} files)`);
  }
  console.log();
}

function deleteArchiveSlots(old) {
  let deleted = 0;
  for (const slot of old) {
    try {
      rmSync(slot.slotPath, { recursive: true, force: true });
      deleted++;
    } catch (err) {
      console.warn(`  ⚠ Could not delete .forge/archive/${slot.slot}: ${err.message}`);
    }
  }
  console.log(`✓ Deleted ${deleted} archive slot(s).`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const forgeDir = resolve(args.cwd, ".forge");

  if (!existsSync(forgeDir)) {
    console.log(`✓ No .forge/ directory found at ${args.cwd} — nothing to clean.`);
    return;
  }

  if (args.dryRun) {
    console.log("⚡ DRY RUN — no files will be moved or deleted.\n");
  }

  // ── Phase 1: collect candidates ─────────────────────────────────────────
  const candidates = collectArchiveCandidates(forgeDir);

  if (candidates.length === 0) {
    console.log("✓ No ephemeral files found — .forge/ looks clean.");
  } else {
    logArchiveCandidates(candidates);
    const proceed =
      args.dryRun ||
      args.noConfirm ||
      (await confirm(`Move ${candidates.length} file(s) to .forge/archive/?`));

    if (proceed && !args.dryRun) {
      archiveCandidates(candidates, buildArchiveSlot(forgeDir));
    } else if (!proceed) {
      console.log("⏭  Skipped archiving.\n");
    }
  }

  // ── Phase 2: prune old archive entries ──────────────────────────────────
  if (args.maxAgeDays <= 0) {
    console.log("ℹ️  --max-age-days=0; skipping archive pruning.");
    return;
  }

  const archiveDir = join(forgeDir, "archive");
  if (!existsSync(archiveDir)) {
    console.log("✓ No archive directory — pruning skipped.");
    return;
  }

  const cutoff = new Date(Date.now() - args.maxAgeDays * 24 * 60 * 60 * 1000);
  const old = collectOldArchiveSlots(archiveDir, cutoff);

  if (old.length === 0) {
    console.log(`✓ No archive entries older than ${args.maxAgeDays} days.`);
    return;
  }

  logOldArchiveSlots(old, args.maxAgeDays);

  if (args.dryRun) {
    console.log("⚡ DRY RUN — would delete the above slots.");
    return;
  }

  const deleteProceed =
    args.noConfirm || (await confirm(`Permanently delete ${old.length} archive slot(s)?`));

  if (deleteProceed) {
    deleteArchiveSlots(old);
  } else {
    console.log("⏭  Skipped deletion.");
  }
}

main().catch((err) => {
  console.error("forge-home-cleanup failed:", err.message);
  process.exit(1);
});

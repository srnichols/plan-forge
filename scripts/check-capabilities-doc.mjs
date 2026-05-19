#!/usr/bin/env node
/**
 * check-capabilities-doc.mjs
 *
 * CI guard: runs generate-capabilities-doc.mjs in --check mode.
 * Exits 1 if docs/capabilities.md would change (tool count / table out of sync).
 *
 * Usage:
 *   node scripts/check-capabilities-doc.mjs
 *
 * Wired into the preCommit chain by pforge.ps1 / pforge.sh
 * (Phase-WORKER-GUARDRAILS pattern).
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const generator = resolve(HERE, "generate-capabilities-doc.mjs");

const result = spawnSync(process.execPath, [generator, "--check"], {
  stdio: "inherit",
  encoding: "utf-8",
});

process.exit(result.status ?? 1);

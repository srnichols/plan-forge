#!/usr/bin/env node
/**
 * pforge patterns list [--since <iso>]
 *
 * CLI entry point for pattern surfacing (Phase-38.6).
 * Runs all registered pattern detectors and prints results grouped by severity.
 */

import { runDetectors } from "../pforge-mcp/patterns/registry.mjs";

const args = process.argv.slice(2);
const sub = args[0] || "";

if (sub !== "list") {
  console.log("Usage: pforge patterns list [--since <iso>]");
  process.exit(sub === "--help" || sub === "help" ? 0 : 1);
}

let since = null;
const sinceIdx = args.indexOf("--since");
if (sinceIdx !== -1 && args[sinceIdx + 1]) {
  since = args[sinceIdx + 1];
}

try {
  let patterns = await runDetectors({ cwd: process.cwd() });

  if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      patterns = patterns.filter((p) => {
        if (!p.lastSeen) return true;
        return new Date(p.lastSeen) >= sinceDate;
      });
    }
  }

  if (patterns.length === 0) {
    console.log("No patterns detected.");
    process.exit(0);
  }

  // Group by severity (error first, then warning, then info)
  const order = ["error", "warning", "info"];
  const grouped = {};
  for (const p of patterns) {
    const sev = p.severity || "info";
    if (!grouped[sev]) grouped[sev] = [];
    grouped[sev].push(p);
  }

  for (const sev of order) {
    const items = grouped[sev];
    if (!items || items.length === 0) continue;
    const label = sev === "error" ? "🔴 ERROR" : sev === "warning" ? "🟡 WARNING" : "ℹ️  INFO";
    console.log(`\n${label}`);
    for (const p of items) {
      console.log(`  • ${p.title || p.id} (${p.occurrences ?? 0} occurrences across ${(p.plans || []).length} plans)`);
      if (p.detail) console.log(`    ${p.detail}`);
      if (p.remediation) console.log(`    → ${p.remediation}`);
    }
  }

  console.log(`\n${patterns.length} pattern(s) detected.`);
} catch (err) {
  console.error(`Pattern detection error: ${err.message}`);
  process.exit(1);
}

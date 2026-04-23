#!/usr/bin/env node
/**
 * Plan Forge — Daily Digest CLI (Phase-38.5 Slice 3)
 *
 * Generates a structured daily digest, writes it to `.forge/digests/<date>.json`,
 * prints Markdown to stdout, and optionally dispatches notifications via
 * configured `extensions/notify-*` adapters.
 *
 * Usage:
 *   node scripts/digest.mjs [--date <YYYY-MM-DD>] [--force] [--notify]
 *
 * @module scripts/digest
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ─── Arg parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { date: null, force: false, notify: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) {
      args.date = argv[++i];
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--notify") {
      args.notify = true;
    }
  }
  if (!args.date) {
    args.date = new Date().toISOString().slice(0, 10);
  }
  return args;
}

// ─── Severity helpers ─────────────────────────────────────────────────

const SEVERITY_ORDINAL = { info: 0, warn: 1, alert: 2 };

function severityMeetsThreshold(sectionSeverity, threshold) {
  const sev = SEVERITY_ORDINAL[sectionSeverity] ?? 0;
  const thr = SEVERITY_ORDINAL[threshold] ?? 0;
  return sev >= thr;
}

// ─── Notify config loader ─────────────────────────────────────────────

function loadNotifyConfig(projectDir) {
  const candidates = [
    resolve(projectDir, ".forge", "notify.config.json"),
    resolve(projectDir, "notify.config.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        console.warn(`[digest] Warning: failed to parse ${p}`);
      }
    }
  }
  return null;
}

// ─── Adapter loader ───────────────────────────────────────────────────

async function loadAdapter(projectDir, adapterName) {
  const extDir = resolve(projectDir, "extensions", `notify-${adapterName}`);
  const indexPath = resolve(extDir, "index.mjs");
  if (!existsSync(indexPath)) return null;
  try {
    const mod = await import(pathToFileURL(indexPath).href);
    return mod.adapter || mod.default?.adapter || null;
  } catch {
    return null;
  }
}

// ─── Notification dispatch ────────────────────────────────────────────

async function dispatchNotifications(digest, projectDir) {
  const config = loadNotifyConfig(projectDir);
  if (!config || !Array.isArray(config.channels) || config.channels.length === 0) {
    console.warn("[digest] No notification channels configured — skipping. Create .forge/notify.config.json to enable.");
    return;
  }

  for (const channel of config.channels) {
    const adapterName = channel.adapter;
    const minSeverity = channel.minSeverity || "warn";

    const sectionsToSend = digest.sections.filter(
      (s) => s.items.length > 0 && severityMeetsThreshold(s.severity, minSeverity)
    );

    if (sectionsToSend.length === 0) continue;

    const adapter = await loadAdapter(projectDir, adapterName);
    if (!adapter) {
      console.warn(`[digest] Adapter '${adapterName}' not found at extensions/notify-${adapterName}/index.mjs — skipping.`);
      continue;
    }

    const validation = adapter.validate(channel.config || {});
    if (!validation.ok) {
      console.warn(`[digest] Adapter '${adapterName}' config invalid (${validation.reason}) — skipping.`);
      continue;
    }

    const message = sectionsToSend
      .map((s) => `${s.title} [${s.severity}]: ${s.items.length} item(s)`)
      .join("\n");

    try {
      const result = await adapter.send({
        event: {
          type: "digest",
          data: { sections: sectionsToSend, date: digest.generatedAt },
          severity: sectionsToSend.some((s) => s.severity === "alert") ? "high" : "medium",
        },
        route: adapterName,
        formattedMessage: `Daily Digest — ${sectionsToSend.length} section(s) need attention\n\n${message}`,
        correlationId: `digest-${digest.generatedAt?.slice(0, 10) || "unknown"}`,
        config: channel.config || {},
      });
      if (result?.ok) {
        console.log(`[digest] Notified via ${adapterName} ✓`);
      } else {
        console.warn(`[digest] ${adapterName} send failed: ${result?.errorCode || result?.error || "unknown"}`);
      }
    } catch (err) {
      if (err.code === "ERR_NOT_IMPLEMENTED") {
        console.warn(`[digest] Adapter '${adapterName}' is a stub (not installed) — skipping.`);
      } else {
        console.warn(`[digest] ${adapterName} error: ${err.message}`);
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const projectDir = REPO_ROOT;

  // Compute baseline date (7 days before target)
  const targetDate = new Date(args.date + "T00:00:00Z");
  const baselineDate = new Date(targetDate);
  baselineDate.setDate(baselineDate.getDate() - 7);
  const baselineDateStr = baselineDate.toISOString().slice(0, 10);

  // Idempotency guard
  const digestDir = resolve(projectDir, ".forge", "digests");
  const digestPath = resolve(digestDir, `${args.date}.json`);

  if (existsSync(digestPath) && !args.force) {
    console.log("Digest already exists — use --force to regenerate.");
    process.exit(0);
  }

  // Import aggregator and renderer
  const { buildDigest } = await import(pathToFileURL(resolve(projectDir, "pforge-mcp", "digest", "aggregator.mjs")).href);
  const { renderMarkdown, renderJson } = await import(pathToFileURL(resolve(projectDir, "pforge-mcp", "digest", "render.mjs")).href);

  // Build digest
  const digest = buildDigest({
    projectDir,
    date: args.date,
    baselineDate: baselineDateStr,
  });

  // Render
  const markdown = renderMarkdown(digest);
  const json = renderJson(digest);

  // Write JSON to .forge/digests/<date>.json
  mkdirSync(digestDir, { recursive: true });
  writeFileSync(digestPath, JSON.stringify(json, null, 2), "utf-8");

  // Print Markdown to stdout
  console.log(markdown);
  console.log(`Digest written to ${digestPath}`);

  // Notify if requested
  if (args.notify) {
    await dispatchNotifications(digest, projectDir);
  }
}

main().catch((err) => {
  console.error(`[digest] Fatal: ${err.message}`);
  process.exit(1);
});

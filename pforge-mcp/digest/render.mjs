/**
 * Plan Forge — Daily Digest Renderer (Phase-38.5 Slice 2)
 *
 * Converts a digest object (from aggregator.mjs) into human-readable
 * Markdown or a stable machine-readable JSON format.
 *
 * @module digest/render
 */

// ─── Severity badges ─────────────────────────────────────────────────

const SEVERITY_BADGE = {
  info:  "🟢 info",
  warn:  "🟡 warn",
  alert: "🔴 alert",
};

function badge(severity) {
  return SEVERITY_BADGE[severity] || severity;
}

// ─── Markdown item renderers (per section id) ────────────────────────

const ITEM_RENDERERS = {
  "probe-deltas"(item) {
    return `- **${item.lane}**: ${item.currentRate}% → was ${item.baselineRate}% (Δ ${item.delta}%)`;
  },
  "aging-bugs"(item) {
    return `- **${item.id}** — ${item.title} (${item.ageDays} days, severity: ${item.severity})`;
  },
  "stalled-phases"(item) {
    return `- **${item.name}** — started ${item.startDate}, stalled ${item.ageDays} days`;
  },
  "drift-trend"(item) {
    return `- Score **${item.score}** (threshold ${item.threshold}) — trend: ${item.trend}, violations: ${item.violationCount}`;
  },
  "cost-anomaly"(item) {
    return `- **$${item.latestCost}** on ${item.date} — ${item.multiplier}× the 7-day avg ($${item.averageCost}), plan: ${item.plan}`;
  },
};

function renderItem(sectionId, item) {
  const renderer = ITEM_RENDERERS[sectionId];
  return renderer ? renderer(item) : `- ${JSON.stringify(item)}`;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Render a digest as human-readable Markdown.
 *
 * @param {{ sections: Array<{id: string, title: string, severity: string, items: any[]}>, generatedAt: string }} digest
 * @returns {string} Markdown string
 */
export function renderMarkdown(digest) {
  const lines = ["# Daily Digest", ""];

  let allGreen = true;

  for (const section of digest.sections) {
    lines.push(`## ${section.title}  ${badge(section.severity)}`);
    lines.push("");

    if (section.items.length === 0) {
      lines.push("No issues detected.");
    } else {
      allGreen = false;
      for (const item of section.items) {
        lines.push(renderItem(section.id, item));
      }
    }
    lines.push("");
  }

  if (allGreen) {
    lines.push("## Summary");
    lines.push("");
    lines.push("✅ All green — no significant deltas detected.");
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated at ${digest.generatedAt} (UTC)*`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Render a digest as a stable machine-readable JSON object.
 *
 * @param {{ sections: Array<{id: string, title: string, severity: string, items: any[]}>, generatedAt: string }} digest
 * @returns {{ version: string, date: string, sections: Array<{id: string, title: string, severity: string, items: any[]}> }}
 */
export function renderJson(digest) {
  const date = digest.generatedAt
    ? digest.generatedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return {
    version: "1",
    date,
    sections: digest.sections.map((s) => ({
      id: s.id,
      title: s.title,
      severity: s.severity,
      items: s.items,
    })),
  };
}

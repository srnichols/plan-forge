/**
 * Forge-Master Hammer Harness Reporter (Phase-37.2, Slice 2).
 *
 * Renders structured JSON records into a detailed Markdown report with:
 *   - Per-prompt table (prompt_id, lane_expected, lane_actual, tools_expected,
 *     tools_called, tool_success_rate, reply_len, cost_usd, tier, verdict)
 *   - Tier Comparison section (when --tier=all records present)
 *   - Cost summary footer
 *
 * Usage:
 *   import { render } from './reporter.mjs';
 *   const md = render(records, { isoStamp, scenarioName });
 *
 * @module hammer-fm/reporter
 */

// ── Helpers ────────────────────────────────────────────────────────

function _extractLane(record) {
  return record.events?.find((e) => e.event === "classification")?.data?.lane ?? "?";
}

function _extractTools(record) {
  return record.events
    ?.filter((e) => e.event === "tool-call")
    .map((e) => e.data?.name || e.data?.tool || "?")
    .filter(Boolean) ?? [];
}

function _extractReplyLen(record) {
  const content = record.events?.find((e) => e.event === "reply")?.data?.content ?? "";
  return content.length;
}

function _extractCostUsd(record) {
  const done = record.events?.find((e) => e.event === "done");
  return done?.data?.costUSD ?? null;
}

function _toolSuccessRateStr(record) {
  const toolEvts = record.events?.filter((e) => e.event === "tool-call") ?? [];
  if (toolEvts.length === 0) return "n/a";
  const FAILURE_STRINGS = ["unknown tool", "requires async dispatch", '"success":false'];
  const ok = toolEvts.filter((e) => {
    const rs = e.data?.resultSummary;
    if (rs == null) return true;
    if (typeof rs === "string") {
      const lower = rs.toLowerCase();
      return !FAILURE_STRINGS.some((f) => lower.includes(f.toLowerCase()));
    }
    if (typeof rs === "object") return rs.success !== false;
    return true;
  });
  return `${ok.length}/${toolEvts.length}`;
}

function _verdictIcon(verdict) {
  if (verdict === "pass") return "✅";
  if (verdict === "error") return "🔥";
  return "❌";
}

// ── Per-prompt table row ───────────────────────────────────────────

function _promptRow(record, expectedLane, expectedTools) {
  const lane = _extractLane(record);
  const tools = _extractTools(record);
  const replyLen = _extractReplyLen(record);
  const costRaw = _extractCostUsd(record);
  const cost = costRaw != null ? `$${costRaw.toFixed(4)}` : "—";
  const tier = record.tier ?? "keyword-only";
  const icon = _verdictIcon(record.verdict);
  const toolStr = tools.join(", ") || "—";
  const expToolStr = (expectedTools ?? []).join(", ") || "—";
  const expLaneStr = expectedLane ?? "—";
  const succRate = _toolSuccessRateStr(record);

  return `| ${record.promptId} | ${expLaneStr} | ${lane} | ${expToolStr} | ${toolStr} | ${succRate} | ${replyLen} | ${cost} | ${tier} | ${record.verdict} ${icon} |`;
}

// ── Tier comparison section ────────────────────────────────────────

function _tierComparison(records) {
  const tiers = [...new Set(records.map((r) => r.tier).filter(Boolean))];
  if (tiers.length < 2) return "";

  const promptIds = [...new Set(records.map((r) => r.promptId))];
  const rows = [];

  for (const promptId of promptIds) {
    const byTier = {};
    for (const t of tiers) {
      byTier[t] = records.find((r) => r.promptId === promptId && r.tier === t);
    }

    const laneByTier = tiers.map((t) => byTier[t] ? _extractLane(byTier[t]) : "—");
    const toolsByTier = tiers.map((t) => byTier[t] ? _extractTools(byTier[t]).join("+") || "—" : "—");

    const allLanes = laneByTier.filter((l) => l !== "—");
    const sameLane = allLanes.length > 0 && allLanes.every((l) => l === allLanes[0]) ? "✅" : "❌";

    const allTools = toolsByTier.filter((t) => t !== "—");
    const sameToolSet = allTools.length > 0 && allTools.every((t) => t === allTools[0]) ? "✅" : "❌";

    const keywordRecord = byTier["keyword-only"];
    const highRecord = byTier["high"];
    let replyDiff = "—";
    if (keywordRecord && highRecord) {
      const kwLen = _extractReplyLen(keywordRecord);
      const highLen = _extractReplyLen(highRecord);
      replyDiff = String(Math.abs(highLen - kwLen));
    }

    const laneCols = tiers.map((t) => laneByTier[tiers.indexOf(t)]).join(" | ");
    rows.push(`| ${promptId} | ${laneCols} | ${sameLane} | ${sameToolSet} | ${replyDiff} |`);
  }

  const tierHeaders = tiers.map((t) => `${t}_lane`).join(" | ");
  const tierDashes = tiers.map(() => "---").join(" | ");

  return [
    `## Tier Comparison`,
    ``,
    `Acceptance: ≥80% of prompts must have \`sameLane=✅\` across all tiers.`,
    ``,
    `| prompt_id | ${tierHeaders} | sameLane? | sameToolSet? | replyDiffChars_kw_vs_high |`,
    `|-----------|${tierDashes}|-----------|--------------|--------------------------|`,
    ...rows,
    ``,
  ].join("\n");
}

// ── Cost summary footer ────────────────────────────────────────────

function _costSummary(records) {
  const doneEvents = records.flatMap(
    (r) => r.events?.filter((e) => e.event === "done") ?? [],
  );
  const totalIn = doneEvents.reduce((s, e) => s + (e.data?.tokensIn ?? 0), 0);
  const totalOut = doneEvents.reduce((s, e) => s + (e.data?.tokensOut ?? 0), 0);
  const totalCost = doneEvents.reduce((s, e) => s + (e.data?.costUSD ?? 0), 0);

  const tierBreakdown = {};
  for (const r of records) {
    const t = r.tier ?? "unknown";
    if (!tierBreakdown[t]) tierBreakdown[t] = { tokensIn: 0, tokensOut: 0, costUSD: 0, count: 0 };
    const done = r.events?.find((e) => e.event === "done");
    tierBreakdown[t].tokensIn += done?.data?.tokensIn ?? 0;
    tierBreakdown[t].tokensOut += done?.data?.tokensOut ?? 0;
    tierBreakdown[t].costUSD += done?.data?.costUSD ?? 0;
    tierBreakdown[t].count++;
  }

  const tierRows = Object.entries(tierBreakdown).map(
    ([t, d]) => `| ${t} | ${d.count} | ${d.tokensIn} | ${d.tokensOut} | $${d.costUSD.toFixed(4)} |`,
  );

  return [
    `## Cost Summary`,
    ``,
    `**Total**: ${totalIn} tokens in / ${totalOut} tokens out / $${totalCost.toFixed(4)}`,
    ``,
    `| Tier | Prompts | Tokens In | Tokens Out | Cost USD |`,
    `|------|---------|-----------|-----------|---------|`,
    ...tierRows,
    ``,
  ].join("\n");
}

// ── Main render function ───────────────────────────────────────────

/**
 * Render hammer-fm records into a Markdown report string.
 *
 * @param {Array<object>} records - Scored prompt records from main()
 * @param {object} opts
 * @param {string} opts.isoStamp - ISO timestamp for report header
 * @param {string} [opts.scenarioName] - Scenario name
 * @param {object} [opts.scenario] - Full scenario object (for expectedLane/Tools lookups)
 * @returns {string} Markdown report
 */
export function render(records, { isoStamp, scenarioName, scenario } = {}) {
  const passed = records.filter((r) => r.verdict === "pass").length;
  const failed = records.filter((r) => r.verdict === "fail").length;
  const errors = records.filter((r) => r.verdict === "error").length;
  const total = records.length;

  // Build prompt map from scenario for expected values
  const promptMap = {};
  for (const p of scenario?.prompts ?? []) {
    promptMap[p.id] = p;
  }

  const tableRows = records.map((r) => {
    const src = promptMap[r.promptId] ?? {};
    return _promptRow(r, src.expectedLane, src.expectedTools);
  });

  const failDetails = records
    .filter((r) => r.verdict !== "pass")
    .map((r) => {
      const failedScores = r.scores?.filter((s) => !s.pass) ?? [];
      const lines = [
        `### ${_verdictIcon(r.verdict)} ${r.promptId} (${r.verdict})`,
        ``,
        `- **Duration**: ${r.durationMs ?? "?"}ms`,
        `- **Closed reason**: ${r.closedReason ?? "?"}`,
        r.error ? `- **Error**: \`${r.error}\`` : null,
        ...failedScores.map((s) => `- **${s.scorer}**: ${s.reason}`),
        ``,
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");

  const tierSection = _tierComparison(records);
  const costSection = _costSummary(records);

  return [
    `# Forge-Master Hammer Report — ${isoStamp}`,
    ``,
    scenarioName ? `**Scenario**: \`${scenarioName}\`` : null,
    `**Results**: ${passed}/${total} passed (${failed} failed, ${errors} errors)`,
    ``,
    `## Per-Prompt Results`,
    ``,
    `| prompt_id | lane_expected | lane_actual | tools_expected | tools_called | tool_success_rate | reply_len | cost_usd | tier | verdict |`,
    `|-----------|--------------|------------|---------------|-------------|------------------|-----------|---------|------|---------|`,
    ...tableRows,
    ``,
    failDetails ? `## Failures\n\n${failDetails}` : null,
    tierSection || null,
    costSection,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

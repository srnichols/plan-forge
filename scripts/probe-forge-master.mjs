// Forge-Master validation probe runner.
// Usage: node scripts/probe-forge-master.mjs [--host=127.0.0.1:3100] [--timeout=60]
//
// SSE events emitted by /api/forge-master/chat/:id/stream (per http-routes.mjs):
//   start          { sessionId }
//   classification { lane, confidence, reason, suggestedTools }
//   reply          { content, sessionId }
//   tool-call      <per-call record>
//   done           { sessionId, tokensIn, tokensOut }
//   error          { error }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [[m[1], m[2] || "true"]] : [];
  }),
);
const HOST = argv.host || "127.0.0.1:3100";
const TIMEOUT_SEC = Number(argv.timeout || 60);
const BASE = `http://${HOST}`;

const PROBES_PATH = resolve(".forge/validation/probes.json");
if (!existsSync(PROBES_PATH)) {
  console.error(`missing ${PROBES_PATH}`);
  process.exit(2);
}
const probes = JSON.parse(readFileSync(PROBES_PATH, "utf-8"));

const outDir = resolve(".forge/validation");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = join(outDir, `results-${stamp}.json`);
const mdPath = join(outDir, `results-${stamp}.md`);

console.log(`[probe] ${probes.length} probes → ${BASE}`);
console.log(`[probe] results → ${mdPath}`);
console.log("");

try {
  const r = await fetch(`${BASE}/api/forge-master/capabilities`);
  if (!r.ok) { console.error(`[probe] server responded ${r.status}`); process.exit(3); }
  console.log(`[probe] server reachable (capabilities ${r.status})`);
} catch (err) {
  console.error(`[probe] cannot reach ${BASE}: ${err.message}`);
  console.error(`[probe] start with: node pforge-mcp/server.mjs`);
  process.exit(3);
}

const results = [];

for (const [i, probe] of probes.entries()) {
  const n = i + 1;
  process.stdout.write(
    `[${n}/${probes.length}] (${probe.lane}) "${probe.message.slice(0, 60).replace(/\n/g, " ")}..." `,
  );
  const start = Date.now();

  let sessionId, streamUrl;
  try {
    const init = await fetch(`${BASE}/api/forge-master/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: probe.message }),
    });
    const body = await init.json();
    sessionId = body.sessionId;
    streamUrl = body.streamUrl;
    if (!sessionId || !streamUrl) throw new Error(`bad init: ${JSON.stringify(body)}`);
  } catch (err) {
    console.log(`FAIL (init: ${err.message})`);
    results.push({ probe, error: `init: ${err.message}`, durationMs: Date.now() - start });
    continue;
  }

  const events = [];
  let reply = "";
  let toolCalls = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let errorEvent = null;
  let classificationData = null;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_SEC * 1000);
    const resp = await fetch(`${BASE}${streamUrl}`, { signal: ctrl.signal });
    if (!resp.ok || !resp.body) throw new Error(`stream ${resp.status}`);

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = parseSseFrame(frame);
        if (!evt) continue;
        events.push(evt);
        switch (evt.event) {
          case "classification":
            classificationData = { lane: evt.data?.lane, confidence: evt.data?.confidence };
            break;
          case "reply":
            reply = evt.data?.content ?? reply;
            break;
          case "tool-call":
            toolCalls.push(evt.data);
            break;
          case "done":
            tokensIn = evt.data?.tokensIn ?? 0;
            tokensOut = evt.data?.tokensOut ?? 0;
            done = true;
            break;
          case "error":
            errorEvent = evt.data;
            done = true;
            break;
        }
        if (done) break;
      }
    }
    clearTimeout(timeout);
  } catch (err) {
    console.log(`FAIL (stream: ${err.message})`);
    results.push({
      probe, sessionId, error: `stream: ${err.message}`, events,
      durationMs: Date.now() - start,
    });
    continue;
  }

  const durationMs = Date.now() - start;
  const toolNames = toolCalls.map((t) => t?.name || t?.tool || "?");
  const status = errorEvent ? "🔥" : reply ? "OK" : "EMPTY";
  const laneStr = classificationData?.lane ? `lane=${classificationData.lane}` : "lane=?";
  const confStr = classificationData?.confidence != null
    ? `conf=${classificationData.confidence.toFixed(2)}`
    : "conf=?";
  console.log(
    `${status} ${laneStr} ${confStr} tokens=${tokensIn}/${tokensOut} tools=${toolCalls.length}${toolNames.length ? `(${toolNames.join(",")})` : ""} dur=${durationMs}ms${errorEvent ? ` ERR:${errorEvent.error || JSON.stringify(errorEvent).slice(0, 60)}` : ""}`,
  );

  results.push({
    probe,
    sessionId,
    durationMs,
    reply,
    classification: classificationData,
    toolCalls: toolCalls.map((t) => ({
      name: t?.name || t?.tool || "?",
      args: t?.arguments || t?.args,
      result: typeof t?.result === "string" ? t.result.slice(0, 300) : t?.result,
    })),
    tokensIn,
    tokensOut,
    errorEvent,
    eventCount: events.length,
    eventNames: events.map((e) => e.event),
  });
}

writeFileSync(jsonPath, JSON.stringify(results, null, 2));
writeFileSync(mdPath, renderMarkdown(results));

console.log("");
console.log(`[probe] done — ${results.length} probes`);
console.log(`[probe] results → ${mdPath}`);

const ok = results.filter((r) => !r.error && !r.errorEvent && r.reply).length;
const errs = results.filter((r) => r.error || r.errorEvent).length;
const empties = results.filter((r) => !r.error && !r.errorEvent && !r.reply).length;
const totalIn = results.reduce((s, r) => s + (r.tokensIn || 0), 0);
const totalOut = results.reduce((s, r) => s + (r.tokensOut || 0), 0);
console.log(
  `[probe] replies: ${ok}/${results.length}, empty: ${empties}, errors: ${errs}, tokens: ${totalIn} in / ${totalOut} out`,
);

// ─── helpers ──────────────────────────────────────────────────────

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { event, data };
}

function renderMarkdown(rs) {
  const now = new Date().toISOString();
  const byLane = {};
  for (const r of rs) {
    const l = r.probe.lane;
    byLane[l] = byLane[l] || { total: 0, ok: 0, empty: 0, errors: 0 };
    byLane[l].total++;
    if (r.error || r.errorEvent) byLane[l].errors++;
    else if (r.reply) byLane[l].ok++;
    else byLane[l].empty++;
  }
  const summaryRows = Object.entries(byLane)
    .map(([l, s]) => `| ${l} | ${s.ok}/${s.total} | ${s.empty} | ${s.errors} |`)
    .join("\n");

  // ── Classification match table ───────────────────────────────────
  // Only count probes that have a definite expected lane (not "any")
  const classRows = [];
  const classAgg = {};
  for (const r of rs) {
    const expected = r.probe.lane;
    const got = r.classification?.lane ?? "?";
    const match = expected === "any" ? null : got === expected;
    if (expected !== "any") {
      classAgg[expected] = classAgg[expected] || { total: 0, matched: 0 };
      classAgg[expected].total++;
      if (match) classAgg[expected].matched++;
    }
    const matchIcon = match === null ? "—" : match ? "✅" : "❌";
    const conf = r.classification?.confidence != null
      ? r.classification.confidence.toFixed(2)
      : "?";
    classRows.push(`| ${r.probe.id} | ${expected} | ${got} | ${conf} | ${matchIcon} |`);
  }
  const classAggRows = Object.entries(classAgg)
    .map(([l, a]) => `| ${l} | ${a.matched}/${a.total} |`)
    .join("\n");
  const totalClassifiable = Object.values(classAgg).reduce((s, a) => s + a.total, 0);
  const totalMatched = Object.values(classAgg).reduce((s, a) => s + a.matched, 0);

  const probeRows = rs.map((r, i) => {
    const status = r.error || r.errorEvent ? "FAIL" : r.reply ? "OK" : "EMPTY";
    const toolList = (r.toolCalls || []).map((t) => t.name).join(", ") || "—";
    const classGot = r.classification?.lane ?? "?";
    const classConf = r.classification?.confidence != null
      ? r.classification.confidence.toFixed(2) : "?";
    const classMatch = r.probe.lane === "any"
      ? "—"
      : classGot === r.probe.lane ? "✅" : "❌";
    return [
      `### ${i + 1}. [${status}] ${r.probe.id} — expected lane \`${r.probe.lane}\``,
      ``,
      `**Prompt**: ${r.probe.message.replace(/\n/g, " ").slice(0, 300)}`,
      ``,
      `- **Duration**: ${r.durationMs} ms`,
      `- **Tokens**: ${r.tokensIn || 0} in → ${r.tokensOut || 0} out`,
      `- **Classification**: lane=\`${classGot}\` conf=${classConf} ${classMatch}`,
      `- **Tool calls**: ${toolList}`,
      `- **SSE events**: ${(r.eventNames || []).join(" → ") || "—"}`,
      r.error ? `- **Init error**: \`${r.error}\`` : "",
      r.errorEvent ? `- **Stream error**: \`${JSON.stringify(r.errorEvent).slice(0, 300)}\`` : "",
      r.probe.expectedTools?.length
        ? `- **Expected tools**: ${r.probe.expectedTools.join(", ")}` : "",
      r.probe.notes ? `- **Notes**: ${r.probe.notes}` : "",
      ``,
      `**Reply** (first 2000 chars):`,
      ``,
      "```",
      (r.reply || "(empty)").slice(0, 2000),
      "```",
      ``,
      r.toolCalls?.length
        ? `**Tool-call details**:\n\n\`\`\`json\n${JSON.stringify(r.toolCalls, null, 2).slice(0, 1500)}\n\`\`\`\n`
        : "",
      `---`,
      ``,
    ].filter(Boolean).join("\n");
  }).join("\n");

  return [
    `# Forge-Master Validation — ${now}`,
    ``,
    `Probed \`${BASE}\` with ${rs.length} prompts.`,
    ``,
    `## Harness caveats`,
    ``,
    `- **The /stream route wires a stub dispatcher** (\`dispatcher: async () => ({})\`). Tool calls are requested by the model but execute as no-ops.`,
    `- Use this report for **reply-quality + classification + request-level tool selection** review. For full tool-chain validation, call \`runTurn\` directly in a node harness with a real dispatcher.`,
    ``,
    `## Classification Match`,
    ``,
    `**Overall**: ${totalMatched}/${totalClassifiable} classifiable probes matched expected lane.`,
    ``,
    `### Per-Lane Accuracy`,
    ``,
    `| Expected Lane | Matched |`,
    `|---------------|---------|`,
    classAggRows,
    ``,
    `### Per-Probe Classification`,
    ``,
    `| Probe ID | Expected | Got | Confidence | Match |`,
    `|----------|----------|-----|-----------|-------|`,
    ...classRows,
    ``,
    `## Summary by Expected Lane`,
    ``,
    `| Expected Lane | Got Reply | Empty | Errors |`,
    `|---------------|-----------|-------|--------|`,
    summaryRows,
    ``,
    `## Probe Results`,
    ``,
    probeRows,
  ].join("\n");
}

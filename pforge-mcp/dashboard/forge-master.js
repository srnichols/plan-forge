/**
 * Forge-Master Studio — Dashboard Tab Controller (Phase-29).
 *
 * Drives the #tab-forge-master section in the main Plan Forge dashboard.
 * Talks to /api/forge-master/* routes registered by forge-master-routes.mjs.
 */

// ─── State ────────────────────────────────────────────────────────────

// Persistent file-based session ID — one per browser tab, survives page reload.
// Uses sessionStorage so different tabs get different IDs.
const FM_TAB_SESSION_ID = (() => {
  try {
    let id = sessionStorage.getItem("fm-session");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("fm-session", id);
    }
    return id;
  } catch {
    // Fallback for environments without sessionStorage (tests, non-browser)
    return crypto.randomUUID ? crypto.randomUUID() : null;
  }
})();

const fm = {
  sessionId: null,
  catalog: null,
  activeCategory: null,
  gallerySearch: "",
  dialTier: null,
  quorumAdvisory: "off",
  quorumEstimateBubbleId: null,
  chatCost: { usd: 0, tokensIn: 0, tokensOut: 0 },
};

// ─── Dial config ──────────────────────────────────────────────────────

const FM_DIAL_TIERS = [
  { tier: "low",    label: "Fast" },
  { tier: "medium", label: "Balanced" },
  { tier: "high",   label: "Deep" },
];

const FM_DIAL_TOOLTIP = "Powered by frontier models via your GitHub Copilot subscription. Higher tiers may hit rate limits sooner.";

// ─── Quorum advisory picker ──────────────────────────────────────────

const FM_QUORUM_MODES = [
  { mode: "off",    label: "Off" },
  { mode: "auto",   label: "Auto" },
  { mode: "always", label: "Always" },
];

// Historical note: globals kept for cross-tab inline handlers.
window.forgeMasterOnTabActivate = () => {
  try {
    if (!fm.catalog) forgeMasterInit();
    else forgeMasterLoadPrefs();
  } catch (err) {
    const list = document.getElementById("fm-gallery-list");
    if (list) list.innerHTML = `<p class="text-xs text-red-400">Forge-Master init failed: ${err?.message || err}</p>`;
    // eslint-disable-next-line no-console
    console.error("[forge-master] init error", err);
  }
};
window.forgeMasterNewChat = (...args) => forgeMasterNewChat(...args);
window.forgeMasterSend = (...args) => forgeMasterSend(...args);
window.forgeMasterFilterGallery = (...args) => forgeMasterFilterGallery(...args);
window.forgeMasterRenderRelatedConversations = (...args) => forgeMasterRenderRelatedConversations(...args);
window.forgeMasterRenderCostMeter = () => forgeMasterRenderCostMeter();
/** Test helper — sets chat cost state then re-renders the meter. */
window._forgeMasterSetChatCost = (usd, tokensIn, tokensOut) => {
  fm.chatCost = { usd, tokensIn, tokensOut };
  forgeMasterRenderCostMeter();
};

// ─── Init ─────────────────────────────────────────────────────────────

async function forgeMasterInit() {
  try {
    const res = await fetch("/api/forge-master/prompts");
    if (!res.ok) throw new Error("prompts API unavailable");
    fm.catalog = await res.json();
    forgeMasterRenderGallery();
    const list = document.getElementById("fm-gallery-list");
    if (list) {
      list.addEventListener("click", e => {
        const btn = e.target.closest("button[data-prompt-id]");
        if (btn) forgeMasterPickPrompt(btn.dataset.promptId);
      });
    }
    await forgeMasterLoadPrefs();
    forgeMasterLoadDigest();
    forgeMasterLoadPatterns();
    const root = document.getElementById("forge-master-root");
    if (root) {
      root.addEventListener("click", e => {
        const tierBtn = e.target.closest("button[data-tier]");
        if (tierBtn) { forgeMasterDialClick(tierBtn.dataset.tier); return; }
        const quorumBtn = e.target.closest("button[data-quorum]");
        if (quorumBtn) forgeMasterQuorumClick(quorumBtn.dataset.quorum);
      });
    }
  } catch (err) {
    const list = document.getElementById("fm-gallery-list");
    if (list) list.innerHTML = `<p class="text-xs text-red-400">Forge-Master Studio API unavailable: ${err.message}</p>`;
  }
}

// ─── Gallery ──────────────────────────────────────────────────────────

function forgeMasterRenderGallery() {
  const list = document.getElementById("fm-gallery-list");
  if (!list || !fm.catalog) return;
  const q = fm.gallerySearch.toLowerCase();
  let html = "";
  for (const cat of fm.catalog.categories) {
    const prompts = cat.prompts.filter(p =>
      !q || p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
    if (!prompts.length) continue;
    html += `<div class="mb-3">
      <h4 class="text-xs font-semibold text-cyan-400 mb-1">${cat.label}</h4>`;
    for (const p of prompts) {
      html += `<button
        class="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-gray-700 text-gray-300 mb-0.5 block"
        data-prompt-id="${p.id}"
        title="${p.description}">
        ${p.title}
      </button>`;
    }
    html += "</div>";
  }
  list.innerHTML = html || '<p class="text-xs text-gray-500">No matching prompts.</p>';
}

function forgeMasterFilterGallery(q) {
  fm.gallerySearch = q;
  forgeMasterRenderGallery();
}

function forgeMasterPickPrompt(id) {
  if (!fm.catalog) return;
  for (const cat of fm.catalog.categories) {
    const p = cat.prompts.find(x => x.id === id);
    if (p) {
      const composer = document.getElementById("fm-composer");
      if (composer) { composer.value = p.template; composer.focus(); }
      return;
    }
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────

function forgeMasterNewChat() {
  fm.sessionId = null;
  fm.chatCost = { usd: 0, tokensIn: 0, tokensOut: 0 };
  forgeMasterRenderCostMeter();
  const stream = document.getElementById("fm-chat-stream");
  const trace = document.getElementById("fm-tool-trace");
  if (stream) stream.innerHTML = '<p class="text-xs text-gray-500 text-center mt-8">New chat started. Type a message or pick a prompt.</p>';
  if (trace) trace.innerHTML = "<p>No tool calls yet.</p>";
}

async function forgeMasterSend() {
  const composer = document.getElementById("fm-composer");
  const message = (composer?.value || "").trim();
  if (!message) return;
  composer.value = "";

  forgeMasterAppendBubble("user", message);
  const thinkingId = forgeMasterAppendBubble("assistant", "Thinking…", true);

  try {
    const res = await fetch("/api/forge-master/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FM_TAB_SESSION_ID ? { "x-pforge-session-id": FM_TAB_SESSION_ID } : {}),
      },
      body: JSON.stringify({ message, sessionId: fm.sessionId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { sessionId, streamUrl } = await res.json();
    fm.sessionId = sessionId;
    forgeMasterStream(streamUrl, thinkingId);
  } catch (err) {
    forgeMasterUpdateBubble(thinkingId, `Error: ${err.message}`);
  }
}

function forgeMasterStream(url, thinkingId) {
  const es = new EventSource(url);
  let replyBubbleId = thinkingId;
  let replyText = "";

  es.addEventListener("reply", (e) => {
    const { content } = JSON.parse(e.data);
    replyText = content || "";
    forgeMasterUpdateBubble(replyBubbleId, replyText);
  });

  es.addEventListener("quorum-estimate", (e) => {
    const data = JSON.parse(e.data);
    fm.quorumEstimateBubbleId = forgeMasterRenderQuorumEstimate(data);
  });

  es.addEventListener("tool-call", (e) => {
    const tc = JSON.parse(e.data);
    forgeMasterAddToolTrace(tc);
  });

  es.addEventListener("done", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (typeof data.totalCostUSD === "number") {
        fm.chatCost.usd += data.totalCostUSD;
        fm.chatCost.tokensIn += data.tokensIn || 0;
        fm.chatCost.tokensOut += data.tokensOut || 0;
        forgeMasterRenderCostMeter();
      }
      if (data.relatedTurns && data.relatedTurns.length > 0) {
        forgeMasterRenderRelatedConversations(data.relatedTurns);
      }
      // Quorum: update estimate bubble and render model cards
      if (fm.quorumEstimateBubbleId) {
        forgeMasterUpdateBubble(fm.quorumEstimateBubbleId, "Quorum complete.");
        fm.quorumEstimateBubbleId = null;
      }
      if (data.quorumResult && data.quorumResult.replies && data.quorumResult.replies.length > 0) {
        forgeMasterRenderQuorumReply(data.quorumResult, replyBubbleId);
      }
    } catch { /* non-fatal */ }
    es.close();
  });

  es.addEventListener("error", () => {
    if (replyText === "") forgeMasterUpdateBubble(replyBubbleId, "Stream error.");
    // Clean up quorum estimate bubble on error
    if (fm.quorumEstimateBubbleId) {
      forgeMasterUpdateBubble(fm.quorumEstimateBubbleId, "Quorum interrupted.");
      fm.quorumEstimateBubbleId = null;
    }
    es.close();
  });
}

// ─── Dial ─────────────────────────────────────────────────────────────

function forgeMasterRenderDial(activeTier) {
  let dialEl = document.getElementById("fm-dial");
  if (!dialEl) {
    const chatCol = document.querySelector("#tab-forge-master .flex-1.flex.flex-col");
    if (!chatCol) return;
    dialEl = document.createElement("div");
    dialEl.id = "fm-dial";
    dialEl.className = "flex items-center gap-1 mb-2";
    dialEl.title = FM_DIAL_TOOLTIP;
    chatCol.insertBefore(dialEl, chatCol.firstChild);
  }
  dialEl.innerHTML = FM_DIAL_TIERS.map(({ tier, label }) => {
    const active = tier === activeTier;
    const cls = active
      ? "text-xs px-3 py-1 rounded bg-cyan-700 text-white font-semibold"
      : "text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600";
    return `<button class="${cls}" data-tier="${tier}">${label}</button>`;
  }).join("");
  forgeMasterRenderCostMeter();
}

// ─── Cost Meter ───────────────────────────────────────────────────────

/**
 * Render the chat cost meter below the reasoning dial.
 * Shows accumulated API-equivalent cost for the current chat.
 * Note: Copilot subscription users are not billed per-token.
 */
function forgeMasterRenderCostMeter() {
  let meterEl = document.getElementById("fm-cost-meter");
  if (!meterEl) {
    const dialEl = document.getElementById("fm-dial");
    if (!dialEl) return;
    meterEl = document.createElement("div");
    meterEl.id = "fm-cost-meter";
    meterEl.className = "text-xs text-gray-500 mb-2";
    dialEl.insertAdjacentElement("afterend", meterEl);
  }
  const { usd, tokensIn, tokensOut } = fm.chatCost;
  const totalTokens = tokensIn + tokensOut;
  if (totalTokens === 0) {
    meterEl.textContent = "";
    return;
  }
  const costStr = usd < 0.0001
    ? `<$0.0001`
    : `~$${usd.toFixed(4)}`;
  const tokenStr = totalTokens >= 1000
    ? `${(totalTokens / 1000).toFixed(1)}k tok`
    : `${totalTokens} tok`;
  meterEl.title = "API-equivalent estimate. Copilot subscription users are not billed per-token.";
  meterEl.textContent = `Chat: ${costStr} · ${tokenStr}`;
}

// ─── Quorum Advisory Picker ──────────────────────────────────────────

function forgeMasterRenderQuorumPicker(activeMode) {
  let pickerEl = document.getElementById("fm-quorum-picker");
  if (!pickerEl) {
    const meterEl = document.getElementById("fm-cost-meter");
    const dialEl = document.getElementById("fm-dial");
    const anchor = meterEl || dialEl;
    if (!anchor) return;
    pickerEl = document.createElement("div");
    pickerEl.id = "fm-quorum-picker";
    pickerEl.className = "flex items-center gap-1 mb-2";
    pickerEl.title = "Quorum advisory: query multiple models for diverse perspectives on advisory questions.";
    anchor.insertAdjacentElement("afterend", pickerEl);
  }
  const label = document.createElement("span");
  label.className = "text-xs text-gray-500 mr-1";
  label.textContent = "Quorum:";
  pickerEl.innerHTML = "";
  pickerEl.appendChild(label);
  for (const { mode, label: btnLabel } of FM_QUORUM_MODES) {
    const btn = document.createElement("button");
    const active = mode === activeMode;
    btn.className = active
      ? "text-xs px-3 py-1 rounded bg-cyan-700 text-white font-semibold"
      : "text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600";
    btn.dataset.quorum = mode;
    btn.textContent = btnLabel;
    pickerEl.appendChild(btn);
  }
}

async function forgeMasterQuorumClick(mode) {
  try {
    const res = await fetch("/api/forge-master/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: fm.dialTier, quorumAdvisory: mode }),
    });
    if (!res.ok) return;
    const saved = await res.json();
    fm.quorumAdvisory = saved.quorumAdvisory || "off";
    forgeMasterRenderQuorumPicker(fm.quorumAdvisory);
  } catch {
    // noop
  }
}

// ─── Quorum Estimate Bubble ──────────────────────────────────────────

function forgeMasterRenderQuorumEstimate(data) {
  const stream = document.getElementById("fm-chat-stream");
  if (!stream) return null;

  const models = data.models || [];
  const cost = typeof data.estimatedCostUSD === "number"
    ? `~$${data.estimatedCostUSD.toFixed(4)}`
    : "";

  const el = document.createElement("div");
  el.id = "fm-quorum-estimate";
  el.className = "bg-gray-800 text-gray-300 self-start mr-8 rounded px-3 py-2 text-xs";

  const header = document.createElement("div");
  header.className = "text-cyan-400 font-semibold mb-1";
  header.textContent = `Quorum advisory — ${models.length} models ${cost ? "· " + cost + " est." : ""}`;
  el.appendChild(header);

  for (const modelName of models) {
    const badge = document.createElement("div");
    badge.className = "inline-block bg-gray-700 rounded px-2 py-0.5 mr-1 mb-1 text-xs text-gray-300";
    badge.textContent = `${modelName} · running…`;
    badge.dataset.quorumModel = modelName;
    el.appendChild(badge);
  }

  stream.appendChild(el);
  stream.scrollTop = stream.scrollHeight;
  return el.id;
}

// ─── Quorum Reply Cards ──────────────────────────────────────────────

function forgeMasterRenderQuorumReply(quorumResult, bubbleId) {
  const stream = document.getElementById("fm-chat-stream");
  if (!stream) return;

  const { replies, dissent } = quorumResult;
  if (!replies || replies.length === 0) return;

  // Update the estimate bubble to "complete" if it still exists
  const estimateEl = document.getElementById("fm-quorum-estimate");
  if (estimateEl) {
    const badges = estimateEl.querySelectorAll("[data-quorum-model]");
    for (const b of badges) {
      const modelName = b.dataset.quorumModel;
      const reply = replies.find(r => r.model === modelName);
      b.textContent = reply
        ? `${modelName} · ${reply.durationMs}ms`
        : `${modelName} · no response`;
    }
  }

  // Build quorum reply container
  const container = document.createElement("div");
  container.id = "fm-quorum-reply";
  container.className = "bg-gray-800 text-gray-300 self-start mr-8 rounded px-3 py-2 text-xs mt-1";

  // Dissent summary at top
  if (dissent && dissent.topic) {
    const dissentEl = document.createElement("div");
    dissentEl.className = "border-l-2 border-cyan-600 pl-2 mb-2 text-gray-400";
    const strong = document.createElement("strong");
    strong.textContent = "Dissent: ";
    dissentEl.appendChild(strong);
    const topicSpan = document.createElement("span");
    topicSpan.textContent = `${dissent.topic} — ${dissent.axis}`;
    dissentEl.appendChild(topicSpan);
    container.appendChild(dissentEl);
  }

  // Model cards in a flex row
  const cardRow = document.createElement("div");
  cardRow.className = "flex gap-2 flex-wrap";

  for (const reply of replies) {
    const card = document.createElement("div");
    card.className = "flex-1 min-w-0 border border-gray-700 rounded p-2";
    card.dataset.quorumCard = reply.model;

    const modelLabel = document.createElement("div");
    modelLabel.className = "text-cyan-400 font-mono text-xs mb-1 truncate";
    modelLabel.textContent = reply.model;
    card.appendChild(modelLabel);

    const replyText = document.createElement("div");
    replyText.className = "text-gray-300 whitespace-pre-wrap text-xs mb-1";
    replyText.textContent = reply.text || "";
    card.appendChild(replyText);

    const meta = document.createElement("div");
    meta.className = "text-gray-500 text-xs";
    const dur = reply.durationMs ? `${reply.durationMs}ms` : "";
    const cost = typeof reply.costUSD === "number" ? `$${reply.costUSD.toFixed(4)}` : "";
    meta.textContent = [dur, cost].filter(Boolean).join(" · ");
    card.appendChild(meta);

    cardRow.appendChild(card);
  }

  container.appendChild(cardRow);
  stream.appendChild(container);
  stream.scrollTop = stream.scrollHeight;
}

async function forgeMasterLoadPrefs() {
  try {
    const res = await fetch("/api/forge-master/prefs");
    if (!res.ok) return;
    const prefs = await res.json();
    fm.dialTier = prefs.tier;
    fm.quorumAdvisory = prefs.quorumAdvisory || "off";
    forgeMasterRenderDial(prefs.tier);
    forgeMasterRenderQuorumPicker(fm.quorumAdvisory);
  } catch {
    // prefs unavailable — dial stays hidden
  }
}

async function forgeMasterDialClick(tier) {
  try {
    const res = await fetch("/api/forge-master/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, quorumAdvisory: fm.quorumAdvisory }),
    });
    if (!res.ok) return;
    const saved = await res.json();
    fm.dialTier = saved.tier;
    forgeMasterRenderDial(saved.tier);
  } catch {
    // noop
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────

let _bubbleCounter = 0;
function forgeMasterAppendBubble(role, text, isThinking = false) {
  const id = `fm-bubble-${++_bubbleCounter}`;
  const stream = document.getElementById("fm-chat-stream");
  if (!stream) return id;
  const cls = role === "user"
    ? "bg-gray-700 text-gray-200 self-end ml-8"
    : "bg-gray-800 text-gray-300 self-start mr-8";
  const el = document.createElement("div");
  el.id = id;
  el.className = `${cls} rounded px-3 py-2 text-xs whitespace-pre-wrap`;
  el.textContent = text;
  const placeholder = stream.querySelector("p");
  if (placeholder) placeholder.remove();
  stream.appendChild(el);
  stream.scrollTop = stream.scrollHeight;
  return id;
}

function forgeMasterUpdateBubble(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    const s = document.getElementById("fm-chat-stream");
    if (s) s.scrollTop = s.scrollHeight;
  }
}

function forgeMasterAddToolTrace(tc) {
  const trace = document.getElementById("fm-tool-trace");
  if (!trace) return;
  const placeholder = trace.querySelector("p");
  if (placeholder) placeholder.remove();
  const el = document.createElement("div");
  el.className = "border border-gray-700 rounded px-2 py-1 mb-1";
  el.innerHTML = `<span class="text-cyan-400 font-mono">${tc.name || tc.tool || "tool"}</span>`;
  trace.appendChild(el);
}

// ─── Related Conversations ────────────────────────────────────────────

/**
 * Render the "Related conversations" section from recall results.
 * Creates or updates the #fm-related-conversations element.
 *
 * @param {Array<{turnId,sessionId,timestamp,userMessage,lane,replyHash,score}>} relatedTurns
 */
function forgeMasterRenderRelatedConversations(relatedTurns) {
  const stream = document.getElementById("fm-chat-stream");
  if (!stream || !relatedTurns || relatedTurns.length === 0) return;

  let el = document.getElementById("fm-related-conversations");
  if (!el) {
    el = document.createElement("details");
    el.id = "fm-related-conversations";
    el.className = "mt-2 border border-gray-700 rounded text-xs";
    stream.appendChild(el);
  }

  const rows = relatedTurns.map((r) => {
    const ts = r.timestamp ? r.timestamp.slice(0, 10) : "";
    const lane = r.lane || "";
    const msg = (r.userMessage || "").slice(0, 100);
    return `<div class="px-2 py-1 border-t border-gray-700 text-gray-400">
      <span class="text-cyan-600 font-mono text-xs">[${ts} · ${lane}]</span>
      <span class="ml-1 text-gray-300">${msg}</span>
    </div>`;
  }).join("");

  el.innerHTML = `<summary class="px-2 py-1 text-cyan-500 cursor-pointer hover:bg-gray-700">
    Related conversations (${relatedTurns.length})
  </summary>${rows}`;
}

// ─── Yesterday's Digest ───────────────────────────────────────────────

/**
 * Render the "Yesterday's Digest" tile from the latest digest JSON
 * found in .forge/digests/. Fetches via the dashboard API route.
 *
 * @param {{ version: string, date: string, sections: Array<{id: string, title: string, severity: string, items: any[]}> }} digestJson
 */
function forgeMasterRenderDigestTile(digestJson) {
  const root = document.getElementById("forge-master-root");
  if (!root) return;

  let tile = document.getElementById("fm-digest-tile");
  if (!tile) {
    tile = document.createElement("div");
    tile.id = "fm-digest-tile";
    tile.className = "border border-gray-700 rounded p-3 mb-3 text-xs";
    root.insertBefore(tile, root.firstChild);
  }

  if (!digestJson || !digestJson.sections) {
    tile.innerHTML = `<h4 class="text-cyan-400 font-semibold mb-1">Yesterday's Digest</h4>
      <p class="text-gray-500">No digest available.</p>`;
    return;
  }

  const SEVERITY_ICON = { info: "🟢", warn: "🟡", alert: "🔴" };

  const sectionRows = digestJson.sections.map(s => {
    const icon = SEVERITY_ICON[s.severity] || "⚪";
    const count = s.items.length;
    const summary = count === 0 ? "all clear" : `${count} item${count > 1 ? "s" : ""}`;
    return `<div class="flex items-center gap-2 py-0.5">
      <span>${icon}</span>
      <span class="text-gray-300">${s.title}</span>
      <span class="text-gray-500 ml-auto">${summary}</span>
    </div>`;
  }).join("");

  const allGreen = digestJson.sections.every(s => s.items.length === 0);
  const statusLine = allGreen
    ? `<p class="text-green-500 mt-1">✅ All green — no significant deltas.</p>`
    : "";

  tile.innerHTML = `<h4 class="text-cyan-400 font-semibold mb-1">Yesterday's Digest <span class="text-gray-500 font-normal">(${digestJson.date})</span></h4>
    ${sectionRows}${statusLine}`;
}

/**
 * Load the latest digest from the dashboard API and render the tile.
 */
async function forgeMasterLoadDigest() {
  try {
    const res = await fetch("/api/forge-master/digest/latest");
    if (!res.ok) {
      forgeMasterRenderDigestTile(null);
      return;
    }
    const digestJson = await res.json();
    forgeMasterRenderDigestTile(digestJson);
  } catch {
    forgeMasterRenderDigestTile(null);
  }
}

window.forgeMasterRenderDigestTile = (...args) => forgeMasterRenderDigestTile(...args);
window.forgeMasterLoadDigest = () => forgeMasterLoadDigest();

// ─── Recurring Patterns Panel ─────────────────────────────────────────

const FM_PATTERN_SEVERITY_ICON = { info: "🟢", warning: "🟡", error: "🔴" };
const FM_PATTERN_SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * Render the "Recurring patterns" panel from detected pattern data.
 * Patterns are grouped by severity (error first, then warning, then info).
 *
 * @param {Array<{id: string, detector: string, severity: string, title: string, detail: string, occurrences: number, plans: string[]}>} patterns
 */
function forgeMasterRenderPatternsPanel(patterns) {
  const root = document.getElementById("forge-master-root");
  if (!root) return;

  let panel = document.getElementById("fm-patterns-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "fm-patterns-panel";
    panel.className = "border border-gray-700 rounded p-3 mb-3 text-xs";
    // Insert after digest tile if present, otherwise at top
    const digestTile = document.getElementById("fm-digest-tile");
    if (digestTile && digestTile.nextSibling) {
      root.insertBefore(panel, digestTile.nextSibling);
    } else if (digestTile) {
      root.appendChild(panel);
    } else {
      root.insertBefore(panel, root.firstChild);
    }
  }

  if (!patterns || patterns.length === 0) {
    panel.innerHTML = `<h4 class="text-cyan-400 font-semibold mb-1">Recurring Patterns</h4>
      <p class="text-gray-500">No patterns detected.</p>`;
    return;
  }

  // Sort by severity: error → warning → info
  const sorted = [...patterns].sort((a, b) =>
    (FM_PATTERN_SEVERITY_ORDER[a.severity] ?? 3) - (FM_PATTERN_SEVERITY_ORDER[b.severity] ?? 3)
  );

  // Group by severity
  const groups = new Map();
  for (const p of sorted) {
    const sev = p.severity || "info";
    if (!groups.has(sev)) groups.set(sev, []);
    groups.get(sev).push(p);
  }

  let rows = "";
  for (const [severity, items] of groups) {
    const icon = FM_PATTERN_SEVERITY_ICON[severity] || "⚪";
    rows += `<div class="mt-1 mb-0.5 text-gray-400 font-semibold">${icon} ${severity} (${items.length})</div>`;
    for (const p of items) {
      const plans = p.plans && p.plans.length > 0 ? p.plans.join(", ") : "";
      rows += `<div class="pl-4 py-0.5 text-gray-300">
        <span class="font-mono text-cyan-600">${p.title || p.id}</span>
        <span class="text-gray-500 ml-1">× ${p.occurrences || 0}</span>
        ${plans ? `<span class="text-gray-600 ml-1">(${plans})</span>` : ""}
      </div>`;
    }
  }

  panel.innerHTML = `<h4 class="text-cyan-400 font-semibold mb-1">Recurring Patterns</h4>${rows}`;
}

/**
 * Load patterns from the forge_patterns_list API and render the panel.
 */
async function forgeMasterLoadPatterns() {
  try {
    const res = await fetch("/api/forge-master/patterns");
    if (!res.ok) {
      forgeMasterRenderPatternsPanel(null);
      return;
    }
    const patterns = await res.json();
    forgeMasterRenderPatternsPanel(Array.isArray(patterns) ? patterns : patterns.patterns || []);
  } catch {
    forgeMasterRenderPatternsPanel(null);
  }
}

window.forgeMasterRenderPatternsPanel = (...args) => forgeMasterRenderPatternsPanel(...args);
window.forgeMasterLoadPatterns = () => forgeMasterLoadPatterns();

// ─── Quorum test helpers ──────────────────────────────────────────────
window.forgeMasterRenderQuorumPicker = (...args) => forgeMasterRenderQuorumPicker(...args);
window.forgeMasterRenderQuorumEstimate = (...args) => forgeMasterRenderQuorumEstimate(...args);
window.forgeMasterRenderQuorumReply = (...args) => forgeMasterRenderQuorumReply(...args);

// Historical note: globals kept for cross-tab inline handlers.

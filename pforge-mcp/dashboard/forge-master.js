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
  chatCost: { usd: 0, tokensIn: 0, tokensOut: 0 },
};

// ─── Dial config ──────────────────────────────────────────────────────

const FM_DIAL_TIERS = [
  { tier: "low",    label: "Fast" },
  { tier: "medium", label: "Balanced" },
  { tier: "high",   label: "Deep" },
];

const FM_DIAL_TOOLTIP = "Powered by frontier models via your GitHub Copilot subscription. Higher tiers may hit rate limits sooner.";

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
    const root = document.getElementById("forge-master-root");
    if (root) {
      root.addEventListener("click", e => {
        const btn = e.target.closest("button[data-tier]");
        if (btn) forgeMasterDialClick(btn.dataset.tier);
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
    } catch { /* non-fatal */ }
    es.close();
  });

  es.addEventListener("error", () => {
    if (replyText === "") forgeMasterUpdateBubble(replyBubbleId, "Stream error.");
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

async function forgeMasterLoadPrefs() {
  try {
    const res = await fetch("/api/forge-master/prefs");
    if (!res.ok) return;
    const { tier } = await res.json();
    fm.dialTier = tier;
    forgeMasterRenderDial(tier);
  } catch {
    // prefs unavailable — dial stays hidden
  }
}

async function forgeMasterDialClick(tier) {
  try {
    const res = await fetch("/api/forge-master/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    if (!res.ok) return;
    const { tier: saved } = await res.json();
    fm.dialTier = saved;
    forgeMasterRenderDial(saved);
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

// Historical note: globals kept for cross-tab inline handlers.

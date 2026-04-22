/**
 * Forge-Master Studio — Dashboard Tab Controller (Phase-29).
 *
 * Drives the #tab-forge-master section in the main Plan Forge dashboard.
 * Talks to /api/forge-master/* routes registered by forge-master-routes.mjs.
 *
 * Phase-30.1 — window.forgeMaster* assignments moved to the top of this
 * module so inline onclick handlers are wired even if init() throws.
 * Hoisted-function declarations below are visible here because the IIFE
 * scope runs after full module parse.
 */

// ─── State ────────────────────────────────────────────────────────────

const fm = {
  sessionId: null,
  catalog: null,
  activeCategory: null,
  gallerySearch: "",
};

// ─── Global surface (wired FIRST — before anything that could throw) ──
// Inline onclick="forgeMasterXxx()" handlers need these globals present
// even if /api/forge-master/prompts fails or a DOM query returns null.
window.forgeMasterOnTabActivate = () => {
  try {
    if (!fm.catalog) forgeMasterInit();
  } catch (err) {
    const list = document.getElementById("fm-gallery-list");
    if (list) list.innerHTML = `<p class="text-xs text-red-400">Forge-Master init failed: ${err?.message || err}</p>`;
    // eslint-disable-next-line no-console
    console.error("[forge-master] init error", err);
  }
};
window.forgeMasterNewChat = (...args) => forgeMasterNewChat(...args);
window.forgeMasterSend = (...args) => forgeMasterSend(...args);
window.forgeMasterPickPrompt = (...args) => forgeMasterPickPrompt(...args);
window.forgeMasterFilterGallery = (...args) => forgeMasterFilterGallery(...args);

// ─── Init ─────────────────────────────────────────────────────────────

async function forgeMasterInit() {
  try {
    const res = await fetch("/api/forge-master/prompts");
    if (!res.ok) throw new Error("prompts API unavailable");
    fm.catalog = await res.json();
    forgeMasterRenderGallery();
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
        onclick="forgeMasterPickPrompt(${JSON.stringify(p.id)})"
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
      headers: { "Content-Type": "application/json" },
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

  es.addEventListener("done", () => { es.close(); });

  es.addEventListener("error", () => {
    if (replyText === "") forgeMasterUpdateBubble(replyBubbleId, "Stream error.");
    es.close();
  });
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

// Note: window.forgeMaster* assignments are at the TOP of this file
// (Phase-30.1) so inline onclick handlers are wired regardless of init state.

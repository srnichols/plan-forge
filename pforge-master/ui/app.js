/**
 * Forge-Master Studio — UI App (Phase-29, Slice 13)
 *
 * Three-pane chat interface:
 *   Left:   prompt library with category accordion
 *   Center: chat messages + SSE streaming + approval cards
 *   Right:  capabilities, tool call log, session list
 */

const API = "/api/forge-master";

// ─── State ───────────────────────────────────────────────────────────

let sessionId = null;
let currentApprovalId = null;
let promptCatalog = null;
let streamingMsgEl = null;
let allPrompts = [];

// ─── Init ─────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([
    loadPromptCatalog(),
    loadCapabilities(),
    loadSessions(),
  ]);
  restoreTheme();
  updateSessionLabel();
  document.getElementById("message-input").focus();
}

// ─── Prompts ─────────────────────────────────────────────────────────

async function loadPromptCatalog() {
  try {
    const resp = await fetch(`${API}/prompts`);
    promptCatalog = await resp.json();
    allPrompts = promptCatalog.categories.flatMap(c => c.prompts);
    renderPrompts(allPrompts);
  } catch {
    document.getElementById("prompt-list").innerHTML =
      '<p class="text-red-400 text-xs px-2">Failed to load prompts</p>';
  }
}

function renderPrompts(prompts) {
  const el = document.getElementById("prompt-list");
  if (!prompts.length) {
    el.innerHTML = '<p class="text-gray-500 text-xs px-2 text-center py-4">No prompts found</p>';
    return;
  }

  // Group by category
  const byCategory = {};
  for (const p of prompts) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }

  let html = "";
  for (const [catId, catPrompts] of Object.entries(byCategory)) {
    const cat = promptCatalog?.categories.find(c => c.id === catId);
    const label = cat?.label || catId;
    html += `<div class="mb-2">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 py-1">${esc(label)}</p>`;
    for (const p of catPrompts) {
      html += `<button class="prompt-item w-full text-left px-2 py-1.5 rounded"
        onclick="selectPrompt(${JSON.stringify(p.id)})"
        title="${esc(p.description)}"
        data-prompt-id="${esc(p.id)}">
        <p class="text-xs font-medium text-gray-200 leading-tight">${esc(p.title)}</p>
        <p class="text-[11px] text-gray-500 leading-tight mt-0.5 line-clamp-1">${esc(p.description)}</p>
      </button>`;
    }
    html += `</div>`;
  }
  el.innerHTML = html;
}

window.filterPrompts = function(query) {
  if (!query.trim()) {
    renderPrompts(allPrompts);
    return;
  }
  const q = query.toLowerCase();
  renderPrompts(allPrompts.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.template.toLowerCase().includes(q),
  ));
};

window.selectPrompt = function(promptId) {
  const prompt = allPrompts.find(p => p.id === promptId);
  if (!prompt) return;

  // Highlight selection
  document.querySelectorAll(".prompt-item").forEach(el => el.classList.remove("selected"));
  document.querySelector(`[data-prompt-id="${promptId}"]`)?.classList.add("selected");

  // Fill in template — if has placeholders, show them inline
  let template = prompt.template;
  if (prompt.placeholders?.length) {
    for (const ph of prompt.placeholders) {
      template = template.replace(`{{${ph.key}}}`, `[${ph.label}: ${ph.example}]`);
    }
  }
  const input = document.getElementById("message-input");
  input.value = template;
  input.focus();
  input.setSelectionRange(0, template.length);
};

// ─── Capabilities ─────────────────────────────────────────────────────

async function loadCapabilities() {
  try {
    const resp = await fetch(`${API}/capabilities`);
    const caps = await resp.json();
    document.getElementById("capabilities-panel").innerHTML = `
      <div class="space-y-1">
        <div class="flex justify-between"><span class="text-gray-500">Model</span><span class="text-gray-300 font-mono text-[10px] truncate max-w-[130px]">${esc(caps.reasoningModel || "—")}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Router</span><span class="text-gray-300 font-mono text-[10px]">${esc(caps.routerModel || "—")}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Read tools</span><span class="text-gray-300">${caps.allowlistedTools}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Write tools</span><span class="text-gray-300">${caps.writeAllowlist}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Prompts</span><span class="text-gray-300">${caps.promptCount} (${caps.promptCategories} categories)</span></div>
      </div>`;
  } catch {
    document.getElementById("capabilities-panel").innerHTML =
      '<p class="text-red-400">Failed to load</p>';
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const resp = await fetch(`${API}/sessions`);
    const list = await resp.json();
    const el = document.getElementById("sessions-panel");
    if (!list.length) { el.innerHTML = '<p class="text-gray-600">No sessions yet</p>'; return; }
    el.innerHTML = list.slice(-10).reverse().map(s =>
      `<div class="prompt-item px-2 py-1.5 cursor-pointer rounded" onclick="resumeSession('${esc(s.id)}')">
        <p class="text-[10px] font-mono text-gray-500">${esc(s.id.slice(0, 8))}…</p>
        <p class="text-xs text-gray-300 truncate">${esc(s.lastMessage || "")}</p>
      </div>`,
    ).join("");
  } catch { /* non-fatal */ }
}

window.resumeSession = function(id) {
  sessionId = id;
  updateSessionLabel();
  appendSystemMessage(`Resumed session ${id.slice(0, 8)}…`);
};

// ─── Chat ─────────────────────────────────────────────────────────────

window.sendMessage = async function() {
  const input = document.getElementById("message-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  setStatusBadge("Thinking…", "blue");
  setSendDisabled(true);

  appendUserMessage(message);

  try {
    // Start session
    const startResp = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    });
    const { sessionId: sid, streamUrl } = await startResp.json();
    sessionId = sid;
    updateSessionLabel();

    // Stream response
    await consumeStream(streamUrl);
  } catch (err) {
    appendErrorMessage(err.message);
  } finally {
    setStatusBadge("Idle", "gray");
    setSendDisabled(false);
    await loadSessions();
  }
};

async function consumeStream(url) {
  const msgEl = appendStreamingMessage();
  streamingMsgEl = msgEl;
  const toolCallItems = [];

  const es = new EventSource(url);
  return new Promise((resolve, reject) => {
    es.addEventListener("start", () => {
      setStatusBadge("Streaming…", "blue");
    });

    es.addEventListener("reply", (e) => {
      const data = JSON.parse(e.data);
      msgEl.classList.remove("stream-cursor");
      msgEl.textContent = data.content || "";
    });

    es.addEventListener("tool-call", (e) => {
      const tc = JSON.parse(e.data);
      toolCallItems.push(tc);
      renderToolCall(tc);
    });

    es.addEventListener("done", (e) => {
      const data = JSON.parse(e.data);
      msgEl.classList.remove("stream-cursor");
      if (data.tokensIn != null) {
        appendTokenNote(data.tokensIn, data.tokensOut);
      }
      es.close();
      resolve();
    });

    es.addEventListener("error", (e) => {
      es.close();
      try {
        const data = JSON.parse(e.data);
        appendErrorMessage(data.error || "Stream error");
      } catch {
        appendErrorMessage("Stream connection lost");
      }
      reject(new Error("stream error"));
    });

    es.onerror = () => {
      es.close();
      resolve(); // treat as done
    };
  });
}

// ─── Approval ─────────────────────────────────────────────────────────

window.approveAction = async function(decision) {
  if (!currentApprovalId) return;
  try {
    await fetch(`${API}/chat/${sessionId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: currentApprovalId, decision }),
    });
    hideApprovalCard();
    currentApprovalId = null;
  } catch (err) {
    appendErrorMessage(`Approval error: ${err.message}`);
  }
};

window.editApproval = function() {
  const newArgs = prompt("Edit tool arguments (JSON):");
  if (!newArgs) return;
  try {
    const editedArgs = JSON.parse(newArgs);
    approveAction("edit"); // will use editedArgs via separate call
  } catch {
    alert("Invalid JSON");
  }
};

function showApprovalCard(tools, approvalId) {
  currentApprovalId = approvalId;
  document.getElementById("approval-card").classList.remove("hidden");
  document.getElementById("approval-tool-list").textContent =
    tools.map(t => `${t.name} (${t.severity}): ${JSON.stringify(t.args || {})}`).join("\n");
}

function hideApprovalCard() {
  document.getElementById("approval-card").classList.add("hidden");
}

// ─── Message rendering ────────────────────────────────────────────────

function appendUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg-user rounded-lg px-4 py-3 max-w-3xl ml-auto text-sm";
  el.textContent = text;
  getMessages().appendChild(el);
  scrollToBottom();
}

function appendStreamingMessage() {
  const el = document.createElement("div");
  el.className = "msg-assistant rounded-lg px-4 py-3 max-w-3xl text-sm stream-cursor whitespace-pre-wrap";
  el.textContent = "";
  getMessages().appendChild(el);
  scrollToBottom();
  return el;
}

function appendSystemMessage(text) {
  const el = document.createElement("div");
  el.className = "text-center text-xs text-gray-500 py-1";
  el.textContent = text;
  getMessages().appendChild(el);
  scrollToBottom();
}

function appendErrorMessage(text) {
  const el = document.createElement("div");
  el.className = "msg-error rounded-lg px-4 py-3 max-w-3xl text-sm text-red-300";
  el.textContent = `⚠ ${text}`;
  getMessages().appendChild(el);
  scrollToBottom();
}

function appendTokenNote(tokensIn, tokensOut) {
  const el = document.createElement("div");
  el.className = "text-center text-[10px] text-gray-600 py-1";
  el.textContent = `↑${tokensIn ?? 0} tokens in · ↓${tokensOut ?? 0} tokens out`;
  getMessages().appendChild(el);
}

function renderToolCall(tc) {
  const panel = document.getElementById("tool-calls-panel");
  if (panel.querySelector("p")) panel.innerHTML = "";
  const el = document.createElement("div");
  el.className = `tool-card p-2 ${tc.ok === false ? "err" : "ok"}`;
  el.innerHTML = `<p class="font-mono text-[11px] text-gray-300">${esc(tc.tool || tc.name || "tool")}</p>
    <p class="text-[10px] text-gray-500 mt-0.5">${tc.ok === false ? `❌ ${esc(tc.error || "failed")}` : `✓ ${tc.durationMs != null ? tc.durationMs + "ms" : "ok"}`}</p>`;
  panel.appendChild(el);
}

// ─── Helpers ──────────────────────────────────────────────────────────

window.clearSession = function() {
  sessionId = null;
  updateSessionLabel();
  getMessages().innerHTML = `<div class="flex justify-center">
    <div class="text-center max-w-md">
      <div class="text-4xl mb-3">🧠</div>
      <h2 class="text-lg font-semibold text-gray-200 mb-2">New Session</h2>
      <p class="text-sm text-gray-400">Ask Forge-Master anything about your project.</p>
    </div>
  </div>`;
  document.getElementById("tool-calls-panel").innerHTML = '<p class="text-gray-600">No tool calls yet</p>';
};

window.handleInputKey = function(e) {
  if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); sendMessage(); }
};

window.toggleTheme = function() {
  document.documentElement.classList.toggle("light");
  localStorage.setItem("fm-theme", document.documentElement.classList.contains("light") ? "light" : "dark");
};

function restoreTheme() {
  if (localStorage.getItem("fm-theme") === "light") document.documentElement.classList.add("light");
}

function updateSessionLabel() {
  const el = document.getElementById("session-label");
  el.textContent = sessionId ? `Session: ${sessionId.slice(0, 8)}…` : "No session";
}

function setStatusBadge(text, color) {
  const el = document.getElementById("status-badge");
  el.textContent = text;
  el.className = `text-xs font-medium px-2.5 py-1 rounded-full border ${
    color === "blue" ? "bg-blue-900/50 text-blue-300 border-blue-800" :
    "bg-gray-800 text-gray-400 border-gray-700"
  }`;
}

function setSendDisabled(disabled) {
  document.getElementById("send-btn").disabled = disabled;
  document.getElementById("message-input").disabled = disabled;
}

function getMessages() { return document.getElementById("messages"); }
function scrollToBottom() {
  const m = getMessages();
  m.scrollTop = m.scrollHeight;
}

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Boot ──────────────────────────────────────────────────────────────

init().catch(console.error);

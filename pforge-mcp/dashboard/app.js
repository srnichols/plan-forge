/**
 * Plan Forge Dashboard — Client-Side Application
 *
 * Connects to:
 *   - WebSocket hub (ws://127.0.0.1:3101) for real-time events
 *   - REST API (http://127.0.0.1:3100/api/*) for data queries
 *
 * No build step. Vanilla JS + Tailwind CDN + Chart.js CDN.
 */

// ─── State ────────────────────────────────────────────────────────────
const state = {
  ws: null,
  connected: false,
  slices: [],       // Current run slice states
  skillRuns: [],    // Skill execution history
  runMeta: null,    // Current run metadata
  charts: {},       // Chart.js instances
};

const API_BASE = `${window.location.protocol}//${window.location.host}`;

// ─── Tab Switching ────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("tab-active");
      b.classList.add("text-gray-400");
    });
    btn.classList.add("tab-active");
    btn.classList.remove("text-gray-400");

    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    const tab = document.getElementById(`tab-${btn.dataset.tab}`);
    if (tab) tab.classList.remove("hidden");

    // Load data for the tab
    if (btn.dataset.tab === "runs") loadRuns();
    if (btn.dataset.tab === "cost") loadCost();
    if (tabLoadHooks[btn.dataset.tab]) tabLoadHooks[btn.dataset.tab]();
  });
});

// ─── WebSocket Connection ─────────────────────────────────────────────
function connectWebSocket() {
  // Read WS port from hub info endpoint
  fetch(`${API_BASE}/api/hub`)
    .then((r) => r.json())
    .then((info) => {
      if (!info.running) {
        updateConnectionBadge(false, "Hub not running");
        return;
      }
      const wsUrl = `ws://127.0.0.1:${info.port}?label=dashboard`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        state.ws = ws;
        state.connected = true;
        updateConnectionBadge(true);
        document.getElementById("ws-port").textContent = `WS :${info.port}`;
      };

      ws.onclose = () => {
        state.connected = false;
        updateConnectionBadge(false);
        // Reconnect after 3s
        setTimeout(connectWebSocket, 3000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleEvent(data);
        } catch { /* ignore malformed */ }
      };
    })
    .catch(() => {
      updateConnectionBadge(false, "API unreachable");
      setTimeout(connectWebSocket, 5000);
    });
}

function updateConnectionBadge(connected, text) {
  const badge = document.getElementById("connection-badge");
  if (connected) {
    badge.textContent = "connected";
    badge.className = "text-xs px-2 py-0.5 rounded-full bg-green-900 text-green-300";
  } else {
    badge.textContent = text || "disconnected";
    badge.className = "text-xs px-2 py-0.5 rounded-full bg-red-900 text-red-300";
  }
}

// ─── Event Handling ───────────────────────────────────────────────────
function handleEvent(event) {
  switch (event.type) {
    case "run-started":
      handleRunStarted(event.data || event);
      break;
    case "slice-started":
      handleSliceStarted(event.data || event);
      break;
    case "slice-completed":
      handleSliceCompleted(event.data || event);
      break;
    case "slice-failed":
      handleSliceFailed(event.data || event);
      break;
    case "run-completed":
      handleRunCompleted(event.data || event);
      break;
    case "run-aborted":
      handleRunAborted(event.data || event);
      break;
    case "skill-started":
      handleSkillStarted(event.data || event);
      break;
    case "skill-step-started":
      handleSkillStepStarted(event.data || event);
      break;
    case "skill-step-completed":
      handleSkillStepCompleted(event.data || event);
      break;
    case "skill-completed":
      handleSkillCompleted(event.data || event);
      break;
  }
}

function handleRunStarted(data) {
  state.runMeta = data;
  state.slices = [];
  const count = data.sliceCount || data.executionOrder?.length || 0;
  const order = data.executionOrder || [];

  for (let i = 0; i < count; i++) {
    state.slices.push({
      id: order[i] || String(i + 1),
      title: `Slice ${order[i] || i + 1}`,
      status: "pending",
    });
  }

  document.getElementById("run-plan-name").textContent = shortName(data.plan);
  document.getElementById("run-progress-text").textContent = `0 of ${count} slices — starting...`;
  document.getElementById("run-progress-bar").classList.remove("hidden");
  document.getElementById("run-progress-fill").style.width = "0%";
  document.getElementById("run-status").textContent = "Running...";

  renderSliceCards();
}

function handleSliceStarted(data) {
  const slice = state.slices.find((s) => s.id === data.sliceId);
  if (slice) {
    slice.status = "executing";
    slice.title = data.title || slice.title;
  }
  updateProgress();
  renderSliceCards();
}

function handleSliceCompleted(data) {
  const slice = state.slices.find((s) => s.id === data.sliceId);
  if (slice) {
    slice.status = "passed";
    slice.duration = data.duration;
    slice.model = data.model;
    slice.cost = data.cost_usd;
    Object.assign(slice, data);
  }
  updateProgress();
  renderSliceCards();
}

function handleSliceFailed(data) {
  const slice = state.slices.find((s) => s.id === data.sliceId);
  if (slice) {
    slice.status = "failed";
    slice.error = data.error;
    Object.assign(slice, data);
  }
  updateProgress();
  renderSliceCards();
}

function handleRunCompleted(data) {
  document.getElementById("run-status").textContent = data.status === "completed" ? "Complete" : "Failed";
  const report = data.report || `${data.results?.passed || 0} passed, ${data.results?.failed || 0} failed`;
  document.getElementById("run-progress-text").textContent = report;
  document.getElementById("run-progress-fill").style.width = "100%";
  document.getElementById("run-progress-fill").className =
    data.status === "completed" ? "h-full bg-green-500 transition-all duration-500" : "h-full bg-red-500 transition-all duration-500";
}

function handleRunAborted(data) {
  document.getElementById("run-status").textContent = "Aborted";
  document.getElementById("run-progress-text").textContent = `Aborted at slice ${data.sliceId}: ${data.reason}`;
}

// ─── Rendering ────────────────────────────────────────────────────────
function renderSliceCards() {
  const container = document.getElementById("slice-cards");
  if (state.slices.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-center py-12">Waiting for run events...</div>';
    return;
  }

  container.innerHTML = state.slices.map((s) => {
    const statusIcon = { pending: "⏳", executing: "⚡", passed: "✅", failed: "❌", skipped: "⏭️" }[s.status] || "❓";
    const bgColor = { pending: "bg-gray-800", executing: "bg-blue-900/50 slice-executing", passed: "bg-green-900/30", failed: "bg-red-900/30", skipped: "bg-gray-800/50" }[s.status] || "bg-gray-800";
    const duration = s.duration ? `${(s.duration / 1000).toFixed(1)}s` : "";
    const cost = s.cost ? `$${s.cost.toFixed(4)}` : "";
    const model = s.model || "";
    const isApiModel = /^grok-/.test(model);
    const modelBadge = isApiModel ? `<span class="text-purple-400">${model}</span> <span class="text-xs text-purple-600">API</span>` : model;

    return `
      <div class="slice-card ${bgColor} rounded-lg p-3 border border-gray-700">
        <div class="flex items-center justify-between mb-1">
          <span class="font-semibold text-sm">${statusIcon} Slice ${s.id}</span>
          <span class="text-xs text-gray-500">${duration}</span>
        </div>
        <p class="text-xs text-gray-400 truncate">${s.title}</p>
        ${model ? `<p class="text-xs text-gray-500 mt-1">${modelBadge} ${cost}</p>` : ""}
        ${s.error ? `<p class="text-xs text-red-400 mt-1 truncate">${s.error}</p>` : ""}
      </div>
    `;
  }).join("");
}

function updateProgress() {
  const total = state.slices.length;
  const done = state.slices.filter((s) => s.status === "passed" || s.status === "failed" || s.status === "skipped").length;
  const executing = state.slices.find((s) => s.status === "executing");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById("run-progress-fill").style.width = `${pct}%`;
  document.getElementById("run-progress-text").textContent =
    executing ? `Slice ${executing.id} of ${total} executing — ${pct}% complete` : `${done} of ${total} slices — ${pct}%`;
}

function shortName(path) {
  if (!path) return "Unknown plan";
  return path.split("/").pop().replace(/\.md$/, "").replace(/-/g, " ");
}

// ─── Runs Tab ─────────────────────────────────────────────────────────
async function loadRuns() {
  try {
    const res = await fetch(`${API_BASE}/api/runs`);
    const runs = await res.json();
    const tbody = document.getElementById("runs-table-body");
    if (!runs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">No runs yet</td></tr>';
      return;
    }
    tbody.innerHTML = runs.map((r) => {
      const date = r.startTime ? new Date(r.startTime).toLocaleDateString() : "—";
      const plan = shortName(r.plan);
      const slices = `${r.results?.passed || 0}/${r.sliceCount || 0}`;
      const status = r.status === "completed"
        ? '<span class="text-green-400">✅ pass</span>'
        : '<span class="text-red-400">❌ fail</span>';
      const cost = r.cost?.total_cost_usd != null ? `$${r.cost.total_cost_usd.toFixed(2)}` : "—";
      const dur = r.totalDuration ? `${(r.totalDuration / 1000).toFixed(0)}s` : "—";
      return `<tr class="border-t border-gray-700 hover:bg-gray-700/50">
        <td class="px-4 py-2">${date}</td>
        <td class="px-4 py-2">${plan}</td>
        <td class="px-4 py-2 text-center">${slices}</td>
        <td class="px-4 py-2 text-center">${status}</td>
        <td class="px-4 py-2 text-right">${cost}</td>
        <td class="px-4 py-2 text-right">${dur}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    document.getElementById("runs-table-body").innerHTML =
      `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400">Error: ${err.message}</td></tr>`;
  }
}

// ─── Cost Tab ─────────────────────────────────────────────────────────
async function loadCost() {
  try {
    const res = await fetch(`${API_BASE}/api/cost`);
    const data = await res.json();

    document.getElementById("cost-total").textContent = `$${(data.total_cost_usd || 0).toFixed(2)}`;
    document.getElementById("cost-runs").textContent = data.runs || 0;
    document.getElementById("cost-tokens").textContent = ((data.total_tokens_in || 0) + (data.total_tokens_out || 0)).toLocaleString();

    // Model cost chart
    if (data.by_model) {
      const labels = Object.keys(data.by_model);
      const costs = labels.map((m) => data.by_model[m].cost_usd);
      renderChart("chart-model-cost", "doughnut", labels, costs, "Cost by Model ($)");
    }

    // Monthly chart
    if (data.monthly) {
      const months = Object.keys(data.monthly).sort();
      const values = months.map((m) => data.monthly[m].cost_usd);
      renderChart("chart-monthly", "bar", months, values, "Monthly Spend ($)");
    }
  } catch (err) {
    document.getElementById("cost-total").textContent = "Error";
  }
}

function renderChart(canvasId, type, labels, data, title) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  state.charts[canvasId] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: type === "doughnut", labels: { color: "#9ca3af" } },
        title: { display: false },
      },
      scales: type === "bar" ? {
        y: { ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
        x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
      } : undefined,
    },
  });
}

// ─── Actions Tab ──────────────────────────────────────────────────────
async function runAction(tool, args) {
  const resultDiv = document.getElementById("action-result");
  const titleEl = document.getElementById("action-result-title");
  const outputEl = document.getElementById("action-result-output");

  titleEl.textContent = `Running: pforge ${tool} ${args || ""}`.trim();
  outputEl.textContent = "Loading...";
  resultDiv.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/api/tool/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: args || "" }),
    });
    const data = await res.json();
    outputEl.textContent = data.output || data.error || JSON.stringify(data, null, 2);
    titleEl.textContent = `${tool}: ${data.success ? "✅" : "❌"}`;
  } catch (err) {
    outputEl.textContent = `Error: ${err.message}`;
    titleEl.textContent = `${tool}: ❌`;
  }
}

// Make runAction available globally for onclick handlers
window.runAction = runAction;

// ─── Quorum / Diagnose Actions ────────────────────────────────────────
async function runAnalyzeQuorum() {
  const target = prompt("Plan or file path:");
  if (!target) return;
  const models = prompt("Models (comma-separated, or leave blank for defaults):", "");
  const args = models ? `${target} --quorum --models ${models}` : `${target} --quorum`;
  runAction("analyze", args);
}

async function runDiagnose() {
  const filePath = prompt("File to diagnose:");
  if (!filePath) return;
  const models = prompt("Models (comma-separated, or leave blank for defaults):", "");
  const args = models ? `${filePath} --models ${models}` : filePath;
  runAction("diagnose", args);
}

window.runAnalyzeQuorum = runAnalyzeQuorum;
window.runDiagnose = runDiagnose;

// ─── Session Replay (Phase 5) ─────────────────────────────────────────
let replayRuns = [];

async function loadReplayRuns() {
  try {
    const res = await fetch(`${API_BASE}/api/runs`);
    replayRuns = await res.json();
    const select = document.getElementById("replay-run-select");
    select.innerHTML = replayRuns.map((r, i) => {
      const date = r.startTime ? new Date(r.startTime).toLocaleDateString() : "—";
      return `<option value="${i}">${date} — ${shortName(r.plan)}</option>`;
    }).join("");
    if (replayRuns.length > 0) loadReplaySlices();
  } catch { /* ignore */ }
}

function loadReplaySlices() {
  const idx = document.getElementById("replay-run-select").value;
  const run = replayRuns[idx];
  if (!run?.sliceResults) return;
  const select = document.getElementById("replay-slice-select");
  select.innerHTML = run.sliceResults
    .filter((s) => s.status !== "skipped")
    .map((s) => `<option value="${s.number || s.sliceId}">Slice ${s.number || s.sliceId}: ${s.title || ""}</option>`)
    .join("");
  loadReplayLog();
}

async function loadReplayLog() {
  const runIdx = document.getElementById("replay-run-select").value;
  const sliceId = document.getElementById("replay-slice-select").value;
  const run = replayRuns[runIdx];
  if (!run) return;

  // Derive run directory name from startTime + plan name
  const logEl = document.getElementById("replay-log");
  try {
    const res = await fetch(`${API_BASE}/api/replay/${runIdx}/${sliceId}`);
    if (res.ok) {
      const data = await res.json();
      logEl.textContent = data.log || "No log content available.";
    } else {
      logEl.textContent = "Log not available for this slice.";
    }
  } catch {
    logEl.textContent = "Failed to load session log.";
  }
}

function filterReplay(mode) {
  const logEl = document.getElementById("replay-log");
  const full = logEl.dataset.fullLog || logEl.textContent;
  if (!logEl.dataset.fullLog) logEl.dataset.fullLog = full;

  if (mode === "all") {
    logEl.textContent = full;
  } else if (mode === "error") {
    logEl.textContent = full.split("\n").filter((l) => /error|fail|❌|ERR/i.test(l)).join("\n") || "No errors found.";
  } else if (mode === "file") {
    logEl.textContent = full.split("\n").filter((l) => /creat|modif|write|read|file/i.test(l)).join("\n") || "No file operations found.";
  }
}

window.loadReplaySlices = loadReplaySlices;
window.loadReplayLog = loadReplayLog;
window.filterReplay = filterReplay;

// ─── Extension Marketplace (Phase 5) ──────────────────────────────────
let catalogData = [];

async function loadExtensions() {
  try {
    const res = await fetch(`${API_BASE}/api/tool/ext`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: "search" }),
    });
    const data = await res.json();
    // Parse the CLI output into cards (best-effort)
    const output = data.output || "";
    catalogData = output.split("\n").filter((l) => l.trim()).map((l) => ({ raw: l }));
    renderExtensions(catalogData);
  } catch {
    document.getElementById("ext-cards").innerHTML = '<div class="text-gray-500 text-center py-12">Failed to load catalog</div>';
  }
}

function renderExtensions(items) {
  const container = document.getElementById("ext-cards");
  if (items.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-center py-12">No extensions found</div>';
    return;
  }
  container.innerHTML = items.map((ext) => `
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition">
      <p class="text-sm text-gray-300">${ext.raw}</p>
    </div>
  `).join("");
}

function filterExtensions() {
  const q = document.getElementById("ext-search").value.toLowerCase();
  renderExtensions(q ? catalogData.filter((e) => e.raw.toLowerCase().includes(q)) : catalogData);
}

window.filterExtensions = filterExtensions;

// ─── Notification Center (Phase 5) ────────────────────────────────────
let notifications = JSON.parse(localStorage.getItem("pf-notifications") || "[]");

function addNotification(text, type = "info") {
  const notif = { text, type, time: new Date().toISOString(), read: false };
  notifications.unshift(notif);
  if (notifications.length > 50) notifications = notifications.slice(0, 50);
  localStorage.setItem("pf-notifications", JSON.stringify(notifications));
  renderNotifications();
}

function renderNotifications() {
  const unread = notifications.filter((n) => !n.read).length;
  const countEl = document.getElementById("notif-count");
  if (unread > 0) {
    countEl.textContent = unread;
    countEl.classList.remove("hidden");
  } else {
    countEl.classList.add("hidden");
  }

  const listEl = document.getElementById("notif-list");
  if (notifications.length === 0) {
    listEl.innerHTML = '<p class="text-gray-500 text-center py-4">No notifications</p>';
    return;
  }
  listEl.innerHTML = notifications.slice(0, 20).map((n, i) => {
    const icon = n.type === "success" ? "✅" : n.type === "error" ? "❌" : "ℹ️";
    const opacity = n.read ? "opacity-50" : "";
    const time = new Date(n.time).toLocaleTimeString();
    return `<div class="flex items-start gap-2 py-2 border-b border-gray-700 ${opacity} cursor-pointer" onclick="markRead(${i})">
      <span>${icon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs truncate">${n.text}</p>
        <p class="text-xs text-gray-500">${time}</p>
      </div>
    </div>`;
  }).join("");
}

function toggleNotifications() {
  document.getElementById("notif-panel").classList.toggle("hidden");
  notifications.forEach((n) => (n.read = true));
  localStorage.setItem("pf-notifications", JSON.stringify(notifications));
  renderNotifications();
}

function markRead(idx) {
  if (notifications[idx]) notifications[idx].read = true;
  localStorage.setItem("pf-notifications", JSON.stringify(notifications));
  renderNotifications();
}

function clearNotifications() {
  notifications = [];
  localStorage.setItem("pf-notifications", "[]");
  renderNotifications();
}

window.toggleNotifications = toggleNotifications;
window.clearNotifications = clearNotifications;
window.markRead = markRead;

// Hook notifications into WS events
const origHandleEvent = handleEvent;
const hookedHandleEvent = function (event) {
  origHandleEvent(event);
  if (event.type === "run-completed") {
    const d = event.data || event;
    addNotification(`Run complete: ${d.report || d.status}`, d.status === "completed" ? "success" : "error");
  } else if (event.type === "slice-failed") {
    const d = event.data || event;
    addNotification(`Slice ${d.sliceId} failed: ${d.error || ""}`, "error");
  }
};
// Monkey-patch handleEvent for notification hooks
window._origHandleEvent = handleEvent;

// ─── Config Editor (Phase 5) ──────────────────────────────────────────
let currentConfig = {};

async function loadConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    currentConfig = await res.json();
    document.getElementById("cfg-preset").value = currentConfig.preset || "";
    document.getElementById("cfg-version").value = currentConfig.templateVersion || "";
    document.getElementById("cfg-model-default").value = currentConfig.modelRouting?.default || "auto";

    // Agents checkboxes
    const agentsEl = document.getElementById("cfg-agents");
    const allAgents = ["claude", "cursor", "codex"];
    const active = currentConfig.agents || [];
    agentsEl.innerHTML = allAgents.map((a) => `
      <label class="flex items-center gap-1 bg-gray-700 px-3 py-1 rounded text-sm cursor-pointer">
        <input type="checkbox" class="cfg-agent-checkbox" value="${a}" ${active.includes(a) ? "checked" : ""}> ${a}
      </label>
    `).join("");

    document.getElementById("cfg-status").textContent = "Configuration loaded.";

    // Check API provider availability
    loadApiProviderStatus();
  } catch (err) {
    document.getElementById("cfg-status").textContent = `Error: ${err.message}`;
  }
}

async function loadApiProviderStatus() {
  const el = document.getElementById("cfg-api-providers");
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/api/tool/smith`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: "" }),
    });
    const data = await res.json();
    const output = data.output || "";
    // Look for API provider info in smith output
    const hasXai = /XAI_API_KEY/.test(output) || /api-xai/.test(output) || /grok/.test(output);
    if (hasXai) {
      el.innerHTML = '<span class="text-green-400">xAI Grok</span> <span class="text-gray-500">— XAI_API_KEY configured</span>';
    } else {
      el.innerHTML = '<span class="text-gray-500">No API providers detected. Set XAI_API_KEY for Grok models.</span>';
    }
  } catch {
    el.textContent = "Unable to check";
  }
}

async function saveConfig() {
  if (!confirm("Save configuration changes to .forge.json?")) return;
  try {
    const agents = [...document.querySelectorAll(".cfg-agent-checkbox:checked")].map((c) => c.value);
    const modelDefault = document.getElementById("cfg-model-default").value;
    const updated = {
      ...currentConfig,
      agents,
      modelRouting: { ...(currentConfig.modelRouting || {}), default: modelDefault },
    };
    const res = await fetch(`${API_BASE}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    const result = await res.json();
    document.getElementById("cfg-status").textContent = result.success ? "Saved successfully." : `Error: ${result.error}`;
    addNotification("Configuration saved", "success");
  } catch (err) {
    document.getElementById("cfg-status").textContent = `Error: ${err.message}`;
  }
}

window.loadConfig = loadConfig;
window.saveConfig = saveConfig;

// ─── Init ─────────────────────────────────────────────────────────────
// Load initial status
fetch(`${API_BASE}/api/status`)
  .then((r) => r.json())
  .then((data) => {
    if (data.status === "completed" || data.status === "failed") {
      document.getElementById("run-plan-name").textContent = shortName(data.plan);
      document.getElementById("run-progress-text").textContent = data.report || `Last run: ${data.status}`;
      document.getElementById("run-status").textContent = data.status === "completed" ? "Last: pass" : "Last: fail";
    }
  })
  .catch(() => {});

// Connect WebSocket
connectWebSocket();

// Load notifications from localStorage
renderNotifications();

// Tab load hooks
const tabLoadHooks = {
  replay: loadReplayRuns,
  extensions: loadExtensions,
  config: loadConfig,
  traces: loadTraces,
};

// ─── Traces Tab (v2.4) ───────────────────────────────────────────────
let traceData = null;

async function loadTraces() {
  try {
    const res = await fetch(`${API_BASE}/api/traces`);
    const runs = await res.json();
    const select = document.getElementById("trace-run-select");
    select.innerHTML = '<option value="">Select a run...</option>' +
      runs.map((r) => {
        const date = r.startTime ? new Date(r.startTime).toLocaleString() : "—";
        const status = r.status === "completed" ? "✅" : "❌";
        return `<option value="${r.dir}">${status} ${date} — ${r.plan?.split("/").pop() || "unknown"}</option>`;
      }).join("");
  } catch {
    document.getElementById("waterfall-bars").innerHTML = '<p class="text-red-400 text-center py-8">Failed to load traces</p>';
  }
}

async function loadTraceDetail() {
  const runId = document.getElementById("trace-run-select").value;
  if (!runId) return;

  try {
    const res = await fetch(`${API_BASE}/api/traces/${encodeURIComponent(runId)}`);
    traceData = await res.json();
    renderWaterfall(traceData);
  } catch {
    document.getElementById("waterfall-bars").innerHTML = '<p class="text-red-400 text-center py-8">Failed to load trace</p>';
  }
}

// ─── Skill Event Handlers ─────────────────────────────────────────────

function handleSkillStarted(data) {
  const skillRun = {
    name: data.skillName,
    startTime: data.timestamp || new Date().toISOString(),
    status: "running",
    steps: [],
    stepCount: data.stepCount || 0,
  };
  state.skillRuns.unshift(skillRun);
  // Keep last 20 skill runs
  if (state.skillRuns.length > 20) state.skillRuns.pop();
  renderSkillTimeline();
}

function handleSkillStepStarted(data) {
  const run = state.skillRuns.find((r) => r.name === data.skillName && r.status === "running");
  if (!run) return;
  run.steps.push({
    number: data.stepNumber,
    name: data.stepName,
    status: "executing",
    startTime: data.timestamp,
  });
  renderSkillTimeline();
}

function handleSkillStepCompleted(data) {
  const run = state.skillRuns.find((r) => r.name === data.skillName && r.status === "running");
  if (!run) return;
  const step = run.steps.find((s) => s.number === data.stepNumber);
  if (step) {
    step.status = data.status || "passed";
    step.duration = data.duration;
  }
  renderSkillTimeline();
}

function handleSkillCompleted(data) {
  const run = state.skillRuns.find((r) => r.name === data.skillName && r.status === "running");
  if (run) {
    run.status = data.status || "completed";
    run.duration = data.totalDuration;
    run.stepsPassed = data.stepsPassed;
    run.stepsFailed = data.stepsFailed;
  }
  renderSkillTimeline();
}

function renderSkillTimeline() {
  const container = document.getElementById("skill-timeline");
  if (!container) return;

  if (state.skillRuns.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-center py-8">No skill executions yet. Invoke a skill via <code>/skill-name</code> or <code>forge_run_skill</code>.</div>';
    return;
  }

  container.innerHTML = state.skillRuns.map((run) => {
    const statusIcon = { running: "⚡", completed: "✅", failed: "❌" }[run.status] || "❓";
    const bgColor = { running: "bg-blue-900/50", completed: "bg-green-900/30", failed: "bg-red-900/30" }[run.status] || "bg-gray-800";
    const duration = run.duration ? `${(run.duration / 1000).toFixed(1)}s` : "...";

    const stepsHtml = run.steps.map((s) => {
      const sIcon = { executing: "⚡", passed: "✅", failed: "❌" }[s.status] || "⏳";
      const sDur = s.duration ? `${(s.duration / 1000).toFixed(1)}s` : "";
      return `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${s.status === "failed" ? "bg-red-900/50 text-red-300" : "bg-gray-700 text-gray-300"}">${sIcon} ${s.name} ${sDur}</span>`;
    }).join(" ");

    return `
      <div class="p-3 rounded ${bgColor} border border-gray-700 mb-2">
        <div class="flex justify-between items-center mb-1">
          <span class="font-medium text-white">${statusIcon} /${run.name}</span>
          <span class="text-xs text-gray-400">${duration}</span>
        </div>
        <div class="flex flex-wrap gap-1">${stepsHtml}</div>
        ${run.status !== "running" ? `<div class="text-xs text-gray-500 mt-1">${run.stepsPassed || 0} passed, ${run.stepsFailed || 0} failed</div>` : ""}
      </div>
    `;
  }).join("");
}

function renderWaterfall(trace) {
  const container = document.getElementById("waterfall-bars");
  const spans = trace.spans || [];
  if (spans.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">No spans in trace</p>';
    return;
  }

  // Calculate time range
  const times = spans.flatMap((s) => [new Date(s.startTime).getTime(), s.endTime ? new Date(s.endTime).getTime() : Date.now()]);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const range = maxTime - minTime || 1;

  container.innerHTML = spans.map((span, idx) => {
    const start = new Date(span.startTime).getTime();
    const end = span.endTime ? new Date(span.endTime).getTime() : Date.now();
    const left = ((start - minTime) / range * 100).toFixed(1);
    const width = Math.max(((end - start) / range * 100), 1).toFixed(1);
    const duration = ((end - start) / 1000).toFixed(1);

    const color = span.status === "OK" ? "bg-green-600" :
                  span.status === "ERROR" ? "bg-red-600" :
                  span.kind === "CLIENT" ? "bg-purple-600" : "bg-blue-600";

    const indent = span.parentSpanId ? (span.kind === "CLIENT" ? "ml-8" : "ml-4") : "";
    const kindBadge = span.kind === "SERVER" ? "🌐" : span.kind === "CLIENT" ? "📡" : "⚙️";

    return `
      <div class="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-700/50 rounded px-2 ${indent}" onclick="showSpanDetail(${idx})">
        <span class="text-xs text-gray-500 w-32 truncate">${kindBadge} ${span.name}</span>
        <div class="flex-1 relative h-5">
          <div class="absolute h-full rounded ${color} opacity-80" style="left:${left}%;width:${width}%"></div>
        </div>
        <span class="text-xs text-gray-500 w-16 text-right">${duration}s</span>
      </div>
    `;
  }).join("");
}

function showSpanDetail(idx) {
  if (!traceData) return;
  const span = traceData.spans[idx];

  // Events
  const eventsEl = document.getElementById("trace-events");
  if (span.events?.length > 0) {
    eventsEl.innerHTML = span.events.map((e) => {
      const color = e.severity === "ERROR" ? "text-red-400" :
                    e.severity === "WARN" ? "text-yellow-400" : "text-gray-300";
      const time = new Date(e.time).toLocaleTimeString();
      return `<div class="${color}">[${time}] ${e.severity} ${e.name} ${JSON.stringify(e.attributes || {})}</div>`;
    }).join("");
  } else {
    eventsEl.innerHTML = '<p class="text-gray-500">No events</p>';
  }

  // Attributes
  const attrsEl = document.getElementById("trace-attributes");
  const attrs = { ...span.attributes, status: span.status, kind: span.kind, spanId: span.spanId };
  if (span.logSummary?.length > 0) attrs.logSummary = span.logSummary;
  attrsEl.textContent = JSON.stringify(attrs, null, 2);
}

function filterTraceEvents(severity) {
  if (!traceData) return;
  const eventsEl = document.getElementById("trace-events");
  const allEvents = traceData.spans.flatMap((s) => (s.events || []).map((e) => ({ ...e, span: s.name })));
  const filtered = severity === "all" ? allEvents : allEvents.filter((e) => e.severity === severity);

  if (filtered.length === 0) {
    eventsEl.innerHTML = `<p class="text-gray-500">No ${severity} events</p>`;
    return;
  }
  eventsEl.innerHTML = filtered.map((e) => {
    const color = e.severity === "ERROR" ? "text-red-400" : e.severity === "WARN" ? "text-yellow-400" : "text-gray-300";
    const time = new Date(e.time).toLocaleTimeString();
    return `<div class="${color}">[${time}] ${e.span} → ${e.name} ${JSON.stringify(e.attributes || {})}</div>`;
  }).join("");
}

window.loadTraceDetail = loadTraceDetail;
window.showSpanDetail = showSpanDetail;
window.filterTraceEvents = filterTraceEvents;

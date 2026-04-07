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
  pendingApprovals: [], // Pending bridge approval gates
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
    if (btn.dataset.tab === "runs") { loadRuns(); tabBadgeState.runsNew = 0; updateTabBadges(); }
    if (btn.dataset.tab === "cost") { loadCost(); tabBadgeState.hasAnomaly = false; updateTabBadges(); }
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
        startHubPolling();
        document.getElementById("ws-port").textContent = `WS :${info.port}`;
      };

      ws.onclose = () => {
        state.connected = false;
        updateConnectionBadge(false);
        stopHubPolling();
        // Reconnect after 3s
        setTimeout(connectWebSocket, 3000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleEvent(data);
          appendEventLog(data);
          // Notification hooks for key lifecycle events
          if (data.type === "run-completed") {
            const d = data.data || data;
            addNotification(`Run complete: ${d.report || d.status}`, d.status === "completed" ? "success" : "error");
          } else if (data.type === "slice-failed") {
            const d = data.data || data;
            addNotification(`Slice ${d.sliceId} failed: ${d.error || ""}`, "error");
          }
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
      loadRuns(); // Auto-refresh runs table
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
      loadRuns(); // Auto-refresh runs table
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
  startSliceTimer(data.sliceId);
  updateProgress();
  renderSliceCards();
  // Auto-scroll to executing slice
  setTimeout(() => {
    const card = document.querySelector(`[data-slice-id="${data.sliceId}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 100);
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
  stopSliceTimer(data.sliceId);
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
  stopSliceTimer(data.sliceId);
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
  // Tab badges + sound
  tabBadgeState.runsNew++;
  updateTabBadges();
  playNotificationSound(data.status === "completed" ? "success" : "error");
  // Check if bridge raised an approval gate
  checkBridgeEscalation();
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

  const runId = state.runMeta?.runId;
  const isEscalated = runId && state.pendingApprovals.some((a) => a.runId === runId && a.status === "pending");
  const escalationBanner = isEscalated
    ? `<div class="col-span-full flex items-center gap-2 bg-amber-900/40 border border-amber-700 rounded-lg px-4 py-2 text-sm text-amber-300">
        <span class="text-lg">🔔</span>
        <span class="font-semibold">Awaiting Approval</span>
        <span class="text-amber-400/70 text-xs ml-1">— bridge escalation active, run paused for external sign-off</span>
       </div>`
    : "";

  container.innerHTML = escalationBanner + state.slices.map((s) => {
    const statusIcon = { pending: "⏳", executing: "⚡", passed: "✅", failed: "❌", skipped: "⏭️" }[s.status] || "❓";
    const bgColor = { pending: "bg-gray-800", executing: "bg-blue-900/50 slice-executing", passed: "bg-green-900/30", failed: "bg-red-900/30", skipped: "bg-gray-800/50" }[s.status] || "bg-gray-800";
    const duration = s.duration ? `${(s.duration / 1000).toFixed(1)}s` : "";
    const cost = s.cost ? `$${s.cost.toFixed(4)}` : "";
    const model = s.model || "";
    const isApiModel = /^grok-/.test(model);
    const modelBadge = isApiModel ? `<span class="text-purple-400">${model}</span> <span class="text-xs text-purple-600">API</span>` : model;
    const elapsed = s.status === "executing" ? '<span class="slice-elapsed text-xs text-blue-300 ml-1">0s</span>' : "";
    const escalatedMark = isEscalated && (s.status === "passed" || s.status === "failed")
      ? `<span class="text-amber-400 text-xs ml-1" title="Awaiting bridge approval">🔔</span>`
      : "";

    return `
      <div class="slice-card ${bgColor} rounded-lg p-3 border border-gray-700" data-slice-id="${s.id}">
        <div class="flex items-center justify-between mb-1">
          <span class="font-semibold text-sm">${statusIcon} Slice ${s.id}${escalatedMark}</span>
          <span class="text-xs text-gray-500">${duration}${elapsed}</span>
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

// ─── Runs Tab ──────────
let allRuns = [];
let filteredRuns = [];
let sortColumn = "date";
let sortDirection = "desc";
let selectedRunIdx = -1;
let compareMode = false;
let compareSelections = [];

async function loadRuns() {
  try {
    const res = await fetch(`${API_BASE}/api/runs`);
    allRuns = await res.json();
    populateFilterDropdowns(allRuns);
    applyRunFilters();
  } catch (err) {
    document.getElementById("runs-table-body").innerHTML =
      `<tr><td colspan="8" class="px-4 py-8 text-center text-red-400">Error: ${err.message}</td></tr>`;
  }
}

function populateFilterDropdowns(runs) {
  const plans = [...new Set(runs.map((r) => shortName(r.plan)).filter(Boolean))];
  const models = [...new Set(runs.map((r) => r.model).filter(Boolean))];
  const planSel = document.getElementById("filter-plan");
  const modelSel = document.getElementById("filter-model");
  planSel.innerHTML = '<option value="">All Plans</option>' + plans.map((p) => `<option value="${p}">${p}</option>`).join("");
  modelSel.innerHTML = '<option value="">All Models</option>' + models.map((m) => `<option value="${m}">${m}</option>`).join("");
}

function applyRunFilters() {
  const planFilter = document.getElementById("filter-plan").value;
  const statusFilter = document.getElementById("filter-status").value;
  const modelFilter = document.getElementById("filter-model").value;
  const modeFilter = document.getElementById("filter-mode").value;
  const dateStart = document.getElementById("filter-date-start").value;
  const dateEnd = document.getElementById("filter-date-end").value;

  filteredRuns = allRuns.filter((r) => {
    if (planFilter && shortName(r.plan) !== planFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (modelFilter && r.model !== modelFilter) return false;
    if (modeFilter && r.mode !== modeFilter) return false;
    if (dateStart && r.startTime && new Date(r.startTime) < new Date(dateStart)) return false;
    if (dateEnd && r.startTime && new Date(r.startTime) > new Date(dateEnd + "T23:59:59")) return false;
    return true;
  });

  applySorting();
  renderRunsTable();
}

function clearRunFilters() {
  document.getElementById("filter-plan").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-model").value = "";
  document.getElementById("filter-mode").value = "";
  document.getElementById("filter-date-start").value = "";
  document.getElementById("filter-date-end").value = "";
  applyRunFilters();
}

function sortRuns(col) {
  if (sortColumn === col) {
    sortDirection = sortDirection === "asc" ? "desc" : sortDirection === "desc" ? "none" : "asc";
  } else {
    sortColumn = col;
    sortDirection = "asc";
  }
  // Update sort indicators
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.textContent = th.textContent.replace(/ [▲▼]/g, "");
    if (th.dataset.sort === sortColumn && sortDirection !== "none") {
      th.textContent += sortDirection === "asc" ? " ▲" : " ▼";
    }
  });
  applySorting();
  renderRunsTable();
}

function applySorting() {
  if (sortDirection === "none") return;
  const dir = sortDirection === "asc" ? 1 : -1;
  filteredRuns.sort((a, b) => {
    switch (sortColumn) {
      case "date": return dir * (new Date(a.startTime || 0) - new Date(b.startTime || 0));
      case "plan": return dir * (shortName(a.plan) || "").localeCompare(shortName(b.plan) || "");
      case "mode": return dir * (a.mode || "").localeCompare(b.mode || "");
      case "model": return dir * (a.model || "").localeCompare(b.model || "");
      case "slices": {
        const ra = (a.results?.passed || 0) / (a.sliceCount || 1);
        const rb = (b.results?.passed || 0) / (b.sliceCount || 1);
        return dir * (ra - rb);
      }
      case "status": return dir * (a.status || "").localeCompare(b.status || "");
      case "cost": return dir * ((a.cost?.total_cost_usd || 0) - (b.cost?.total_cost_usd || 0));
      case "duration": return dir * ((a.totalDuration || 0) - (b.totalDuration || 0));
      default: return 0;
    }
  });
}

function renderRunsTable() {
  const tbody = document.getElementById("runs-table-body");
  document.getElementById("runs-count").textContent = `Showing ${filteredRuns.length} of ${allRuns.length} runs`;
  if (!filteredRuns.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-500">No runs match filters</td></tr>';
    return;
  }
  tbody.innerHTML = filteredRuns.map((r, idx) => {
    const origIdx = allRuns.indexOf(r);
    const date = r.startTime ? new Date(r.startTime).toLocaleDateString() : "—";
    const plan = shortName(r.plan);
    const modeColors = { auto: "blue", assisted: "amber", estimate: "gray" };
    const modeColor = modeColors[r.mode] || "gray";
    const mode = r.mode ? `<span class="px-1.5 py-0.5 text-xs rounded bg-${modeColor}-500/20 text-${modeColor}-400">${r.mode}</span>` : "—";
    const model = r.model ? `<span class="text-xs text-gray-400">${r.model}</span>` : "—";
    const slices = `${r.results?.passed || 0}/${r.sliceCount || 0}`;
    const isPendingApproval = state.pendingApprovals.some((a) => a.runId === r.runId && a.status === "pending");
    const status = isPendingApproval
      ? '<span class="text-amber-400">🔔 approval</span>'
      : r.status === "completed"
        ? '<span class="text-green-400">✅ pass</span>'
        : '<span class="text-red-400">❌ fail</span>';
    const cost = r.cost?.total_cost_usd != null ? `$${r.cost.total_cost_usd.toFixed(2)}` : "—";
    const dur = r.totalDuration ? `${(r.totalDuration / 1000).toFixed(0)}s` : "—";
    const sel = selectedRunIdx === idx ? "row-selected" : "";
    const cmp = compareSelections.includes(idx) ? "row-compare" : "";
    const clickHandler = compareMode ? `toggleCompareSelection(${idx})` : `openRunDrawer(${origIdx})`;
    return `<tr class="border-t border-gray-700 hover:bg-gray-700/50 cursor-pointer ${sel} ${cmp}" data-row-idx="${idx}" onclick="${clickHandler}">
      <td class="px-4 py-2">${date}</td>
      <td class="px-4 py-2">${plan}</td>
      <td class="px-4 py-2 text-center hide-tablet">${mode}</td>
      <td class="px-4 py-2 hide-tablet">${model}</td>
      <td class="px-4 py-2 text-center">${slices}</td>
      <td class="px-4 py-2 text-center">${status}</td>
      <td class="px-4 py-2 text-right">${cost}</td>
      <td class="px-4 py-2 text-right">${dur}</td>
    </tr>`;
  }).join("");
}

// ─── Run Detail Drawer ─────────────────────────────────────────
async function openRunDrawer(runIdx) {
  try {
    const res = await fetch(`${API_BASE}/api/runs/${runIdx}`);
    if (!res.ok) throw new Error("Run not found");
    const data = await res.json();
    const s = data.summary;
    const title = document.getElementById("drawer-title");
    const content = document.getElementById("drawer-content");
    title.textContent = shortName(s.plan);

    const modeColors = { auto: "blue", assisted: "amber", estimate: "gray" };
    const mc = modeColors[s.mode] || "gray";
    // Find first failed slice for resume
    const firstFailed = data.slices.find((sl) => sl.status === "failed");
    const resumeBtn = firstFailed ? `<button onclick="resumeRunFromDrawer('${escHtml(s.plan)}', ${firstFailed.number || firstFailed.sliceId})" class="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 rounded text-white">Resume from Slice ${firstFailed.number || firstFailed.sliceId}</button>` : "";
    const header = `
      <div class="space-y-2 mb-4 text-sm">
        <div class="flex gap-2 flex-wrap">
          <span class="px-2 py-0.5 rounded text-xs bg-${mc}-500/20 text-${mc}-400">${s.mode || "auto"}</span>
          <span class="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">${s.model || "unknown"}</span>
          <span class="px-2 py-0.5 rounded text-xs ${s.status === "completed" ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}">${s.status}</span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs text-gray-400">
          <div>Cost: <span class="text-white">$${(s.cost?.total_cost_usd || 0).toFixed(2)}</span></div>
          <div>Duration: <span class="text-white">${s.totalDuration ? (s.totalDuration / 1000).toFixed(0) + "s" : "—"}</span></div>
          <div>Slices: <span class="text-white">${s.results?.passed || 0}/${s.sliceCount || 0}</span></div>
        </div>
        <div class="text-xs text-gray-500">${s.startTime ? new Date(s.startTime).toLocaleString() : ""}</div>
        ${resumeBtn}
      </div>`;

    const sliceCards = data.slices.map((sl) => {
      const icon = sl.status === "passed" ? "✅" : sl.status === "failed" ? "❌" : "⏭️";
      const borderColor = sl.status === "passed" ? "border-green-700/40" : sl.status === "failed" ? "border-red-700/40" : "border-gray-700";
      const dur = sl.duration ? `${(sl.duration / 1000).toFixed(1)}s` : "—";
      const tokIn = sl.tokens?.in || sl.tokens_in || 0;
      const tokOut = sl.tokens?.out || sl.tokens_out || 0;

      let errorBlock = "";
      if (sl.status === "failed") {
        errorBlock = `<div class="mt-2 bg-red-900/30 border border-red-700/40 rounded p-2 text-xs">
          ${sl.gateError ? `<p class="text-red-300 mb-1">${escHtml(sl.gateError)}</p>` : ""}
          ${sl.failedCommand ? `<pre class="text-red-200 font-mono text-xs whitespace-pre-wrap">${escHtml(sl.failedCommand)}</pre>` : ""}
          ${sl.gateOutput ? `<details class="mt-1"><summary class="text-red-400 cursor-pointer">Gate output</summary><pre class="text-xs text-gray-300 mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">${escHtml(sl.gateOutput)}</pre></details>` : ""}
        </div>`;
      }

      let gateBlock = "";
      if (sl.status === "passed" && sl.gateOutput) {
        gateBlock = `<details class="mt-2"><summary class="text-xs text-gray-500 cursor-pointer">Gate output</summary><pre class="text-xs text-gray-400 mt-1 whitespace-pre-wrap max-h-24 overflow-y-auto">${escHtml(sl.gateOutput)}</pre></details>`;
      }

      // Slice detail: tasks, commands
      let detailBlock = "";
      const tasks = sl.tasks || [];
      const buildCmd = sl.buildCommand || sl.build_command;
      const testCmd = sl.testCommand || sl.test_command;
      if (tasks.length > 0 || buildCmd || testCmd) {
        detailBlock = `<details class="mt-2"><summary class="text-xs text-gray-500 cursor-pointer">Tasks & commands</summary><div class="mt-1 text-xs space-y-1">
          ${tasks.length > 0 ? `<ol class="list-decimal ml-4 text-gray-400">${tasks.map((t) => `<li>${escHtml(typeof t === "string" ? t : t.description || t.name || JSON.stringify(t))}</li>`).join("")}</ol>` : ""}
          ${buildCmd ? `<div class="text-gray-500">Build: <code class="bg-gray-700 px-1 rounded text-gray-300">${escHtml(buildCmd)}</code></div>` : ""}
          ${testCmd ? `<div class="text-gray-500">Test: <code class="bg-gray-700 px-1 rounded text-gray-300">${escHtml(testCmd)}</code></div>` : ""}
        </div></details>`;
      }

      const routingBlock = sl.escalatedModel
        ? `<div class="mt-1 text-xs text-amber-400/80">⬆ Recommended: <span class="font-mono">${escHtml(sl.escalatedModel)}</span> → Used: <span class="font-mono">${escHtml(sl.model || "auto")}</span> <span class="text-amber-600">(escalated)</span></div>`
        : (sl.model ? `<div class="mt-1 text-xs text-gray-500">Model: <span class="font-mono text-gray-400">${escHtml(sl.model)}</span></div>` : "");

      return `<div class="border ${borderColor} rounded-lg p-3 mb-2">
        <div class="flex justify-between items-center">
          <span class="font-medium text-sm">${icon} Slice ${sl.number || sl.sliceId}: ${escHtml(sl.title || "")}</span>
          <span class="text-xs text-gray-500">${dur}</span>
        </div>
        <div class="flex gap-3 mt-1 text-xs text-gray-400">
          <span>${sl.worker || "cli"}</span>
          <span>${tokIn.toLocaleString()} in / ${tokOut.toLocaleString()} out</span>
          <span>$${(sl.cost_usd || 0).toFixed(4)}</span>
        </div>
        ${routingBlock}
        ${errorBlock}${gateBlock}${detailBlock}
      </div>`;
    }).join("");

    content.innerHTML = header + sliceCards;
    document.getElementById("run-detail-drawer").classList.add("open");
    document.getElementById("drawer-overlay").classList.add("open");
  } catch (err) {
    console.error("Drawer error:", err);
  }
}

function closeRunDrawer() {
  document.getElementById("run-detail-drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("open");
}

window.openRunDrawer = openRunDrawer;
window.closeRunDrawer = closeRunDrawer;
window.applyRunFilters = applyRunFilters;
window.clearRunFilters = clearRunFilters;
window.sortRuns = sortRuns;

function resumeRunFromDrawer(plan, fromSlice) {
  if (!confirm(`Resume "${plan}" from slice ${fromSlice}?\nCompleted slices will be skipped.`)) return;
  closeRunDrawer();
  runAction("run-plan", `${plan} --resume-from ${fromSlice}`);
  addNotification(`Resuming ${plan} from slice ${fromSlice}`, "info");
}

window.resumeRunFromDrawer = resumeRunFromDrawer;

// ─── Run Comparison ────────────────────────────────────────────
function toggleCompareMode() {
  compareMode = !compareMode;
  compareSelections = [];
  const btn = document.getElementById("compare-btn");
  btn.textContent = compareMode ? "Cancel Compare" : "Compare";
  btn.className = compareMode
    ? "text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 rounded ml-1 text-white"
    : "text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded ml-1";
  if (!compareMode) document.getElementById("compare-panel").classList.add("hidden");
  renderRunsTable();
}

function toggleCompareSelection(idx) {
  const pos = compareSelections.indexOf(idx);
  if (pos >= 0) { compareSelections.splice(pos, 1); }
  else if (compareSelections.length < 2) { compareSelections.push(idx); }
  else { compareSelections.shift(); compareSelections.push(idx); }
  renderRunsTable();
  if (compareSelections.length === 2) showComparison();
}

function showComparison() {
  const a = filteredRuns[compareSelections[0]];
  const b = filteredRuns[compareSelections[1]];
  if (!a || !b) return;

  const costA = a.cost?.total_cost_usd || 0, costB = b.cost?.total_cost_usd || 0;
  const durA = a.totalDuration || 0, durB = b.totalDuration || 0;
  const tokA = (a.cost?.total_tokens_in || 0) + (a.cost?.total_tokens_out || 0);
  const tokB = (b.cost?.total_tokens_in || 0) + (b.cost?.total_tokens_out || 0);

  function delta(va, vb, fmt, lowerBetter = true) {
    const diff = va - vb;
    const color = (lowerBetter ? diff < 0 : diff > 0) ? "text-green-400" : diff === 0 ? "text-gray-400" : "text-red-400";
    const sign = diff > 0 ? "+" : "";
    return `<span class="${color}">${sign}${fmt(diff)}</span>`;
  }

  const fmtCost = (v) => `$${v.toFixed(2)}`;
  const fmtDur = (v) => `${(v / 1000).toFixed(0)}s`;
  const fmtTok = (v) => v.toLocaleString();

  const panel = document.getElementById("compare-content");
  panel.innerHTML = `
    <div class="bg-gray-700/50 rounded p-3">
      <h4 class="text-xs text-gray-500 mb-2">Run A — ${new Date(a.startTime).toLocaleDateString()}</h4>
      <p class="font-medium">${shortName(a.plan)}</p>
      <p class="text-xs text-gray-400">${a.mode} · ${a.model}</p>
      <div class="grid grid-cols-3 gap-2 mt-2 text-xs">
        <div>Cost: <span class="text-white">${fmtCost(costA)}</span></div>
        <div>Duration: <span class="text-white">${fmtDur(durA)}</span></div>
        <div>Tokens: <span class="text-white">${fmtTok(tokA)}</span></div>
      </div>
      <p class="text-xs mt-1">${a.results?.passed || 0}/${a.sliceCount || 0} passed · ${a.status}</p>
    </div>
    <div class="bg-gray-700/50 rounded p-3">
      <h4 class="text-xs text-gray-500 mb-2">Run B — ${new Date(b.startTime).toLocaleDateString()}</h4>
      <p class="font-medium">${shortName(b.plan)}</p>
      <p class="text-xs text-gray-400">${b.mode} · ${b.model}</p>
      <div class="grid grid-cols-3 gap-2 mt-2 text-xs">
        <div>Cost: <span class="text-white">${fmtCost(costB)}</span></div>
        <div>Duration: <span class="text-white">${fmtDur(durB)}</span></div>
        <div>Tokens: <span class="text-white">${fmtTok(tokB)}</span></div>
      </div>
      <p class="text-xs mt-1">${b.results?.passed || 0}/${b.sliceCount || 0} passed · ${b.status}</p>
    </div>
    <div class="col-span-2 bg-gray-700/30 rounded p-3 text-center text-sm">
      <span class="text-gray-400">Δ Cost:</span> ${delta(costA, costB, fmtCost)}
      <span class="ml-4 text-gray-400">Δ Duration:</span> ${delta(durA, durB, fmtDur)}
      <span class="ml-4 text-gray-400">Δ Tokens:</span> ${delta(tokA, tokB, fmtTok)}
    </div>`;
  document.getElementById("compare-panel").classList.remove("hidden");
}

function closeComparison() {
  compareMode = false;
  compareSelections = [];
  document.getElementById("compare-panel").classList.add("hidden");
  document.getElementById("compare-btn").textContent = "Compare";
  document.getElementById("compare-btn").className = "text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded ml-1";
  renderRunsTable();
}

window.toggleCompareMode = toggleCompareMode;
window.toggleCompareSelection = toggleCompareSelection;
window.closeComparison = closeComparison;

// ─── Export ────────────────────────────────────────────────────
function toggleExportMenu(id) {
  document.getElementById(`export-menu-${id}`).classList.toggle("hidden");
}

function exportRuns(format) {
  document.getElementById("export-menu-runs").classList.add("hidden");
  const data = filteredRuns;
  if (format === "json") {
    downloadFile("plan-forge-runs.json", JSON.stringify(data, null, 2), "application/json");
  } else {
    const headers = "Date,Plan,Mode,Model,Slices Passed,Slices Total,Status,Cost,Duration\n";
    const rows = data.map((r) => [
      r.startTime ? new Date(r.startTime).toISOString() : "",
      `"${shortName(r.plan).replace(/"/g, '""')}"`,
      r.mode || "", r.model || "",
      r.results?.passed || 0, r.sliceCount || 0,
      r.status || "",
      r.cost?.total_cost_usd?.toFixed(4) || 0,
      r.totalDuration ? (r.totalDuration / 1000).toFixed(0) : 0,
    ].join(",")).join("\n");
    downloadFile("plan-forge-runs.csv", headers + rows, "text/csv");
  }
}

function exportCost(format) {
  document.getElementById("export-menu-cost").classList.add("hidden");
  fetch(`${API_BASE}/api/cost`).then((r) => r.json()).then((data) => {
    if (format === "csv") {
      const rows = [["Model", "Cost ($)", "Tokens In", "Tokens Out", "Runs"]];
      if (data.by_model) {
        for (const [model, m] of Object.entries(data.by_model)) {
          rows.push([model, (m.cost_usd || 0).toFixed(4), m.tokens_in || 0, m.tokens_out || 0, m.runs || 0]);
        }
      }
      rows.push(["TOTAL", (data.total_cost_usd || 0).toFixed(4), data.total_tokens_in || 0, data.total_tokens_out || 0, data.runs || 0]);
      downloadFile("plan-forge-cost-report.csv", rows.map((r) => r.join(",")).join("\n"), "text/csv");
    } else {
      downloadFile("plan-forge-cost-report.json", JSON.stringify(data, null, 2), "application/json");
    }
  });
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

window.toggleExportMenu = toggleExportMenu;
window.exportRuns = exportRuns;
window.exportCost = exportCost;

// ─── Cost Tab ────────────────────────────
async function loadCost() {
  try {
    const [costRes, runsRes] = await Promise.all([
      fetch(`${API_BASE}/api/cost`),
      fetch(`${API_BASE}/api/runs`),
    ]);
    const data = await costRes.json();
    const runs = await runsRes.json();

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

    // Cost Trend Line 
    if (runs.length > 0) {
      const runCosts = runs.slice().reverse().map((r) => r.cost?.total_cost_usd || 0);
      const runLabels = runs.slice().reverse().map((r) => r.startTime ? new Date(r.startTime).toLocaleDateString() : "?");
      const avg = runCosts.reduce((a, b) => a + b, 0) / runCosts.length;
      const pointColors = runCosts.map((c) => {
        if (c > avg * 3) return "#ef4444";
        if (c > avg * 2) return "#f59e0b";
        return "#10b981";
      });
      const ctx = document.getElementById("chart-cost-trend");
      if (ctx) {
        if (state.charts["chart-cost-trend"]) state.charts["chart-cost-trend"].destroy();
        state.charts["chart-cost-trend"] = new Chart(ctx, {
          type: "line",
          data: {
            labels: runLabels,
            datasets: [
              {
                label: "Cost ($)",
                data: runCosts,
                borderColor: "#3b82f6",
                backgroundColor: "transparent",
                pointBackgroundColor: pointColors,
                pointRadius: 4,
                tension: 0.2,
              },
              {
                label: "Average",
                data: Array(runCosts.length).fill(avg),
                borderColor: "#6b7280",
                borderDash: [5, 5],
                backgroundColor: "transparent",
                pointRadius: 0,
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: { labels: { color: "#9ca3af" } },
              tooltip: {
                callbacks: {
                  afterLabel: (ctx) => {
                    if (ctx.datasetIndex === 0) {
                      const diff = ((ctx.raw - avg) / avg * 100).toFixed(0);
                      return `${diff > 0 ? "+" : ""}${diff}% vs avg ($${avg.toFixed(4)})`;
                    }
                    return "";
                  },
                },
              },
            },
            scales: {
              y: { ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
              x: { ticks: { color: "#9ca3af", maxTicksLimit: 10 }, grid: { display: false } },
            },
          },
        });
      }

      // Anomaly banner 
      const recent = runs.slice(0, 5);
      const anomaly = recent.find((r) => (r.cost?.total_cost_usd || 0) > avg * 3 && avg > 0);
      if (anomaly) {
        const banner = document.getElementById("cost-anomaly-banner");
        const text = document.getElementById("cost-anomaly-text");
        const cost = anomaly.cost.total_cost_usd;
        const ratio = (cost / avg).toFixed(1);
        text.textContent = `⚠ Cost Spike: "${shortName(anomaly.plan)}" on ${new Date(anomaly.startTime).toLocaleDateString()} cost $${cost.toFixed(2)} — ${ratio}× above your $${avg.toFixed(4)} average`;
        banner.classList.remove("hidden");
        tabBadgeState.hasAnomaly = true;
        updateTabBadges();
      }

      // Duration Per Run Chart 
      const runDurations = runs.slice().reverse().map((r) => r.totalDuration ? r.totalDuration / 1000 : 0);
      const durCtx = document.getElementById("chart-duration-trend");
      if (durCtx && runDurations.some((d) => d > 0)) {
        if (state.charts["chart-duration-trend"]) state.charts["chart-duration-trend"].destroy();
        state.charts["chart-duration-trend"] = new Chart(durCtx, {
          type: "bar",
          data: {
            labels: runLabels,
            datasets: [{
              label: "Duration (s)",
              data: runDurations,
              backgroundColor: runDurations.map((d) => d > 300 ? "#ef4444" : d > 120 ? "#f59e0b" : "#3b82f6"),
              borderWidth: 0,
              borderRadius: 2,
            }],
          },
          options: {
            responsive: true,
            plugins: { legend: { labels: { color: "#9ca3af" } } },
            scales: {
              y: { ticks: { color: "#9ca3af" }, grid: { color: "#374151" }, title: { display: true, text: "seconds", color: "#6b7280" } },
              x: { ticks: { color: "#9ca3af", maxTicksLimit: 10 }, grid: { display: false } },
            },
          },
        });
      }
    }

    // Load model comparison
    loadModelComparison();
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

// ─── Plan Browser ─────────────────────────────────────────────
async function loadPlans() {
  const listEl = document.getElementById("plan-list");
  const countEl = document.getElementById("plan-count");
  if (!listEl) return;
  try {
    const res = await fetch(`${API_BASE}/api/plans`);
    const plans = await res.json();
    countEl.textContent = `(${plans.length})`;
    if (plans.length === 0) {
      listEl.innerHTML = '<p class="text-gray-500 text-sm py-2">No plan files found in docs/plans/</p>';
      return;
    }
    listEl.innerHTML = plans.map((p, pi) => {
      const icon = p.status.includes("Complete") ? "✅" : p.status.includes("Progress") ? "🚧" : p.status.includes("Paused") ? "⏸️" : "📋";
      const sliceCheckboxes = Array.from({ length: p.sliceCount }, (_, i) => {
        const num = i + 1;
        const sl = p.slices?.[i];
        const label = sl?.title || `Slice ${num}`;
        const pTag = sl?.parallel ? ' <span class="text-purple-400">[P]</span>' : "";
        const deps = sl?.depends?.length > 0 ? ` <span class="text-gray-600">→ ${sl.depends.join(",")}</span>` : "";
        return `<label class="inline-flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked data-plan="${pi}" data-slice="${num}" class="plan-slice-toggle rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-0 w-3 h-3">
          ${escHtml(label)}${pTag}${deps}
        </label>`;
      }).join(" ");

      // Scope contract rendering
      let scopeHtml = "";
      if (p.scopeContract) {
        const sc = p.scopeContract;
        const inScope = (sc.inScope || []).map((s) => `<span class="text-green-400 text-xs">✓ ${escHtml(s)}</span>`).join("<br>");
        const outScope = (sc.outOfScope || []).map((s) => `<span class="text-gray-500 text-xs">✗ ${escHtml(s)}</span>`).join("<br>");
        const forbidden = (sc.forbidden || []).map((s) => `<span class="text-red-400 text-xs">⛔ ${escHtml(s)}</span>`).join("<br>");
        scopeHtml = `<details class="mt-1 ml-7">
          <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Scope Contract</summary>
          <div class="grid grid-cols-3 gap-2 mt-1 py-1 text-xs">
            <div><p class="text-gray-500 font-semibold mb-1">In Scope</p>${inScope || '<span class="text-gray-600">—</span>'}</div>
            <div><p class="text-gray-500 font-semibold mb-1">Out of Scope</p>${outScope || '<span class="text-gray-600">—</span>'}</div>
            <div><p class="text-gray-500 font-semibold mb-1">Forbidden</p>${forbidden || '<span class="text-gray-600">—</span>'}</div>
          </div>
        </details>`;
      }

      return `
        <div class="py-2 border-b border-gray-700/50 last:border-0 group">
          <div class="flex items-center gap-3">
            <span class="text-sm">${icon}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-200 truncate">${p.title}</p>
              <p class="text-xs text-gray-500">${p.file} · ${p.sliceCount} slices${p.branch ? ` · ${p.branch}` : ""}</p>
            </div>
            <div class="flex gap-1 opacity-70 group-hover:opacity-100">
              <button onclick="estimatePlan('${p.file}')" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition">Estimate</button>
              <button onclick="runPlanFromBrowser('${p.file}', '${p.title}', ${p.sliceCount}, ${pi})" class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition">Run</button>
            </div>
          </div>
          ${scopeHtml}
          <details class="mt-1 ml-7">
            <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Select slices</summary>
            <div class="flex flex-wrap gap-2 mt-1 py-1">${sliceCheckboxes}</div>
          </details>
          ${renderDAGView(p.slices || [])}
          <div id="plan-est-${p.file.replace(/[^a-zA-Z0-9]/g, '_')}" class="hidden text-xs text-gray-400 w-full pl-8 pb-1"></div>
        </div>`;
    }).join("");
  } catch {
    listEl.innerHTML = '<p class="text-red-400 text-sm py-2">Failed to load plans</p>';
  }
}

async function estimatePlan(file) {
  const estId = `plan-est-${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const estEl = document.getElementById(estId);
  if (estEl) {
    estEl.classList.remove("hidden");
    estEl.textContent = "Estimating...";
  }
  try {
    const res = await fetch(`${API_BASE}/api/tool/run-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: `${file} --estimate` }),
    });
    const data = await res.json();
    if (estEl) estEl.textContent = data.output || data.error || "No estimate available";
  } catch (err) {
    if (estEl) estEl.textContent = `Error: ${err.message}`;
  }
}

function runPlanFromBrowser(file, title, sliceCount, planIdx) {
  // Gather unchecked slices to build --skip-slices arg
  const unchecked = [];
  for (let i = 1; i <= sliceCount; i++) {
    const cb = document.querySelector(`input.plan-slice-toggle[data-plan="${planIdx}"][data-slice="${i}"]`);
    if (cb && !cb.checked) unchecked.push(i);
  }
  const skipNote = unchecked.length > 0 ? `\nSkipping slices: ${unchecked.join(", ")}` : "";
  if (!confirm(`Run "${title}" with ${sliceCount - unchecked.length}/${sliceCount} slices?${skipNote}\n\nPlan: ${file}`)) return;
  const args = unchecked.length > 0 ? `${file} --skip-slices ${unchecked.join(",")}` : file;
  runAction("run-plan", args);
  addNotification(`Started run: ${title}${skipNote}`, "info");
}

window.loadPlans = loadPlans;
window.estimatePlan = estimatePlan;
window.runPlanFromBrowser = runPlanFromBrowser;

// ─── Launch Plan Panel ─────────────────────────────────────────
async function openLaunchPanel() {
  const modal = document.getElementById("launch-modal");
  const planSelect = document.getElementById("launch-plan");
  const workersEl = document.getElementById("launch-workers");
  modal.classList.remove("hidden");

  // Load available plans
  try {
    const res = await fetch(`${API_BASE}/api/plans`);
    const plans = await res.json();
    planSelect.innerHTML = plans.map((p) => `<option value="${p.file}">${p.title} (${p.sliceCount} slices)</option>`).join("");
  } catch {
    planSelect.innerHTML = '<option value="">No plans found</option>';
  }

  // Load workers
  try {
    const res = await fetch(`${API_BASE}/api/workers`);
    const workers = await res.json();
    const workerNames = Array.isArray(workers) ? workers.filter((w) => w.available).map((w) => w.name) : Object.values(workers).flat().map((w) => typeof w === "string" ? w : w.name);
    workersEl.innerHTML = workerNames.length > 0 ? `Available: ${workerNames.map((n) => `<span class="text-green-400">${escHtml(n)}</span>`).join(", ")}` : '<span class="text-yellow-400">No CLI workers detected</span>';
  } catch {
    workersEl.textContent = "";
  }
}

function closeLaunchPanel() {
  document.getElementById("launch-modal").classList.add("hidden");
  document.getElementById("launch-status").textContent = "";
}

async function submitLaunch(estimateOnly) {
  const plan = document.getElementById("launch-plan").value;
  const mode = document.getElementById("launch-mode").value;
  const model = document.getElementById("launch-model").value;
  const quorum = document.getElementById("launch-quorum").value;
  const estimate = estimateOnly || document.getElementById("launch-estimate").checked;
  const statusEl = document.getElementById("launch-status");

  if (!plan) { statusEl.textContent = "Select a plan first"; return; }
  if (!confirm(`${estimate ? "Estimate" : "Launch"} "${plan}"?\nMode: ${mode}, Model: ${model}, Quorum: ${quorum}`)) return;

  statusEl.textContent = estimate ? "Estimating..." : "Launching...";
  try {
    let args = plan;
    if (mode !== "auto") args += ` --${mode}`;
    if (model !== "auto") args += ` --model ${model}`;
    if (quorum !== "false") args += ` --quorum ${quorum}`;
    if (estimate) args += " --estimate";

    const res = await fetch(`${API_BASE}/api/tool/run-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const data = await res.json();
    if (estimate) {
      statusEl.innerHTML = `<pre class="whitespace-pre-wrap text-gray-300 mt-1">${escHtml(data.output || JSON.stringify(data, null, 2))}</pre>`;
    } else {
      closeLaunchPanel();
      addNotification(`Plan launched: ${plan}`, "success");
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

window.openLaunchPanel = openLaunchPanel;
window.closeLaunchPanel = closeLaunchPanel;
window.submitLaunch = submitLaunch;

// ─── Git Operations ───────────────────────────────────────────
async function runBranch() {
  const plan = prompt("Plan file path:", "docs/plans/");
  if (!plan) return;
  runAction("branch", plan);
}

async function runCommit() {
  const plan = prompt("Plan file path:", "docs/plans/");
  if (!plan) return;
  const slice = prompt("Slice number:");
  if (!slice) return;
  runAction("commit", `${plan} ${slice}`);
}

async function runDiff() {
  const plan = prompt("Plan file path:", "docs/plans/");
  if (!plan) return;
  // Use the standard runAction — the diff output will show in the action result panel
  const resultDiv = document.getElementById("action-result");
  const titleEl = document.getElementById("action-result-title");
  const outputEl = document.getElementById("action-result-output");
  titleEl.textContent = "Running: pforge diff " + plan;
  outputEl.textContent = "Loading...";
  resultDiv.classList.remove("hidden");
  try {
    const res = await fetch(`${API_BASE}/api/tool/diff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: plan }),
    });
    const data = await res.json();
    const output = data.output || data.error || "";
    // Color-code diff output with +/- line formatting
    const lines = output.split("\n");
    outputEl.innerHTML = lines.map((l) => {
      if (/forbidden|❌|FORBIDDEN/i.test(l)) return `<span class="text-red-400 font-semibold">${escHtml(l)}</span>`;
      if (/out.of.scope|⚠|WARNING/i.test(l)) return `<span class="text-yellow-400">${escHtml(l)}</span>`;
      if (/in.scope|✅|PASS/i.test(l)) return `<span class="text-green-400">${escHtml(l)}</span>`;
      if (/^\+/.test(l)) return `<span class="text-green-300 bg-green-900/20">${escHtml(l)}</span>`;
      if (/^-/.test(l)) return `<span class="text-red-300 bg-red-900/20">${escHtml(l)}</span>`;
      if (/^@@/.test(l)) return `<span class="text-cyan-400">${escHtml(l)}</span>`;
      if (/^diff|^index|^---|\+\+\+/.test(l)) return `<span class="text-gray-500 font-semibold">${escHtml(l)}</span>`;
      return escHtml(l);
    }).join("\n");
    titleEl.textContent = `diff: ${data.success ? "✅" : "❌"}`;
  } catch (err) {
    outputEl.textContent = `Error: ${err.message}`;
    titleEl.textContent = "diff: ❌";
  }
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

window.runBranch = runBranch;
window.runCommit = runCommit;
window.runDiff = runDiff;

// ─── Sweep Table ──────────────────────────────────────────────
async function runSweep() {
  const resultDiv = document.getElementById("action-result");
  const titleEl = document.getElementById("action-result-title");
  const outputEl = document.getElementById("action-result-output");
  titleEl.textContent = "Running: pforge sweep";
  outputEl.textContent = "Loading...";
  resultDiv.classList.remove("hidden");
  try {
    const res = await fetch(`${API_BASE}/api/tool/sweep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: "" }),
    });
    const data = await res.json();
    const output = data.output || "";
    titleEl.textContent = `sweep: ${data.success ? "✅" : "❌"}`;
    // Try to parse into structured table
    const markers = [];
    for (const line of output.split("\n")) {
      const m = line.match(/^(.+?):(\d+):\s*(TODO|FIXME|HACK|STUB|stub|placeholder|mock)\b[:\s]*(.*)/i);
      if (m) markers.push({ file: m[1].trim(), line: m[2], type: m[3].toUpperCase(), text: m[4].trim() });
    }
    if (markers.length > 0) {
      const typeColors = { TODO: "blue", FIXME: "amber", HACK: "red", STUB: "gray", PLACEHOLDER: "gray", MOCK: "gray" };
      const filters = `<div class="flex gap-1 mb-2">
        <button onclick="filterSweepTable('all')" class="text-xs px-2 py-1 bg-gray-600 rounded hover:bg-gray-500">All (${markers.length})</button>
        ${[...new Set(markers.map((m) => m.type))].map((t) =>
          `<button onclick="filterSweepTable('${t}')" class="text-xs px-2 py-1 bg-gray-600 rounded hover:bg-gray-500">${t} (${markers.filter((m) => m.type === t).length})</button>`
        ).join("")}
      </div>`;
      const rows = markers.map((m) => {
        const c = typeColors[m.type] || "gray";
        return `<tr class="sweep-row border-b border-gray-700/50" data-type="${m.type}">
          <td class="px-2 py-1 text-xs text-gray-300 truncate max-w-[200px]">${escHtml(m.file)}</td>
          <td class="px-2 py-1 text-xs text-gray-400">${m.line}</td>
          <td class="px-2 py-1"><span class="text-xs px-1.5 py-0.5 rounded bg-${c}-500/20 text-${c}-400">${m.type}</span></td>
          <td class="px-2 py-1 text-xs text-gray-300">${escHtml(m.text)}</td>
        </tr>`;
      }).join("");
      outputEl.innerHTML = filters + `<table class="w-full text-left"><thead class="text-xs text-gray-500"><tr>
        <th class="px-2 py-1">File</th><th class="px-2 py-1">Line</th><th class="px-2 py-1">Type</th><th class="px-2 py-1">Text</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    } else if (/clean|no.*markers|0 markers/i.test(output)) {
      outputEl.innerHTML = '<span class="text-green-400">✓ Clean — no TODO/FIXME markers</span>';
    } else {
      outputEl.textContent = output;
    }
  } catch (err) {
    outputEl.textContent = `Error: ${err.message}`;
    titleEl.textContent = "sweep: ❌";
  }
}

function filterSweepTable(type) {
  document.querySelectorAll(".sweep-row").forEach((row) => {
    row.style.display = (type === "all" || row.dataset.type === type) ? "" : "none";
  });
}

window.runSweep = runSweep;
window.filterSweepTable = filterSweepTable;

// ─── Model Comparison ─────────────────────────────────────────
async function loadModelComparison() {
  const el = document.getElementById("model-comparison");
  if (!el) return;
  try {
    const [costRes, runsRes] = await Promise.all([
      fetch(`${API_BASE}/api/cost`),
      fetch(`${API_BASE}/api/runs`),
    ]);
    const cost = await costRes.json();
    const runs = await runsRes.json();
    if (!cost.by_model || Object.keys(cost.by_model).length === 0) {
      el.innerHTML = '<p class="text-gray-500 text-sm">No run data available yet</p>';
      return;
    }
    // Aggregate per-model stats from runs
    const modelStats = {};
    for (const [model, data] of Object.entries(cost.by_model)) {
      modelStats[model] = {
        runs: data.runs || 0,
        cost: data.cost_usd || 0,
        tokens: (data.tokens_in || 0) + (data.tokens_out || 0),
        duration: data.duration || 0,
        passed: 0,
        total: 0,
      };
    }
    // Count pass/fail per model from run summaries
    for (const run of runs) {
      if (run.sliceResults) {
        for (const sr of run.sliceResults) {
          const model = sr.model || "unknown";
          if (!modelStats[model]) modelStats[model] = { runs: 0, cost: 0, tokens: 0, duration: 0, passed: 0, total: 0 };
          modelStats[model].total++;
          if (sr.status === "passed") modelStats[model].passed++;
        }
      }
    }
    const sorted = Object.entries(modelStats).sort((a, b) => b[1].runs - a[1].runs);

    // Pass-rate bar chart
    const chartCtx = document.getElementById("chart-model-perf");
    if (chartCtx && sorted.length > 0) {
      if (state.charts["chart-model-perf"]) state.charts["chart-model-perf"].destroy();
      const chartLabels = sorted.map(([m]) => m);
      const passRates = sorted.map(([, s]) => s.total > 0 ? parseFloat(((s.passed / s.total) * 100).toFixed(1)) : 0);
      const avgCosts = sorted.map(([, s]) => s.runs > 0 ? parseFloat((s.cost / s.runs).toFixed(4)) : 0);
      state.charts["chart-model-perf"] = new Chart(chartCtx, {
        type: "bar",
        data: {
          labels: chartLabels,
          datasets: [
            {
              label: "Pass Rate (%)",
              data: passRates,
              backgroundColor: passRates.map((r) => r >= 90 ? "#10b981" : r >= 70 ? "#f59e0b" : "#ef4444"),
              borderWidth: 0,
              borderRadius: 3,
              yAxisID: "yRate",
            },
            {
              label: "Avg Cost ($)",
              data: avgCosts,
              type: "line",
              borderColor: "#8b5cf6",
              backgroundColor: "transparent",
              pointBackgroundColor: "#8b5cf6",
              pointRadius: 4,
              tension: 0.2,
              yAxisID: "yCost",
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: "#9ca3af" } } },
          scales: {
            yRate: { position: "left", min: 0, max: 100, ticks: { color: "#9ca3af", callback: (v) => v + "%" }, grid: { color: "#374151" } },
            yCost: { position: "right", ticks: { color: "#8b5cf6", callback: (v) => "$" + v }, grid: { display: false } },
            x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
          },
        },
      });
    }

    el.innerHTML = `<table class="w-full text-sm">
      <thead class="text-xs text-gray-500 border-b border-gray-700">
        <tr><th class="px-3 py-2 text-left">Model</th><th class="px-3 py-2 text-right">Runs</th><th class="px-3 py-2 text-right">Pass Rate</th><th class="px-3 py-2 text-right">Avg Duration</th><th class="px-3 py-2 text-right">Avg Cost</th><th class="px-3 py-2 text-right">Tokens</th></tr>
      </thead>
      <tbody>${sorted.map(([model, s]) => {
        const passRate = s.total > 0 ? ((s.passed / s.total) * 100) : 0;
        const prColor = passRate >= 90 ? "text-green-400" : passRate >= 70 ? "text-amber-400" : "text-red-400";
        const avgDur = s.runs > 0 ? (s.duration / s.runs / 1000).toFixed(1) + "s" : "—";
        const avgCost = s.runs > 0 ? "$" + (s.cost / s.runs).toFixed(4) : "—";
        return `<tr class="border-b border-gray-700/50 hover:bg-gray-700/30">
          <td class="px-3 py-2 text-gray-200">${escHtml(model)}</td>
          <td class="px-3 py-2 text-right text-gray-400">${s.runs}</td>
          <td class="px-3 py-2 text-right ${prColor}">${s.total > 0 ? passRate.toFixed(0) + "%" : "—"}</td>
          <td class="px-3 py-2 text-right text-gray-400">${avgDur}</td>
          <td class="px-3 py-2 text-right text-gray-400">${avgCost}</td>
          <td class="px-3 py-2 text-right text-gray-400">${s.tokens.toLocaleString()}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  } catch {
    el.innerHTML = '<p class="text-red-400 text-sm">Failed to load model data</p>';
  }
}

// ─── Phase Status Editor ──────────────────────────────────────
async function runStatusEditable() {
  const resultDiv = document.getElementById("action-result");
  const titleEl = document.getElementById("action-result-title");
  const outputEl = document.getElementById("action-result-output");
  titleEl.textContent = "Running: pforge status";
  outputEl.textContent = "Loading...";
  resultDiv.classList.remove("hidden");
  try {
    const res = await fetch(`${API_BASE}/api/tool/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: "" }),
    });
    const data = await res.json();
    const output = data.output || "";
    titleEl.textContent = `status: ${data.success ? "✅" : "❌"}`;
    // Parse phase lines and add editable dropdowns
    const lines = output.split("\n");
    const parsed = lines.map((line) => {
      const m = line.match(/^(.*?)(📋\s*Planned|🚧\s*In Progress|✅\s*Complete|⏸️\s*Paused)\s*$/);
      if (!m) return { raw: line, editable: false };
      // Try to extract plan file reference from the line
      const planMatch = line.match(/\[(Phase-[^\]]+\.md)\]/);
      return { raw: line, editable: true, planFile: planMatch ? `docs/plans/${planMatch[1]}` : null, prefix: m[1], currentStatus: m[2] };
    });
    outputEl.innerHTML = parsed.map((p, i) => {
      if (!p.editable) return `<div class="text-xs">${escHtml(p.raw)}</div>`;
      const statuses = ["planned", "in-progress", "complete", "paused"];
      const current = p.currentStatus.includes("Planned") ? "planned" : p.currentStatus.includes("Progress") ? "in-progress" : p.currentStatus.includes("Complete") ? "complete" : "paused";
      const options = statuses.map((s) => `<option value="${s}" ${s === current ? "selected" : ""}>${s}</option>`).join("");
      return `<div class="flex items-center gap-2 text-xs py-0.5">
        <span class="flex-1">${escHtml(p.prefix)}</span>
        <select class="bg-gray-700 text-white text-xs rounded px-2 py-0.5" onchange="updatePhaseStatus('${p.planFile || ""}', this.value, ${i})">
          ${options}
        </select>
      </div>`;
    }).join("");
  } catch (err) {
    outputEl.textContent = `Error: ${err.message}`;
    titleEl.textContent = "status: ❌";
  }
}

async function updatePhaseStatus(planFile, newStatus, rowIdx) {
  if (!planFile) { alert("Cannot determine plan file for this phase"); return; }
  try {
    await fetch(`${API_BASE}/api/tool/phase-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: `${planFile} ${newStatus}` }),
    });
    addNotification(`Phase status updated to ${newStatus}`, "success");
  } catch (err) {
    addNotification(`Failed to update status: ${err.message}`, "error");
  }
}

window.runStatusEditable = runStatusEditable;
window.updatePhaseStatus = updatePhaseStatus;

// ─── Memory Search ────────────────────────
let memoryPresets = null;

async function loadMemoryPresets() {
  const presetsEl = document.getElementById("memory-presets");
  if (!presetsEl) return;
  try {
    const res = await fetch(`${API_BASE}/api/memory/presets`);
    memoryPresets = await res.json();
    const categories = memoryPresets.categories || [];
    presetsEl.innerHTML = categories.map((cat) =>
      cat.queries.map((q) =>
        `<button onclick="searchMemoryPreset('${escHtml(q)}')" class="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition" title="${escHtml(cat.name)}">${cat.icon} ${escHtml(q)}</button>`
      ).join("")
    ).join("");
  } catch {
    presetsEl.innerHTML = "";
  }
}

function searchMemoryPreset(query) {
  const input = document.getElementById("memory-search-input");
  if (input) input.value = query;
  searchMemory();
}

window.searchMemoryPreset = searchMemoryPreset;

async function searchMemory() {
  const input = document.getElementById("memory-search-input");
  const resultsEl = document.getElementById("memory-search-results");
  if (!input || !resultsEl) return;
  const query = input.value.trim();
  if (!query) {
    resultsEl.innerHTML = '<p class="text-gray-500 text-sm py-2">Click a preset above or type a search term</p>';
    return;
  }
  resultsEl.innerHTML = '<p class="text-gray-500 text-sm py-2">Searching...</p>';
  try {
    const res = await fetch(`${API_BASE}/api/memory/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.configured === false) {
      resultsEl.innerHTML = `<p class="text-gray-500 text-sm py-2">${escHtml(data.note || "OpenBrain not configured")}</p>`;
      return;
    }
    const results = data.results || [];
    if (results.length === 0) {
      // Show helpful suggestions when no results
      const suggestions = memoryPresets?.categories?.flatMap((c) => c.queries).filter((q) => q !== query).slice(0, 5) || [];
      resultsEl.innerHTML = `<div class="text-sm py-2">
        <p class="text-gray-500 mb-2">No results for "${escHtml(query)}"</p>
        ${suggestions.length > 0 ? `<p class="text-gray-600 text-xs mb-1">Try:</p>
        <div class="flex flex-wrap gap-1">${suggestions.map((s) =>
          `<button onclick="searchMemoryPreset('${escHtml(s)}')" class="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-400">${escHtml(s)}</button>`
        ).join("")}</div>` : ""}
      </div>`;
      return;
    }
    resultsEl.innerHTML = results.map((r) => `
      <div class="bg-gray-700/50 rounded p-2 mb-2 border border-gray-700 hover:border-gray-600 transition">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs text-blue-400 font-mono">${escHtml(r.file || "")}</span>
          ${r.line ? `<span class="text-xs text-gray-600">:${r.line}</span>` : ""}
        </div>
        <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-20 overflow-hidden">${escHtml(r.excerpt || r.thought || r.text || "")}</pre>
      </div>`).join("");
  } catch {
    resultsEl.innerHTML = '<p class="text-red-400 text-sm py-2">Search failed</p>';
  }
}

window.searchMemory = searchMemory;

// ─── Session Replay  ─────────────────────────────────────────
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

// ─── Extension Marketplace  ──────────────────────────────────
let catalogData = [];
let installedExtensions = [];

async function loadExtensions() {
  try {
    // Load installed list
    try {
      const listRes = await fetch(`${API_BASE}/api/tool/ext`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: "list" }),
      });
      const listData = await listRes.json();
      const output = listData.output || "";
      installedExtensions = output.split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("─") && !l.startsWith("No") && !l.startsWith("Installed"))
        .map((l) => l.replace(/^[•\-]\s*/, "").split(/\s/)[0].trim())
        .filter(Boolean);
    } catch { installedExtensions = []; }

    // Try structured JSON endpoint first, fall back to CLI
    let items = [];
    try {
      const res = await fetch(`${API_BASE}/api/extensions`);
      if (res.ok) items = await res.json();
    } catch { /* fall through */ }

    if (items.length > 0) {
      catalogData = items;
    } else {
      const res = await fetch(`${API_BASE}/api/tool/ext`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: "search" }),
      });
      const data = await res.json();
      const output = data.output || "";
      catalogData = output.split("\n").filter((l) => l.trim()).map((l) => ({ raw: l }));
    }
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
  container.innerHTML = items.map((ext) => {
    // Structured catalog JSON item
    if (ext.name && ext.description) {
      const provides = ext.provides || {};
      const badges = [];
      if (provides.agents) badges.push(`${provides.agents} agent${provides.agents > 1 ? "s" : ""}`);
      if (provides.instructions) badges.push(`${provides.instructions} instruction${provides.instructions > 1 ? "s" : ""}`);
      if (provides.prompts) badges.push(`${provides.prompts} prompt${provides.prompts > 1 ? "s" : ""}`);
      if (provides.skills) badges.push(`${provides.skills} skill${provides.skills > 1 ? "s" : ""}`);
      const tagColor = ext.category === "integration" ? "purple" : "blue";
      const isInstalled = installedExtensions.includes(ext.id || ext.name);
      const installBtn = isInstalled
        ? `<button onclick="uninstallExtension('${ext.id || ext.name}')" class="ext-btn text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/40">Uninstall</button>`
        : `<button onclick="installExtension('${ext.id || ext.name}')" class="ext-btn text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/40">Install</button>`;
      return `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-500 transition" id="ext-card-${ext.id || ext.name}">
          <div class="flex items-start justify-between mb-2">
            <h3 class="font-semibold text-white text-sm">${ext.name}</h3>
            <span class="text-xs px-2 py-0.5 rounded-full bg-${tagColor}-500/20 text-${tagColor}-400 border border-${tagColor}-500/30">${ext.category || "code"}</span>
          </div>
          <p class="text-xs text-gray-400 mb-3">${ext.description}</p>
          <div class="flex items-center justify-between">
            <div class="flex gap-1 flex-wrap">${badges.map((b) => `<span class="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">${b}</span>`).join("")}</div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500">v${ext.version || "1.0.0"}</span>
              ${installBtn}
            </div>
          </div>
          ${ext.author ? `<p class="text-xs text-gray-600 mt-2">by ${ext.author}${ext.verified ? ' <span class="text-green-400">✓</span>' : ""}</p>` : ""}
        </div>`;
    }
    // Fallback: raw CLI text
    return `
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition">
        <p class="text-sm text-gray-300">${ext.raw}</p>
      </div>`;
  }).join("");
}

async function installExtension(name) {
  const btn = event.target;
  btn.textContent = "Installing...";
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/tool/ext`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: `add ${name}` }),
    });
    const data = await res.json();
    if (data.success !== false) {
      installedExtensions.push(name);
      addNotification(`Extension ${name} installed`, "success");
      renderExtensions(catalogData);
    } else {
      addNotification(`Install failed: ${data.error || data.output}`, "error");
      btn.textContent = "Install";
      btn.disabled = false;
    }
  } catch (err) {
    addNotification(`Install failed: ${err.message}`, "error");
    btn.textContent = "Install";
    btn.disabled = false;
  }
}

async function uninstallExtension(name) {
  if (!confirm(`Remove extension "${name}"?`)) return;
  const btn = event.target;
  btn.textContent = "Removing...";
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/tool/ext`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: `remove ${name}` }),
    });
    const data = await res.json();
    if (data.success !== false) {
      installedExtensions = installedExtensions.filter((e) => e !== name);
      addNotification(`Extension ${name} removed`, "success");
      renderExtensions(catalogData);
    } else {
      addNotification(`Uninstall failed: ${data.error || data.output}`, "error");
      btn.textContent = "Uninstall";
      btn.disabled = false;
    }
  } catch (err) {
    addNotification(`Uninstall failed: ${err.message}`, "error");
    btn.textContent = "Uninstall";
    btn.disabled = false;
  }
}

window.installExtension = installExtension;
window.uninstallExtension = uninstallExtension;

function filterExtensions() {
  const q = document.getElementById("ext-search").value.toLowerCase();
  renderExtensions(q ? catalogData.filter((e) =>
    (e.name || e.raw || "").toLowerCase().includes(q) ||
    (e.description || "").toLowerCase().includes(q) ||
    (e.tags || []).some((t) => t.includes(q))
  ) : catalogData);
}

window.filterExtensions = filterExtensions;

// ─── Notification Center  ───
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

// B1: Notification hooks are now inline in ws.onmessage — no monkey-patch needed

// ─── Config Editor  ──────────────────────────────────────────
let currentConfig = {};

async function loadConfig() {
  const skeleton = document.getElementById("cfg-skeleton");
  const formBody = document.getElementById("cfg-form-body");
  if (skeleton) { skeleton.classList.remove("hidden"); }
  if (formBody) { formBody.classList.add("hidden"); }
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    currentConfig = await res.json();
    document.getElementById("cfg-preset").value = currentConfig.preset || "";
    document.getElementById("cfg-version").value = currentConfig.templateVersion || "";
    document.getElementById("cfg-model-default").value = currentConfig.modelRouting?.default || "auto";

    // Image generation model 
    const imgModel = document.getElementById("cfg-model-image");
    if (imgModel) imgModel.value = currentConfig.modelRouting?.imageGeneration || "";

    // Agents checkboxes
    const agentsEl = document.getElementById("cfg-agents");
    const allAgents = ["copilot", "claude", "cursor", "codex", "gemini", "windsurf", "generic", "grok"];
    const active = currentConfig.agents || [];
    agentsEl.innerHTML = allAgents.map((a) => `
      <label class="flex items-center gap-1 bg-gray-700 px-3 py-1 rounded text-sm cursor-pointer">
        <input type="checkbox" class="cfg-agent-checkbox" value="${a}" ${active.includes(a) ? "checked" : ""}> ${a}
      </label>
    `).join("");

    document.getElementById("cfg-status").textContent = "Configuration loaded.";

    // Advanced settings 
    const maxP = document.getElementById("cfg-max-parallel");
    const maxR = document.getElementById("cfg-max-retries");
    const maxH = document.getElementById("cfg-max-history");
    const qEnabled = document.getElementById("cfg-quorum-enabled");
    const qThresh = document.getElementById("cfg-quorum-threshold");
    const qModels = document.getElementById("cfg-quorum-models");
    if (maxP) maxP.value = currentConfig.maxParallelism ?? 3;
    if (maxR) maxR.value = currentConfig.maxRetries ?? 1;
    if (maxH) maxH.value = currentConfig.maxRunHistory ?? 50;
    if (qEnabled) qEnabled.checked = currentConfig.quorum?.enabled || false;
    if (qThresh) qThresh.value = currentConfig.quorum?.threshold ?? 7;
    if (qModels) qModels.value = (currentConfig.quorum?.models || []).join(", ");

    // Check API provider availability
    loadApiProviderStatus();
    loadOpenBrainStatus();
    loadMemoryPresets();
    loadWorkerStatus();
    loadBridgeStatus();

    if (skeleton) { skeleton.classList.add("hidden"); }
    if (formBody) { formBody.classList.remove("hidden"); }
  } catch (err) {
    if (skeleton) { skeleton.classList.add("hidden"); }
    if (formBody) { formBody.classList.remove("hidden"); }
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

// ─── Worker Detection ─────────────────────────────────────────
async function loadWorkerStatus() {
  const el = document.getElementById("cfg-workers");
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/api/workers`);
    const workers = await res.json();
    if (Array.isArray(workers) && workers.length > 0) {
      el.innerHTML = workers.map((w) => {
        const color = w.available ? "text-green-400" : "text-gray-600";
        const icon = w.available ? "✓" : "✗";
        return `<span class="${color} text-xs mr-3">${icon} ${escHtml(w.name || w.command || w)}</span>`;
      }).join("");
    } else if (typeof workers === "object" && !Array.isArray(workers)) {
      // Object format: { cli: [...], api: [...] }
      const parts = [];
      for (const [category, items] of Object.entries(workers)) {
        if (Array.isArray(items)) {
          parts.push(`<span class="text-gray-500 text-xs font-semibold mr-1">${category}:</span>` +
            items.map((w) => `<span class="text-green-400 text-xs mr-2">✓ ${escHtml(typeof w === "string" ? w : w.name || "")}</span>`).join(""));
        }
      }
      el.innerHTML = parts.join("") || '<span class="text-gray-500">No workers detected</span>';
    } else {
      el.innerHTML = '<span class="text-gray-500">No workers detected. Install gh-copilot, claude, or codex CLI.</span>';
    }
  } catch {
    el.textContent = "Unable to detect workers";
  }
}

async function loadOpenBrainStatus() {
  const el = document.getElementById("cfg-openbrain");
  const searchPanel = document.getElementById("memory-search-panel");
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/api/memory`);
    const data = await res.json();
    if (data.configured) {
      el.innerHTML = `<span class="text-green-400">✓ Connected</span> <span class="text-gray-500">— ${data.serverName || "openbrain"}</span>`
        + (data.endpoint ? `<br><span class="text-xs text-gray-500">${data.endpoint}</span>` : "");
      if (searchPanel) searchPanel.classList.remove("hidden");
    } else {
      el.innerHTML = '<span class="text-gray-500">Not configured. Add openbrain MCP server to enable project memory.</span>';
      if (searchPanel) searchPanel.classList.add("hidden");
    }
  } catch {
    el.textContent = "Unable to check";
    if (searchPanel) searchPanel.classList.add("hidden");
  }
}

async function saveConfig() {
  if (!confirm("Save configuration changes to .forge.json?")) return;
  try {
    const agents = [...document.querySelectorAll(".cfg-agent-checkbox:checked")].map((c) => c.value);
    const modelDefault = document.getElementById("cfg-model-default").value;
    const modelImage = document.getElementById("cfg-model-image")?.value || "";
    // Advanced settings 
    const maxP = parseInt(document.getElementById("cfg-max-parallel")?.value, 10);
    const maxR = parseInt(document.getElementById("cfg-max-retries")?.value, 10);
    const maxH = parseInt(document.getElementById("cfg-max-history")?.value, 10);
    const qEnabled = document.getElementById("cfg-quorum-enabled")?.checked || false;
    const qThresh = parseInt(document.getElementById("cfg-quorum-threshold")?.value, 10);
    const qModelsStr = document.getElementById("cfg-quorum-models")?.value || "";
    const qModels = qModelsStr ? qModelsStr.split(",").map((m) => m.trim()).filter(Boolean) : [];

    const updated = {
      ...currentConfig,
      agents,
      modelRouting: { ...(currentConfig.modelRouting || {}), default: modelDefault, imageGeneration: modelImage || undefined },
      maxParallelism: isNaN(maxP) ? 3 : maxP,
      maxRetries: isNaN(maxR) ? 1 : maxR,
      maxRunHistory: isNaN(maxH) ? 50 : maxH,
      quorum: {
        ...(currentConfig.quorum || {}),
        enabled: qEnabled,
        threshold: isNaN(qThresh) ? 7 : qThresh,
        models: qModels.length > 0 ? qModels : (currentConfig.quorum?.models || []),
      },
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

// ─── Bridge Status & Escalation ───────────────────────────────────────
async function checkBridgeEscalation() {
  try {
    const res = await fetch(`${API_BASE}/api/bridge/status`);
    if (!res.ok) return;
    const data = await res.json();
    state.pendingApprovals = data.pendingApprovals || [];
    renderSliceCards();
    renderRunsTable();
    updateBridgeStatusUI(data);
  } catch {
    // Bridge not configured — ignore
  }
}

function updateBridgeStatusUI(data) {
  const badge = document.getElementById("bridge-enabled-badge");
  const statusEl = document.getElementById("bridge-status-badge");
  const channelsList = document.getElementById("bridge-channels-list");
  const approvalsPanel = document.getElementById("bridge-approvals-panel");
  const approvalsList = document.getElementById("bridge-approvals-list");

  if (!statusEl) return;

  if (!data || data.error) {
    statusEl.innerHTML = '<span class="text-gray-500">Not configured — add <code class="text-gray-400">bridge</code> to .forge.json</span>';
    if (badge) badge.classList.add("hidden");
    return;
  }

  const connectedDot = data.connected
    ? '<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span><span class="text-green-400">connected</span>'
    : '<span class="inline-block w-2 h-2 rounded-full bg-gray-600 mr-1"></span><span class="text-gray-500">disconnected</span>';
  const enabledText = data.enabled ? connectedDot : '<span class="text-gray-500">disabled</span>';
  statusEl.innerHTML = enabledText;

  if (badge) {
    if (data.enabled) { badge.classList.remove("hidden"); } else { badge.classList.add("hidden"); }
  }

  if (channelsList) {
    const channels = data.channels || [];
    channelsList.innerHTML = channels.length === 0
      ? '<p class="text-xs text-gray-600">No channels configured</p>'
      : channels.map((c) => {
        const levelColor = { all: "blue", important: "amber", critical: "red" }[c.level] || "gray";
        return `<div class="flex items-center gap-2 text-xs">
          <span class="text-gray-400 font-semibold w-16 shrink-0">${escHtml(c.type)}</span>
          <span class="px-1.5 py-0.5 rounded bg-${levelColor}-500/20 text-${levelColor}-400">${escHtml(c.level || "important")}</span>
          ${c.approvalRequired ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">approval</span>' : ""}
        </div>`;
      }).join("");
  }

  const pending = data.pendingApprovals || [];
  if (approvalsPanel && approvalsList) {
    if (pending.length > 0) {
      approvalsPanel.classList.remove("hidden");
      approvalsList.innerHTML = pending.map((a) => `
        <div class="flex items-center gap-2 bg-amber-900/30 border border-amber-800 rounded px-3 py-2 text-xs">
          <span class="text-amber-300 font-semibold">Run ${escHtml(a.runId)}</span>
          <span class="text-gray-500">requested ${new Date(a.requestedAt).toLocaleTimeString()}</span>
          <div class="ml-auto flex gap-2">
            <button onclick="sendApproval('${escHtml(a.runId)}', true)" class="bg-green-700 hover:bg-green-600 text-white px-2 py-0.5 rounded">Approve</button>
            <button onclick="sendApproval('${escHtml(a.runId)}', false)" class="bg-red-800 hover:bg-red-700 text-white px-2 py-0.5 rounded">Reject</button>
          </div>
        </div>`).join("");
    } else {
      approvalsPanel.classList.add("hidden");
    }
  }
}

async function sendApproval(runId, approved) {
  try {
    await fetch(`${API_BASE}/api/bridge/approve/${encodeURIComponent(runId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved, approver: "dashboard" }),
    });
    addNotification(`Run ${runId} ${approved ? "approved" : "rejected"}`, approved ? "success" : "error");
    checkBridgeEscalation();
  } catch (err) {
    addNotification(`Approval failed: ${err.message}`, "error");
  }
}

window.sendApproval = sendApproval;

async function loadBridgeStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/bridge/status`);
    if (!res.ok) return;
    const data = await res.json();
    state.pendingApprovals = data.pendingApprovals || [];
    updateBridgeStatusUI(data);
  } catch {
    updateBridgeStatusUI(null);
  }
}


function renderDAGView(slices) {
  if (!slices || slices.length === 0) return "";
  // Only show if there are dependencies or parallel tags
  const hasDeps = slices.some((s) => (s.depends || []).length > 0);
  const hasParallel = slices.some((s) => s.parallel);
  if (!hasDeps && !hasParallel) return "";

  const lines = slices.map((s) => {
    const id = s.id || s.number || "?";
    const title = s.title || `Slice ${id}`;
    const deps = (s.depends || []).map((d) => `${d}`).join(",");
    const pTag = s.parallel ? ' <span class="text-purple-400">[P]</span>' : "";
    const depArrow = deps ? ` <span class="text-gray-600">← ${deps}</span>` : "";
    const indent = (s.depends || []).length > 0 ? "ml-4" : "";
    return `<div class="${indent} py-0.5 flex items-center gap-1">
      <span class="text-gray-500 w-6 text-right">${id}.</span>
      <span class="text-gray-300">${escHtml(title)}</span>${pTag}${depArrow}
    </div>`;
  });

  return `<details class="mt-1 ml-7">
    <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">DAG View</summary>
    <div class="text-xs mt-1 py-1 font-mono">${lines.join("")}</div>
  </details>`;
}

// ─── Tab Badges ───────────────────────────────────────────────
let tabBadgeState = { runsNew: 0, hasAnomaly: false, skillsActive: 0 };

function updateTabBadges() {
  const tabs = document.querySelectorAll(".tab-btn[data-tab]");
  tabs.forEach((tab) => {
    // Remove existing badge
    const existing = tab.querySelector(".tab-badge");
    if (existing) existing.remove();

    let badgeText = null;
    if (tab.dataset.tab === "runs" && tabBadgeState.runsNew > 0) {
      badgeText = tabBadgeState.runsNew;
    } else if (tab.dataset.tab === "cost" && tabBadgeState.hasAnomaly) {
      badgeText = "!";
    } else if (tab.dataset.tab === "skills" && tabBadgeState.skillsActive > 0) {
      badgeText = tabBadgeState.skillsActive;
    }

    if (badgeText !== null) {
      const badge = document.createElement("span");
      badge.className = "tab-badge ml-1 inline-flex items-center justify-center w-4 h-4 text-xs rounded-full bg-red-500 text-white";
      badge.textContent = badgeText;
      tab.appendChild(badge);
    }
  });
}

// ─── Auto-Scroll + Elapsed Time ───────────────────────────────
let sliceTimers = {};

function startSliceTimer(sliceId) {
  const startTime = Date.now();
  sliceTimers[sliceId] = setInterval(() => {
    const card = document.querySelector(`[data-slice-id="${sliceId}"] .slice-elapsed`);
    if (card) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      card.textContent = `${elapsed}s`;
    }
  }, 1000);
}

function stopSliceTimer(sliceId) {
  if (sliceTimers[sliceId]) {
    clearInterval(sliceTimers[sliceId]);
    delete sliceTimers[sliceId];
  }
}

// ─── Notification Sound ────────────────────────────────────────
function playNotificationSound(type) {
  if (localStorage.getItem("pf-sound") === "off") return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.1;
    osc.frequency.value = type === "success" ? 880 : 440;
    osc.type = "sine";
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch { /* audio blocked by browser — fail silently */ }
}

// ─── Hub Client Monitor ───────────────────────────────────────
let hubPollInterval = null;

function startHubPolling() {
  if (hubPollInterval) return;
  pollHubClients();
  hubPollInterval = setInterval(pollHubClients, 10000);
}

function stopHubPolling() {
  if (hubPollInterval) { clearInterval(hubPollInterval); hubPollInterval = null; }
  const el = document.getElementById("hub-clients");
  if (el) el.classList.add("hidden");
}

async function pollHubClients() {
  try {
    const res = await fetch(`${API_BASE}/api/hub`);
    const info = await res.json();
    const el = document.getElementById("hub-clients");
    if (!el) return;
    if (info.running) {
      const clients = info.clients || [];
      const count = Array.isArray(clients) ? clients.length : (typeof clients === "number" ? clients : 0);
      el.textContent = `${count} client${count !== 1 ? "s" : ""}`;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  } catch { /* ignore */ }
}

// ─── Init ─────────────────────────────────────────────────────────────
// Load initial status + reconstruct slice state from latest run
fetch(`${API_BASE}/api/status`)
  .then((r) => r.json())
  .then((data) => {
    if (data.status === "completed" || data.status === "failed") {
      document.getElementById("run-plan-name").textContent = shortName(data.plan);
      document.getElementById("run-progress-text").textContent = data.report || `Last run: ${data.status}`;
      document.getElementById("run-status").textContent = data.status === "completed" ? "Last: pass" : "Last: fail";
    } else if (data.status === "running") {
      document.getElementById("run-plan-name").textContent = shortName(data.plan);
      document.getElementById("run-status").textContent = "Running...";
    }
  })
  .catch(() => {});

// Populate slice cards from the latest run (REST fallback for when WS events are missed)
fetch(`${API_BASE}/api/runs/latest`)
  .then((r) => { if (!r.ok) throw new Error("no runs"); return r.json(); })
  .then((run) => {
    // Build run metadata
    state.runMeta = run;
    state.slices = [];
    const order = run.executionOrder || [];
    const count = run.sliceCount || order.length || 0;

    for (let i = 0; i < count; i++) {
      state.slices.push({
        id: order[i] || String(i + 1),
        title: `Slice ${order[i] || i + 1}`,
        status: "pending",
      });
    }

    // Now load per-slice files from runs/0 (latest run index)
    return fetch(`${API_BASE}/api/runs/0`)
      .then((r) => { if (!r.ok) throw new Error("no detail"); return r.json(); })
      .then((detail) => {
        if (detail.slices && detail.slices.length > 0) {
          for (const slice of detail.slices) {
            const found = state.slices.find((s) => s.id === String(slice.number));
            if (found) {
              found.status = slice.status === "passed" ? "passed" : slice.status === "failed" ? "failed" : found.status;
              found.title = slice.title || found.title;
              found.duration = slice.duration;
              found.model = slice.model;
              found.cost = slice.cost_usd;
              Object.assign(found, slice);
            }
          }
        }

        document.getElementById("run-plan-name").textContent = shortName(run.plan);
        document.getElementById("run-progress-bar").classList.remove("hidden");
        renderSliceCards();
        updateProgress();
      });
  })
  .catch(() => { /* No runs yet — that's fine */ });

// Connect WebSocket
connectWebSocket();

// Load version in footer
fetch(`${API_BASE}/api/capabilities`)
  .then((r) => r.json())
  .then((data) => {
    const ver = data.version || data.serverVersion || "";
    const el = document.getElementById("footer-version");
    if (el && ver) el.textContent = `v${ver}`;
  })
  .catch(() => {});

// Load notifications from localStorage
renderNotifications();

// Load plan browser on init (Progress is default tab)
loadPlans();

// Apply saved theme
(function initTheme() {
  const saved = localStorage.getItem("pf-theme");
  if (saved === "light") {
    document.documentElement.classList.add("light");
    const toggle = document.getElementById("theme-toggle");
    if (toggle) toggle.textContent = "☀️";
  }
})();

// Tab load hooks
const tabLoadHooks = {
  progress: loadPlans,
  replay: loadReplayRuns,
  extensions: loadExtensions,
  config: loadConfig,
  traces: loadTraces,
  cost: () => { loadCost(); },
  skills: loadSkillCatalog,
};

// ─── Theme Toggle ─────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle("light");
  localStorage.setItem("pf-theme", isLight ? "light" : "dark");
  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.textContent = isLight ? "☀️" : "🌙";
  // Update chart colors for theme
  Object.values(state.charts).forEach((c) => {
    if (c.options?.scales?.y) {
      c.options.scales.y.ticks.color = isLight ? "#64748b" : "#9ca3af";
      c.options.scales.y.grid.color = isLight ? "#e2e8f0" : "#374151";
    }
    if (c.options?.scales?.x) {
      c.options.scales.x.ticks.color = isLight ? "#64748b" : "#9ca3af";
    }
    c.update();
  });
}
window.toggleTheme = toggleTheme;

// ─── Keyboard Navigation ──────────────────────────────────────
document.addEventListener("keydown", (e) => {
  // Skip if focus is in input/select/textarea
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;

  const activeTab = document.querySelector(".tab-btn.tab-active")?.dataset?.tab;

  // ? — show shortcuts modal
  if (e.key === "?") {
    e.preventDefault();
    document.getElementById("shortcuts-modal").classList.toggle("hidden");
    return;
  }

  // Esc — close drawer / comparison / modal
  if (e.key === "Escape") {
    closeRunDrawer();
    document.getElementById("shortcuts-modal").classList.add("hidden");
    if (compareMode) closeComparison();
    return;
  }

  // 1-9 — switch tabs
  if (e.key >= "1" && e.key <= "9" && !e.ctrlKey && !e.metaKey) {
    const tabs = document.querySelectorAll(".tab-btn[data-tab]");
    const idx = parseInt(e.key, 10) - 1;
    if (idx < tabs.length) { tabs[idx].click(); e.preventDefault(); }
    return;
  }

  // j/k — navigate run rows (Runs tab)
  if (activeTab === "runs" && (e.key === "j" || e.key === "k")) {
    e.preventDefault();
    const rows = document.querySelectorAll("#runs-table-body tr[data-row-idx]");
    if (rows.length === 0) return;
    if (selectedRunIdx < 0) selectedRunIdx = 0;
    if (e.key === "j") selectedRunIdx = Math.min(selectedRunIdx + 1, rows.length - 1);
    else selectedRunIdx = Math.max(selectedRunIdx - 1, 0);
    rows.forEach((r) => r.classList.remove("row-selected"));
    if (rows[selectedRunIdx]) rows[selectedRunIdx].classList.add("row-selected");
    rows[selectedRunIdx]?.scrollIntoView({ block: "nearest" });
    return;
  }

  // Enter — open detail for selected row
  if (activeTab === "runs" && e.key === "Enter" && selectedRunIdx >= 0) {
    e.preventDefault();
    const origIdx = allRuns.indexOf(filteredRuns[selectedRunIdx]);
    if (origIdx >= 0) openRunDrawer(origIdx);
    return;
  }
});

// ─── Skill Catalog ────────────────────────────────────────────
async function loadSkillCatalog() {
  const container = document.getElementById("skill-catalog");
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/api/skills`);
    const skills = await res.json();
    if (skills.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No skills available</p>';
      return;
    }
    container.innerHTML = skills.map((s) => {
      const isBuiltin = s.file === "built-in";
      return `<div class="bg-gray-700/50 rounded p-3 border border-gray-700 hover:border-gray-500 transition">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm font-medium text-white">/${s.name}</span>
          ${isBuiltin ? '<span class="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">built-in</span>' : '<span class="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">custom</span>'}
        </div>
        <p class="text-xs text-gray-400">${escHtml(s.description || "")}</p>
      </div>`;
    }).join("");
  } catch {
    container.innerHTML = '<p class="text-red-400 text-sm">Failed to load skills</p>';
  }
}

// ─── Traces Tab ───────────────────────────────────────────────
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

  // Quorum summary banner
  let quorumBanner = "";
  if (trace.quorum && Object.keys(trace.quorum).length > 0) {
    const slices = Object.entries(trace.quorum);
    const totalLegs = slices.reduce((sum, [, q]) => sum + (q.totalLegs || 0), 0);
    const successLegs = slices.reduce((sum, [, q]) => sum + (q.successfulLegs || 0), 0);
    const models = [...new Set(slices.flatMap(([, q]) => q.models || []))];
    quorumBanner = `<div class="mb-3 p-3 rounded bg-purple-900/30 border border-purple-700/50">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-purple-400 font-semibold">🔮 Quorum Mode</span>
        <span class="text-xs text-gray-400">${slices.length} slice(s) · ${successLegs}/${totalLegs} legs succeeded</span>
      </div>
      <div class="flex flex-wrap gap-1">${models.map((m) =>
        `<span class="inline-block px-2 py-0.5 text-xs rounded bg-purple-800/50 text-purple-300">${escHtml(m)}</span>`
      ).join("")}</div>
    </div>`;
  }

  // Calculate time range
  const times = spans.flatMap((s) => [new Date(s.startTime).getTime(), s.endTime ? new Date(s.endTime).getTime() : Date.now()]);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const range = maxTime - minTime || 1;

  // Build quorum lookup for slice spans
  const quorumLookup = {};
  if (trace.quorum) {
    for (const [sliceNum, qd] of Object.entries(trace.quorum)) {
      quorumLookup[`slice-${sliceNum}`] = qd;
    }
  }

  const rows = spans.map((span, idx) => {
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

    // Quorum indicator on slice spans
    const sliceMatch = span.name?.match(/slice[- ]?(\d+)/i);
    const qData = sliceMatch ? quorumLookup[`slice-${sliceMatch[1]}`] : null;
    const quorumBadge = qData ? `<span class="text-purple-400 text-xs ml-1" title="Quorum: ${qData.successfulLegs}/${qData.totalLegs} legs, threshold ${qData.threshold}">🔮${qData.successfulLegs}/${qData.totalLegs}</span>` : "";

    return `
      <div class="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-700/50 rounded px-2 ${indent}" onclick="showSpanDetail(${idx})" data-span-idx="${idx}">
        <span class="text-xs text-gray-500 w-32 truncate">${kindBadge} ${span.name}${quorumBadge}</span>
        <div class="flex-1 relative h-5">
          <div class="absolute h-full rounded ${color} opacity-80" style="left:${left}%;width:${width}%"></div>
        </div>
        <span class="text-xs text-gray-500 w-16 text-right">${duration}s</span>
      </div>
    `;
  }).join("");

  container.innerHTML = quorumBanner + rows;
}

function showSpanDetail(idx) {
  if (!traceData) return;
  const span = traceData.spans[idx];

  // Events — render full detail 
  const eventsEl = document.getElementById("trace-events");
  if (span.events?.length > 0) {
    eventsEl.innerHTML = span.events.map((e) => {
      const color = e.severity === "ERROR" ? "text-red-400" :
                    e.severity === "WARN" ? "text-yellow-400" : "text-gray-300";
      const time = new Date(e.time).toLocaleTimeString();
      const attrs = e.attributes ? Object.entries(e.attributes).map(([k, v]) =>
        `<span class="text-gray-500">${escHtml(k)}=</span><span class="text-gray-200">${escHtml(String(v))}</span>`
      ).join(" ") : "";
      return `<div class="${color} border-b border-gray-700/30 py-1">
        <span class="text-gray-500">[${time}]</span> <span class="font-medium">${escHtml(e.name || e.severity || "")}</span>
        ${attrs ? `<div class="ml-4 text-xs">${attrs}</div>` : ""}
      </div>`;
    }).join("");
  } else {
    eventsEl.innerHTML = '<p class="text-gray-500">No events</p>';
  }

  // Attributes — formatted table 
  const attrsEl = document.getElementById("trace-attributes");
  const labels = { model: "Model", tokens_in: "Input Tokens", tokens_out: "Output Tokens", worker: "Worker", cost_usd: "Cost ($)", exit_code: "Exit Code", duration_ms: "Duration (ms)", slice_id: "Slice ID" };
  const allAttrs = { ...span.attributes, status: span.status, kind: span.kind, spanId: span.spanId };
  const rows = Object.entries(allAttrs).map(([k, v]) => {
    const label = labels[k] || k;
    return `<tr class="border-b border-gray-700/30"><td class="py-1 pr-3 text-gray-500 text-xs">${escHtml(label)}</td><td class="py-1 text-xs text-gray-200">${escHtml(String(v))}</td></tr>`;
  }).join("");
  attrsEl.innerHTML = `<table class="w-full">${rows}</table>`;

  // Log summary 
  if (span.logSummary?.length > 0) {
    attrsEl.innerHTML += `<details class="mt-2"><summary class="text-xs text-gray-500 cursor-pointer">Log Summary (${span.logSummary.length} entries)</summary>
      <pre class="text-xs text-gray-400 mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">${span.logSummary.map((l) => escHtml(l)).join("\n")}</pre>
    </details>`;
  }

  // Quorum detail for slice spans
  const sliceMatch = span.name?.match(/slice[- ]?(\d+)/i);
  if (sliceMatch && traceData.quorum?.[sliceMatch[1]]) {
    const qd = traceData.quorum[sliceMatch[1]];
    attrsEl.innerHTML += `<div class="mt-3 p-2 rounded bg-purple-900/20 border border-purple-700/30">
      <div class="text-xs font-semibold text-purple-400 mb-1">🔮 Quorum Detail</div>
      <div class="grid grid-cols-2 gap-1 text-xs">
        <span class="text-gray-500">Complexity Score</span><span class="text-gray-200">${qd.score ?? "—"}/10</span>
        <span class="text-gray-500">Threshold</span><span class="text-gray-200">${qd.threshold ?? "—"}</span>
        <span class="text-gray-500">Models</span><span class="text-gray-200">${(qd.models || []).join(", ") || "—"}</span>
        <span class="text-gray-500">Legs</span><span class="text-gray-200">${qd.successfulLegs ?? 0}/${qd.totalLegs ?? 0} succeeded</span>
        <span class="text-gray-500">Dispatch Duration</span><span class="text-gray-200">${qd.dispatchDuration ? (qd.dispatchDuration / 1000).toFixed(1) + "s" : "—"}</span>
        <span class="text-gray-500">Reviewer Fallback</span><span class="text-gray-200">${qd.reviewerFallback ? "Yes" : "No"}</span>
        <span class="text-gray-500">Reviewer Cost</span><span class="text-gray-200">${qd.reviewerCost ? "$" + qd.reviewerCost.toFixed(4) : "—"}</span>
      </div>
    </div>`;
  }
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

// ─── Trace Span Search ────────────────────────────────────────
function filterTraceSpans() {
  if (!traceData) return;
  const query = (document.getElementById("trace-search")?.value || "").toLowerCase();
  if (!query) { renderWaterfall(traceData); return; }
  const filtered = {
    ...traceData,
    spans: traceData.spans.filter((s) =>
      (s.name || "").toLowerCase().includes(query) ||
      JSON.stringify(s.attributes || {}).toLowerCase().includes(query) ||
      (s.logSummary || []).some((l) => l.toLowerCase().includes(query))
    ),
  };
  renderWaterfall(filtered);
}

window.filterTraceSpans = filterTraceSpans;

// ─── Event History Log ─────────────────────────────────────────
let eventLogEntries = [];

function appendEventLog(event) {
  const time = new Date().toLocaleTimeString();
  const typeColors = {
    "run-started": "text-blue-400", "run-completed": "text-green-400", "run-aborted": "text-yellow-400",
    "slice-started": "text-cyan-400", "slice-completed": "text-green-300", "slice-failed": "text-red-400",
    "skill-started": "text-purple-400", "skill-completed": "text-purple-300",
  };
  const color = typeColors[event.type] || "text-gray-400";
  const summary = event.data?.sliceId ? ` slice ${event.data.sliceId}` : event.data?.plan ? ` ${shortName(event.data.plan)}` : event.data?.skillName ? ` /${event.data.skillName}` : "";

  eventLogEntries.push({ time, type: event.type, summary, color });
  if (eventLogEntries.length > 200) eventLogEntries.shift();

  const logEl = document.getElementById("event-log");
  const countEl = document.getElementById("event-log-count");
  if (!logEl) return;

  countEl.textContent = `(${eventLogEntries.length})`;
  // Append to bottom, auto-scroll
  const entry = document.createElement("div");
  entry.className = `${color} py-0.5`;
  entry.textContent = `[${time}] ${event.type}${summary}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}


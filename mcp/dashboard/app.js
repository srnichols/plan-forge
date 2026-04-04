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

    return `
      <div class="slice-card ${bgColor} rounded-lg p-3 border border-gray-700">
        <div class="flex items-center justify-between mb-1">
          <span class="font-semibold text-sm">${statusIcon} Slice ${s.id}</span>
          <span class="text-xs text-gray-500">${duration}</span>
        </div>
        <p class="text-xs text-gray-400 truncate">${s.title}</p>
        ${model ? `<p class="text-xs text-gray-500 mt-1">${model} ${cost}</p>` : ""}
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

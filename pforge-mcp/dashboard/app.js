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
  watcher: {        // v2.35: watcher feed (snapshots, anomalies, advice)
    snapshots: [],     // [{ targetPath, runId, runState, anomalyCount, cursor, ts }]
    anomalies: [],     // [{ targetPath, runId, code, severity, message, ts }]
    advice: [],        // [{ targetPath, runId, model, tokensOut, ts }]
  },
  // Phase TEMPER-01 Slice 01.2 — local cache of the latest
  // forge_tempering_status response for the Tempering tab.
  tempering: {
    initialized: false,
    state: null,
    scans: [],         // newest first — coverage-per-layer summaries
    fetching: false,
    lastError: null,
    // TEMPER-02 Slice 02.2 — per-slice run verdicts keyed by sliceRef.slice.
    // Populated by the `tempering-run-completed` hub event; read by
    // renderSliceCards to render a tiny 🔨 pill next to the gate/retry
    // indicators. Kept separate from the scan cache to keep the
    // Tempering tab free of per-run state it doesn't render.
    slicePills: {},
    // TEMPER-04 Slice 04.2 — visual regression viewer cards keyed by urlHash.
    visualRegressions: [],
    visualIgnoredOnce: new Set(),
    // TEMPER-05 Slice 05.1 — flakiness, perf-budget, load-stress panels.
    flakyTests: [],
    perfRegressions: [],
    loadResults: [],
  },
};

const API_BASE = `${window.location.protocol}//${window.location.host}`;

// ─── Tab Switching ────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // Clear active from ALL tab-btn elements across all groups
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
    if (tabLoadHooks[btn.dataset.tab]) tabLoadHooks[btn.dataset.tab]();
  });
});

// ─── Group Tab Switching ──────────────────────────────────────────────
function switchGroup(group) {
  // Update group tab styles
  document.querySelectorAll(".group-tab").forEach((g) => {
    g.classList.remove("group-active", "text-blue-400", "text-amber-400", "border-blue-400", "border-amber-400");
    g.classList.add("text-gray-500", "border-transparent");
  });
  const activeGroup = document.querySelector(`.group-tab[data-group="${group}"]`);
  if (activeGroup) {
    activeGroup.classList.add("group-active");
    activeGroup.classList.remove("text-gray-500", "border-transparent");
    const color = group === "liveguard" ? "amber" : "blue";
    activeGroup.classList.add(`text-${color}-400`, `border-${color}-400`);
  }

  // Show/hide subtab rows
  document.getElementById("subtabs-forge").classList.toggle("hidden", group !== "forge");
  document.getElementById("subtabs-liveguard").classList.toggle("hidden", group !== "liveguard");

  // Auto-click the first subtab in the group if none active
  const subtabRow = document.getElementById(`subtabs-${group}`);
  const activeSubtab = subtabRow?.querySelector(".tab-active");
  if (!activeSubtab) {
    const first = subtabRow?.querySelector(".tab-btn");
    if (first) first.click();
  }
}

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
          } else if (data.type === "liveguard-tool-completed" || data.type === "liveguard") {
            const d = data.data || data;
            const detail = d.score != null ? ` (score: ${d.score})` : d.gates != null ? ` (${d.passed}/${d.gates} passed)` : d.overallStatus ? ` [${d.overallStatus}]` : '';
            addNotification(`LiveGuard: ${d.tool || 'unknown'}${detail}`, d.status === "error" ? "error" : "amber");
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
    case "slice-model-routed":
      handleSliceModelRouted(event.data || event);
      break;
    case "quorum-dispatch-started":
      handleQuorumDispatch(event.data || event);
      break;
    case "quorum-leg-completed":
      handleQuorumLeg(event.data || event);
      break;
    case "quorum-review-completed":
      handleQuorumReview(event.data || event);
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
    case "liveguard-drift":
      handleLGDrift(event.data || event);
      break;
    case "liveguard-incident":
      handleLGIncident(event.data || event);
      break;
    case "liveguard-triage":
      handleLGTriage(event.data || event);
      break;
    case "fix-proposal-ready":
      handleFixProposal(event.data || event);
      break;
    case "liveguard-tool-completed":
      handleLGToolCompleted(event.data || event);
      break;
    case "liveguard":
      handleLGToolCompleted(event); // Use same handler — liveguard events include tool + status + summary
      break;
    case "liveguard-secret-scan":
      handleLGSecretScan(event.data || event);
      break;
    case "watch-snapshot-completed":
      handleWatchSnapshot(event.data || event);
      break;
    case "watch-anomaly-detected":
      handleWatchAnomaly(event.data || event);
      break;
    case "watch-advice-generated":
      handleWatchAdvice(event.data || event);
      break;
    case "tempering-run-completed":
      handleTemperingRunCompleted(event.data || event);
      break;
    case "tempering-visual-regression-detected":
      handleTemperingVisualRegression(event.data || event);
      upsertVisualRegressionCard(event.data || event);
      break;
    case "tempering-baseline-promoted":
      addNotification(`Baseline promoted: ${(event.data || event).url || (event.data || event).urlHash}`, "success");
      break;
  }
}

function handleRunStarted(data) {
  const isSameRun = state.runMeta && state.runMeta.plan === data.plan && state.slices.length > 0;
  state.runMeta = data;

  const count = data.sliceCount || data.executionOrder?.length || 0;
  const order = data.executionOrder || [];

  if (isSameRun) {
    // Duplicate run-started (e.g. WS history replay) — preserve existing slice statuses
    for (let i = 0; i < count; i++) {
      const id = order[i] || String(i + 1);
      if (!state.slices.find((s) => s.id === id)) {
        state.slices.push({ id, title: `Slice ${id}`, status: "pending" });
      }
    }
  } else {
    state.slices = [];
    for (let i = 0; i < count; i++) {
      state.slices.push({
        id: order[i] || String(i + 1),
        title: `Slice ${order[i] || i + 1}`,
        status: "pending",
      });
    }
  }

  document.getElementById("run-plan-name").textContent = shortName(data.plan);
  document.getElementById("run-progress-text").textContent = `0 of ${count} slices — starting...`;
  document.getElementById("run-progress-bar").classList.remove("hidden");
  document.getElementById("run-progress-fill").style.width = "0%";
  document.getElementById("run-status").textContent = "Running...";

  // Show run mode + model badges
  updateRunBadges(data);

  renderSliceCards();
  updateProgress();
}

function updateRunBadges(data) {
  const modeBadge = document.getElementById("run-mode-badge");
  const modelBadge = document.getElementById("run-model-badge");
  const execBadge = document.getElementById("run-exec-mode-badge");
  if (!modeBadge || !modelBadge) return;

  // Quorum vs single-pass
  if (data.quorum && data.quorum.enabled) {
    modeBadge.textContent = `\u26a1 Quorum${data.quorum.auto ? " (auto)" : ""}${data.quorum.threshold ? " T" + data.quorum.threshold : ""}`;
    modeBadge.className = "text-xs px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 border border-purple-700";
    modeBadge.classList.remove("hidden");
  } else {
    modeBadge.textContent = "Single-pass";
    modeBadge.className = "text-xs px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 border border-blue-700";
    modeBadge.classList.remove("hidden");
  }

  // Model
  const model = data.model || "";
  if (model) {
    modelBadge.textContent = model;
    modelBadge.className = "text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300";
    modelBadge.classList.remove("hidden");
  } else {
    modelBadge.classList.add("hidden");
  }

  // Execution mode (autonomous / assisted)
  if (execBadge) {
    const mode = data.mode || "";
    if (mode) {
      execBadge.textContent = mode === "assisted" ? "\ud83d\udc64 Assisted" : "\ud83e\udd16 Autonomous";
      execBadge.classList.remove("hidden");
    } else {
      execBadge.classList.add("hidden");
    }
  }
}

function handleSliceModelRouted(data) {
  const slice = state.slices.find((s) => s.id === String(data.sliceId));
  if (slice) {
    slice.model = data.model;
    slice.sliceType = data.sliceType;
  }
  renderSliceCards();
}

function handleQuorumDispatch(data) {
  const slice = state.slices.find((s) => s.id === String(data.sliceId));
  if (slice) {
    slice.quorum = { models: data.models, legs: [], status: "dispatched" };
  }
  renderSliceCards();
}

function handleQuorumLeg(data) {
  const slice = state.slices.find((s) => s.id === String(data.sliceId));
  if (slice && slice.quorum) {
    slice.quorum.legs.push({ model: data.model, success: data.success, duration: data.duration });
  }
  renderSliceCards();
}

function handleQuorumReview(data) {
  const slice = state.slices.find((s) => s.id === String(data.sliceId));
  if (slice && slice.quorum) {
    slice.quorum.status = "reviewed";
    slice.quorum.winner = data.winner || data.selectedModel;
  }
  renderSliceCards();
}

function handleSliceStarted(data) {
  const slice = state.slices.find((s) => s.id === data.sliceId);
  if (slice) {
    slice.status = "executing";
    slice.title = data.title || slice.title;
    if (typeof data.complexityScore === "number") slice.complexityScore = data.complexityScore;
  }
  startSliceTimer(data.sliceId);
  updateProgress();
  renderSliceCards();
  // Auto-scroll to executing slice
  setTimeout(() => {
    const card = document.querySelector(`[data-slice-id="${data.sliceId}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 100);
  // Auto-load slice log panel for executing slice
  loadSliceLog(data.sliceId);
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
  if (activeSliceLogId === data.sliceId) fetchSliceLogContent(data.sliceId);
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
  if (activeSliceLogId === data.sliceId) fetchSliceLogContent(data.sliceId);
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

// ─── Tempering run pill (TEMPER-02 Slice 02.2) ────────────────────────
//
// The runner emits `tempering-run-completed` with a primitives-only
// payload (verdict, pass/fail/skipped, durationMs, sliceRef). We bucket
// it per-slice in `state.tempering.slicePills[sliceRef.slice]` and
// re-render the slice cards so the new pill appears next to
// gate/retry indicators. No network calls, no per-scanner detail — the
// Tempering tab handles that.
function handleTemperingRunCompleted(data) {
  if (!data || !data.sliceRef || !data.sliceRef.slice) return;
  state.tempering.slicePills[data.sliceRef.slice] = {
    verdict: data.verdict || "unknown",
    pass: data.pass || 0,
    fail: data.fail || 0,
    skipped: data.skipped || 0,
    durationMs: data.durationMs || 0,
    stack: data.stack || null,
    ts: Date.now(),
  };
  renderSliceCards();
}

// TEMPER-04 Slice 04.1 — visual regression detected toast + action
function handleTemperingVisualRegression(data) {
  const pct = data.diffPercent != null ? `${(data.diffPercent * 100).toFixed(2)}%` : "unknown";
  const sev = data.severity || data.band || "unknown";
  addNotification(`Visual regression: ${data.url || data.urlHash} (${pct}) – ${sev}`, "error");
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

    // Quorum leg indicators
    let quorumHtml = "";
    if (s.quorum) {
      const q = s.quorum;
      const legDots = (q.models || []).map((m) => {
        const leg = (q.legs || []).find((l) => l.model === m);
        if (!leg) return `<span class="inline-block w-2 h-2 rounded-full bg-gray-600" title="${m}: pending"></span>`;
        return leg.success
          ? `<span class="inline-block w-2 h-2 rounded-full bg-green-500" title="${m}: done ${leg.duration ? (leg.duration / 1000).toFixed(1) + 's' : ''}"></span>`
          : `<span class="inline-block w-2 h-2 rounded-full bg-red-500" title="${m}: failed"></span>`;
      }).join(" ");
      const winnerLabel = q.winner ? `<span class="text-green-400 text-xs ml-1">→ ${q.winner}</span>` : "";
      quorumHtml = `<div class="flex items-center gap-1 mt-1"><span class="text-xs text-purple-400">⚡ Quorum</span> ${legDots}${winnerLabel}</div>
        <p class="text-xs text-gray-600 mt-0.5">${(q.models || []).join(", ")}</p>`;
    }

    // Quorum vs single-pass badge on card
    const sliceModeBadge = s.quorum
      ? `<span class="text-xs px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-800" title="Quorum mode">Q</span>`
      : (s.status !== "pending" ? `<span class="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-800" title="Single-pass">S</span>` : "");

    // Phase CRUCIBLE-02 Slice 02.1 — Complexity Score badge (⚙ 1-10)
    // Color-graded: green 1-3 (low), amber 4-6 (medium), red 7-10 (high)
    let complexityBadge = "";
    if (typeof s.complexityScore === "number" && Number.isFinite(s.complexityScore)) {
      const c = s.complexityScore;
      const color = c >= 7
        ? "bg-red-900/50 text-red-300 border-red-800"
        : c >= 4
        ? "bg-amber-900/50 text-amber-300 border-amber-800"
        : "bg-green-900/40 text-green-400 border-green-800";
      complexityBadge = `<span class="text-xs px-1.5 py-0.5 rounded ${color} border" title="Complexity score (1-10)">⚙ ${c}/10</span>`;
    }

    // Phase CRUCIBLE-02 Slice 02.1 — Total-Spend badge ($0.xxxx)
    // Only shows once a cost has been recorded. Separate from the existing
    // footer-level model+cost line so the spend is scannable at-a-glance.
    const spendBadge = (typeof s.cost === "number" && s.cost > 0)
      ? `<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-emerald-300 border border-gray-700" title="Model spend for this slice">💰 $${s.cost.toFixed(4)}</span>`
      : "";

    // Gate status indicator
    let gateHtml = "";
    if (s.gateStatus === "passed") {
      gateHtml = `<span class="text-xs text-green-500" title="Gate passed">⛩ pass</span>`;
    } else if (s.gateStatus === "failed") {
      gateHtml = `<span class="text-xs text-red-400" title="Gate failed: ${s.failedCommand || ''}">⛩ fail</span>`;
    }

    // Retry indicator
    const retryHtml = s.attempts && s.attempts > 1
      ? `<span class="text-xs text-yellow-400" title="${s.attempts} attempts">🔄${s.attempts}</span>`
      : "";

    // TEMPER-02 Slice 02.2 — Tempering run pill. Keyed by slice id.
    // Verdict colour-graded green/red/amber so operators can scan the
    // grid and spot the failing slice without opening the Tempering
    // tab. Tooltip shows pass/fail/skipped totals + stack.
    let temperingPillHtml = "";
    const pill = state.tempering?.slicePills?.[s.id];
    if (pill) {
      const pillColor = pill.verdict === "pass"
        ? "text-green-400"
        : pill.verdict === "skipped"
        ? "text-gray-400"
        : "text-red-400";
      const pillIcon = pill.verdict === "pass" ? "✓" : pill.verdict === "skipped" ? "◌" : "✗";
      const pillTitle = `Tempering ${pill.verdict} — ${pill.pass} pass / ${pill.fail} fail / ${pill.skipped} skipped${pill.stack ? " (" + pill.stack + ")" : ""}`;
      temperingPillHtml = `<span class="text-xs ${pillColor}" title="${pillTitle}">🔨${pillIcon}</span>`;
    }

    // Duration bar (proportional to max duration across all slices)
    const maxDuration = Math.max(...state.slices.map((x) => x.duration || 0), 1);
    const durationPct = s.duration ? Math.round((s.duration / maxDuration) * 100) : 0;
    const durationBarColor = s.status === "failed" ? "bg-red-500/40" : s.status === "passed" ? "bg-green-500/30" : "bg-blue-500/30";
    const durationBar = s.duration ? `<div class="mt-1.5 h-1 rounded-full bg-gray-700 overflow-hidden"><div class="${durationBarColor} h-full rounded-full" style="width:${durationPct}%"></div></div>` : "";

    return `
      <div class="slice-card ${bgColor} rounded-lg p-3 border border-gray-700 cursor-pointer hover:border-gray-500 transition-colors" data-slice-id="${s.id}" onclick="loadSliceLog('${s.id}')">
        <div class="flex items-center justify-between mb-1">
          <span class="font-semibold text-sm">${statusIcon} Slice ${s.id} ${sliceModeBadge}${escalatedMark}</span>
          <span class="text-xs text-gray-500 flex items-center gap-1.5">${retryHtml}${temperingPillHtml}${gateHtml}${duration}${elapsed}</span>
        </div>
        <p class="text-xs text-gray-400 truncate">${s.title}</p>
        ${(complexityBadge || spendBadge) ? `<div class="flex items-center gap-1.5 mt-1.5">${complexityBadge}${spendBadge}</div>` : ""}
        ${model ? `<p class="text-xs text-gray-500 mt-1">${modelBadge} ${cost}</p>` : ""}
        ${quorumHtml}
        ${s.error ? `<p class="text-xs text-red-400 mt-1 truncate">${s.error}</p>` : ""}
        ${durationBar}
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

// ─── Slice Log Panel ──────────────────────────────────────────────────
let activeSliceLogId = null;
let sliceLogPollInterval = null;

function loadSliceLog(sliceId) {
  activeSliceLogId = sliceId;
  const label = document.getElementById("slice-log-label");
  if (label) label.textContent = `— Slice ${sliceId}`;

  // Highlight selected card
  document.querySelectorAll(".slice-card").forEach((c) => {
    c.classList.toggle("ring-1", c.dataset.sliceId === sliceId);
    c.classList.toggle("ring-blue-500", c.dataset.sliceId === sliceId);
  });

  fetchSliceLogContent(sliceId);

  // Poll while executing
  const slice = state.slices.find((s) => s.id === sliceId);
  if (sliceLogPollInterval) clearInterval(sliceLogPollInterval);
  if (slice && slice.status === "executing") {
    sliceLogPollInterval = setInterval(() => {
      if (activeSliceLogId === sliceId) fetchSliceLogContent(sliceId);
      else clearInterval(sliceLogPollInterval);
    }, 3000);
  }
}

function fetchSliceLogContent(sliceId) {
  const logEl = document.getElementById("slice-log");
  if (!logEl) return;

  // Try recent run indices (0 = latest, then 1, 2...) until we find a log
  tryFetchSliceLog(sliceId, 0, logEl);
}

function tryFetchSliceLog(sliceId, runIdx, logEl) {
  if (runIdx > 5) {
    // Exhausted search — show status-based message
    const slice = state.slices.find((s) => s.id === sliceId);
    if (slice && slice.status === "executing") {
      logEl.innerHTML = '<div class="text-blue-300 animate-pulse py-2">⚡ Slice executing — log will appear when worker output is captured...</div>';
    } else if (slice && slice.status === "pending") {
      logEl.innerHTML = '<div class="text-gray-500 py-2">⏳ Slice not started yet</div>';
    } else {
      logEl.innerHTML = '<div class="text-gray-500 py-2">No log available for this slice</div>';
    }
    return;
  }

  fetch(`${API_BASE}/api/replay/${runIdx}/${sliceId}`)
    .then((r) => {
      if (!r.ok) throw new Error("not found");
      return r.json();
    })
    .then((data) => {
      const text = data.log || "";
      if (!text.trim()) throw new Error("empty");
      // Preserve expanded/collapsed state of sections before re-render
      const expandedSections = new Set();
      logEl.querySelectorAll("[id^='sec-']").forEach((el) => {
        if (!el.classList.contains("hidden")) expandedSections.add(el.previousElementSibling?.textContent?.trim());
      });
      logEl.innerHTML = formatSliceLog(text);
      // Restore expanded sections
      if (expandedSections.size > 0) {
        logEl.querySelectorAll("[id^='sec-']").forEach((el) => {
          const header = el.previousElementSibling?.textContent?.trim();
          if (expandedSections.has(header)) el.classList.remove("hidden");
        });
      }
      logEl.scrollTop = logEl.scrollHeight;
    })
    .catch(() => {
      // Try next older run
      tryFetchSliceLog(sliceId, runIdx + 1, logEl);
    });
}

function formatSliceLog(text) {
  const lines = text.split("\n");
  const sections = [];
  let currentSection = null;
  let sectionLines = [];

  for (const line of lines) {
    if (line.startsWith("=== ") && line.endsWith(" ===")) {
      if (currentSection) {
        sections.push({ title: currentSection, lines: sectionLines });
      }
      currentSection = line.replace(/^=== | ===$/g, "");
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  if (currentSection) sections.push({ title: currentSection, lines: sectionLines });
  if (sections.length === 0) {
    return lines.map((l) => `<div class="text-gray-400">${escapeHtml(l) || "&nbsp;"}</div>`).join("");
  }

  return sections.map((sec) => {
    const lineCount = sec.lines.filter((l) => l.trim()).length;
    const isOutput = /STDOUT|STDERR/.test(sec.title);
    const isCollapsed = isOutput && lineCount > 15;
    const id = `sec-${Math.random().toString(36).slice(2, 8)}`;

    let headerCls = "text-blue-400 font-semibold";
    if (/STDERR/.test(sec.title)) headerCls = "text-yellow-400 font-semibold";

    const formatted = sec.lines.map((line) => {
      let cls = "text-gray-400";
      if (/\bFAIL|\bERROR|\bfailed|❌/.test(line)) cls = "text-red-400";
      else if (/\bPASS|\bsuccess|✅|passed/.test(line)) cls = "text-green-400";
      else if (/^Worker:|^Model:|^Started:/.test(line)) cls = "text-cyan-400";
      else if (/RETRY|GATE FAILED|TIMED OUT/.test(line)) cls = "text-yellow-400";
      else if (/^\s*\d+\s+(passing|failing)/.test(line)) cls = line.includes("failing") ? "text-red-400" : "text-green-400";
      return `<div class="${cls}">${escapeHtml(line) || "&nbsp;"}</div>`;
    }).join("");

    if (isCollapsed) {
      return `<div class="mt-1">
        <div class="${headerCls} cursor-pointer select-none" onclick="document.getElementById('${id}').classList.toggle('hidden')">
          ▶ ${escapeHtml(sec.title)} <span class="text-gray-600 font-normal">(${lineCount} lines — click to expand)</span>
        </div>
        <div id="${id}" class="hidden pl-2 border-l border-gray-700 ml-1">${formatted}</div>
      </div>`;
    }

    return `<div class="mt-1">
      <div class="${headerCls}">${escapeHtml(sec.title)} <span class="text-gray-600 font-normal">${lineCount > 0 ? `(${lineCount} lines)` : ""}</span></div>
      <div class="pl-2 border-l border-gray-700 ml-1">${formatted}</div>
    </div>`;
  }).join("");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clearSliceLog() {
  activeSliceLogId = null;
  if (sliceLogPollInterval) clearInterval(sliceLogPollInterval);
  const label = document.getElementById("slice-log-label");
  const logEl = document.getElementById("slice-log");
  const searchEl = document.getElementById("slice-log-search");
  if (label) label.textContent = "";
  if (searchEl) searchEl.value = "";
  if (logEl) logEl.innerHTML = '<p class="py-4 text-center text-gray-500">Click a slice card to view its log</p>';
  document.querySelectorAll(".slice-card").forEach((c) => {
    c.classList.remove("ring-1", "ring-blue-500");
  });
}

function filterSliceLog(query) {
  const logEl = document.getElementById("slice-log");
  if (!logEl) return;
  const q = query.toLowerCase().trim();
  logEl.querySelectorAll("div").forEach((line) => {
    if (!q) {
      line.style.display = "";
      return;
    }
    // Always show section headers and containers
    if (line.id?.startsWith("sec-") || line.querySelector("[id^='sec-']") || line.classList.contains("mt-1")) {
      line.style.display = "";
      return;
    }
    // Filter leaf lines
    const text = line.textContent?.toLowerCase() || "";
    line.style.display = text.includes(q) ? "" : "none";
  });
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
      const runLabels = runs.slice().reverse().map((r) => {
        const d = r.startTime ? new Date(r.startTime) : null;
        const plan = r.plan ? r.plan.split("/").pop().replace(/\.md$/, "").replace(/Phase-/i, "").substring(0, 20) : "?";
        return d ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}` : plan;
      });
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
    const qPreset = document.getElementById("cfg-quorum-preset");
    if (maxP) maxP.value = currentConfig.maxParallelism ?? 3;
    if (maxR) maxR.value = currentConfig.maxRetries ?? 1;
    if (maxH) maxH.value = currentConfig.maxRunHistory ?? 50;
    if (qEnabled) qEnabled.checked = currentConfig.quorum?.enabled || false;
    if (qThresh) qThresh.value = currentConfig.quorum?.threshold ?? 7;
    if (qModels) qModels.value = (currentConfig.quorum?.models || []).join(", ");
    if (qPreset) qPreset.value = currentConfig.quorum?.preset || "";

    // Check API provider availability
    loadApiProviderStatus();
    loadApiKeys();
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

// ─── Provider API Keys ────────────────────────────────────────
const KNOWN_PROVIDER_KEYS = [
  { key: "XAI_API_KEY", label: "xAI (Grok)", placeholder: "xai-..." },
  { key: "OPENAI_API_KEY", label: "OpenAI (GPT / DALL-E)", placeholder: "sk-..." },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude API)", placeholder: "sk-ant-..." },
  { key: "OPENCLAW_API_KEY", label: "OpenClaw Analytics", placeholder: "oc-..." },
];

async function loadApiKeys() {
  const container = document.getElementById("cfg-api-keys");
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/api/secrets`);
    const data = await res.json();
    const keys = data.keys || {};

    container.innerHTML = KNOWN_PROVIDER_KEYS.map((pk) => {
      const info = keys[pk.key];
      const isSet = info?.set;
      const source = info?.source === "env" ? " (env var)" : "";
      const masked = info?.masked || "";
      const statusIcon = isSet ? '<span class="text-green-400">✓</span>' : '<span class="text-gray-600">○</span>';
      const statusText = isSet ? `<span class="text-xs text-gray-500">${masked}${source}</span>` : '<span class="text-xs text-gray-600">not set</span>';

      return `
        <div class="flex items-center gap-2 bg-gray-700/50 rounded px-3 py-1.5">
          <span class="text-xs w-40 text-gray-300">${statusIcon} ${pk.label}</span>
          ${statusText}
          <input type="password" id="secret-${pk.key}" placeholder="${pk.placeholder}" class="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-blue-500 outline-none" autocomplete="off">
          <button onclick="saveApiKey('${pk.key}')" class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">Save</button>
          ${isSet && info?.source !== "env" ? `<button onclick="removeApiKey('${pk.key}')" class="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 text-red-300 rounded">✗</button>` : ""}
        </div>`;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-xs text-red-400">Error loading keys: ${err.message}</div>`;
  }
}

async function saveApiKey(key) {
  const input = document.getElementById(`secret-${key}`);
  if (!input || !input.value.trim()) return;
  try {
    const res = await fetch(`${API_BASE}/api/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: input.value.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      input.value = "";
      addNotification(`${key} saved`, "success");
      loadApiKeys(); // Refresh display
    } else {
      addNotification(`Error: ${data.error}`, "error");
    }
  } catch (err) {
    addNotification(`Error saving key: ${err.message}`, "error");
  }
}

async function removeApiKey(key) {
  if (!confirm(`Remove ${key} from .forge/secrets.json?`)) return;
  try {
    const res = await fetch(`${API_BASE}/api/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: "" }),
    });
    const data = await res.json();
    if (data.success) {
      addNotification(`${key} removed`, "success");
      loadApiKeys();
    }
  } catch (err) {
    addNotification(`Error: ${err.message}`, "error");
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
    const qPreset = document.getElementById("cfg-quorum-preset")?.value || "";

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
        ...(qPreset ? { preset: qPreset } : {}),
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
let tabBadgeState = { runsNew: 0, hasAnomaly: false, skillsActive: 0, lgHealthAlert: false, lgIncidentsNew: 0, lgCritical: false, lgSecurityAlert: false };

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
    } else if (tab.dataset.tab === "lg-health" && tabBadgeState.lgHealthAlert) {
      badgeText = "!";
    } else if (tab.dataset.tab === "lg-incidents" && tabBadgeState.lgIncidentsNew > 0) {
      badgeText = tabBadgeState.lgIncidentsNew;
    } else if (tab.dataset.tab === "lg-security" && tabBadgeState.lgSecurityAlert) {
      badgeText = "!";
    } else if (tab.dataset.tab === "lg-triage" && tabBadgeState.lgCritical) {
      badgeText = "⚠";
    } else if (tab.dataset.tab === "watcher" && tabBadgeState.watcherNew > 0) {
      badgeText = tabBadgeState.watcherNew;
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
// Bootstrap version check — detect stale core files and show upgrade banner
// This code reaches existing users via `pforge update` which copies dashboard/app.js
(function checkBootstrapVersion() {
  const MIN_FRAMEWORK_VERSION = '2.30.2';
  fetch(`${API_BASE}/api/version`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !data.framework) return;
      // Simple semver compare: "2.30.2" > "2.29.3"
      const current = data.framework.split('.').map(Number);
      const required = MIN_FRAMEWORK_VERSION.split('.').map(Number);
      const isStale = current[0] < required[0] ||
        (current[0] === required[0] && current[1] < required[1]) ||
        (current[0] === required[0] && current[1] === required[1] && current[2] < required[2]);
      if (isStale) {
        const banner = document.createElement('div');
        banner.className = 'fixed top-0 left-0 right-0 z-[200] bg-amber-900/95 border-b-2 border-amber-500 px-6 py-3 text-center';
        banner.innerHTML = `
          <p class="text-amber-100 font-semibold">⚠️ Plan Forge core v${data.framework} is outdated (v${MIN_FRAMEWORK_VERSION}+ required)</p>
          <p class="text-amber-200 text-sm mt-1">Your dashboard is updated but the CLI and MCP server are not. Run this one-time bootstrap:</p>
          <code class="block bg-slate-900 text-amber-400 rounded px-4 py-2 mt-2 text-xs font-mono select-all max-w-2xl mx-auto">
            ${navigator.platform.includes('Win')
              ? 'Invoke-WebRequest -Uri "https://raw.githubusercontent.com/srnichols/plan-forge/master/pforge.ps1" -OutFile pforge.ps1; .\\pforge.ps1 update --force'
              : 'curl -sO https://raw.githubusercontent.com/srnichols/plan-forge/master/pforge.sh && bash pforge.sh update --force'}
          </code>
          <button onclick="this.parentElement.remove()" class="text-amber-400 hover:text-white text-xs mt-2 underline block mx-auto">Dismiss</button>
        `;
        document.body.prepend(banner);
      }
    })
    .catch(() => {}); // Server may not support /api/version yet — silently skip
})();

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
    // Skip REST init if WebSocket history replay has already populated slice state.
    // WS is the authoritative real-time source; REST is only a fallback.
    if (state.slices.length > 0) {
      // Still update metadata if not set
      if (!state.runMeta) state.runMeta = run;
      return;
    }

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
        updateRunBadges(run);
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

// ─── Phase UPDATE-01 — update-available banner ─────────────
// Dashboard asks the server (which caches 24h) whether a newer release
// exists. If so, show a small dismissible banner in the header that
// links to the release. Dismissal is remembered per-release via
// localStorage so we don't nag after the user clicked "later".
function dismissUpdateBanner() {
  const banner = document.getElementById("update-banner");
  if (!banner) return;
  banner.classList.add("hidden");
  banner.classList.remove("flex");
  const latest = banner.dataset.latest;
  if (latest) {
    try { localStorage.setItem("pforge-update-dismissed", latest); } catch { /* ignore */ }
  }
}
window.dismissUpdateBanner = dismissUpdateBanner;

fetch(`${API_BASE}/api/update-status`)
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data || !data.available || !data.latest) return;
    let dismissed = null;
    try { dismissed = localStorage.getItem("pforge-update-dismissed"); } catch { /* ignore */ }
    if (dismissed === data.latest) return;
    const banner = document.getElementById("update-banner");
    const text = document.getElementById("update-banner-text");
    if (!banner || !text) return;
    banner.href = data.url || "https://github.com/srnichols/plan-forge/releases/latest";
    banner.dataset.latest = data.latest;
    text.textContent = `v${data.latest} available (you have v${data.current})`;
    banner.classList.remove("hidden");
    banner.classList.add("inline-flex");
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
  crucible: loadCrucible,
  governance: loadGovernance,
  runs: () => { loadRuns(); tabBadgeState.runsNew = 0; updateTabBadges(); },
  replay: loadReplayRuns,
  extensions: loadExtensions,
  config: () => { loadConfig(); loadCrucibleConfigUI(); },
  traces: loadTraces,
  cost: () => { loadCost(); tabBadgeState.hasAnomaly = false; updateTabBadges(); },
  skills: loadSkillCatalog,
  'lg-health': loadLGHealth,
  'lg-incidents': () => { loadLGIncidents(); tabBadgeState.lgIncidentsNew = 0; updateTabBadges(); },
  'lg-triage': loadLGTriage,
  'lg-security': () => { loadLGSecurity(); tabBadgeState.lgSecurityAlert = false; updateTabBadges(); },
  'lg-env': loadLGEnv,
  watcher: () => { renderWatcherPanel(); tabBadgeState.watcherNew = 0; updateTabBadges(); },
  tempering: () => { loadTemperingStatus(); },
  memory: loadMemoryReport,
};

// ─── Theme Toggle ─────────────────────────────────────────────

// ─── LiveGuard Tab Loaders ─────────────────────────────────────
async function loadLGHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/capabilities`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (res?.liveguard) {
      const el = document.getElementById('lg-drift-score');
      const score = res.liveguard.driftScore ?? null;
      if (el) el.textContent = score ?? '—';
      const inc = document.getElementById('lg-open-incidents');
      if (inc) inc.textContent = res.liveguard.openIncidents ?? '—';
      const scan = document.getElementById('lg-last-scan');
      if (scan) scan.textContent = res.liveguard.lastScan ? new Date(res.liveguard.lastScan).toLocaleString() : '—';
      // Drift gauge
      const gauge = document.getElementById('lg-drift-gauge');
      if (gauge && score != null) {
        gauge.value = score;
        const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
        if (el) el.className = `text-2xl font-bold ${color}`;
      }
    }
    // Drift history chart
    const driftData = await fetch(`${API_BASE}/api/liveguard/traces`).then(r => r.ok ? r.json() : []).catch(() => []);
    const healthCanvas = document.getElementById('lg-health-chart');
    if (healthCanvas && typeof Chart !== 'undefined') {
      if (window._lgHealthChart) { window._lgHealthChart.destroy(); window._lgHealthChart = null; }
      const driftEntries = driftData.filter(e => e.tool === 'forge_drift_report' && e.result?.score != null).slice(-20);
      if (driftEntries.length > 0) {
        window._lgHealthChart = new Chart(healthCanvas, {
          type: 'line',
          data: {
            labels: driftEntries.map(e => new Date(e.timestamp || e.ts).toLocaleDateString()),
            datasets: [{ label: 'Drift Score', data: driftEntries.map(e => e.result.score), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3 }]
          },
          options: { responsive: true, scales: { y: { min: 0, max: 100, ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }, x: { ticks: { color: '#9ca3af' } } }, plugins: { legend: { display: false } } }
        });
      } else {
        const ctx = healthCanvas.getContext('2d');
        ctx.clearRect(0, 0, healthCanvas.width, healthCanvas.height);
        document.getElementById('lg-health-trend').innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No drift history yet. Run <code>pforge drift</code> to populate.</p>';
      }
    }
    // Hotspot chart
    const hotspotCanvas = document.getElementById('lg-hotspot-chart');
    if (hotspotCanvas && typeof Chart !== 'undefined') {
      if (window._lgHotspotChart) { window._lgHotspotChart.destroy(); window._lgHotspotChart = null; }
      const toolCounts = {};
      for (const e of driftData) { const t = e.tool || 'unknown'; toolCounts[t] = (toolCounts[t] || 0) + 1; }
      const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (sorted.length > 0) {
        window._lgHotspotChart = new Chart(hotspotCanvas, {
          type: 'bar',
          data: {
            labels: sorted.map(([k]) => k.replace('forge_', '')),
            datasets: [{ label: 'Invocations', data: sorted.map(([, v]) => v), backgroundColor: '#f59e0b' }]
          },
          options: { responsive: true, indexAxis: 'y', scales: { x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }, y: { ticks: { color: '#9ca3af' } } }, plugins: { legend: { display: false } } }
        });
      } else {
        document.getElementById('lg-hotspot-container').innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No data yet — run <code>pforge drift</code></p>';
      }
    }
  } catch { /* tab remains in placeholder state */ }
}
window.loadLGHealth = loadLGHealth;

async function loadLGIncidents() {
  try {
    const proposals = await fetch(`${API_BASE}/api/fix/proposals`).then(r => r.ok ? r.json() : []).catch(() => []);
    renderFixProposals(proposals);
  } catch { /* tab remains in placeholder state */ }
}
window.loadLGIncidents = loadLGIncidents;

async function loadLGTriage() {
  // Placeholder — loads triage data when triage REST endpoint ships
  const el = document.getElementById('lg-triage-list');
  if (el && el.children.length <= 1) {
    el.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No triage data yet. Run <code class="bg-gray-700 px-1 rounded">pforge alert-triage</code> to populate.</p>';
  }
}
window.loadLGTriage = loadLGTriage;

async function loadLGSecurity() {
  const el = document.getElementById('lg-security-results');
  if (!el) return;
  try {
    const res = await fetch('/api/secret-scan');
    const data = await res.json();
    if (!data || data.cache === null || !data.scannedAt) {
      el.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No scan results. Run <code class="bg-gray-700 px-1 rounded">pforge secret-scan</code> to populate.</p>';
      return;
    }
    let html = `<div class="text-xs text-gray-400 mb-2">Scanned: ${data.scannedAt} | Since: ${data.since} | Files: ${data.scannedFiles} | Threshold: ${data.threshold}</div>`;
    if (data.clean) {
      html += '<p class="text-green-400 text-sm py-2">\u2705 Clean — no secrets detected</p>';
    } else {
      html += `<p class="text-yellow-400 text-sm mb-2">\u26A0\uFE0F ${data.findings.length} finding(s)</p>`;
      html += '<div class="space-y-1">';
      for (const f of data.findings) {
        const color = f.confidence === 'high' ? 'text-red-400' : f.confidence === 'medium' ? 'text-yellow-400' : 'text-gray-400';
        html += `<div class="${color} text-xs font-mono">${f.file}:${f.line} [${f.confidence}] entropy=${f.entropyScore} type=${f.type}</div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No scan results. Run <code class="bg-gray-700 px-1 rounded">pforge secret-scan</code> to populate.</p>';
  }
}
window.loadLGSecurity = loadLGSecurity;

async function loadLGEnv() {
  // Placeholder — loads env diff data when env REST endpoint ships
  const el = document.getElementById('lg-env-diff');
  if (el && el.children.length <= 1) {
    el.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No diff data yet. Run <code class="bg-gray-700 px-1 rounded">pforge env-diff</code> to populate.</p>';
  }
}
window.loadLGEnv = loadLGEnv;

function renderFixProposals(proposals) {
  const el = document.getElementById('lg-fix-proposals-list');
  if (!el) return;
  if (!proposals || !proposals.length) {
    el.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">No fix proposals yet. Run <code class="bg-gray-700 px-1 rounded">pforge fix-proposal --source regression</code> after a LiveGuard alert.</p>';
    return;
  }
  el.innerHTML = proposals.map(p => `
    <div class="bg-gray-700/50 rounded-lg p-3 flex items-center justify-between mb-2">
      <div>
        <code class="text-amber-400 text-xs">${escHtml(p.incidentId || 'unknown')}</code>
        <span class="ml-2 text-xs px-1.5 py-0.5 rounded ${p.status === 'applied' ? 'bg-green-900 text-green-300' : p.status === 'needs-human-intervention' ? 'bg-red-900 text-red-300' : 'bg-gray-600 text-gray-300'}">${escHtml(p.status || 'pending')}</span>
        <p class="text-xs text-gray-500 mt-0.5">${escHtml(p.planFile || '')}</p>
      </div>
      <span class="text-xs text-gray-500">${p.generatedAt ? new Date(p.generatedAt).toLocaleDateString() : ''}</span>
    </div>`).join('');
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// LiveGuard hub event handlers
function handleLGDrift(data) {
  const el = document.getElementById('lg-drift-score');
  if (el && data.score != null) el.textContent = data.score;
  // Update drift gauge
  const gauge = document.getElementById('lg-drift-gauge');
  if (gauge && data.score != null) {
    gauge.value = data.score;
    const color = data.score >= 80 ? 'text-green-400' : data.score >= 50 ? 'text-amber-400' : 'text-red-400';
    el.className = `text-2xl font-bold ${color}`;
  }
  if (data.score != null && data.score < 50) {
    tabBadgeState.lgHealthAlert = true;
    updateTabBadges();
  }
}

function handleLGIncident(data) {
  tabBadgeState.lgIncidentsNew++;
  updateTabBadges();
  loadLGIncidents();
}

function handleLGTriage(data) {
  if (data.severity === 'critical') {
    tabBadgeState.lgCritical = true;
    updateTabBadges();
  }
  loadLGTriage();
}

function handleFixProposal(data) {
  loadLGIncidents();
  addNotification(`Fix proposal ready: ${data.incidentId || 'new'}`, 'amber');
}

function handleLGToolCompleted(data) {
  const tool = data.tool || data.name || '';
  if (tool.includes('secret') || tool.includes('scan')) {
    tabBadgeState.lgSecurityAlert = true;
    updateTabBadges();
    addNotification(`LiveGuard: ${tool} completed`, 'amber');
  } else if (tool.includes('drift')) {
    tabBadgeState.lgHealthAlert = true;
    updateTabBadges();
  }
  // Refresh the active LG tab if one is showing
  const activeTab = document.querySelector(".tab-btn.tab-active")?.dataset?.tab;
  if (activeTab && activeTab.startsWith('lg-') && tabLoadHooks[activeTab]) {
    tabLoadHooks[activeTab]();
  }
}

function handleLGSecretScan(data) {
  tabBadgeState.lgSecurityAlert = true;
  updateTabBadges();
  addNotification('LiveGuard: secret scan results available', 'amber');
  const activeTab = document.querySelector(".tab-btn.tab-active")?.dataset?.tab;
  if (activeTab === 'lg-security') loadLGSecurity();
}

// ─── Watcher (v2.35) hub event handlers ──────────────────────
function handleWatchSnapshot(data) {
  const snap = { ...data, ts: new Date().toISOString() };
  state.watcher.snapshots.unshift(snap);
  if (state.watcher.snapshots.length > 50) state.watcher.snapshots.length = 50;
  tabBadgeState.watcherNew = (tabBadgeState.watcherNew || 0) + 1;
  updateTabBadges();
  if (document.querySelector(".tab-btn.tab-active")?.dataset?.tab === "watcher") renderWatcherPanel();
}

function handleWatchAnomaly(data) {
  const a = { ...data, ts: new Date().toISOString() };
  state.watcher.anomalies.unshift(a);
  if (state.watcher.anomalies.length > 100) state.watcher.anomalies.length = 100;
  const sev = a.severity || "warn";
  const type = sev === "error" ? "error" : "amber";
  addNotification(`Watcher: ${a.code || "anomaly"} — ${a.message || ""}`, type);
  if (document.querySelector(".tab-btn.tab-active")?.dataset?.tab === "watcher") renderWatcherPanel();
}

function handleWatchAdvice(data) {
  const adv = { ...data, ts: new Date().toISOString() };
  state.watcher.advice.unshift(adv);
  if (state.watcher.advice.length > 50) state.watcher.advice.length = 50;
  addNotification(`Watcher advice: ${adv.model || "model"} (${adv.tokensOut || 0} tokens out)`, "info");
  if (document.querySelector(".tab-btn.tab-active")?.dataset?.tab === "watcher") renderWatcherPanel();
}

function renderWatcherPanel() {
  const snapEl = document.getElementById("watcher-snapshot");
  const anoEl = document.getElementById("watcher-anomalies");
  const advEl = document.getElementById("watcher-advice");
  if (!snapEl || !anoEl || !advEl) return;

  const latest = state.watcher.snapshots[0];
  if (!latest) {
    snapEl.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No watcher snapshots yet. Run <code class="bg-gray-700 px-1 rounded">pforge watch &lt;target&gt;</code> or <code class="bg-gray-700 px-1 rounded">pforge watch-live &lt;target&gt;</code>.</p>';
  } else {
    const stateColor = { "in-progress": "text-blue-400", "completed": "text-green-400", "failed": "text-red-400", "stalled": "text-yellow-400", "idle": "text-gray-400" }[latest.runState] || "text-gray-300";

    // Phase CRUCIBLE-03 Slice 03.2 — dedicated Crucible funnel row.
    // Renders counts + stall/orphan highlights when the watched project
    // has a `.forge/crucible/` directory, otherwise stays hidden. This
    // mirrors the Smith panel section and is driven by the `crucible`
    // block on the `watch-snapshot-completed` hub event payload.
    let crucibleRow = "";
    if (latest.crucible) {
      const c = latest.crucible;
      const staleColor = c.staleInProgress > 0 ? "text-amber-400" : "text-gray-500";
      const orphanColor = c.orphanHandoffs > 0 ? "text-red-400" : "text-gray-500";
      const cutoff = c.stallCutoffDays || 7;
      crucibleRow = `
      <div class="col-span-2 mt-3 pt-3 border-t border-gray-700/50">
        <p class="text-gray-500 text-xs mb-1.5">Crucible Funnel</p>
        <div class="flex items-center gap-3 text-xs flex-wrap" data-testid="watcher-crucible-row">
          <span class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300" title="Total smelts">Σ ${c.total}</span>
          <span class="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300" title="Finalized smelts">✓ ${c.finalized}</span>
          <span class="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300" title="In-progress smelts">⧗ ${c.in_progress}</span>
          <span class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400" title="Abandoned smelts">✗ ${c.abandoned}</span>
          <span class="px-1.5 py-0.5 rounded bg-gray-800 ${staleColor}" title="Idle ≥ ${cutoff} days">⚠ ${c.staleInProgress} stalled</span>
          <span class="px-1.5 py-0.5 rounded bg-gray-800 ${orphanColor}" title="Hardener handoffs with missing plan files">⛓ ${c.orphanHandoffs} orphan</span>
        </div>
      </div>`;
    }

    // Phase TEMPER-01 Slice 01.2 — Tempering row mirrors the Crucible row.
    // Driven by the compact `tempering` block on watch-snapshot-completed
    // payloads. Hidden when the subsystem hasn't been initialized.
    let temperingRow = "";
    if (latest.tempering) {
      const t = latest.tempering;
      const cutoff = t.staleCutoffDays || 7;
      const ageDays = t.latestScanAgeMs ? Math.floor(t.latestScanAgeMs / (24 * 60 * 60 * 1000)) : null;
      const staleColor = t.stale ? "text-amber-400" : "text-gray-500";
      const belowColor = t.belowMinimum > 0 ? "text-amber-400" : "text-gray-500";
      const statusMap = { green: "text-green-300 bg-green-900/40", amber: "text-amber-300 bg-amber-900/40", "no-data": "text-gray-400 bg-gray-800", error: "text-red-300 bg-red-900/40" };
      const statusCls = statusMap[t.latestStatus] || "text-gray-400 bg-gray-800";
      const statusLabel = t.latestStatus || "no-scan";
      temperingRow = `
      <div class="col-span-2 mt-3 pt-3 border-t border-gray-700/50">
        <p class="text-gray-500 text-xs mb-1.5">Tempering</p>
        <div class="flex items-center gap-3 text-xs flex-wrap" data-testid="watcher-tempering-row">
          <span class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300" title="Total scans">Σ ${t.totalScans}</span>
          <span class="px-1.5 py-0.5 rounded ${statusCls}" title="Latest scan status">● ${escHtml(statusLabel)}</span>
          <span class="px-1.5 py-0.5 rounded bg-gray-800 ${belowColor}" title="Coverage layers ≥ 5 points below minimum">⚠ ${t.belowMinimum} below min</span>
          <span class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400" title="Total gap records in latest scan">⌂ ${t.gaps} gaps</span>
          <span class="px-1.5 py-0.5 rounded bg-gray-800 ${staleColor}" title="Latest scan age (cutoff ${cutoff}d)">⏱ ${ageDays !== null ? ageDays + "d" : "never"}${t.stale ? " stale" : ""}</span>
        </div>
      </div>`;
    }

    snapEl.innerHTML = `
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div><p class="text-gray-500 text-xs">Target</p><p class="text-gray-200 font-mono text-xs truncate">${escHtml(latest.targetPath || "—")}</p></div>
        <div><p class="text-gray-500 text-xs">Run State</p><p class="${stateColor} font-semibold">${escHtml(latest.runState || "—")}</p></div>
        <div><p class="text-gray-500 text-xs">Run ID</p><p class="text-gray-300 font-mono text-xs">${escHtml(latest.runId || "—")}</p></div>
        <div><p class="text-gray-500 text-xs">Anomalies</p><p class="${latest.anomalyCount > 0 ? "text-amber-400" : "text-green-400"} font-semibold">${latest.anomalyCount ?? 0}</p></div>
        <div class="col-span-2"><p class="text-gray-500 text-xs">Cursor</p><p class="text-gray-400 font-mono text-xs">${escHtml(latest.cursor || "—")}</p></div>
        ${crucibleRow}
        ${temperingRow}
      </div>
      <p class="text-xs text-gray-600 mt-2">${state.watcher.snapshots.length} snapshot(s) received this session</p>`;
  }

  const anomalies = state.watcher.anomalies.slice(0, 20);
  if (anomalies.length === 0) {
    anoEl.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No anomalies detected.</p>';
  } else {
    anoEl.innerHTML = anomalies.map((a) => {
      const sev = a.severity || "warn";
      const color = sev === "error" ? "red" : sev === "warn" ? "amber" : "blue";
      const time = new Date(a.ts).toLocaleTimeString();
      return `<div class="flex items-start gap-2 py-1.5 border-b border-gray-700/50 last:border-0">
        <span class="text-xs px-1.5 py-0.5 rounded bg-${color}-500/20 text-${color}-400 shrink-0 font-mono">${escHtml(a.code || "anomaly")}</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-gray-300">${escHtml(a.message || "")}</p>
          <p class="text-xs text-gray-600">${escHtml(a.runId || "")} · ${time}</p>
        </div>
      </div>`;
    }).join("");
  }

  const advice = state.watcher.advice.slice(0, 10);
  if (advice.length === 0) {
    advEl.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No advice generated yet. Use <code class="bg-gray-700 px-1 rounded">pforge watch &lt;target&gt; --analyze</code>.</p>';
  } else {
    advEl.innerHTML = advice.map((a) => {
      const time = new Date(a.ts).toLocaleTimeString();
      return `<div class="flex items-center gap-2 py-1.5 border-b border-gray-700/50 last:border-0">
        <span class="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 shrink-0">${escHtml(a.model || "model")}</span>
        <span class="text-xs text-gray-400 flex-1 truncate">${escHtml(a.runId || "")}</span>
        <span class="text-xs text-gray-500">${a.tokensOut || 0} tok</span>
        <span class="text-xs text-gray-600">${time}</span>
      </div>`;
    }).join("");
  }
}
window.renderWatcherPanel = renderWatcherPanel;

// ─── Memory Tab Loader (GX.1 v2.36) ─────────────────────────────────────
// Pulls /api/memory/report (backed by buildMemoryReport in memory.mjs / GX.3)
// and renders KPI strip + L2 file table + by-tool/by-type breakdowns + drain
// trend + orphan list. Defensive: every section degrades to a friendly placeholder
// when its slice of the report is empty.
async function loadMemoryReport() {
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  let report;
  try {
    const r = await fetch(`${API_BASE}/api/memory/report`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    report = await r.json();
  } catch (err) {
    setText("mem-captures-total", "—");
    setHTML("mem-l2-files", `<p class="text-red-400 py-2 text-center">Failed to load: ${err.message}</p>`);
    return;
  }

  // KPI strip
  const t = report.telemetry || { total: 0, dedupedCount: 0, byTool: {}, byType: {} };
  const q = report.queue || { pending: 0, delivered: 0, failed: 0, deferred: 0, dlq: 0 };
  const c = report.cache || { totalEntries: 0, uniqueKeys: 0, freshEntries: 0 };
  setText("mem-captures-total", t.total);
  setText("mem-captures-deduped", `${t.dedupedCount} deduped`);
  setText("mem-queue-pending", q.pending);
  setText("mem-queue-deferred", `${q.deferred} deferred`);
  setText("mem-queue-delivered", q.delivered);
  setText("mem-queue-dlq", q.failed + q.dlq);
  setText("mem-cache-fresh", c.freshEntries);
  setText("mem-cache-total", `${c.totalEntries} total entries`);

  // L2 files table
  const files = Array.isArray(report.l2Files) ? report.l2Files : [];
  if (files.length === 0) {
    setHTML("mem-l2-files", `<p class="text-gray-500 py-2 text-center">No L2 files yet.</p>`);
  } else {
    const fmtBytes = (n) => {
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    };
    const rows = files.map((f) => {
      const status = f.exists
        ? `<span class="text-green-400">✓</span>`
        : `<span class="text-gray-600">·</span>`;
      const versions = f.versions ? Object.entries(f.versions).map(([v, n]) => `_v:${v}=${n}`).join(" · ") : "—";
      return `<tr class="border-b border-gray-700/50">
        <td class="py-1 pr-2">${status}</td>
        <td class="py-1 pr-2 font-mono text-gray-300">${f.name}</td>
        <td class="py-1 pr-2 text-right text-gray-400">${f.exists ? f.records : "—"}</td>
        <td class="py-1 pr-2 text-right text-gray-500">${f.exists ? fmtBytes(f.size) : "—"}</td>
        <td class="py-1 text-gray-500">${f.exists ? versions : "—"}</td>
      </tr>`;
    }).join("");
    setHTML("mem-l2-files", `<table class="w-full text-xs">
      <thead><tr class="text-gray-500 border-b border-gray-700">
        <th class="text-left py-1 pr-2"></th>
        <th class="text-left py-1 pr-2">File</th>
        <th class="text-right py-1 pr-2">Records</th>
        <th class="text-right py-1 pr-2">Size</th>
        <th class="text-left py-1">Versions</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
  }

  // By-tool breakdown
  const byTool = t.byTool || {};
  const toolEntries = Object.entries(byTool).sort(([, a], [, b]) => b - a);
  if (toolEntries.length === 0) {
    setHTML("mem-by-tool", `<p class="text-gray-500 py-2 text-center">No captures yet.</p>`);
  } else {
    const max = toolEntries[0][1] || 1;
    setHTML("mem-by-tool", toolEntries.map(([tool, n]) => {
      const pct = Math.round((n / max) * 100);
      return `<div class="mb-1">
        <div class="flex justify-between text-gray-400">
          <span class="font-mono">${tool}</span><span>${n}</span>
        </div>
        <div class="h-1 bg-gray-700 rounded"><div class="h-1 bg-blue-500 rounded" style="width:${pct}%"></div></div>
      </div>`;
    }).join(""));
  }

  // By-type breakdown
  const byType = t.byType || {};
  const typeEntries = Object.entries(byType).sort(([, a], [, b]) => b - a);
  if (typeEntries.length === 0) {
    setHTML("mem-by-type", `<p class="text-gray-500 py-2 text-center">No captures yet.</p>`);
  } else {
    const max = typeEntries[0][1] || 1;
    const colors = { gotcha: "bg-amber-500", lesson: "bg-green-500", decision: "bg-purple-500", pattern: "bg-blue-500", convention: "bg-cyan-500" };
    setHTML("mem-by-type", typeEntries.map(([type, n]) => {
      const pct = Math.round((n / max) * 100);
      const color = colors[type] || "bg-gray-500";
      return `<div class="mb-1">
        <div class="flex justify-between text-gray-400">
          <span class="font-mono">${type}</span><span>${n}</span>
        </div>
        <div class="h-1 bg-gray-700 rounded"><div class="h-1 ${color} rounded" style="width:${pct}%"></div></div>
      </div>`;
    }).join(""));
  }

  // Drain trend
  const drain = report.drainTrend || { passes: 0 };
  if (drain.passes === 0) {
    setHTML("mem-drain-trend", `<p class="text-gray-500 py-2 text-center">No drain passes recorded yet.</p>`);
  } else {
    setHTML("mem-drain-trend", `<table class="w-full text-xs">
      <tbody>
        <tr><td class="text-gray-500 py-0.5">Passes</td><td class="text-right text-gray-300">${drain.passes}</td></tr>
        <tr><td class="text-gray-500 py-0.5">Last attempted</td><td class="text-right text-gray-300">${drain.lastAttempted}</td></tr>
        <tr><td class="text-gray-500 py-0.5">Last delivered</td><td class="text-right text-green-400">${drain.lastDelivered}</td></tr>
        <tr><td class="text-gray-500 py-0.5">Total delivered</td><td class="text-right text-gray-300">${drain.totalDelivered}</td></tr>
        <tr><td class="text-gray-500 py-0.5">Total deferred</td><td class="text-right text-gray-300">${drain.totalDeferred}</td></tr>
      </tbody></table>`);
  }

  // Orphans
  const orphans = Array.isArray(report.orphans) ? report.orphans : [];
  if (orphans.length === 0) {
    setHTML("mem-orphans", `<p class="text-green-400 py-2 text-center">✓ No orphan files.</p>`);
  } else {
    setHTML("mem-orphans", `<ul class="list-disc list-inside text-amber-400 font-mono">${
      orphans.map((o) => `<li>${o}</li>`).join("")
    }</ul>`);
  }
}
window.loadMemoryReport = loadMemoryReport;

// ─── v2.37 Crucible Tab (Slice 01.5) ─────────────────────────
// Client for the /api/crucible/* endpoints. Keeps a tiny module-scope
// state object so the 3 panels (list, interview, preview) can update
// each other without DOM scraping.

const crucibleState = {
  activeId: null,
  currentQuestion: null,
  done: false,
  lastListAt: 0,
};

async function loadCrucible() {
  try {
    const res = await fetch(`${API_BASE}/api/crucible/list`);
    if (!res.ok) {
      setHTML("crucible-smelt-list", `<p class="text-red-400 py-2">Failed to load smelts (${res.status})</p>`);
      return;
    }
    const { smelts = [] } = await res.json();
    crucibleState.lastListAt = Date.now();
    renderCrucibleList(smelts);
    // Re-sync active smelt preview if one is selected
    if (crucibleState.activeId && smelts.some((s) => s.id === crucibleState.activeId)) {
      refreshCrucibleInterview();
    }
  } catch (err) {
    setHTML("crucible-smelt-list", `<p class="text-red-400 py-2">Error: ${err.message}</p>`);
  }
}
window.loadCrucible = loadCrucible;

function renderCrucibleList(smelts) {
  const listEl = document.getElementById("crucible-smelt-list");
  if (!listEl) return;
  if (!smelts.length) {
    listEl.innerHTML = `<p class="text-gray-500 py-2">No smelts yet. Click <span class="text-orange-400">+ New Smelt</span>.</p>`;
    return;
  }
  const statusColor = {
    "in-progress": "text-orange-400",
    "finalized": "text-green-400",
    "abandoned": "text-gray-500",
  };
  listEl.innerHTML = smelts
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .map((s) => {
      const active = s.id === crucibleState.activeId ? "bg-gray-700" : "hover:bg-gray-700/50";
      const label = s.phaseName || (s.rawIdea ? s.rawIdea.slice(0, 40) : s.id.slice(0, 8));
      const color = statusColor[s.status] || "text-gray-400";
      return `<button class="w-full text-left ${active} rounded px-2 py-1.5 block" onclick="selectSmelt('${s.id}')">
        <div class="truncate">${escapeHtml(label)}</div>
        <div class="text-[10px] ${color}">${s.status} · ${s.lane}</div>
      </button>`;
    })
    .join("");
}

async function startNewSmelt() {
  const rawIdea = window.prompt("Describe the idea to smelt (one-paragraph summary is fine):");
  if (!rawIdea || !rawIdea.trim()) return;
  const lane = window.prompt("Lane (tweak / feature / full, or leave blank for auto-detection):", "") || null;
  try {
    const res = await fetch(`${API_BASE}/api/crucible/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawIdea, lane: lane ? lane.trim() : null }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      alert(`Submit failed: ${error || res.status}`);
      return;
    }
    const { id, firstQuestion } = await res.json();
    crucibleState.activeId = id;
    crucibleState.currentQuestion = firstQuestion;
    crucibleState.done = firstQuestion === null;
    await loadCrucible();
    renderCrucibleInterview();
    await refreshCrucibleInterview();
  } catch (err) { alert(`Submit error: ${err.message}`); }
}
window.startNewSmelt = startNewSmelt;

async function selectSmelt(id) {
  crucibleState.activeId = id;
  crucibleState.currentQuestion = null;
  crucibleState.done = false;
  renderCrucibleInterview();
  await refreshCrucibleInterview();
  await loadCrucible();
}
window.selectSmelt = selectSmelt;

async function refreshCrucibleInterview() {
  if (!crucibleState.activeId) return;
  try {
    // Use ask with no answer to fetch the next question + fresh preview
    const askRes = await fetch(`${API_BASE}/api/crucible/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crucibleState.activeId }),
    });
    if (askRes.ok) {
      const data = await askRes.json();
      crucibleState.currentQuestion = data.nextQuestion || null;
      crucibleState.done = Boolean(data.done);
      updateInterviewPanel(data);
    } else {
      // Smelt is likely not in-progress (finalized/abandoned) — fall back to preview only
      crucibleState.currentQuestion = null;
      crucibleState.done = true;
    }
    // Preview is always available
    const prevRes = await fetch(`${API_BASE}/api/crucible/preview?id=${encodeURIComponent(crucibleState.activeId)}`);
    if (prevRes.ok) {
      const preview = await prevRes.json();
      updatePreviewPanel(preview);
    }
  } catch (err) {
    console.error("[crucible] refresh failed", err);
  }
}

function renderCrucibleInterview() {
  const empty = document.getElementById("crucible-interview-empty");
  const panel = document.getElementById("crucible-interview");
  if (crucibleState.activeId) {
    if (empty) empty.classList.add("hidden");
    if (panel) panel.classList.remove("hidden");
    const idEl = document.getElementById("crucible-active-id");
    if (idEl) idEl.textContent = crucibleState.activeId.slice(0, 12) + "…";
  } else {
    if (empty) empty.classList.remove("hidden");
    if (panel) panel.classList.add("hidden");
  }
}

function updateInterviewPanel(data) {
  const q = data.nextQuestion;
  const qText = document.getElementById("crucible-question-text");
  const answer = document.getElementById("crucible-answer");
  const idx = document.getElementById("crucible-q-index");
  const total = document.getElementById("crucible-q-total");
  const recLabel = document.getElementById("crucible-recommendation-label");
  const recVal = document.getElementById("crucible-recommendation-value");
  const nextBtn = document.getElementById("crucible-next-btn");
  const finalBtn = document.getElementById("crucible-finalize-btn");
  const lane = document.getElementById("crucible-active-lane");

  if (q) {
    if (qText) qText.textContent = q.prompt || q.text || q.id || "(no prompt)";
    if (answer) answer.value = q.recommendedDefault || "";
    if (idx) idx.textContent = (q.index ?? "?");
    if (total) total.textContent = (q.total ?? "?");
    if (lane && q.lane) lane.textContent = q.lane;
    if (q.recommendedDefault && recLabel && recVal) {
      recVal.textContent = q.recommendedDefault;
      recLabel.classList.remove("hidden");
    } else if (recLabel) {
      recLabel.classList.add("hidden");
    }
    if (nextBtn) nextBtn.classList.remove("hidden");
    if (finalBtn) finalBtn.classList.add("hidden");
  } else {
    // Interview complete
    if (qText) qText.textContent = "Interview complete — review the draft and finalize.";
    if (answer) answer.value = "";
    if (nextBtn) nextBtn.classList.add("hidden");
    if (finalBtn) finalBtn.classList.remove("hidden");
  }
}

function updatePreviewPanel(preview) {
  const pre = document.getElementById("crucible-preview");
  if (pre) pre.textContent = preview.markdown || "(empty)";
  const unresolved = Array.isArray(preview.unresolvedFields) ? preview.unresolvedFields : [];
  const badge = document.getElementById("crucible-unresolved-count");
  if (badge) badge.textContent = unresolved.length > 0 ? `${unresolved.length} unresolved` : "✓ complete";
}

async function submitAnswer() {
  if (!crucibleState.activeId) return;
  const answerEl = document.getElementById("crucible-answer");
  const answer = answerEl ? answerEl.value : "";
  try {
    const res = await fetch(`${API_BASE}/api/crucible/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crucibleState.activeId, answer }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      alert(`Ask failed: ${error || res.status}`);
      return;
    }
    const data = await res.json();
    crucibleState.currentQuestion = data.nextQuestion;
    crucibleState.done = Boolean(data.done);
    updateInterviewPanel(data);
    if (data.draftPreview !== undefined) {
      updatePreviewPanel({ markdown: data.draftPreview, unresolvedFields: extractUnresolvedFromMarkdown(data.draftPreview) });
    }
  } catch (err) { alert(`Ask error: ${err.message}`); }
}
window.submitAnswer = submitAnswer;

function extractUnresolvedFromMarkdown(md) {
  if (typeof md !== "string") return [];
  const re = /\{\{TBD:[^}]+\}\}/g;
  return md.match(re) || [];
}

async function finalizeSmelt() {
  if (!crucibleState.activeId) return;
  if (!confirm("Finalize this smelt? A Phase-NN.md will be written to docs/plans/.")) return;
  try {
    const res = await fetch(`${API_BASE}/api/crucible/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crucibleState.activeId }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      alert(`Finalize failed: ${error || res.status}`);
      return;
    }
    const { phaseName, planPath } = await res.json();
    alert(`✓ Finalized as ${phaseName}\n  ${planPath}\n\nNext: run the Plan Hardener on this plan.`);
    await loadCrucible();
  } catch (err) { alert(`Finalize error: ${err.message}`); }
}
window.finalizeSmelt = finalizeSmelt;

async function abandonSmelt() {
  if (!crucibleState.activeId) return;
  if (!confirm("Abandon this smelt? This cannot be undone.")) return;
  try {
    const res = await fetch(`${API_BASE}/api/crucible/abandon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crucibleState.activeId }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      alert(`Abandon failed: ${error || res.status}`);
      return;
    }
    crucibleState.activeId = null;
    renderCrucibleInterview();
    await loadCrucible();
  } catch (err) { alert(`Abandon error: ${err.message}`); }
}
window.abandonSmelt = abandonSmelt;

function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Live-update hook — called from the existing hub subscriber when a
// crucible-* event arrives.
function onCrucibleHubEvent(event) {
  const type = event && event.type;
  if (typeof type !== "string" || !type.startsWith("crucible-")) return;
  // Refresh list on every crucible event; if it's our active smelt, refresh the interview too
  loadCrucible();
  if (event.data && event.data.id === crucibleState.activeId) {
    refreshCrucibleInterview();
  }
  // Show a Hardener-ready toast when the handoff event fires
  if (type === "crucible-handoff-to-hardener" && event.data) {
    const { phaseName, planPath } = event.data;
    // Use alert as a deliberate user-visible nudge — the reviewer must
    // take an action before the plan runs through the gate.
    try {
      console.log(`[crucible] Hardener ready for ${phaseName} (${planPath})`);
      if (typeof window !== "undefined" && window.alert) {
        // Non-blocking: only alert if the Crucible tab is active
        const activeTab = document.querySelector(".tab-btn.tab-active");
        if (activeTab && activeTab.dataset.tab === "crucible") {
          window.alert(`✓ ${phaseName} finalized. Next step: run /step2-harden-plan against ${planPath}`);
        }
      }
    } catch { /* ignore */ }
  }
}
window.onCrucibleHubEvent = onCrucibleHubEvent;

// ─── v2.37 Crucible Config (Slice 01.6) ─────────────────────
async function loadCrucibleConfigUI() {
  try {
    const res = await fetch(`${API_BASE}/api/crucible/config`);
    if (!res.ok) {
      const el = document.getElementById("crucible-cfg-status");
      if (el) el.textContent = `Failed to load config (${res.status})`;
      return;
    }
    const cfg = await res.json();
    const lane = document.getElementById("crucible-cfg-lane");
    if (lane) lane.value = cfg.defaultLane;
    const depth = document.getElementById("crucible-cfg-depth");
    if (depth) depth.value = String(cfg.recursionDepth);
    const auto = document.getElementById("crucible-cfg-auto-approve");
    if (auto) auto.checked = Boolean(cfg.autoApproveAgent);
    const wm = document.getElementById("crucible-cfg-w-memory");
    const wp = document.getElementById("crucible-cfg-w-principles");
    const wpl = document.getElementById("crucible-cfg-w-plans");
    if (wm) wm.value = String(cfg.sourceWeights?.memory ?? 34);
    if (wp) wp.value = String(cfg.sourceWeights?.principles ?? 33);
    if (wpl) wpl.value = String(cfg.sourceWeights?.plans ?? 33);
    const stale = document.getElementById("crucible-cfg-stale");
    if (stale) stale.value = String(cfg.staleDefaultsHours ?? 24);
    const status = document.getElementById("crucible-cfg-status");
    if (status) status.textContent = "Loaded.";
  } catch (err) {
    const status = document.getElementById("crucible-cfg-status");
    if (status) status.textContent = `Error: ${err.message}`;
  }
}
window.loadCrucibleConfigUI = loadCrucibleConfigUI;

async function saveCrucibleConfig() {
  const body = {
    defaultLane: document.getElementById("crucible-cfg-lane")?.value || "feature",
    recursionDepth: Number(document.getElementById("crucible-cfg-depth")?.value ?? 1),
    autoApproveAgent: Boolean(document.getElementById("crucible-cfg-auto-approve")?.checked),
    sourceWeights: {
      memory: Number(document.getElementById("crucible-cfg-w-memory")?.value ?? 34),
      principles: Number(document.getElementById("crucible-cfg-w-principles")?.value ?? 33),
      plans: Number(document.getElementById("crucible-cfg-w-plans")?.value ?? 33),
    },
    staleDefaultsHours: Number(document.getElementById("crucible-cfg-stale")?.value ?? 24),
  };
  const status = document.getElementById("crucible-cfg-status");
  try {
    const res = await fetch(`${API_BASE}/api/crucible/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (status) status.textContent = `Save failed (${res.status})`;
      return;
    }
    const saved = await res.json();
    if (status) status.textContent = `✓ Saved. Weights normalized to ${saved.sourceWeights.memory}/${saved.sourceWeights.principles}/${saved.sourceWeights.plans}.`;
    await loadCrucibleConfigUI();
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message}`;
  }
}
window.saveCrucibleConfig = saveCrucibleConfig;

// ─── v2.37 Governance Tab (Slice 01.6, read-only) ───────────
async function loadGovernance() {
  try {
    const [govRes, auditRes] = await Promise.all([
      fetch(`${API_BASE}/api/crucible/governance`),
      fetch(`${API_BASE}/api/crucible/manual-imports`),
    ]);
    const filesEl = document.getElementById("governance-files");
    if (govRes.ok) {
      const { files = [] } = await govRes.json();
      if (!files.length) {
        if (filesEl) filesEl.innerHTML = `<p class="text-gray-500 py-2">No principles or profile files found. Create <code>docs/plans/PROJECT-PRINCIPLES.md</code> to start.</p>`;
      } else {
        if (filesEl) filesEl.innerHTML = files.map((f) => `
          <details class="bg-gray-900 rounded">
            <summary class="cursor-pointer px-3 py-2 text-sm flex items-center justify-between">
              <span><span class="text-gray-400">${f.role}</span> — <code class="text-orange-300">${escapeHtml(f.path)}</code></span>
              <span class="text-xs text-gray-500">${new Date(f.mtime).toLocaleString()}</span>
            </summary>
            <div class="px-3 pb-3">
              <div class="flex justify-end mb-2">
                <a href="vscode://file/${encodeURI(f.absolutePath.replace(/\\/g, "/"))}" class="text-xs text-blue-400 hover:text-blue-300">Open in VS Code →</a>
              </div>
              <pre class="text-xs text-gray-300 whitespace-pre-wrap font-mono max-h-72 overflow-y-auto bg-black/40 rounded p-2">${escapeHtml(f.content)}</pre>
            </div>
          </details>
        `).join("");
      }
    } else if (filesEl) {
      filesEl.innerHTML = `<p class="text-red-400">Failed to load governance (${govRes.status})</p>`;
    }

    const auditEl = document.getElementById("governance-audit");
    const countEl = document.getElementById("governance-audit-count");
    if (auditRes.ok) {
      const { total, showing, entries } = await auditRes.json();
      if (countEl) countEl.textContent = `${showing}/${total}`;
      if (!entries.length) {
        if (auditEl) auditEl.innerHTML = `<p class="text-gray-500 py-2">No manual imports recorded.</p>`;
      } else {
        const sourceColor = { human: "text-blue-300", speckit: "text-green-300", grandfather: "text-gray-400" };
        if (auditEl) auditEl.innerHTML = entries.map((e) => `
          <div class="bg-gray-900 rounded px-2 py-1.5">
            <div class="flex items-center justify-between">
              <span class="${sourceColor[e.source] || "text-gray-300"} font-semibold">${escapeHtml(e.source || "?")}</span>
              <span class="text-gray-500">${new Date(e.timestamp).toLocaleString()}</span>
            </div>
            <div class="text-gray-400 truncate" title="${escapeHtml(e.planPath || "")}">${escapeHtml(e.planPath || "(no path)")}</div>
            ${e.crucibleId ? `<div class="text-orange-300 text-[10px]">${escapeHtml(e.crucibleId)}</div>` : ""}
            ${e.reason ? `<div class="text-gray-500 text-[10px] italic">${escapeHtml(e.reason)}</div>` : ""}
          </div>
        `).join("");
      }
    } else if (auditEl) {
      auditEl.innerHTML = `<p class="text-red-400">Failed to load audit log (${auditRes.status})</p>`;
    }
  } catch (err) {
    console.error("[governance] load failed", err);
  }
}
window.loadGovernance = loadGovernance;


async function copyWatchCommand(live) {
  const cmd = live ? "pforge watch-live <target-path>" : "pforge watch <target-path>";
  try {
    await navigator.clipboard.writeText(cmd);
    addNotification(`Copied: ${cmd}`, "success");
  } catch {
    addNotification(`Command: ${cmd}`, "info");
  }
}
window.copyWatchCommand = copyWatchCommand;

// Dashboard quorum shortcut — copies quorum prompt to clipboard
async function runQuorumFromDashboard(source) {
  try {
    const res = await fetch(`${API_BASE}/api/quorum/prompt?source=${encodeURIComponent(source)}&goal=risk-assess`);
    if (!res.ok) { addNotification('Quorum prompt generation failed', 'red'); return; }
    const json = await res.json();
    if (json.prompt) {
      await navigator.clipboard.writeText(json.prompt);
      addNotification('Quorum prompt copied to clipboard', 'green');
    }
  } catch {
    addNotification('Quorum prompt generation failed', 'red');
  }
}
window.runQuorumFromDashboard = runQuorumFromDashboard;

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
    "slice-model-routed": "text-indigo-400",
    "quorum-dispatch-started": "text-purple-400", "quorum-leg-completed": "text-purple-300", "quorum-review-completed": "text-purple-200",
    "skill-started": "text-purple-400", "skill-completed": "text-purple-300",
  };
  const color = typeColors[event.type] || "text-gray-400";
  let summary = event.data?.sliceId ? ` slice ${event.data.sliceId}` : event.data?.plan ? ` ${shortName(event.data.plan)}` : event.data?.skillName ? ` /${event.data.skillName}` : "";
  if (event.type === "slice-model-routed" && event.data?.model) {
    summary += ` \u2192 ${event.data.model}`;
  } else if (event.type === "quorum-dispatch-started" && event.data?.models) {
    summary += ` [${event.data.models.join(", ")}]`;
  } else if (event.type === "quorum-leg-completed" && event.data?.model) {
    summary += ` ${event.data.model} ${event.data.success ? "\u2713" : "\u2717"}`;
  } else if (event.type === "quorum-review-completed" && (event.data?.winner || event.data?.selectedModel)) {
    summary += ` winner: ${event.data.winner || event.data.selectedModel}`;
  }

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

// ─── Tempering Panel (Phase TEMPER-01 Slice 01.2) ────────────────────
// Read-only view over .forge/tempering/scan-*.json records surfaced by
// forge_tempering_status. Never triggers a scan on its own — the "Run
// scan" button calls forge_tempering_scan explicitly, per the one-slice
// scope contract in Phase-TEMPER-01.md.

async function loadTemperingStatus() {
  if (state.tempering.fetching) return;
  state.tempering.fetching = true;
  state.tempering.lastError = null;
  try {
    const res = await fetch(`${API_BASE}/api/tool/forge_tempering_status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 20 }),
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok) {
      state.tempering.initialized = !!data.initialized;
      state.tempering.state = data.state || null;
      state.tempering.scans = Array.isArray(data.scans) ? data.scans : [];
    } else {
      state.tempering.lastError = data?.error || "Tempering status request failed";
    }
  } catch (err) {
    state.tempering.lastError = err.message || String(err);
  } finally {
    state.tempering.fetching = false;
    renderTemperingPanel();
  }
}

async function runTemperingScan() {
  const btn = document.getElementById("tempering-scan-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Scanning..."; }
  try {
    const res = await fetch(`${API_BASE}/api/tool/forge_tempering_scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      state.tempering.lastError = data?.error || data?.reason || "Scan request failed";
    } else {
      state.tempering.lastError = null;
    }
  } catch (err) {
    state.tempering.lastError = err.message || String(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Run scan"; }
    await loadTemperingStatus();
  }
}

function renderTemperingPanel() {
  const summaryEl = document.getElementById("tempering-summary-body");
  const coverageEl = document.getElementById("tempering-coverage-body");
  const gapsEl = document.getElementById("tempering-gaps-body");
  const historyEl = document.getElementById("tempering-history-body");
  if (!summaryEl || !coverageEl || !gapsEl || !historyEl) return;

  const { initialized, state: tState, scans, lastError } = state.tempering;

  if (lastError) {
    summaryEl.innerHTML = `<p class="text-red-400 text-xs py-2">${escHtml(lastError)}</p>`;
  } else if (!initialized) {
    summaryEl.innerHTML = `
      <p class="text-gray-400 text-xs">Tempering has not been initialized in this project.</p>
      <p class="text-gray-500 text-xs mt-2">Click <span class="text-emerald-400">Run scan</span> above (or call <code class="bg-gray-700 px-1 rounded">forge_tempering_scan</code>) to seed <code class="bg-gray-700 px-1 rounded">.forge/tempering/</code> and record a baseline.</p>`;
  } else if (!tState || tState.totalScans === 0) {
    summaryEl.innerHTML = `
      <p class="text-gray-400 text-xs">Subsystem ready. No scans recorded yet.</p>
      <p class="text-gray-500 text-xs mt-2">Run a scan to evaluate coverage against the configured minima.</p>`;
  } else {
    const statusMap = { green: "text-green-400", amber: "text-amber-400", "no-data": "text-gray-400", error: "text-red-400" };
    const statusCls = statusMap[tState.latestStatus] || "text-gray-300";
    const ageDays = tState.latestScanAgeMs ? Math.floor(tState.latestScanAgeMs / (24 * 60 * 60 * 1000)) : null;
    const staleBadge = tState.stale
      ? `<span class="ml-2 px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 text-xs">stale</span>`
      : "";
    summaryEl.innerHTML = `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><p class="text-gray-500">Status</p><p class="${statusCls} font-semibold">${escHtml(tState.latestStatus || "—")}${staleBadge}</p></div>
        <div><p class="text-gray-500">Total scans</p><p class="text-gray-200">${tState.totalScans}</p></div>
        <div><p class="text-gray-500">Latest</p><p class="text-gray-300 font-mono">${tState.latestScanTs ? new Date(tState.latestScanTs).toLocaleString() : "—"}</p></div>
        <div><p class="text-gray-500">Age</p><p class="text-gray-300">${ageDays !== null ? ageDays + " day(s)" : "—"}</p></div>
        <div><p class="text-gray-500">Gaps</p><p class="text-gray-200">${tState.gaps}</p></div>
        <div><p class="text-gray-500">Below min</p><p class="${tState.belowMinimum > 0 ? "text-amber-400" : "text-gray-200"} font-semibold">${tState.belowMinimum}</p></div>
      </div>`;
  }

  // Coverage vs. minima — rendered from the newest scan's per-layer data.
  const latest = scans[0] || null;
  if (!latest || !latest.coverage) {
    coverageEl.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No coverage data.</p>';
  } else {
    const minima = latest.coverageMinima || { domain: 90, integration: 80, controller: 60, overall: 80 };
    const rows = ["domain", "integration", "controller", "overall"].map((layer) => {
      const actual = latest.coverage[layer];
      const min = minima[layer] ?? 0;
      if (actual === undefined || actual === null) return "";
      const gap = min - actual;
      const color = gap <= 0 ? "bg-green-500" : gap < 5 ? "bg-amber-500" : "bg-red-500";
      const pct = Math.max(0, Math.min(100, actual));
      return `
        <div class="mb-2 last:mb-0" data-testid="tempering-coverage-row-${layer}">
          <div class="flex justify-between text-xs mb-0.5">
            <span class="text-gray-300 font-semibold">${escHtml(layer)}</span>
            <span class="text-gray-400">${actual.toFixed(1)}% <span class="text-gray-600">/ min ${min}%</span></span>
          </div>
          <div class="h-2 bg-gray-900 rounded overflow-hidden relative">
            <div class="h-full ${color}" style="width:${pct}%"></div>
            <div class="absolute top-0 h-full border-r border-gray-400/70" style="left:${min}%"></div>
          </div>
        </div>`;
    }).filter(Boolean).join("");
    coverageEl.innerHTML = rows || '<p class="text-gray-500 text-sm py-4 text-center">No coverage rows.</p>';
  }

  // Gap list — worst-first files per layer.
  if (!latest || !Array.isArray(latest.coverageVsMinima) || latest.coverageVsMinima.length === 0) {
    gapsEl.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No gaps.</p>';
  } else {
    gapsEl.innerHTML = latest.coverageVsMinima.map((g) => {
      const files = Array.isArray(g.files) ? g.files.slice(0, 10) : [];
      const fileRows = files.map((f) => {
        const pct = f.linesTotal > 0 ? Math.round((f.linesHit / f.linesTotal) * 100) : 0;
        return `<li class="text-xs text-gray-400 font-mono truncate"><span class="text-red-400">${pct}%</span> ${escHtml(f.file)} <span class="text-gray-600">(${f.linesHit}/${f.linesTotal})</span></li>`;
      }).join("");
      return `
        <div class="mb-4 last:mb-0 pb-3 border-b border-gray-700/50 last:border-0">
          <div class="flex items-center gap-3 text-xs mb-2">
            <span class="px-2 py-0.5 rounded bg-red-900/40 text-red-300 font-semibold">${escHtml(g.layer)}</span>
            <span class="text-gray-400">${g.actual}% / min ${g.minimum}%</span>
            <span class="text-amber-400 font-semibold">− ${g.gap} pts</span>
          </div>
          <ul class="space-y-0.5">${fileRows || '<li class="text-xs text-gray-600">No file breakdown.</li>'}</ul>
        </div>`;
    }).join("");
  }

  // History — recent scans, newest first.
  if (!scans.length) {
    historyEl.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No scan history.</p>';
  } else {
    const statusColors = { green: "text-green-400", amber: "text-amber-400", "no-data": "text-gray-500", error: "text-red-400" };
    historyEl.innerHTML = scans.map((s) => {
      const cls = statusColors[s.status] || "text-gray-300";
      const ts = s.completedAt ? new Date(s.completedAt).toLocaleString() : "—";
      return `<div class="flex items-center gap-3 py-1 text-xs border-b border-gray-700/50 last:border-0">
        <span class="${cls} font-semibold w-16">${escHtml(s.status || "—")}</span>
        <span class="text-gray-300 font-mono w-44">${escHtml(s.scanId || "—")}</span>
        <span class="text-gray-500 flex-1">${escHtml(ts)}</span>
        <span class="text-gray-400">${s.gaps ?? 0} gaps</span>
        <span class="text-amber-400">${s.belowMinimum ?? 0} below-min</span>
      </div>`;
    }).join("");
  }
}

window.renderTemperingPanel = renderTemperingPanel;
window.loadTemperingStatus = loadTemperingStatus;
window.runTemperingScan = runTemperingScan;

// ─── Visual Regression Viewer (TEMPER-04 Slice 04.2) ─────────────────
// Cards upserted by urlHash from hub events. Images served via
// /api/tempering/artifact?path=… (path-traversal enforced server-side).

function upsertVisualRegressionCard(data) {
  if (!data || !data.urlHash) return;
  if (state.tempering.visualIgnoredOnce.has(data.urlHash)) return;

  const idx = state.tempering.visualRegressions.findIndex(r => r.urlHash === data.urlHash);
  if (idx >= 0) {
    state.tempering.visualRegressions[idx] = data;
  } else {
    state.tempering.visualRegressions.push(data);
  }
  renderVisualDiffViewer();
}

function renderVisualDiffViewer() {
  const viewer = document.getElementById("visual-diff-viewer");
  const list = document.getElementById("visual-diff-list");
  if (!viewer || !list) return;

  const cards = state.tempering.visualRegressions;
  if (cards.length === 0) {
    viewer.classList.add("hidden");
    return;
  }
  viewer.classList.remove("hidden");

  list.innerHTML = cards.map(card => {
    const pct = card.diffPercent != null ? `${(card.diffPercent * 100).toFixed(2)}%` : "—";
    const verdict = card.verdict || card.llmVerdict || card.band || "unknown";

    // Verdict banner color
    let bannerCls, bannerLabel;
    if (verdict === "regression") {
      bannerCls = "bg-red-900/60 text-red-300";
      bannerLabel = "Regression";
    } else if (verdict === "acceptable") {
      bannerCls = "bg-green-900/60 text-green-300";
      bannerLabel = "Acceptable";
    } else if (verdict === "inconclusive") {
      bannerCls = "bg-amber-900/60 text-amber-300";
      bannerLabel = "Human Review Needed";
    } else {
      bannerCls = "bg-gray-700 text-gray-300";
      bannerLabel = escHtml(verdict);
    }

    // Quorum vote badges
    let voteBadges = "";
    if (card.quorum && Array.isArray(card.quorum.votes)) {
      voteBadges = card.quorum.votes.map(v => {
        if (!v.ok && v.error === "analyzer-timeout") return `<span class="px-1.5 py-0.5 rounded text-xs bg-amber-800 text-amber-200" title="Timeout">⏱ ${escHtml(v.model)}</span>`;
        if (!v.ok) return `<span class="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-400" title="${escHtml(v.error || "failed")}">? ${escHtml(v.model)}</span>`;
        if (v.regression) return `<span class="px-1.5 py-0.5 rounded text-xs bg-red-900/60 text-red-300" title="${escHtml(v.explanation || "")}">✗ ${escHtml(v.model)}</span>`;
        return `<span class="px-1.5 py-0.5 rounded text-xs bg-green-900/60 text-green-300" title="${escHtml(v.explanation || "")}">✓ ${escHtml(v.model)}</span>`;
      }).join(" ");
    }

    // Image trio
    let imageTrio = "";
    if (card.artifacts) {
      const artifactBase = `${API_BASE}/api/tempering/artifact?path=`;
      const baselineImg = card.artifacts.baseline ? `<img src="${artifactBase}${encodeURIComponent(card.artifacts.baseline)}" alt="Baseline" class="max-w-full rounded border border-gray-700" onerror="this.style.display='none'">` : "";
      const currentImg = card.artifacts.current ? `<img src="${artifactBase}${encodeURIComponent(card.artifacts.current)}" alt="Current" class="max-w-full rounded border border-gray-700" onerror="this.style.display='none'">` : "";
      const diffImg = card.artifacts.diff ? `<img src="${artifactBase}${encodeURIComponent(card.artifacts.diff)}" alt="Diff" class="max-w-full rounded border border-gray-700" onerror="this.style.display='none'">` : "";
      imageTrio = `
        <div class="grid grid-cols-3 gap-2 mt-2">
          <div><p class="text-xs text-gray-500 mb-1">Baseline</p>${baselineImg}</div>
          <div><p class="text-xs text-gray-500 mb-1">Current</p>${currentImg}</div>
          <div><p class="text-xs text-gray-500 mb-1">Diff</p>${diffImg}</div>
        </div>`;
    }

    return `
      <div class="bg-gray-800 rounded-lg p-4" data-testid="visual-diff-card" data-urlhash="${escHtml(card.urlHash)}">
        <div class="flex items-center justify-between mb-2">
          <div>
            <span class="text-sm font-semibold text-white">${escHtml(card.url || card.urlHash)}</span>
            <span class="text-xs text-gray-500 ml-2">${pct} diff</span>
          </div>
          <span class="px-2 py-0.5 rounded text-xs font-semibold ${bannerCls}">${bannerLabel}</span>
        </div>
        ${voteBadges ? `<div class="flex gap-1 flex-wrap mb-2" data-testid="quorum-votes">${voteBadges}</div>` : ""}
        ${imageTrio}
        <div class="flex gap-2 mt-3">
          <button class="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-white" onclick="approveBaseline('${escHtml(card.urlHash)}', '${escHtml(card.url || "")}')" data-testid="approve-baseline-btn">Approve as Baseline</button>
          <button class="text-xs px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-white" onclick="openBugStub('${escHtml(card.urlHash)}', '${escHtml(card.url || "")}', '${escHtml(verdict)}', '${escHtml(card.explanation || "")}')" data-testid="open-bug-btn">Open Bug</button>
          <button class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300" onclick="ignoreOnce('${escHtml(card.urlHash)}')" data-testid="ignore-once-btn">Ignore Once</button>
        </div>
      </div>`;
  }).join("");
}

async function approveBaseline(urlHash, url) {
  try {
    await fetch(`${API_BASE}/api/tool/forge_tempering_approve_baseline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urlHash, url }),
    });
    state.tempering.visualRegressions = state.tempering.visualRegressions.filter(r => r.urlHash !== urlHash);
    renderVisualDiffViewer();
    addNotification(`Baseline approved: ${url || urlHash}`, "success");
  } catch (err) {
    addNotification(`Approve failed: ${err.message}`, "error");
  }
}

async function openBugStub(urlHash, url, verdict, explanation) {
  try {
    await fetch(`${API_BASE}/api/tempering/bug-stub`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urlHash, url, verdict, explanation }),
    });
    addNotification(`Bug stub created: ${url || urlHash}`, "success");
  } catch (err) {
    addNotification(`Bug stub failed: ${err.message}`, "error");
  }
}

function ignoreOnce(urlHash) {
  state.tempering.visualIgnoredOnce.add(urlHash);
  state.tempering.visualRegressions = state.tempering.visualRegressions.filter(r => r.urlHash !== urlHash);
  renderVisualDiffViewer();
}

window.approveBaseline = approveBaseline;
window.openBugStub = openBugStub;
window.ignoreOnce = ignoreOnce;
window.upsertVisualRegressionCard = upsertVisualRegressionCard;
window.renderVisualDiffViewer = renderVisualDiffViewer;

// ─── TEMPER-05 Slice 05.1: Flakiness / Perf-Budget / Load panels ────

function handleFlakinessDetected(data) {
  if (!data) return;
  state.tempering.flakyTests.push(data);
  renderFlakinessPanel();
}

function handlePerfRegression(data) {
  if (!data) return;
  state.tempering.perfRegressions.push(data);
  addNotification(`Perf regression: ${data.endpoint || "unknown"} (+${((data.deltaPercent || 0) * 100).toFixed(1)}%)`, "error");
  renderPerfBudgetPanel();
}

function handleLoadCompleted(data) {
  if (!data) return;
  state.tempering.loadResults.push(data);
  renderLoadStressPanel();
}

function renderFlakinessPanel() {
  const body = document.getElementById("tempering-flakiness-body");
  if (!body) return;
  const items = state.tempering.flakyTests;
  if (items.length === 0) {
    body.innerHTML = '<p class="text-gray-400 text-xs">No flaky tests detected.</p>';
    return;
  }
  const sorted = [...items].sort((a, b) => (b.failureRate || 0) - (a.failureRate || 0));
  body.innerHTML = `<table class="w-full text-xs"><thead><tr class="text-gray-400"><th class="text-left pb-1">Test</th><th class="text-right pb-1">Failure Rate</th><th class="text-right pb-1">Window</th></tr></thead><tbody>${sorted.map(f => `<tr class="border-t border-gray-700"><td class="py-1 text-white">${escHtml(f.testId || "—")}</td><td class="py-1 text-right text-red-400">${((f.failureRate || 0) * 100).toFixed(1)}%</td><td class="py-1 text-right text-gray-400">${f.window || "—"}</td></tr>`).join("")}</tbody></table>`;
}

function renderPerfBudgetPanel() {
  const body = document.getElementById("tempering-perf-budget-body");
  if (!body) return;
  const items = state.tempering.perfRegressions;
  if (items.length === 0) {
    body.innerHTML = '<p class="text-gray-400 text-xs">No performance regressions.</p>';
    return;
  }
  body.innerHTML = `<table class="w-full text-xs"><thead><tr class="text-gray-400"><th class="text-left pb-1">Endpoint</th><th class="text-right pb-1">Baseline p95</th><th class="text-right pb-1">Current p95</th><th class="text-right pb-1">Delta</th></tr></thead><tbody>${items.map(r => `<tr class="border-t border-gray-700"><td class="py-1 text-white">${escHtml(r.endpoint || "—")}</td><td class="py-1 text-right text-gray-400">${r.baselineP95 != null ? r.baselineP95 + "ms" : "—"}</td><td class="py-1 text-right text-red-400">${r.currentP95 != null ? r.currentP95 + "ms" : "—"}</td><td class="py-1 text-right text-red-400">+${((r.deltaPercent || 0) * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table>`;
}

function renderLoadStressPanel() {
  const body = document.getElementById("tempering-load-stress-body");
  if (!body) return;
  const items = state.tempering.loadResults;
  if (items.length === 0) {
    body.innerHTML = '<p class="text-gray-400 text-xs">No load test results.</p>';
    return;
  }
  const latest = items[items.length - 1];
  body.innerHTML = `<div class="text-xs"><p class="text-gray-300">Endpoints tested: <span class="text-white">${latest.endpointCount || 0}</span></p><p class="text-gray-300">Passed: <span class="text-emerald-400">${latest.passCount || 0}</span> · Failed: <span class="text-red-400">${latest.failCount || 0}</span></p><p class="text-gray-300">Verdict: <span class="${latest.verdict === "pass" ? "text-emerald-400" : "text-red-400"}">${escHtml(latest.verdict || "—")}</span></p></div>`;
}

window.handleFlakinessDetected = handleFlakinessDetected;
window.handlePerfRegression = handlePerfRegression;
window.handleLoadCompleted = handleLoadCompleted;
window.renderFlakinessPanel = renderFlakinessPanel;
window.renderPerfBudgetPanel = renderPerfBudgetPanel;
window.renderLoadStressPanel = renderLoadStressPanel;


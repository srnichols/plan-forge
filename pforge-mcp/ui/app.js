/**
 * Plan Forge — Plan Browser (ui/app.js)
 *
 * Single-page plan visualization. Fetches /api/plans and renders
 * an interactive plan browser with slice/task detail view.
 *
 * No build step. Vanilla JS + Tailwind CDN.
 */

const API_BASE = `${window.location.protocol}//${window.location.host}`;

// ─── State ────────────────────────────────────────────────────────────────
let allPlans = [];
let selectedPlan = null;

// ─── Status helpers ───────────────────────────────────────────────────────
const STATUS_STYLES = {
  "complete":     { dot: "bg-green-500",  text: "text-green-400",  label: "Complete" },
  "completed":    { dot: "bg-green-500",  text: "text-green-400",  label: "Complete" },
  "in-progress":  { dot: "bg-yellow-400", text: "text-yellow-300", label: "In Progress" },
  "in_progress":  { dot: "bg-yellow-400", text: "text-yellow-300", label: "In Progress" },
  "planned":      { dot: "bg-blue-400",   text: "text-blue-300",   label: "Planned" },
  "paused":       { dot: "bg-orange-400", text: "text-orange-300", label: "Paused" },
  "draft":        { dot: "bg-gray-400",   text: "text-gray-400",   label: "Draft" },
};

function getStatusStyle(status = "") {
  return STATUS_STYLES[status.toLowerCase()] || { dot: "bg-gray-500", text: "text-gray-400", label: status || "Unknown" };
}

function statusBadge(status) {
  const s = getStatusStyle(status);
  return `<span class="status-badge text-xs ${s.text}">
    <span class="inline-block w-1.5 h-1.5 rounded-full ${s.dot}"></span>
    ${s.label}
  </span>`;
}

// ─── Load Plans ───────────────────────────────────────────────────────────
async function loadPlans() {
  const refreshIcon = document.getElementById("refresh-icon");
  if (refreshIcon) refreshIcon.classList.add("spinner");

  try {
    const res = await fetch(`${API_BASE}/api/plans`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allPlans = await res.json();
    renderPlanList(allPlans);

    const countEl = document.getElementById("plan-count");
    if (countEl) countEl.textContent = `${allPlans.length} plan${allPlans.length !== 1 ? "s" : ""}`;

    // Re-render selected plan with fresh data
    if (selectedPlan) {
      const refreshed = allPlans.find((p) => p.file === selectedPlan.file);
      if (refreshed) renderPlanDetail(refreshed);
    }
  } catch (err) {
    showSidebarError(err.message);
  } finally {
    if (refreshIcon) refreshIcon.classList.remove("spinner");
  }
}

// ─── Filter ───────────────────────────────────────────────────────────────
function filterPlans(query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? allPlans.filter((p) =>
        (p.title || p.file || "").toLowerCase().includes(q) ||
        (p.status || "").toLowerCase().includes(q)
      )
    : allPlans;
  renderPlanList(filtered, selectedPlan?.file);
}

// ─── Render Plan List (sidebar) ───────────────────────────────────────────
function renderPlanList(plans, activefile = selectedPlan?.file) {
  const container = document.getElementById("plan-list");
  if (!container) return;

  if (plans.length === 0) {
    container.innerHTML = `
      <div class="px-4 py-8 text-center text-gray-500 text-sm">
        <div class="text-2xl mb-2">🗂️</div>
        <p>No plans found</p>
        <p class="text-xs mt-1 text-gray-600">Add <code>Phase-*-PLAN.md</code> files to <code>docs/plans/</code></p>
      </div>`;
    return;
  }

  container.innerHTML = plans
    .map((plan) => {
      const isSelected = plan.file === activefile;
      const s = getStatusStyle(plan.status);
      const phaseLabel = plan.file.match(/Phase-(\d+)/i)?.[1]
        ? `Phase ${plan.file.match(/Phase-(\d+)/i)[1]}`
        : null;

      return `
        <div
          class="plan-card cursor-pointer px-4 py-3 border-l-2 ${isSelected ? "selected border-indigo-500 bg-gray-800/60" : "border-transparent hover:bg-gray-800/40"}"
          onclick="selectPlan('${escapeAttr(plan.file)}')"
          data-file="${escapeAttr(plan.file)}"
        >
          ${phaseLabel ? `<div class="text-xs text-gray-500 mb-0.5">${phaseLabel}</div>` : ""}
          <div class="text-sm font-medium text-gray-100 leading-snug">${escapeHtml(plan.title || plan.file)}</div>
          <div class="flex items-center gap-3 mt-1">
            ${statusBadge(plan.status)}
            <span class="text-xs text-gray-500">${plan.sliceCount} slice${plan.sliceCount !== 1 ? "s" : ""}</span>
          </div>
        </div>`;
    })
    .join("");
}

// ─── Select Plan ──────────────────────────────────────────────────────────
function selectPlan(file) {
  const plan = allPlans.find((p) => p.file === file);
  if (!plan) return;
  selectedPlan = plan;

  // Update sidebar highlights
  document.querySelectorAll(".plan-card").forEach((el) => {
    const isThis = el.dataset.file === file;
    el.classList.toggle("selected", isThis);
    el.classList.toggle("border-indigo-500", isThis);
    el.classList.toggle("bg-gray-800/60", isThis);
    el.classList.toggle("border-transparent", !isThis);
  });

  renderPlanDetail(plan);
}

// ─── Render Plan Detail (main panel) ─────────────────────────────────────
function renderPlanDetail(plan) {
  const emptyState = document.getElementById("empty-state");
  const detailEl = document.getElementById("plan-detail");
  if (emptyState) emptyState.classList.add("hidden");
  if (detailEl) detailEl.classList.remove("hidden");

  const s = getStatusStyle(plan.status);
  const phaseMatch = plan.file.match(/Phase-(\d+)/i);
  const phaseNum = phaseMatch ? phaseMatch[1] : null;

  detailEl.innerHTML = `
    <!-- Plan header -->
    <div class="mb-6">
      ${phaseNum ? `<div class="text-xs font-medium text-indigo-400 uppercase tracking-wider mb-1">Phase ${phaseNum}</div>` : ""}
      <h1 class="text-2xl font-bold text-white mb-2">${escapeHtml(plan.title || plan.file)}</h1>
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <span class="status-badge ${s.text} flex items-center gap-1.5">
          <span class="inline-block w-2 h-2 rounded-full ${s.dot}"></span>
          ${s.label}
        </span>
        <span class="text-gray-400">${plan.sliceCount} execution slice${plan.sliceCount !== 1 ? "s" : ""}</span>
        ${plan.branch ? `<span class="text-gray-400 flex items-center gap-1">⎇ <code class="text-indigo-300">${escapeHtml(plan.branch)}</code></span>` : ""}
        <span class="text-gray-600 text-xs font-mono">${escapeHtml(plan.file)}</span>
      </div>
    </div>

    <!-- Scope Contract -->
    ${renderScopeContract(plan.scopeContract)}

    <!-- Slices -->
    <div>
      <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Execution Slices</h2>
      ${plan.slices.length === 0
        ? `<p class="text-gray-500 text-sm italic">No slices defined</p>`
        : plan.slices.map((slice, i) => renderSlice(slice, i)).join("")
      }
    </div>
  `;
}

function renderScopeContract(scope) {
  if (!scope || (typeof scope === "string" && !scope.trim())) return "";
  const text = typeof scope === "string" ? scope : JSON.stringify(scope, null, 2);
  return `
    <div class="mb-6 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span class="text-indigo-400">🔐</span>
        <span class="text-sm font-medium text-gray-300">Scope Contract</span>
      </div>
      <div class="px-4 py-3 text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">${escapeHtml(text)}</div>
    </div>`;
}

function renderSlice(slice, index) {
  const parallelBadge = slice.parallel
    ? `<span class="text-xs px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded font-mono">parallel-safe</span>`
    : `<span class="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded font-mono">sequential</span>`;

  const deps = slice.depends?.length
    ? `<div class="text-xs text-gray-500 mt-1">Depends on: ${slice.depends.map((d) => `<code class="text-gray-400">${escapeHtml(String(d))}</code>`).join(", ")}</div>`
    : "";

  const tasks = slice.tasks?.length
    ? `<ul class="mt-2 space-y-1">
        ${slice.tasks.map((t) => `<li class="task-item text-sm text-gray-300 pl-4">${escapeHtml(String(t))}</li>`).join("")}
      </ul>`
    : "";

  const scope = slice.scope?.length
    ? `<div class="mt-2 flex flex-wrap gap-1">
        ${slice.scope.map((f) => `<span class="scope-tag text-xs px-2 py-0.5 rounded font-mono">${escapeHtml(String(f))}</span>`).join("")}
      </div>`
    : "";

  const commands = [
    slice.buildCommand ? `<div class="text-xs text-gray-500">Build: <code class="text-green-400">${escapeHtml(slice.buildCommand)}</code></div>` : "",
    slice.testCommand  ? `<div class="text-xs text-gray-500">Test: <code class="text-green-400">${escapeHtml(slice.testCommand)}</code></div>`  : "",
  ].filter(Boolean).join("");

  return `
    <div class="slice-row mb-3 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div class="px-4 py-3 flex items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <span class="flex-shrink-0 w-6 h-6 bg-indigo-900/50 text-indigo-300 rounded text-xs font-bold flex items-center justify-center">${index + 1}</span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-100">${escapeHtml(slice.title || `Slice ${index + 1}`)}</div>
            ${deps}
            ${tasks}
            ${scope}
            ${commands ? `<div class="mt-2 space-y-0.5">${commands}</div>` : ""}
          </div>
        </div>
        <div class="flex-shrink-0">${parallelBadge}</div>
      </div>
    </div>`;
}

// ─── Error States ─────────────────────────────────────────────────────────
function showSidebarError(message) {
  const container = document.getElementById("plan-list");
  if (!container) return;
  container.innerHTML = `
    <div class="px-4 py-6 text-center">
      <div class="text-red-400 text-sm font-medium mb-1">Failed to load plans</div>
      <div class="text-gray-500 text-xs">${escapeHtml(message)}</div>
      <button onclick="loadPlans()" class="mt-3 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-300">Retry</button>
    </div>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ─── Init ─────────────────────────────────────────────────────────────────
loadPlans();

// Auto-refresh every 30s (plans change infrequently)
setInterval(loadPlans, 30_000);

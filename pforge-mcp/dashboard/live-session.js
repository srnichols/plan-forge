/**
 * Plan Forge Dashboard — Live Session module (Phase-31 Slice 1).
 *
 * Handles real-time in-session UI enhancements that augment slice cards
 * rendered by app.js without modifying app.js itself.
 *
 * Currently surfaces: committed-before-timeout badge.
 * When the orchestrator emits `slice-timeout-but-committed` (a worker
 * timed out but its git commit already landed), this module injects a
 * green badge into the matching slice card so operators see the outcome
 * at a glance rather than digging through logs.
 */
(function () {
  // ─── State ───────────────────────────────────────────────────────────
  // Keyed by String(sliceNumber). Cleared on run-started to avoid
  // cross-run stale badges when the hub replays event history on reconnect.
  const committedSHAs = new Map();

  // ─── Pure helpers ────────────────────────────────────────────────────

  function formatBadgeText(pre, post) {
    const s = String(pre || "").slice(0, 7);
    const e = String(post || "").slice(0, 7);
    return `committed-before-timeout (${s}\u2192${e})`;
  }

  // ─── DOM helpers ─────────────────────────────────────────────────────

  function buildBadge(pre, post) {
    const span = document.createElement("span");
    span.setAttribute("data-testid", "committed-before-timeout-badge");
    span.className =
      "text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-300 border border-green-700";
    span.title = "Worker timed out but commit already landed — treated as success";
    span.textContent = formatBadgeText(pre, post);
    return span;
  }

  function injectBadge(sliceId, entry) {
    const container =
      typeof document !== "undefined" ? document.getElementById("slice-cards") : null;
    if (!container) return;
    const card = container.querySelector(`[data-slice-id="${sliceId}"]`);
    if (!card) return;

    const existing = card.querySelector('[data-testid="committed-before-timeout-badge"]');
    if (existing) {
      // Upsert: update text in case SHAs changed (e.g. history replay).
      existing.textContent = formatBadgeText(entry.preSliceHead, entry.postTimeoutHead);
      return;
    }

    const badge = buildBadge(entry.preSliceHead, entry.postTimeoutHead);
    const wrapper = document.createElement("div");
    wrapper.className = "flex items-center gap-1.5 mt-1";
    wrapper.appendChild(badge);
    card.appendChild(wrapper);
  }

  function injectAllBadges() {
    committedSHAs.forEach((entry, sliceId) => {
      injectBadge(sliceId, entry);
    });
  }

  // ─── Event handlers ──────────────────────────────────────────────────

  function onSliceTimeoutButCommitted(data) {
    const sliceId = String(data.sliceNumber ?? "");
    if (!sliceId) return;
    committedSHAs.set(sliceId, {
      preSliceHead: data.preSliceHead,
      postTimeoutHead: data.postTimeoutHead,
      sliceTitle: data.sliceTitle,
    });
    injectAllBadges();
  }

  // ─── Wrap global handleEvent ──────────────────────────────────────────
  // app.js defines handleEvent as a function declaration (window.handleEvent).
  // Wrap it after this script loads to intercept the event stream without
  // modifying app.js.
  const _orig =
    typeof window !== "undefined" && typeof window.handleEvent === "function"
      ? window.handleEvent
      : null;

  function liveHandleEvent(event) {
    if (event) {
      if (event.type === "slice-timeout-but-committed") {
        onSliceTimeoutButCommitted(event.data || event);
      } else if (event.type === "run-started") {
        // Clear stale state when a new run begins.
        committedSHAs.clear();
      }
    }
    if (_orig) _orig.call(this, event);
  }

  if (typeof window !== "undefined") {
    window.handleEvent = liveHandleEvent;
  }

  // ─── MutationObserver — re-inject badges after renderSliceCards() ─────
  // renderSliceCards() replaces all direct children of #slice-cards on every
  // update; observe childList changes and re-inject stored badges each time.
  function startObserver() {
    if (typeof document === "undefined") return;
    const container = document.getElementById("slice-cards");
    if (!container) return;
    const observer = new MutationObserver(injectAllBadges);
    observer.observe(container, { childList: true });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startObserver);
    } else {
      startObserver();
    }
  }

  // Expose for testing
  if (typeof window !== "undefined") {
    window.liveSession = {
      committedSHAs,
      onSliceTimeoutButCommitted,
      formatBadgeText,
      liveHandleEvent,
      injectAllBadges,
    };
  }
})();

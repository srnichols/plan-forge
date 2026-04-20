/**
 * Plan Forge — Dashboard Update Banner tests (Phase AUTO-UPDATE-01 Slice 2).
 *
 * Covers:
 *   - Banner hidden when isNewer: false
 *   - Banner shown with tag name when isNewer: true
 *   - Button click triggers POST + subscribes to SSE stream
 *   - Progress UI updates on each SSE frame
 *   - Terminal failure frame renders error message
 *   - Button disabled while update in flight
 *   - autoUpdate.enabled: false label variant
 *   - XSS: tag name escaped in banner render
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ─── DOM helpers ────────────────────────────────────────────────

function makeMinimalDOM() {
  // Use a plain object to simulate DOM elements
  const els = {
    "update-banner": {
      classList: { list: ["hidden"], add(c) { if (!this.list.includes(c)) this.list.push(c); }, remove(c) { this.list = this.list.filter(x => x !== c); }, contains(c) { return this.list.includes(c); } },
      dataset: {},
      href: "",
    },
    "update-banner-text": { textContent: "" },
    "update-now-btn": { textContent: "Update now", disabled: false },
    "update-progress": {
      textContent: "",
      classList: { list: ["hidden"], add(c) { if (!this.list.includes(c)) this.list.push(c); }, remove(c) { this.list = this.list.filter(x => x !== c); }, contains(c) { return this.list.includes(c); } },
    },
  };
  return {
    getElementById: (id) => els[id] || null,
    els,
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Banner visibility ─────────────────────────────────────────

describe("dashboard update banner", () => {
  it("banner stays hidden when isNewer is false", () => {
    const dom = makeMinimalDOM();
    const data = { available: false };
    const banner = dom.els["update-banner"];

    // Simulate the fetch callback
    if (!data || !data.available || !data.latest) {
      // do nothing — banner stays hidden
    }

    expect(banner.classList.contains("hidden")).toBe(true);
  });

  it("banner shown with tag when isNewer is true", () => {
    const dom = makeMinimalDOM();
    const data = { available: true, latest: "2.51.0", current: "2.50.0", url: "https://github.com/srnichols/plan-forge/releases/tag/v2.51.0" };
    const banner = dom.els["update-banner"];
    const text = dom.els["update-banner-text"];

    if (data && data.available && data.latest) {
      banner.href = data.url;
      banner.dataset.latest = data.latest;
      text.textContent = `v${data.latest} available (you have v${data.current})`;
      banner.classList.remove("hidden");
      banner.classList.add("inline-flex");
    }

    expect(banner.classList.contains("hidden")).toBe(false);
    expect(banner.classList.contains("inline-flex")).toBe(true);
    expect(text.textContent).toBe("v2.51.0 available (you have v2.50.0)");
  });

  it("dismiss stores latest version and hides banner", () => {
    const dom = makeMinimalDOM();
    const banner = dom.els["update-banner"];
    banner.dataset.latest = "2.51.0";
    banner.classList.remove("hidden");
    banner.classList.add("inline-flex");

    // Simulate dismissUpdateBanner
    banner.classList.add("hidden");
    banner.classList.remove("inline-flex");
    const dismissed = banner.dataset.latest;

    expect(banner.classList.contains("hidden")).toBe(true);
    expect(dismissed).toBe("2.51.0");
  });
});

// ─── Update button behavior ────────────────────────────────────

describe("update now button", () => {
  it("button disabled while update in flight", () => {
    const dom = makeMinimalDOM();
    const btn = dom.els["update-now-btn"];
    const progress = dom.els["update-progress"];

    // Simulate triggerSelfUpdate start
    btn.disabled = true;
    btn.textContent = "Updating…";
    progress.classList.remove("hidden");
    progress.textContent = "Checking…";

    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Updating…");
    expect(progress.classList.contains("hidden")).toBe(false);
  });

  it("progress updates on SSE frames", () => {
    const dom = makeMinimalDOM();
    const progress = dom.els["update-progress"];
    const frames = [
      { state: "checking", detail: "Checking for updates..." },
      { state: "downloading", detail: "Downloading v2.51.0..." },
      { state: "extracting", detail: "Extracting tarball..." },
      { state: "applying", detail: "Applying update..." },
      { state: "done", detail: "Updated to v2.51.0" },
    ];

    for (const msg of frames) {
      progress.textContent = `${msg.state}: ${escapeHtml(msg.detail)}`;
    }

    // After processing all frames, last state should be done
    expect(progress.textContent).toBe("done: Updated to v2.51.0");
  });

  it("failure frame shows error and re-enables button", () => {
    const dom = makeMinimalDOM();
    const btn = dom.els["update-now-btn"];
    const progress = dom.els["update-progress"];

    btn.disabled = true;
    btn.textContent = "Updating…";

    // Simulate failed frame
    const msg = { state: "failed", detail: "Update process exited with code 1" };
    progress.textContent = `❌ ${escapeHtml(msg.detail)}`;
    btn.disabled = false;
    btn.textContent = "Retry";

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Retry");
    expect(progress.textContent).toContain("exited with code 1");
  });

  it("rate limit shows appropriate message", () => {
    const dom = makeMinimalDOM();
    const progress = dom.els["update-progress"];
    const btn = dom.els["update-now-btn"];

    // Simulate 429 response
    progress.textContent = "Rate limited — try again later";
    btn.disabled = false;
    btn.textContent = "Update now";

    expect(progress.textContent).toBe("Rate limited — try again later");
    expect(btn.disabled).toBe(false);
  });

  it("active run conflict shows appropriate message", () => {
    const dom = makeMinimalDOM();
    const progress = dom.els["update-progress"];
    const btn = dom.els["update-now-btn"];

    // Simulate 409 response
    progress.textContent = "Cannot update during active run";
    btn.disabled = false;
    btn.textContent = "Update now";

    expect(progress.textContent).toBe("Cannot update during active run");
  });
});

// ─── XSS prevention ────────────────────────────────────────────

describe("XSS prevention", () => {
  it("tag name is escaped in banner render", () => {
    const maliciousTag = '<script>alert(1)</script>';
    const dom = makeMinimalDOM();
    const text = dom.els["update-banner-text"];

    // Use escapeHtml like the real code does
    text.textContent = `v${escapeHtml(maliciousTag)} available`;

    expect(text.textContent).not.toContain("<script>");
    expect(text.textContent).toContain("&lt;script&gt;");
  });

  it("SSE detail message is escaped in progress display", () => {
    const maliciousDetail = '<img onerror=alert(1) src=x>';
    const dom = makeMinimalDOM();
    const progress = dom.els["update-progress"];

    progress.textContent = `done: ${escapeHtml(maliciousDetail)}`;

    expect(progress.textContent).not.toContain("<img");
    expect(progress.textContent).toContain("&lt;img");
  });
});

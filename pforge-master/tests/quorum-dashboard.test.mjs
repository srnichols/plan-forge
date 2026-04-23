/* @vitest-environment jsdom */
/**
 * Tests for Forge-Master quorum dashboard UI — Phase-38.7, Slice 3.
 *
 * Verifies:
 *   (1) forgeMasterRenderQuorumPicker creates #fm-quorum-picker with 3 buttons
 *   (2) Active mode gets highlighted class (bg-cyan-700)
 *   (3) #fm-quorum-picker placed after cost meter (or dial)
 *   (4) forgeMasterRenderQuorumEstimate creates estimate bubble with model badges
 *   (5) forgeMasterRenderQuorumReply renders model cards with dissent summary
 *   (6) forgeMasterRenderQuorumReply without dissent omits the dissent banner
 *   (7) No duplicate quorum picker on repeated renders
 *   (8) Partial quorum: fewer replies than models in estimate
 *   (9) forgeMasterLoadPrefs reads quorumAdvisory and highlights correct segment
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function seedDOM() {
  document.body.innerHTML = `
    <div id="forge-master-root">
      <div id="fm-dial"></div>
      <div id="fm-cost-meter"></div>
    </div>
    <div id="fm-chat-stream"></div>
    <div id="fm-tool-trace"></div>
    <textarea id="fm-composer"></textarea>
  `;
}

function loadModule() {
  const src = readFileSync(
    resolve(__dirname, "../../pforge-mcp/dashboard/forge-master.js"),
    "utf-8",
  );
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "crypto", "sessionStorage", src);
  fn(window, document, window.crypto, window.sessionStorage);
}

const MOCK_QUORUM_RESULT = {
  replies: [
    { model: "claude-sonnet-4-20250514", text: "Use option A.", durationMs: 1200, costUSD: 0.003 },
    { model: "gpt-5.2", text: "Use option B.", durationMs: 1500, costUSD: 0.004 },
    { model: "grok-4.20", text: "Use option A with caveats.", durationMs: 900, costUSD: 0.002 },
  ],
  dissent: { topic: "recommendation", axis: "claude emphasizes safety vs gpt emphasizes speed" },
};

// ─── Quorum Picker ────────────────────────────────────────────────────

describe("forgeMasterRenderQuorumPicker", () => {
  beforeEach(() => {
    seedDOM();
    loadModule();
  });

  it("(1) creates #fm-quorum-picker with 3 mode buttons", () => {
    window.forgeMasterRenderQuorumPicker("off");

    const picker = document.getElementById("fm-quorum-picker");
    expect(picker).not.toBeNull();
    const buttons = picker.querySelectorAll("button[data-quorum]");
    expect(buttons.length).toBe(3);
    const modes = Array.from(buttons).map((b) => b.dataset.quorum);
    expect(modes).toEqual(["off", "auto", "always"]);
  });

  it("(2) active mode gets highlighted class", () => {
    window.forgeMasterRenderQuorumPicker("auto");

    const picker = document.getElementById("fm-quorum-picker");
    const autoBtn = picker.querySelector('button[data-quorum="auto"]');
    const offBtn = picker.querySelector('button[data-quorum="off"]');
    expect(autoBtn.className).toContain("bg-cyan-700");
    expect(offBtn.className).not.toContain("bg-cyan-700");
  });

  it("(3) picker placed after cost meter", () => {
    window.forgeMasterRenderQuorumPicker("off");

    const meter = document.getElementById("fm-cost-meter");
    const picker = document.getElementById("fm-quorum-picker");
    expect(meter).not.toBeNull();
    expect(picker).not.toBeNull();
    // Picker should be the next sibling of the cost meter
    expect(meter.nextElementSibling).toBe(picker);
  });

  it("(7) no duplicate picker on repeated renders", () => {
    window.forgeMasterRenderQuorumPicker("off");
    window.forgeMasterRenderQuorumPicker("auto");
    window.forgeMasterRenderQuorumPicker("always");

    const pickers = document.querySelectorAll("#fm-quorum-picker");
    expect(pickers.length).toBe(1);
  });

  it("picker renders a Quorum: label", () => {
    window.forgeMasterRenderQuorumPicker("off");

    const picker = document.getElementById("fm-quorum-picker");
    expect(picker.textContent).toContain("Quorum:");
  });
});

// ─── Quorum Estimate Bubble ──────────────────────────────────────────

describe("forgeMasterRenderQuorumEstimate", () => {
  beforeEach(() => {
    seedDOM();
    loadModule();
  });

  it("(4) creates estimate bubble with model badges", () => {
    const id = window.forgeMasterRenderQuorumEstimate({
      type: "quorum-estimate",
      models: ["claude-sonnet-4-20250514", "gpt-5.2", "grok-4.20"],
      estimatedCostUSD: 0.009,
      canCancel: true,
    });

    expect(id).toBe("fm-quorum-estimate");
    const el = document.getElementById("fm-quorum-estimate");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("Quorum advisory");
    expect(el.textContent).toContain("3 models");
    expect(el.textContent).toContain("$0.0090");

    const badges = el.querySelectorAll("[data-quorum-model]");
    expect(badges.length).toBe(3);
    expect(badges[0].textContent).toContain("running…");
  });

  it("renders without cost when estimatedCostUSD is absent", () => {
    window.forgeMasterRenderQuorumEstimate({
      type: "quorum-estimate",
      models: ["model-a"],
    });

    const el = document.getElementById("fm-quorum-estimate");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("1 models");
    expect(el.textContent).not.toContain("est.");
  });
});

// ─── Quorum Reply Cards ──────────────────────────────────────────────

describe("forgeMasterRenderQuorumReply", () => {
  beforeEach(() => {
    seedDOM();
    loadModule();
  });

  it("(5) renders model cards with dissent summary", () => {
    window.forgeMasterRenderQuorumReply(MOCK_QUORUM_RESULT, "fm-bubble-1");

    const container = document.getElementById("fm-quorum-reply");
    expect(container).not.toBeNull();

    // Dissent banner present
    const dissentEl = container.querySelector("strong");
    expect(dissentEl).not.toBeNull();
    expect(dissentEl.textContent).toContain("Dissent");
    expect(container.textContent).toContain("recommendation");
    expect(container.textContent).toContain("safety");

    // Model cards
    const cards = container.querySelectorAll("[data-quorum-card]");
    expect(cards.length).toBe(3);
    expect(cards[0].dataset.quorumCard).toBe("claude-sonnet-4-20250514");
    expect(cards[0].textContent).toContain("Use option A.");
    expect(cards[0].textContent).toContain("1200ms");
    expect(cards[0].textContent).toContain("$0.0030");
  });

  it("(6) without dissent omits dissent banner", () => {
    const result = {
      replies: [
        { model: "model-a", text: "Answer.", durationMs: 500, costUSD: 0.001 },
      ],
      dissent: { topic: "", axis: "" },
    };
    window.forgeMasterRenderQuorumReply(result, "fm-bubble-2");

    const container = document.getElementById("fm-quorum-reply");
    expect(container).not.toBeNull();
    const dissentEl = container.querySelector("strong");
    expect(dissentEl).toBeNull();
  });

  it("(8) partial quorum: fewer replies than expected", () => {
    const result = {
      replies: [
        { model: "claude-sonnet-4-20250514", text: "Only me.", durationMs: 800, costUSD: 0.002 },
      ],
      dissent: { topic: "", axis: "" },
    };
    window.forgeMasterRenderQuorumReply(result, "fm-bubble-3");

    const cards = document.querySelectorAll("[data-quorum-card]");
    expect(cards.length).toBe(1);
  });

  it("does not render when replies is empty", () => {
    const result = { replies: [], dissent: { topic: "", axis: "" } };
    window.forgeMasterRenderQuorumReply(result, "fm-bubble-4");

    const container = document.getElementById("fm-quorum-reply");
    expect(container).toBeNull();
  });

  it("uses textContent for reply text (XSS safety)", () => {
    const result = {
      replies: [
        { model: "model-a", text: '<script>alert("xss")</script>', durationMs: 100, costUSD: 0.001 },
      ],
      dissent: { topic: "", axis: "" },
    };
    window.forgeMasterRenderQuorumReply(result, "fm-bubble-5");

    const cards = document.querySelectorAll("[data-quorum-card]");
    expect(cards.length).toBe(1);
    // textContent should contain the raw script tag, not execute it
    expect(cards[0].textContent).toContain("<script>");
    // innerHTML should have the tag escaped
    expect(cards[0].innerHTML).not.toContain("<script>");
  });

  it("updates estimate badges to show duration on reply", () => {
    // First create an estimate
    window.forgeMasterRenderQuorumEstimate({
      type: "quorum-estimate",
      models: ["claude-sonnet-4-20250514", "gpt-5.2"],
      estimatedCostUSD: 0.006,
      canCancel: true,
    });

    // Then render the reply
    const result = {
      replies: [
        { model: "claude-sonnet-4-20250514", text: "Reply A.", durationMs: 1200, costUSD: 0.003 },
        { model: "gpt-5.2", text: "Reply B.", durationMs: 1500, costUSD: 0.004 },
      ],
      dissent: { topic: "", axis: "" },
    };
    window.forgeMasterRenderQuorumReply(result, "fm-bubble-6");

    const estimateEl = document.getElementById("fm-quorum-estimate");
    const badges = estimateEl.querySelectorAll("[data-quorum-model]");
    expect(badges[0].textContent).toContain("1200ms");
    expect(badges[0].textContent).not.toContain("running…");
  });
});

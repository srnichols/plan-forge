import { describe, it, expect } from "vitest";
import {
  formatTelegram,
  formatSlack,
  formatDiscord,
  formatGeneric,
} from "../bridge.mjs";

// ─── formatGeneric ────────────────────────────────────────────────────

describe("formatGeneric", () => {
  it("wraps event with plan-forge source and schema version", () => {
    const event = { type: "run-started", plan: "/path/to/plan.md" };
    const result = formatGeneric(event);
    expect(result.source).toBe("plan-forge");
    expect(result.schemaVersion).toBe("1.0");
    expect(result.event).toBe(event);
    expect(typeof result.timestamp).toBe("string");
  });

  it("includes a valid ISO timestamp", () => {
    const result = formatGeneric({ type: "slice-completed" });
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});

// ─── formatTelegram ───────────────────────────────────────────────────

describe("formatTelegram", () => {
  const channel = { chatId: "12345" };

  it("returns payload with chat_id and MarkdownV2 parse_mode", () => {
    const event = { type: "run-started", plan: "/plans/test.md", sliceCount: 3, mode: "auto" };
    const result = formatTelegram(event, channel, {});
    expect(result.chat_id).toBe("12345");
    expect(result.parse_mode).toBe("MarkdownV2");
    expect(typeof result.text).toBe("string");
  });

  it("formats run-started event", () => {
    const event = { type: "run-started", plan: "/plans/test.md", sliceCount: 5, mode: "auto" };
    const result = formatTelegram(event, channel, {});
    expect(result.text).toContain("🚀");
    expect(result.text).toContain("Plan Forge");
  });

  it("formats slice-completed event", () => {
    const event = { type: "slice-completed", sliceId: "2", duration: 12000, cost_usd: 0.05 };
    const result = formatTelegram(event, channel, {});
    expect(result.text).toContain("✅");
    expect(result.text).toContain("2");
  });

  it("formats slice-failed event", () => {
    const event = { type: "slice-failed", sliceId: "3", failedCommand: "npm test" };
    const result = formatTelegram(event, channel, {});
    expect(result.text).toContain("❌");
    expect(result.text).toContain("npm test");
  });

  it("formats run-completed event with results", () => {
    const event = { type: "run-completed", results: { passed: 4, failed: 0 }, plan: "/p/plan.md" };
    const result = formatTelegram(event, channel, {});
    expect(result.text).toContain("🏁");
  });

  it("formats run-aborted event", () => {
    const event = { type: "run-aborted", sliceId: "2", reason: "user cancelled" };
    const result = formatTelegram(event, channel, {});
    expect(result.text).toContain("🛑");
    expect(result.text).toContain("2");
  });

  it("adds approval keyboard when approvalRequired on run-completed", () => {
    const approvalChannel = {
      chatId: "12345",
      approvalRequired: true,
      serverUrl: "https://example.com",
    };
    const event = { type: "run-completed", runId: "run-abc", results: { passed: 2, failed: 0 } };
    const result = formatTelegram(event, approvalChannel, {});
    expect(result.reply_markup).toBeDefined();
    expect(result.reply_markup.inline_keyboard[0]).toHaveLength(2);
  });

  it("does NOT add approval keyboard without serverUrl", () => {
    const approvalChannel = { chatId: "12345", approvalRequired: true };
    const event = { type: "run-completed", runId: "run-abc", results: {} };
    const result = formatTelegram(event, approvalChannel, {});
    expect(result.reply_markup).toBeUndefined();
  });
});

// ─── formatSlack ─────────────────────────────────────────────────────

describe("formatSlack", () => {
  const channel = {};

  it("returns text and blocks", () => {
    const event = { type: "run-started", plan: "/plans/plan.md", sliceCount: 3, mode: "auto" };
    const result = formatSlack(event, channel, {});
    expect(typeof result.text).toBe("string");
    expect(Array.isArray(result.blocks)).toBe(true);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("formats slice-completed with progress context when sliceCount provided", () => {
    const event = { type: "slice-completed", sliceId: "2" };
    const context = { sliceCount: 5 };
    const result = formatSlack(event, channel, context);
    const allText = result.blocks.map((b) => JSON.stringify(b)).join(" ");
    expect(allText).toContain("2/5");
  });

  it("formats slice-failed block includes FAILED text", () => {
    const event = { type: "slice-failed", sliceId: "1", error: "Compilation error" };
    const result = formatSlack(event, channel, {});
    const sectionText = result.blocks.find((b) => b.type === "section")?.text?.text ?? "";
    expect(sectionText).toContain("FAILED");
  });

  it("formats run-completed with pass/fail summary", () => {
    const event = {
      type: "run-completed",
      results: { passed: 3, failed: 1 },
      plan: "/plans/plan.md",
    };
    const result = formatSlack(event, channel, {});
    const allText = result.blocks.map((b) => JSON.stringify(b)).join(" ");
    expect(allText).toMatch(/3\/4 passed/);
  });
});

// ─── formatDiscord ────────────────────────────────────────────────────

describe("formatDiscord", () => {
  it("returns embeds array with one embed", () => {
    const event = { type: "run-started", plan: "/plans/plan.md", sliceCount: 2, mode: "auto" };
    const result = formatDiscord(event, {});
    expect(Array.isArray(result.embeds)).toBe(true);
    expect(result.embeds).toHaveLength(1);
  });

  it("embed has title, description, color, and footer", () => {
    const event = { type: "slice-completed", sliceId: "1" };
    const result = formatDiscord(event, {});
    const embed = result.embeds[0];
    expect(embed.title).toBeTruthy();
    expect(embed.description).toBeTruthy();
    expect(typeof embed.color).toBe("number");
    expect(embed.footer?.text).toContain("Plan Forge");
  });

  it("uses green color (0x2ecc71) for successful run-completed", () => {
    const event = { type: "run-completed", results: { passed: 3, failed: 0 } };
    const result = formatDiscord(event, {});
    expect(result.embeds[0].color).toBe(0x2ecc71);
  });

  it("uses red color (0xe74c3c) for slice-failed", () => {
    const event = { type: "slice-failed", sliceId: "2" };
    const result = formatDiscord(event, {});
    expect(result.embeds[0].color).toBe(0xe74c3c);
  });

  it("uses blue color (0x3498db) for slice-started", () => {
    const event = { type: "slice-started", sliceId: "1" };
    const result = formatDiscord(event, {});
    expect(result.embeds[0].color).toBe(0x3498db);
  });
});

/**
 * Plan Forge Bridge — External Notifications & Webhook Dispatcher
 *
 * Subscribes to WebSocket hub events and dispatches formatted notifications
 * to external platforms: Telegram, Slack, Discord, and generic webhooks.
 *
 * Phase 16: OpenClaw Bridge
 *
 * Architecture:
 *   - BridgeManager connects to the hub as a WebSocket CLIENT (read-only subscriber)
 *   - Hub is NOT modified — bridge observes events via standard ws:// connection
 *   - Notification level filtering: all | important | critical
 *   - Rate limiter: max 1 notification per 5s per channel (anti-spam)
 *   - Config: .forge.json `bridge` section
 *   - HTTP client: Node.js built-in fetch (no new dependencies)
 *
 * @module bridge
 */

import { WebSocket } from "ws";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { appendEvent, SECURITY_RISK } from "./orchestrator.mjs";
import { authenticate } from "./auth/index.mjs";

// ─── Constants ────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 5_000;
const RECONNECT_DELAY_MS = 5_000;

/**
 * Which event types belong to each notification level.
 * Levels are hierarchical: critical ⊆ important ⊆ all.
 */
const LEVEL_EVENTS = {
  all: new Set([
    "run-started", "slice-started", "slice-completed",
    "slice-failed", "run-completed", "run-aborted",
  ]),
  important: new Set([
    "run-started", "slice-failed", "run-completed", "run-aborted",
  ]),
  critical: new Set([
    "slice-failed", "run-aborted",
    // run-completed only if there were failures
  ]),
};

// ─── Config ───────────────────────────────────────────────────────────

/**
 * Load bridge configuration from .forge.json in the project directory.
 *
 * Expected shape:
 * ```json
 * {
 *   "bridge": {
 *     "enabled": true,
 *     "channels": [
 *       { "type": "telegram", "url": "...", "chatId": "...", "level": "important" },
 *       { "type": "slack",    "url": "...", "level": "all" },
 *       { "type": "discord",  "url": "...", "level": "critical" },
 *       { "type": "generic",  "url": "...", "level": "all" }
 *     ]
 *   }
 * }
 * ```
 *
 * @param {string} cwd - Project directory
 * @returns {{ enabled: boolean, channels: Array } | null}
 */
function loadBridgeConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config.bridge ?? null;
  } catch {
    return null;
  }
}

// ─── Event Text Helpers ───────────────────────────────────────────────

/**
 * Get a short title for a hub event (used by Discord embeds and logging).
 * @param {object} event
 * @returns {string}
 */
function getEventTitle(event) {
  switch (event.type) {
    case "run-started":     return "🚀 Plan Forge — Execution Started";
    case "slice-started":   return `▶️ Slice ${event.sliceId} Started`;
    case "slice-completed": return `✅ Slice ${event.sliceId} Passed`;
    case "slice-failed":    return `❌ Slice ${event.sliceId} Failed`;
    case "run-completed":   return (event.results?.failed ?? 0) === 0
                              ? "🏁 Plan Forge — Execution Complete"
                              : "⚠️ Plan Forge — Execution Finished with Failures";
    case "run-aborted":     return "🛑 Plan Forge — Execution Aborted";
    default:                return `Plan Forge — ${event.type}`;
  }
}

/**
 * Get a Discord embed color for a hub event.
 * @param {object} event
 * @returns {number} RGB integer
 */
function getEventColor(event) {
  switch (event.type) {
    case "run-started":
    case "slice-started":   return 0x3498db;  // blue
    case "slice-completed": return 0x2ecc71;  // green
    case "slice-failed":
    case "run-aborted":     return 0xe74c3c;  // red
    case "run-completed":   return (event.results?.failed ?? 0) === 0 ? 0x2ecc71 : 0xe74c3c;
    default:                return 0x95a5a6;  // grey
  }
}

/**
 * Format a hub event as a human-readable text string.
 *
 * @param {object} event - Hub event payload
 * @param {"plain"|"markdown"} style - Text style
 * @returns {string}
 */
function _fmtRunStarted(event, fmt) {
  const plan = event.plan ? fmt.code(basename(event.plan)) : "plan";
  const count = event.sliceCount ?? "?";
  const mode = event.mode ?? "auto";
  return `🚀 ${fmt.bold("Plan Forge")} — Executing ${plan} (${count} slices, ${mode} mode)`;
}

function _fmtSliceStarted(event) {
  return `▶️ Slice ${event.sliceId} started${event.title ? `: ${event.title}` : ""}`;
}

function _fmtSliceCompleted(event) {
  const dur = event.duration != null ? `${Math.round(event.duration / 1000)}s` : null;
  const cost = event.cost_usd != null ? `$${event.cost_usd.toFixed(2)}` : null;
  const detail = [dur, cost].filter(Boolean).join(", ");
  return `✅ Slice ${event.sliceId} passed${detail ? ` (${detail})` : ""}`;
}

function _fmtSliceFailed(event, fmt) {
  const cmd = event.failedCommand ? fmt.code(event.failedCommand) : null;
  const err = !cmd && event.error ? event.error.slice(0, 120) : null;
  const detail = cmd ?? err ?? "";
  return `❌ Slice ${event.sliceId} FAILED${detail ? ` — ${detail}` : ""}`;
}

function _fmtRunCompleted(event, fmt) {
  const r = event.results ?? {};
  const passed = r.passed ?? 0;
  const failed = r.failed ?? 0;
  const total = passed + failed;
  const plan = event.plan ? fmt.code(basename(event.plan)) : null;
  const score = event.analyze?.score != null ? ` Score: ${event.analyze.score}.` : "";
  const cost = event.cost?.total_cost_usd != null
    ? ` Cost: $${Number(event.cost.total_cost_usd).toFixed(2)}.`
    : "";
  const summary = total > 0 ? `${passed}/${total} passed.` : "Complete.";
  return `🏁 ${fmt.bold("Plan Forge")}${plan ? ` — ${plan}` : ""} ${summary}${score}${cost}`;
}

function _fmtRunAborted(event) {
  return `🛑 Execution aborted at slice ${event.sliceId ?? "?"}${event.reason ? `: ${event.reason}` : ""}`;
}

const _FORMAT_EVENT_HANDLERS = {
  "run-started": _fmtRunStarted,
  "slice-started": _fmtSliceStarted,
  "slice-completed": _fmtSliceCompleted,
  "slice-failed": _fmtSliceFailed,
  "run-completed": _fmtRunCompleted,
  "run-aborted": _fmtRunAborted,
};

function formatEventText(event, style = "plain") {
  const fmt = {
    bold: (s) => style === "markdown" ? `*${s}*` : s,
    code: (s) => style === "markdown" ? `\`${s}\`` : s,
  };
  const fn = _FORMAT_EVENT_HANDLERS[event.type];
  return fn ? fn(event, fmt) : `${event.type}: ${JSON.stringify(event)}`;
}

// ─── Telegram MarkdownV2 Helpers ─────────────────────────────────────

/**
 * Escape text for Telegram MarkdownV2.
 * All reserved characters outside formatting entities must be preceded by `\`.
 * Reserved: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * @param {string|number} text
 * @returns {string}
 */
function escapeMdV2(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

/** Telegram MarkdownV2 bold — content is auto-escaped. */
function tgBold(text) { return `*${escapeMdV2(text)}*`; }

/** Telegram MarkdownV2 inline code — no escaping needed inside backticks. */
function tgCode(text) { return `\`${text}\``; }

/**
 * Build a Telegram MarkdownV2 message string for a hub event.
 * @param {object} event
 * @param {{ sliceCount?: number, plan?: string, model?: string }} [context] - Cached run context
 * @returns {string}
 */
function _tgRunStarted(event) {
  const plan = event.plan ? tgCode(basename(event.plan)) : escapeMdV2("plan");
  const count = escapeMdV2(event.sliceCount ?? "?");
  const mode = escapeMdV2(event.mode ?? "auto");
  return `🚀 ${tgBold("Plan Forge")} — Executing ${plan} \\(${count} slices, ${mode} mode\\)`;
}

function _tgSliceStarted(event, sliceRef) {
  const id = sliceRef(event.sliceId);
  const title = event.title ? ` \\— ${escapeMdV2(event.title)}` : "";
  return `▶️ Slice ${id} started${title}`;
}

function _tgSliceCompleted(event, sliceRef) {
  const id = sliceRef(event.sliceId);
  const dur = event.duration != null ? escapeMdV2(`${Math.round(event.duration / 1000)}s`) : null;
  const cost = event.cost_usd != null ? escapeMdV2(`$${event.cost_usd.toFixed(2)}`) : null;
  const detail = [dur, cost].filter(Boolean).join(", ");
  return `✅ Slice ${id} passed${detail ? ` \\(${detail}\\)` : ""}`;
}

function _tgSliceFailed(event, sliceRef) {
  const id = sliceRef(event.sliceId);
  const cmd = event.failedCommand ? tgCode(event.failedCommand) : null;
  const err = !cmd && event.error ? escapeMdV2(event.error.slice(0, 120)) : null;
  const detail = cmd ?? err ?? "";
  return `❌ Slice ${id} FAILED${detail ? ` — ${detail}` : ""}`;
}

function _tgRunCompleted(event) {
  const r = event.results ?? {};
  const passed = r.passed ?? 0;
  const failed = r.failed ?? 0;
  const total = passed + failed;
  const plan = event.plan ? ` — ${tgCode(basename(event.plan))}` : "";
  const summary = escapeMdV2(total > 0 ? `${passed}/${total} passed` : "Complete");
  const score = event.analyze?.score != null
    ? ` Score: ${escapeMdV2(String(event.analyze.score))}\\.`
    : "";
  const cost = event.cost?.total_cost_usd != null
    ? ` Cost: ${escapeMdV2(`$${Number(event.cost.total_cost_usd).toFixed(2)}`)}\\.`
    : "";
  const icon = failed === 0 ? "🏁" : "⚠️";
  return `${icon} ${tgBold("Plan Forge")}${plan} ${summary}\\.${score}${cost}`;
}

function _tgRunAborted(event) {
  const id = escapeMdV2(event.sliceId ?? "?");
  const reason = event.reason ? `: ${escapeMdV2(event.reason)}` : "";
  return `🛑 Execution aborted at slice ${id}${reason}`;
}

const _TELEGRAM_HANDLERS = {
  "run-started": _tgRunStarted,
  "slice-started": _tgSliceStarted,
  "slice-completed": _tgSliceCompleted,
  "slice-failed": _tgSliceFailed,
  "run-completed": _tgRunCompleted,
  "run-aborted": _tgRunAborted,
};

function buildTelegramText(event, context) {
  const sliceRef = (id) => {
    const total = context?.sliceCount;
    return total != null
      ? `${escapeMdV2(id ?? "?")}/${escapeMdV2(total)}`
      : escapeMdV2(id ?? "?");
  };
  const fn = _TELEGRAM_HANDLERS[event.type];
  return fn ? fn(event, sliceRef) : escapeMdV2(`${event.type}: ${JSON.stringify(event)}`);
}

// ─── Slack Block Kit Helpers ──────────────────────────────────────────

/**
 * Render a text-based progress bar for use in Slack context blocks.
 * Example: "▓▓▓▒▒▒▒▒ 3/8 (37%)"
 *
 * @param {string|number} current - Current slice index (1-based)
 * @param {string|number} total   - Total slice count
 * @returns {string}
 */
function slackProgressBar(current, total) {
  const BAR_LEN = 8;
  const n = typeof current === "string" ? parseInt(current, 10) : current;
  const t = typeof total === "string" ? parseInt(total, 10) : total;
  if (isNaN(n) || isNaN(t) || t <= 0) return `${current}/${total}`;
  const filled = Math.round((n / t) * BAR_LEN);
  const bar = "▓".repeat(Math.max(0, filled)) + "▒".repeat(Math.max(0, BAR_LEN - filled));
  const pct = Math.round((n / t) * 100);
  return `${bar} ${n}/${t} (${pct}%)`;
}

/**
 * Build Slack Block Kit blocks for a hub event.
 * Includes context blocks for metadata (plan, cost, model), an optional
 * progress bar when sliceCount is known, and approval action buttons
 * when `channel.approvalRequired` is true.
 *
 * @param {object} event
 * @param {object} [channel] - Channel config (for approvalRequired + serverUrl)
 * @param {{ sliceCount?: number, plan?: string, model?: string }} [context] - Cached run context
 * @returns {Array}
 */
function _slackSliceLabel(event, context) {
  return context?.sliceCount
    ? `*Slice ${event.sliceId ?? "?"}/${context.sliceCount}*`
    : `*Slice ${event.sliceId ?? "?"}*`;
}

function _slackProgressContext(event, context) {
  if (!context?.sliceCount) return null;
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: slackProgressBar(event.sliceId ?? 0, context.sliceCount) }],
  };
}

function _slackRunStarted(event) {
  const blocks = [];
  const planName = event.plan ? basename(event.plan) : null;
  const header = planName
    ? `🚀 *Plan Forge* — Executing \`${planName}\``
    : "🚀 *Plan Forge* — Execution Started";
  blocks.push({ type: "section", text: { type: "mrkdwn", text: header } });
  const ctx = [
    event.sliceCount != null && `${event.sliceCount} slices`,
    event.mode && `${event.mode} mode`,
    event.model,
  ].filter(Boolean);
  if (ctx.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctx.join(" · ") }] });
  }
  return blocks;
}

function _slackSliceStarted(event, context) {
  const blocks = [];
  const title = event.title ? `: ${event.title}` : "";
  const sliceLabel = _slackSliceLabel(event, context);
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `▶️ ${sliceLabel} started${title}` },
  });
  const progress = _slackProgressContext(event, context);
  if (progress) blocks.push(progress);
  return blocks;
}

function _slackSliceCompleted(event, context) {
  const blocks = [];
  const sliceLabel = _slackSliceLabel(event, context);
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `✅ ${sliceLabel} passed` },
  });
  const ctx = [
    context?.sliceCount && slackProgressBar(event.sliceId ?? 0, context.sliceCount),
    event.duration != null && `${Math.round(event.duration / 1000)}s`,
    event.cost_usd != null && `$${event.cost_usd.toFixed(2)}`,
    event.tokens?.model,
  ].filter(Boolean);
  if (ctx.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctx.join(" · ") }] });
  }
  return blocks;
}

function _slackSliceFailed(event, context) {
  const blocks = [];
  const sliceLabel = _slackSliceLabel(event, context);
  const cmd = event.failedCommand ? ` — \`${event.failedCommand}\`` : "";
  const err = !event.failedCommand && event.error ? ` — ${event.error.slice(0, 200)}` : "";
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `❌ ${sliceLabel} FAILED${cmd || err}` },
  });
  const progress = _slackProgressContext(event, context);
  if (progress) blocks.push(progress);
  return blocks;
}

function _slackApprovalActions(event, channel) {
  const serverUrl = (channel.serverUrl ?? "").replace(/\/$/, "");
  return [
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve", emoji: true },
          style: "primary",
          ...(serverUrl && { url: `${serverUrl}/api/bridge/approve/${event.runId}?action=approve` }),
          value: `approve:${event.runId}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Reject", emoji: true },
          style: "danger",
          ...(serverUrl && { url: `${serverUrl}/api/bridge/approve/${event.runId}?action=reject` }),
          value: `reject:${event.runId}`,
        },
      ],
    },
  ];
}

function _slackRunCompleted(event, _context, channel) {
  const blocks = [];
  const r = event.results ?? {};
  const passed = r.passed ?? 0;
  const failed = r.failed ?? 0;
  const total = passed + failed;
  const planName = event.plan ? basename(event.plan) : null;
  const icon = failed === 0 ? "🏁" : "⚠️";
  const summary = total > 0 ? `${passed}/${total} passed` : "Complete";
  const header = planName
    ? `${icon} *${planName}* — ${summary}`
    : `${icon} *Plan Forge* — ${summary}`;
  blocks.push({ type: "section", text: { type: "mrkdwn", text: header } });
  const ctx = [
    event.analyze?.score != null && `Score: ${event.analyze.score}/100`,
    event.cost?.total_cost_usd != null && `$${Number(event.cost.total_cost_usd).toFixed(2)}`,
    event.model,
  ].filter(Boolean);
  if (ctx.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctx.join(" · ") }] });
  }
  if (channel?.approvalRequired && failed === 0 && event.runId) {
    blocks.push(..._slackApprovalActions(event, channel));
  }
  return blocks;
}

function _slackRunAborted(event) {
  const reason = event.reason ? `: ${event.reason}` : "";
  return [{
    type: "section",
    text: {
      type: "mrkdwn",
      text: `🛑 *Plan Forge* — Aborted at Slice ${event.sliceId ?? "?"}${reason}`,
    },
  }];
}

const _SLACK_BLOCK_HANDLERS = {
  "run-started": _slackRunStarted,
  "slice-started": _slackSliceStarted,
  "slice-completed": _slackSliceCompleted,
  "slice-failed": _slackSliceFailed,
  "run-completed": _slackRunCompleted,
  "run-aborted": _slackRunAborted,
};

function buildSlackBlocks(event, channel, context) {
  const fn = _SLACK_BLOCK_HANDLERS[event.type];
  const blocks = fn
    ? fn(event, context, channel)
    : [{ type: "section", text: { type: "mrkdwn", text: `Plan Forge — \`${event.type}\`` } }];
  blocks.push({ type: "divider" });
  return blocks;
}

// ─── Discord Embed Field Helpers ──────────────────────────────────────

/**
 * Build Discord embed fields for a hub event.
 * Returns per-event fields: Plan, Slice, Status, Duration, Cost, Model.
 *
 * @param {object} event
 * @param {{ sliceCount?: number, plan?: string, model?: string }} [context] - Cached run context
 * @returns {Array<{ name: string, value: string, inline: boolean }>}
 */
function _discordRunStarted(event) {
  const fields = [];
  if (event.plan) fields.push({ name: "Plan", value: basename(event.plan), inline: true });
  if (event.mode) fields.push({ name: "Mode", value: event.mode, inline: true });
  if (event.sliceCount != null) fields.push({ name: "Slices", value: String(event.sliceCount), inline: true });
  if (event.model) fields.push({ name: "Model", value: event.model, inline: true });
  return fields;
}

function _discordSliceStarted(event, sliceRef) {
  const fields = [{ name: "Slice", value: sliceRef(event.sliceId), inline: true }];
  if (event.title) fields.push({ name: "Title", value: event.title, inline: true });
  return fields;
}

function _discordSliceCompleted(event, sliceRef) {
  const fields = [
    { name: "Slice", value: sliceRef(event.sliceId), inline: true },
    { name: "Status", value: "✅ Passed", inline: true },
  ];
  if (event.duration != null) fields.push({ name: "Duration", value: `${Math.round(event.duration / 1000)}s`, inline: true });
  if (event.cost_usd != null) fields.push({ name: "Cost", value: `$${event.cost_usd.toFixed(2)}`, inline: true });
  if (event.tokens?.model) fields.push({ name: "Model", value: event.tokens.model, inline: true });
  return fields;
}

function _discordSliceFailed(event, sliceRef) {
  const fields = [
    { name: "Slice", value: sliceRef(event.sliceId), inline: true },
    { name: "Status", value: "❌ Failed", inline: true },
  ];
  if (event.failedCommand) fields.push({ name: "Failed Command", value: `\`${event.failedCommand}\``, inline: false });
  else if (event.error) fields.push({ name: "Error", value: event.error.slice(0, 1024), inline: false });
  return fields;
}

function _discordRunCompleted(event) {
  const fields = [];
  const r = event.results ?? {};
  const passed = r.passed ?? 0;
  const failed = r.failed ?? 0;
  const total = passed + failed;
  if (event.plan) fields.push({ name: "Plan", value: basename(event.plan), inline: true });
  if (total > 0) fields.push({ name: "Results", value: `${passed}/${total} passed`, inline: true });
  if (event.analyze?.score != null) fields.push({ name: "Score", value: `${event.analyze.score}/100`, inline: true });
  if (event.cost?.total_cost_usd != null) fields.push({ name: "Cost", value: `$${Number(event.cost.total_cost_usd).toFixed(2)}`, inline: true });
  if (event.totalDuration != null) fields.push({ name: "Duration", value: `${Math.round(event.totalDuration / 60000)}m`, inline: true });
  return fields;
}

function _discordRunAborted(event, sliceRef) {
  const fields = [];
  if (event.sliceId) fields.push({ name: "Aborted at Slice", value: sliceRef(event.sliceId), inline: true });
  if (event.reason) fields.push({ name: "Reason", value: event.reason, inline: false });
  return fields;
}

const _DISCORD_FIELD_HANDLERS = {
  "run-started": _discordRunStarted,
  "slice-started": _discordSliceStarted,
  "slice-completed": _discordSliceCompleted,
  "slice-failed": _discordSliceFailed,
  "run-completed": _discordRunCompleted,
  "run-aborted": _discordRunAborted,
};

function buildDiscordFields(event, context) {
  const sliceRef = (id) =>
    context?.sliceCount != null ? `${id ?? "?"}/${context.sliceCount}` : String(id ?? "?");
  const fn = _DISCORD_FIELD_HANDLERS[event.type];
  return fn ? fn(event, sliceRef) : [];
}

// ─── Platform Formatters ──────────────────────────────────────────────

/**
 * Format a hub event for the Telegram Bot API (sendMessage) using MarkdownV2.
 * Emoji status indicators per event type with proper character escaping.
 *
 * @param {object} event - Hub event
 * @param {object} channel - Channel config (must include `chatId`)
 * @param {{ sliceCount?: number, plan?: string, model?: string }} [context] - Cached run context
 * @returns {{ chat_id: string, text: string, parse_mode: string, reply_markup?: object }}
 */
export function formatTelegram(event, channel, context) {
  const payload = {
    chat_id: channel.chatId ?? "",
    text: buildTelegramText(event, context),
    parse_mode: "MarkdownV2",
  };

  // Add inline keyboard approval buttons for approval-required channels
  if (channel.approvalRequired && event.runId && event.type === "run-completed") {
    const serverUrl = (channel.serverUrl ?? "").replace(/\/$/, "");
    if (serverUrl) {
      payload.reply_markup = {
        inline_keyboard: [[
          { text: "✅ Approve", url: `${serverUrl}/api/bridge/approve/${event.runId}?action=approve` },
          { text: "❌ Reject",  url: `${serverUrl}/api/bridge/approve/${event.runId}?action=reject` },
        ]],
      };
    }
  }

  return payload;
}

/**
 * Format a hub event for Slack Incoming Webhooks using Block Kit.
 * Rich blocks with plan name, progress bar, cost, model info, and optional
 * approval action buttons when `channel.approvalRequired` is true.
 *
 * @param {object} event - Hub event
 * @param {object} [channel] - Channel config (for approvalRequired + serverUrl)
 * @param {{ sliceCount?: number, plan?: string, model?: string }} [context] - Cached run context
 * @returns {{ text: string, blocks: Array }}
 */
export function formatSlack(event, channel, context) {
  return {
    text: formatEventText(event, "plain"),
    blocks: buildSlackBlocks(event, channel, context),
  };
}

/**
 * Format a hub event for Discord Webhooks using Embeds.
 * Color-coded sidebar (green=pass, red=fail, blue=info) with per-event
 * fields: Plan, Slice, Status, Duration, Cost. Footer includes model + timestamp.
 *
 * @param {object} event - Hub event
 * @param {{ sliceCount?: number, plan?: string, model?: string }} [context] - Cached run context
 * @returns {{ embeds: Array }}
 */
export function formatDiscord(event, context) {
  const fields = buildDiscordFields(event, context);
  const model = event.model ?? event.tokens?.model ?? context?.model ?? null;
  const footerParts = ["Plan Forge", model, event.timestamp ?? new Date().toISOString()].filter(Boolean);
  return {
    embeds: [
      {
        title: getEventTitle(event),
        description: formatEventText(event, "plain"),
        color: getEventColor(event),
        ...(fields.length > 0 && { fields }),
        footer: { text: footerParts.join(" • ") },
      },
    ],
  };
}

/**
 * Format a hub event for a generic webhook.
 * Clean JSON envelope with event type, payload, and metadata.
 *
 * @param {object} event - Hub event
 * @returns {{ source: string, schemaVersion: string, timestamp: string, event: object }}
 */
export function formatGeneric(event) {
  return {
    source: "plan-forge",
    schemaVersion: "1.0",
    timestamp: new Date().toISOString(),
    event,
  };
}

// ─── Tool Deny Filter ─────────────────────────────────────────────────

/**
 * Determine whether a tool-call event should be blocked based on the plan's
 * `tools.deny` list parsed from frontmatter.
 *
 * Phase-WORKER-GUARDRAILS Slice 6 (A8): MCP bridge filter for `tools.deny`.
 * The orchestrator extracts `meta.toolsDeny` from plan frontmatter and passes it
 * here; the bridge drops any `tool-call` / `tool-invoked` event whose `toolName`
 * appears in the denied list before forwarding to external notification channels.
 *
 * @param {string}          toolName    - The MCP tool name being invoked
 * @param {string[] | null} deniedTools - List from plan frontmatter `tools.deny`
 * @returns {boolean} true when the tool is denied and must be blocked
 */
export function isDeniedTool(toolName, deniedTools) {
  if (!deniedTools || !Array.isArray(deniedTools) || deniedTools.length === 0) return false;
  return deniedTools.includes(toolName);
}



class RateLimiter {
  /**
   * @param {number} windowMs - Minimum milliseconds between notifications per key
   */
  constructor(windowMs = RATE_LIMIT_MS) {
    this.windowMs = windowMs;
    this._lastSent = new Map(); // channelKey → timestamp (ms)
  }

  /** @param {string} key @returns {boolean} */
  isAllowed(key) {
    const last = this._lastSent.get(key) ?? 0;
    return Date.now() - last >= this.windowMs;
  }

  /** @param {string} key */
  record(key) {
    this._lastSent.set(key, Date.now());
  }
}

// ─── BridgeManager ────────────────────────────────────────────────────

/**
 * BridgeManager connects to the Plan Forge WebSocket hub as a subscriber
 * and dispatches notifications to configured external channels.
 *
 * Usage:
 * ```js
 * const bridge = new BridgeManager({ cwd: '/path/to/project' });
 * bridge.connect(); // reads port from .forge/server-ports.json
 * // ...
 * bridge.stop();
 * ```
 */
export class BridgeManager {
  /**
   * @param {object} options
   * @param {string} [options.cwd]         - Project directory (for .forge.json + server-ports.json)
   * @param {object} [options.config]      - Bridge config override (skips .forge.json lookup)
   * @param {string} [options.logDir]      - Run log directory for bridge-edit-* event recording
   * @param {string[]} [options.deniedTools] - Tool names denied by plan frontmatter `tools.deny`
   */
  constructor(options = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.config = options.config ?? loadBridgeConfig(this.cwd);
    this._logDir = options.logDir ?? null;
    /** Phase-WORKER-GUARDRAILS Slice 6 (A8): MCP tool names blocked by plan frontmatter `tools.deny`. */
    this._deniedTools = options.deniedTools ?? null;
    this._ws = null;
    this._rateLimiter = new RateLimiter();
    this._reconnectTimer = null;
    this._stopped = false;
    /** Cached context from the most recent run-started event. */
    this._runContext = null;
    /** Lazily initialised ApprovalGate — created on first requestApproval call. */
    this._approvalGate = null;
  }

  /**
   * Returns true if bridge is enabled and has at least one channel configured.
   * @returns {boolean}
   */
  get isEnabled() {
    return !!(this.config?.enabled !== false && this.config?.channels?.length);
  }

  /**
   * Returns true if any configured channel has `approvalRequired: true`.
   * @returns {boolean}
   */
  get hasApprovalChannels() {
    return (this.config?.channels ?? []).some((c) => c.approvalRequired === true);
  }

  /**
   * Request approval for a run. Dispatches approval notifications to channels
   * with `approvalRequired: true` and awaits human decision or timeout.
   *
   * @param {string} runId
   * @param {object} event - Typically a run-completed event payload
   * @returns {Promise<{ approved: boolean, approver?: string, timedOut?: boolean }>}
   */
  requestApproval(runId, event) {
    if (!this._approvalGate) {
      const channels = ApprovalGate.getApprovalChannels(this.config);
      const serverUrl = this.config?.serverUrl ?? "";
      const timeoutMinutes = this.config?.approvalTimeoutMinutes ?? 30;
      this._approvalGate = new ApprovalGate({ channels, serverUrl, timeoutMinutes, logDir: this._logDir });
    }
    return this._approvalGate.requestApproval(runId, event);
  }

  /**
   * Receive an external approval decision — called by the server's REST endpoint.
   *
   * @param {string} runId
   * @param {boolean} approved
   * @param {string} [approver]
   * @returns {{ ok: boolean, message: string }}
   */
  receiveApproval(runId, approved, approver = "unknown") {
    if (!this._approvalGate) {
      return { ok: false, message: "No approval gate initialised" };
    }
    return this._approvalGate.receiveApproval(runId, approved, approver);
  }

  /**
   * Return pending approvals from the internal gate (for the status endpoint).
   * @returns {Array<{ runId: string, status: string, requestedAt: string }>}
   */
  getPendingApprovals() {
    return this._approvalGate?.getPendingApprovals() ?? [];
  }

  /**
   * Authenticate an incoming approval request against the configured
   * `bridge.approvalSecret`. Returns `{ ok: true }` when no secret is
   * configured (permissive / local mode).
   *
   * Accepts the token via:
   *   - `Authorization: Bearer <secret>` header, OR
   *   - `?token=<secret>` query parameter (browser-friendly Telegram links)
   *
   * @param {Object} req - Incoming request context with `headers` map and
   *   optional `query` object (Express-style).
   * @returns {{ ok: boolean, error?: string }}
   */
  authenticateApproval(req) {
    const secret = this.config?.approvalSecret;
    if (!secret) return { ok: true };

    // Prefer header-based bearer auth via the shared auth module
    const headerResult = authenticate(req, { provider: "bearer", token: secret });
    if (headerResult.ok) return { ok: true };

    // Fallback: query-parameter token for browser-friendly approval links
    const queryToken = req?.query?.token ?? null;
    if (queryToken && queryToken === secret) return { ok: true };

    return { ok: false, error: "Unauthorized — invalid or missing approval secret" };
  }

  /**
   * Connect to the hub WebSocket and start processing events.
   * Auto-reconnects on disconnect unless `stop()` has been called.
   *
   * @param {number} [port] - Hub WS port. Reads .forge/server-ports.json if omitted.
   */
  connect(port) {
    if (!this.isEnabled) return;

    const hubPort = port ?? this._readHubPort();
    if (!hubPort) {
      console.error("[bridge] No hub port found — bridge will not connect");
      return;
    }

    const url = `ws://127.0.0.1:${hubPort}?label=bridge`;
    this._ws = new WebSocket(url);

    this._ws.on("open", () => {
      console.error(`[bridge] Connected to hub at ws://127.0.0.1:${hubPort}`);
    });

    this._ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        // Skip the 'connected' ack and replayed history ack
        if (event.type && event.type !== "connected") {
          this._onEvent(event);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    this._ws.on("close", () => {
      if (!this._stopped) {
        console.error(`[bridge] Hub connection closed — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
        this._reconnectTimer = setTimeout(() => this.connect(port), RECONNECT_DELAY_MS);
      }
    });

    this._ws.on("error", (err) => {
      // 'close' fires after error, which triggers reconnect — just log here
      console.error(`[bridge] WebSocket error: ${err.message}`);
    });
  }

  /**
   * Disconnect from the hub and stop all reconnect attempts.
   */
  stop() {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /**
   * Handle an incoming hub event — apply level filter and dispatch to each channel.
   * Caches run-started context for use in per-slice message formatting.
   * Drops `tool-call`/`tool-invoked` events whose `toolName` appears in
   * `_deniedTools` (populated from plan frontmatter `tools.deny`).
   * @param {object} event
   */
  _onEvent(event) {
    // Phase-WORKER-GUARDRAILS Slice 6 (A8): drop denied tool-call events before forwarding
    if (
      (event.type === "tool-call" || event.type === "tool-invoked") &&
      isDeniedTool(event.toolName, this._deniedTools)
    ) {
      console.error(`[bridge] Blocked denied tool event: ${event.toolName}`);
      return;
    }

    // Cache run context so slice formatters can show "Slice N/Total"
    if (event.type === "run-started") {
      this._runContext = {
        sliceCount: event.sliceCount ?? null,
        plan: event.plan ?? null,
        model: event.model ?? null,
      };
    } else if (event.type === "run-completed" || event.type === "run-aborted") {
      this._runContext = null;
    }

    const channels = this.config?.channels;
    if (!channels?.length) return;

    for (const channel of channels) {
      if (this._shouldSend(channel, event)) {
        // Fire-and-forget; errors are caught inside dispatchToChannel
        this.dispatchToChannel(channel, event).catch(() => {});
      }
    }
  }

  /**
   * Decide whether a channel should receive the given event.
   * For `critical` level, run-completed is only sent when there are failures.
   *
   * @param {object} channel
   * @param {object} event
   * @returns {boolean}
   */
  _shouldSend(channel, event) {
    const level = channel.level ?? "important";
    const allowed = LEVEL_EVENTS[level] ?? LEVEL_EVENTS.important;

    if (!allowed.has(event.type)) return false;

    // For critical level, run-completed only fires on failure
    if (level === "critical" && event.type === "run-completed") {
      return (event.results?.failed ?? 0) > 0;
    }

    return true;
  }

  /**
   * Format and POST a notification to a single channel with rate limiting.
   * Never throws — logs errors and continues.
   *
   * @param {object} channel - Channel config ({ type, url, chatId?, level? })
   * @param {object} event - Hub event payload
   */
  async dispatchToChannel(channel, event) {
    const key = `${channel.type}:${channel.url}`;

    if (!this._rateLimiter.isAllowed(key)) {
      console.error(`[bridge] Rate limited — skipping ${channel.type} for ${event.type}`);
      return;
    }

    this._rateLimiter.record(key);

    const ctx = this._runContext;
    let payload;
    switch (channel.type) {
      case "telegram": payload = formatTelegram(event, channel, ctx); break;
      case "slack":    payload = formatSlack(event, channel, ctx); break;
      case "discord":  payload = formatDiscord(event, ctx); break;
      default:         payload = formatGeneric(event); break;
    }

    try {
      const response = await fetch(channel.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        // Mask URL to avoid leaking tokens in logs
        const maskedUrl = channel.url.replace(/\/bot[^/]+\//, "/bot[REDACTED]/");
        console.error(`[bridge] Webhook ${channel.type} HTTP ${response.status} (${maskedUrl}): ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[bridge] Webhook error (${channel.type}): ${err.message}`);
    }
  }

  /**
   * Read the active hub port from .forge/server-ports.json.
   * @returns {number | null}
   */
  _readHubPort() {
    const portsPath = resolve(this.cwd, ".forge", "server-ports.json");
    try {
      if (existsSync(portsPath)) {
        const info = JSON.parse(readFileSync(portsPath, "utf-8"));
        return info.ws ?? null;
      }
    } catch {
      // Stale or corrupt
    }
    return null;
  }
}

// ─── Approval Gate ────────────────────────────────────────────────────

const DEFAULT_APPROVAL_TIMEOUT_MINUTES = 30;

/**
 * Build a Telegram sendMessage payload with an inline keyboard for approval.
 * Adds reply_markup with Approve/Reject buttons when serverUrl is configured.
 *
 * @param {string} runId
 * @param {object} event - run-completed event
 * @param {object} channel - Channel config (chatId, serverUrl)
 * @returns {object} Telegram sendMessage payload
 */
function buildTelegramApprovalPayload(runId, event, channel) {
  const serverUrl = (channel.serverUrl ?? "").replace(/\/$/, "");
  const text = buildTelegramText(event) + "\n\n_Waiting for approval\\.\\.\\._";
  const payload = {
    chat_id: channel.chatId ?? "",
    text,
    parse_mode: "MarkdownV2",
  };

  if (serverUrl) {
    payload.reply_markup = {
      inline_keyboard: [[
        { text: "✅ Approve", url: `${serverUrl}/api/bridge/approve/${runId}?action=approve` },
        { text: "❌ Reject",  url: `${serverUrl}/api/bridge/approve/${runId}?action=reject`  },
      ]],
    };
  }

  return payload;
}

/**
 * Approval Gate — pause-on-completion state machine.
 *
 * Tracks pending approvals for runs that require external sign-off before the
 * orchestrator writes the final summary and manifest.
 *
 * Usage:
 * ```js
 * const gate = new ApprovalGate({ channels: approvalChannels, serverUrl });
 * const result = await gate.requestApproval(runId, runCompletedEvent);
 * if (!result.approved) { ... }
 * ```
 */
export class ApprovalGate {
  /**
   * @param {object} [options]
   * @param {Array}  [options.channels]                - Channels with approvalRequired: true
   * @param {string} [options.serverUrl]               - Base URL for callback links (e.g. "http://localhost:3100")
   * @param {number} [options.timeoutMinutes=30]       - Auto-reject after N minutes
   * @param {string} [options.logDir]                  - Run log directory for bridge-edit-* event recording
   */
  constructor(options = {}) {
    /** @type {Map<string, { status: string, requestedAt: string, event: object, timer: any, _resolve: Function }>} */
    this._pending = new Map();
    this._timeoutMs = (options.timeoutMinutes ?? DEFAULT_APPROVAL_TIMEOUT_MINUTES) * 60_000;
    this._channels = options.channels ?? [];
    this._serverUrl = options.serverUrl ?? "";
    this._logDir = options.logDir ?? null;
  }

  /**
   * Filter an array of bridge channels to only those with approvalRequired: true.
   * @param {object} bridgeConfig - Bridge config from .forge.json
   * @returns {Array}
   */
  static getApprovalChannels(bridgeConfig) {
    return (bridgeConfig?.channels ?? []).filter((c) => c.approvalRequired === true);
  }

  /**
   * Send an approval request to all configured approval channels and return a
   * Promise that resolves when `receiveApproval` is called or the timeout elapses.
   *
   * @param {string} runId
   * @param {object} event - Hub event triggering the approval (typically run-completed)
   * @returns {Promise<{ approved: boolean, approver?: string, timedOut?: boolean }>}
   */
  requestApproval(runId, event) {
    if (this._pending.has(runId)) {
      const entry = this._pending.get(runId);
      return new Promise((resolve) => {
        const origResolve = entry._resolve;
        entry._resolve = (result) => { origResolve(result); resolve(result); };
      });
    }

    let resolveApproval;
    const promise = new Promise((resolve) => { resolveApproval = resolve; });

    const timer = setTimeout(() => {
      if (this._pending.has(runId)) {
        this._pending.delete(runId);
        resolveApproval({ approved: false, timedOut: true });
        // Call site 1: bridge-edit-blocked — approval timed out
        appendEvent("bridge-edit-blocked", {
          runId,
          reason: "timeout",
          source: "bridge",
          security_risk: SECURITY_RISK.HIGH,
        }, this._logDir);
      }
    }, this._timeoutMs);

    this._pending.set(runId, {
      status: "pending",
      requestedAt: new Date().toISOString(),
      event,
      timer,
      _resolve: resolveApproval,
    });

    // Dispatch approval notifications fire-and-forget
    this._dispatchApprovalRequests(runId, event).catch((err) => {
      console.error(`[bridge] ApprovalGate dispatch error: ${err.message}`);
    });

    return promise;
  }

  /**
   * Receive an approval decision and resolve the pending gate.
   *
   * @param {string} runId
   * @param {boolean} approved
   * @param {string} [approver]
   * @returns {{ ok: boolean, message: string }}
   */
  receiveApproval(runId, approved, approver = "unknown") {
    const entry = this._pending.get(runId);
    if (!entry) {
      return { ok: false, message: `No pending approval for runId: ${runId}` };
    }

    clearTimeout(entry.timer);
    this._pending.delete(runId);
    entry._resolve({ approved, approver, timedOut: false });

    // Call site 2: bridge-edit-approved or bridge-edit-blocked — explicit decision
    const eventType = approved ? "bridge-edit-approved" : "bridge-edit-blocked";
    appendEvent(eventType, {
      runId,
      approver,
      source: "bridge",
      security_risk: approved
        ? (entry.event?.security_risk ?? SECURITY_RISK.NONE)
        : SECURITY_RISK.HIGH,
    }, this._logDir);

    return { ok: true, message: approved ? "Approved" : "Rejected" };
  }

  /**
   * Check if a runId has a pending approval.
   * @param {string} runId
   * @returns {boolean}
   */
  hasPending(runId) {
    return this._pending.has(runId);
  }

  /**
   * Return all pending approvals (for status endpoint).
   * @returns {Array<{ runId: string, status: string, requestedAt: string }>}
   */
  getPendingApprovals() {
    return Array.from(this._pending.entries()).map(([runId, entry]) => ({
      runId,
      status: entry.status,
      requestedAt: entry.requestedAt,
    }));
  }

  /**
   * Dispatch approval-request notifications to all approval channels.
   * Telegram gets an inline keyboard; Slack gets action buttons (already
   * handled by buildSlackBlocks when approvalRequired + runId are present);
   * Discord and generic get standard event formatting.
   *
   * @param {string} runId
   * @param {object} event
   */
  async _dispatchApprovalRequests(runId, event) {
    const eventWithRunId = { ...event, runId };

    for (const channel of this._channels) {
      const channelWithServer = {
        ...channel,
        serverUrl: channel.serverUrl ?? this._serverUrl,
      };

      let payload;
      switch (channel.type) {
        case "telegram":
          payload = buildTelegramApprovalPayload(runId, eventWithRunId, channelWithServer);
          break;
        case "slack":
          payload = formatSlack(eventWithRunId, channelWithServer);
          break;
        case "discord":
          payload = formatDiscord(eventWithRunId);
          break;
        default:
          payload = formatGeneric(eventWithRunId);
          break;
      }

      try {
        const response = await fetch(channel.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const maskedUrl = channel.url.replace(/\/bot[^/]+\//, "/bot[REDACTED]/");
          console.error(`[bridge] ApprovalGate ${channel.type} HTTP ${response.status} (${maskedUrl}): ${body.slice(0, 200)}`);
        }
      } catch (err) {
        console.error(`[bridge] ApprovalGate dispatch error (${channel.type}): ${err.message}`);
      }
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

/**
 * Create and connect a BridgeManager if bridge is configured and enabled.
 * Returns null if bridge is disabled or `.forge.json` has no bridge section.
 *
 * @param {object} options
 * @param {string} [options.cwd] - Project directory
 * @param {number} [options.port] - Hub WS port override
 * @param {object} [options.config] - Bridge config override
 * @returns {BridgeManager | null}
 */
export function createBridge(options = {}) {
  const manager = new BridgeManager(options);
  if (!manager.isEnabled) return null;
  manager.connect(options.port);
  return manager;
}

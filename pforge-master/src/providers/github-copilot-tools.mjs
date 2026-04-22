/**
 * Plan Forge — Forge-Master GitHub Copilot Provider Adapter (Phase-33, Slice 1).
 *
 * Connects the reasoning loop to the GitHub Models inference endpoint,
 * which exposes an OpenAI-compatible Chat Completions API.
 *
 * GitHub Models specifics:
 *   - POST /chat/completions (base: https://models.github.ai/inference)
 *   - Header: Authorization: Bearer <github-token>
 *   - Token resolution: passed → GITHUB_TOKEN env → .forge/secrets.json → `gh auth token`
 *   - Models: gpt-4o, gpt-4o-mini, claude-sonnet-4, claude-opus-4 (fallback: gpt-4o-mini)
 *   - 429 → structured rate_limited return; ≥500 → throw; 2xx → parse OpenAI format
 *
 * @module forge-master/providers/github-copilot-tools
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildOpenAITools,
  formatMessages,
  parseResponse,
} from "./openai-tools.mjs";

const DEFAULT_BASE_URL = "https://models.github.ai/inference";

export const KNOWN_MODELS = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-opus-4"];

const _warnedModels = new Set();

// Module-scope subprocess cache: undefined = not yet attempted; null = attempted, no token; string = token
let _ghSubprocessAttempted = false;
let _ghTokenCache = null;

/** Reset subprocess token cache — for testing only. */
export function _resetTokenCache() {
  _ghSubprocessAttempted = false;
  _ghTokenCache = null;
  _warnedModels.clear();
}

/**
 * Resolve a GitHub token from four ordered tiers:
 *   1. `token` argument passed directly
 *   2. `GITHUB_TOKEN` environment variable
 *   3. `.forge/secrets.json` — key `GITHUB_TOKEN` or `github.token`
 *   4. `gh auth token` subprocess (result cached at module scope)
 *
 * @param {{ token?: string, useSubprocess?: boolean }} [opts]
 * @returns {string | null}
 */
export function resolveGitHubToken({ token, useSubprocess = true } = {}) {
  // Tier 1: directly passed
  if (token) return token;

  // Tier 2: environment variable
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  // Tier 3: .forge/secrets.json
  try {
    const secretsPath = resolve(process.cwd(), ".forge", "secrets.json");
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
      const secretToken = secrets?.GITHUB_TOKEN || secrets?.github?.token;
      if (secretToken) return secretToken;
    }
  } catch { /* malformed JSON or unreadable — skip */ }

  // Tier 4: gh auth token subprocess (cache result at module scope)
  if (useSubprocess) {
    if (_ghSubprocessAttempted) return _ghTokenCache;
    _ghSubprocessAttempted = true;
    try {
      const tok = execFileSync("gh", ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (tok) {
        _ghTokenCache = tok;
        return tok;
      }
    } catch { /* gh not installed or not authenticated */ }
  }

  return null;
}

/**
 * Returns true if a GitHub token is available from any resolution tier.
 * Allowed to spawn `gh` once for the initial cache warm-up; subsequent
 * calls are cache-only and never hit the network.
 *
 * @returns {boolean}
 */
export function isAvailable() {
  return Boolean(resolveGitHubToken({ useSubprocess: true }));
}

function normalizeModel(model) {
  if (KNOWN_MODELS.includes(model)) return model;
  if (!_warnedModels.has(model)) {
    console.warn(
      `[github-copilot] Unknown model "${model}", falling back to "gpt-4o-mini"`,
    );
    _warnedModels.add(model);
  }
  return "gpt-4o-mini";
}

/**
 * Send a turn to the GitHub Models Chat Completions endpoint.
 *
 * @param {{
 *   messages: Array<{role, content, toolCalls?, toolCallId?}>,
 *   tools?: Array<{name, description, parameters?}>,
 *   model: string,
 *   token?: string,
 *   apiKey?: string,
 *   baseUrl?: string,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<
 *   | { type: "reply"|"tool_calls", content?: string, toolCalls?: Array, tokensIn: number, tokensOut: number }
 *   | { type: "rate_limited", retryAfter: string|null, raw: string }
 * >}
 */
export async function sendTurn(opts) {
  const {
    messages,
    tools = [],
    model,
    token,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    signal,
  } = opts;

  // Accept both `token` and `apiKey` for caller compatibility
  const resolvedToken = resolveGitHubToken({ token: token ?? apiKey });
  if (!resolvedToken) {
    throw new Error(
      "GitHub Copilot: no token available. " +
      "Set GITHUB_TOKEN env var, add to .forge/secrets.json, or run `gh auth login`.",
    );
  }

  const normalizedModel = normalizeModel(model);
  const formatted = formatMessages(messages);
  const body = { model: normalizedModel, messages: formatted };

  const builtTools = buildOpenAITools(tools);
  if (builtTools.length > 0) body.tools = builtTools;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 429) {
    const raw = await response.text();
    return {
      type: "rate_limited",
      retryAfter: response.headers.get("retry-after") ?? null,
      raw,
    };
  }

  if (response.status >= 500) {
    const errBody = await response.text();
    throw new Error(`GitHub Copilot API error ${response.status}: ${errBody}`);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`GitHub Copilot API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return parseResponse(data);
}

export const PROVIDER_NAME = "github-copilot";

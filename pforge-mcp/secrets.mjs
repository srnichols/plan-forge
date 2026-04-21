/**
 * Shared secret-loading utilities for Plan Forge.
 *
 * Loads API keys from .forge/secrets.json (fallback when env var is not set).
 * File is gitignored via **\/.forge/ pattern. Never committed.
 * Schema: { "XAI_API_KEY": "xai-...", "OPENAI_API_KEY": "sk-..." }
 *
 * @module secrets
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load an API key from .forge/secrets.json.
 * @param {string} key - Environment variable name to look up
 * @param {string} [cwd] - Working directory (defaults to process.cwd())
 * @returns {string|null}
 */
export function loadSecretFromForge(key, cwd) {
  try {
    const secretsPath = resolve(cwd || process.cwd(), ".forge", "secrets.json");
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
      return secrets[key] || null;
    }
  } catch { /* ignore parse errors */ }
  return null;
}

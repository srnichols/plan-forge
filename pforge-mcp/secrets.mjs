/**
 * Shared secret-loading utilities for Plan Forge.
 *
 * Loads API keys from .forge/secrets.json (fallback when env var is not set).
 * File is gitignored via **\/.forge/ pattern. Never committed.
 * Schema: { "GITHUB_TOKEN": "ghp_...", "XAI_API_KEY": "xai-...", "OPENAI_API_KEY": "sk-..." }
 *
 * @module secrets
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Registry of known secrets for the dashboard UI.
 * `GITHUB_TOKEN` is listed first as the recommended zero-key provider credential.
 *
 * @type {Array<{key: string, label: string, placeholder: string}>}
 */
export const KNOWN_SECRETS = [
  { key: "GITHUB_TOKEN", label: "GitHub (Copilot, recommended)", placeholder: "ghp_..." },
  { key: "XAI_API_KEY", label: "xAI (Grok)", placeholder: "xai-..." },
  { key: "OPENAI_API_KEY", label: "OpenAI (GPT / DALL-E)", placeholder: "sk-..." },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude API)", placeholder: "sk-ant-..." },
  { key: "OPENCLAW_API_KEY", label: "OpenClaw Analytics", placeholder: "oc-..." },
  { key: "AZURE_OPENAI_API_KEY", label: "Azure OpenAI (API Key)", placeholder: "..." },
  { key: "AZURE_OPENAI_ENDPOINT", label: "Azure OpenAI (Endpoint)", placeholder: "https://<resource>.openai.azure.com/" },
  { key: "AZURE_OPENAI_DEPLOYMENT", label: "Azure OpenAI (Deployment)", placeholder: "my-deployment" },
  { key: "AZURE_OPENAI_API_VERSION", label: "Azure OpenAI (API Version)", placeholder: "2024-02-01" },
  { key: "AZURE_TENANT_ID", label: "Azure (Tenant ID)", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
  { key: "AZURE_CLIENT_ID", label: "Azure (Client ID)", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
  { key: "AZURE_SUBSCRIPTION_ID", label: "Azure Subscription ID (Foundry quota preflight)", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
  { key: "AZURE_RESOURCE_GROUP", label: "Azure Resource Group (Foundry quota preflight)", placeholder: "my-resource-group" },
];

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

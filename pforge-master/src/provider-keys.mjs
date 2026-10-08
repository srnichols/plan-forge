/**
 * Environment-variable API keys for the direct-API reasoning providers.
 *
 * The key is read at call time and never logged or embedded in errors.
 *
 * @module forge-master/provider-keys
 */

const PROVIDER_KEY_ENV = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
});

/**
 * @param {string|null|undefined} providerName
 * @returns {string|null} Environment variable holding the provider's API key
 */
export function providerKeyEnvName(providerName) {
  return Object.hasOwn(PROVIDER_KEY_ENV, providerName ?? "") ? PROVIDER_KEY_ENV[providerName] : null;
}

/**
 * @param {string|null|undefined} providerName
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null} The configured API key, or null when absent
 */
export function resolveEnvApiKey(providerName, env = process.env) {
  const envName = providerKeyEnvName(providerName);
  return (envName && env?.[envName]) || null;
}

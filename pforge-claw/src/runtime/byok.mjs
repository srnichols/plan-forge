export const BYOK_PROVIDERS = Object.freeze(["anthropic", "openai", "azure"]);

const DEFAULT_KEY_SECRETS = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  azure: "AZURE_OPENAI_API_KEY",
});

export function buildByokProvider({ type, config, secrets }) {
  if (!BYOK_PROVIDERS.includes(type)) {
    return {
      ok: false,
      error: "BYOK_UNSUPPORTED_PROVIDER",
      provider: type,
      supported: [...BYOK_PROVIDERS],
    };
  }

  const providerConfig = config?.runtimes?.byok?.[type];
  const secretName = providerConfig?.keySecret ?? DEFAULT_KEY_SECRETS[type];
  const apiKey = secrets?.get(secretName);
  if (apiKey === null || apiKey === undefined) {
    return { ok: false, error: "BYOK_KEY_MISSING", provider: type };
  }

  const endpoint = providerConfig?.endpoint;
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    return { ok: false, error: "BYOK_ENDPOINT_MISSING", provider: type };
  }

  return {
    ok: true,
    provider: { type, baseUrl: endpoint, apiKey },
  };
}

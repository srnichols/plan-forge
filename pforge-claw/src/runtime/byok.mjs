export const BYOK_PROVIDERS = Object.freeze(["anthropic", "openai", "azure"]);

const DEFAULT_KEY_SECRETS = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  azure: "AZURE_OPENAI_API_KEY",
});

/** Returns configuration references only; resolved credentials never belong in a lease. */
export function byokProviderReference({ type, config } = {}) {
  if (!BYOK_PROVIDERS.includes(type)) return null;
  const providerConfig = config?.runtimes?.byok?.[type];
  return {
    type,
    keySecret: providerConfig?.keySecret ?? DEFAULT_KEY_SECRETS[type],
    ...(providerConfig?.endpoint !== undefined ? { endpoint: providerConfig.endpoint } : {}),
  };
}

export function buildByokProvider({ type, config, secrets }) {
  if (!BYOK_PROVIDERS.includes(type)) {
    return {
      ok: false,
      error: "BYOK_UNSUPPORTED_PROVIDER",
      provider: type,
      supported: [...BYOK_PROVIDERS],
    };
  }

  const reference = byokProviderReference({ type, config });
  const apiKey = secrets?.get(reference.keySecret);
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { ok: false, error: "BYOK_KEY_MISSING", provider: type };
  }

  const endpoint = reference.endpoint;
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    return { ok: false, error: "BYOK_ENDPOINT_MISSING", provider: type };
  }

  return {
    ok: true,
    provider: { type, baseUrl: endpoint, apiKey },
  };
}

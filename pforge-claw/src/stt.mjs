import fsPromises from "node:fs/promises";

export const STT_PROVIDERS = Object.freeze(["openai", "azure"]);

const DEFAULT_KEY_SECRETS = Object.freeze({
  openai: "OPENAI_API_KEY",
  azure: "AZURE_SPEECH_KEY",
});

function transcriptFrom(value) {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.DisplayText === "string") return value.DisplayText;
  const phrase = value?.combinedPhrases?.[0]?.text;
  return typeof phrase === "string" ? phrase : "";
}

function resolveTranscriptionTarget({ voice, config, provider, key }) {
  const endpoint = voice.endpoint ?? config?.runtimes?.byok?.[provider]?.endpoint;
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    return { ok: false, error: "STT_ENDPOINT_MISSING", provider };
  }
  return { ok: true, provider, key, endpoint };
}

function transcriptionRequest({ voice, config, secrets }) {
  if (voice?.enabled !== true) return { ok: false, error: "STT_DISABLED" };
  const provider = voice.provider;
  if (!STT_PROVIDERS.includes(provider)) {
    return { ok: false, error: "STT_UNSUPPORTED_PROVIDER", provider };
  }
  const key = secrets?.get?.(voice.keySecret ?? DEFAULT_KEY_SECRETS[provider]);
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, error: "BYOK_KEY_MISSING", provider };
  }
  return resolveTranscriptionTarget({ voice, config, provider, key });
}

export function createStt({ config, secrets, fetch = globalThis.fetch, fs = fsPromises, logger } = {}) {
  async function transcribe({ audioPath, mimeType = "audio/ogg", signal } = {}) {
    let result;
    const voice = config?.capture?.voice;
    try {
      const request = transcriptionRequest({ voice, config, secrets });
      if (!request.ok) {
        result = request;
        return result;
      }
      const { provider, key, endpoint } = request;
      const audio = new Blob([await fs.readFile(audioPath)], { type: mimeType });
      const form = new FormData();
      if (provider === "openai") {
        form.append("file", audio, "capture-audio");
        if (typeof voice.model === "string" && voice.model.trim()) form.append("model", voice.model);
      } else {
        form.append("audio", audio, "capture-audio");
        form.append("definition", JSON.stringify({ locales: ["en-US"] }));
      }
      const headers = provider === "openai"
        ? { Authorization: `Bearer ${key}` }
        : { "Ocp-Apim-Subscription-Key": key };
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: form,
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        result = { ok: false, error: "STT_PROVIDER_ERROR", provider, status: response.status };
        return result;
      }
      const body = await response.json();
      const text = transcriptFrom(body).trim();
      result = text
        ? { ok: true, text }
        : { ok: false, error: "STT_EMPTY_TRANSCRIPT", provider };
      return result;
    } catch {
      result = { ok: false, error: "STT_REQUEST_FAILED" };
      return result;
    } finally {
      if (audioPath) {
        try {
          await fs.unlink(audioPath);
        } catch (error) {
          if (error?.code !== "ENOENT") {
            logger?.error?.("STT_AUDIO_CLEANUP_FAILED", { code: "STT_AUDIO_CLEANUP_FAILED" });
            result.cleanupFailed = true;
          }
        }
      }
    }
  }

  return { transcribe };
}

import fs from "node:fs/promises";
import path from "node:path";
import { ClawError } from "./errors.mjs";
import { captureErrorCode } from "./capture-policy.mjs";

const MAX_AUDIO_MEBIBYTES = 20;
const BYTES_PER_MEBIBYTE = 1_048_576;
export const MAX_CAPTURE_AUDIO_BYTES = MAX_AUDIO_MEBIBYTES * BYTES_PER_MEBIBYTE;
const DIRECTORY_MODE = 0o700;
const AUDIO_MODE = 0o600;
const DEFAULT_AUDIO_TYPE = "audio/ogg";

function audioLimit(channel) {
  const limit = channel?.limits?.maxFileBytes;
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, MAX_CAPTURE_AUDIO_BYTES) : MAX_CAPTURE_AUDIO_BYTES;
}

function validateDownload(downloaded, { fileId, maxBytes }) {
  if (downloaded?.fileId !== fileId
    || typeof downloaded?.filePath !== "string"
    || !Buffer.isBuffer(downloaded?.bytes)
    || downloaded.bytes.length === 0) {
    throw new ClawError("CAPTURE_MEDIA_INVALID");
  }
  if (downloaded.bytes.length > maxBytes) throw new ClawError("CAPTURE_MEDIA_TOO_LARGE");
}

async function materializeAudio(home, bytes, owned) {
  if (typeof home !== "string" || !home.trim()) throw new ClawError("CAPTURE_HOME_REQUIRED");
  const root = path.resolve(home);
  await fs.mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
  owned.directory = await fs.mkdtemp(path.join(root, "capture-voice-"));
  await fs.chmod(owned.directory, DIRECTORY_MODE);
  const audioPath = path.join(owned.directory, "audio");
  await fs.writeFile(audioPath, bytes, { flag: "wx", mode: AUDIO_MODE });
  return audioPath;
}

async function cleanupAudio(owned, logger) {
  if (!owned.directory) return true;
  try {
    await fs.rm(owned.directory, { recursive: true, force: true });
    return true;
  } catch {
    logger?.error?.("CAPTURE_AUDIO_CLEANUP_FAILED", { code: "CAPTURE_AUDIO_CLEANUP_FAILED" });
    return false;
  }
}

/**
 * Bridges only an adapter's bounded Buffer download to STT's existing file contract.
 * @param {{channel: {limits?: {maxFileBytes?: number},
 * download: (input: {fileId: string, maxBytes: number}) => Promise<{fileId: string, filePath: string, bytes: Buffer}>},
 * stt?: {transcribe: (input: {audioPath: string, mimeType: string}) =>
 * Promise<{ok: boolean, text?: string, error?: string, cleanupFailed?: boolean}>},
 * home?: string, classified: {fileId: string, mimeType?: string},
 * logger?: {error?: (message: string, fields: {code: string}) => void}}} input
 * @returns {Promise<{ok: boolean, text?: string, error?: string, cleanupFailed?: boolean}>}
 */
export async function transcribeCaptureAudio({ channel, stt, home, classified, logger }) {
  const owned = { directory: null };
  let transcription;
  try {
    if (typeof stt?.transcribe !== "function") throw new ClawError("STT_UNAVAILABLE");
    const maxBytes = audioLimit(channel);
    const downloaded = await channel.download({ fileId: classified.fileId, maxBytes });
    validateDownload(downloaded, { fileId: classified.fileId, maxBytes });
    const audioPath = await materializeAudio(home, downloaded.bytes, owned);
    transcription = await stt.transcribe({
      audioPath, mimeType: classified.mimeType ?? DEFAULT_AUDIO_TYPE,
    });
    if (transcription?.cleanupFailed) {
      logger?.error?.("STT_AUDIO_CLEANUP_FAILED", { code: "STT_AUDIO_CLEANUP_FAILED" });
      transcription = { ok: false, error: "STT_AUDIO_CLEANUP_FAILED", cleanupFailed: true };
    }
  } catch (error) {
    transcription = { ok: false, error: captureErrorCode(error, "STT_REQUEST_FAILED") };
  } finally {
    // STT unlinks audio; remove our directory, including any pre-handoff or failed-unlink residue.
    if (!await cleanupAudio(owned, logger)) {
      transcription = { ok: false, error: "CAPTURE_AUDIO_CLEANUP_FAILED", cleanupFailed: true };
    }
  }
  return transcription;
}

export class ClawError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "ClawError";
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {unknown} error
 * @param {string} fallback
 * @param {Record<string, unknown>} details
 * @returns {ClawError}
 */
export function withClawErrorDetails(error, fallback, details) {
  const failure = error instanceof ClawError ? error : new ClawError(fallback);
  return new ClawError(failure.code, { ...failure.details, ...details });
}

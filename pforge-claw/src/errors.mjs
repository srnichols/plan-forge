export class ClawError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "ClawError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Plan Forge — Crucible Mode interface contract (Phase-59 Slice 1).
 *
 * Defines the required shape every CrucibleMode descriptor must satisfy.
 * This module has zero external dependencies so it can be safely imported
 * from any layer without circular-import risk.
 */

/**
 * @typedef {object} CrucibleMode
 * @property {string}                      id          - canonical lane id ('tweak'|'feature'|'full' or custom)
 * @property {string}                      label       - human-readable display label
 * @property {() => ReadonlyArray<object>} questionBank - returns the frozen question array for this mode
 * @property {(smelt: object, options?: object) => string} renderDraft - render a markdown draft from smelt answers
 * @property {(params: object) => object}  finalize    - finalize the smelt into a phase document
 */

export const MODE_INTERFACE_KEYS = Object.freeze([
  "id",
  "label",
  "questionBank",
  "renderDraft",
  "finalize",
]);

/**
 * Validate that a mode descriptor satisfies the CrucibleMode interface.
 * Throws TypeError with a descriptive message on the first violation.
 *
 * @param {unknown} mode
 * @throws {TypeError}
 */
export function validateMode(mode) {
  if (!mode || typeof mode !== "object") {
    throw new TypeError("mode must be a non-null object");
  }
  for (const key of MODE_INTERFACE_KEYS) {
    if (!(key in mode)) {
      throw new TypeError(`mode missing required key: ${key}`);
    }
  }
  if (typeof mode.id !== "string" || !mode.id.trim()) {
    throw new TypeError("mode.id must be a non-empty string");
  }
  if (typeof mode.label !== "string") {
    throw new TypeError("mode.label must be a string");
  }
  if (typeof mode.questionBank !== "function") {
    throw new TypeError("mode.questionBank must be a function");
  }
  if (typeof mode.renderDraft !== "function") {
    throw new TypeError("mode.renderDraft must be a function");
  }
  if (typeof mode.finalize !== "function") {
    throw new TypeError("mode.finalize must be a function");
  }
}

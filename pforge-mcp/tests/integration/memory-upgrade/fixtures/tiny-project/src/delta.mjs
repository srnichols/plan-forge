/**
 * delta.mjs — fixture: quibblate calls snargle
 * Caller edges: gamma.flibbert  → delta.quibblate
 * Callee edges:  delta.quibblate → epsilon.snargle
 */

import { snargle } from "./epsilon.mjs";

/**
 * Perform the quibblating step.
 * @param {number} value
 * @returns {number}
 */
export function quibblate(value) {
  return snargle(value * 3);
}

/**
 * Clamp a value between min and max.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

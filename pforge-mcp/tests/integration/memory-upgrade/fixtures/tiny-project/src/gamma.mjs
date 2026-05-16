/**
 * gamma.mjs — fixture: flibbert calls quibblate
 * Caller edges: beta.combulate  → gamma.flibbert
 * Callee edges:  gamma.flibbert → delta.quibblate
 */

import { quibblate } from "./delta.mjs";

/**
 * Apply the flibbering transform.
 * @param {number} value
 * @returns {number}
 */
export function flibbert(value) {
  return quibblate(value - 1);
}

/**
 * Returns whether the value is even.
 * @param {number} n
 * @returns {boolean}
 */
export function isEven(n) {
  return n % 2 === 0;
}

/**
 * beta.mjs — fixture: combulate calls flibbert
 * Caller edges: alpha.frobnicate → beta.combulate
 * Callee edges:  beta.combulate  → gamma.flibbert
 */

import { flibbert } from "./gamma.mjs";

/**
 * Combine and process a value through the pipeline.
 * @param {number} value
 * @returns {number}
 */
export function combulate(value) {
  const intermediate = value + 1;
  return flibbert(intermediate);
}

/**
 * Returns the absolute value of the input.
 * @param {number} n
 * @returns {number}
 */
export function absVal(n) {
  return Math.abs(n);
}

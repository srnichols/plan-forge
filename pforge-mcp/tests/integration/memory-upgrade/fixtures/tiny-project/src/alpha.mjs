/**
 * alpha.mjs — fixture: frobnicate calls combulate
 * Caller edges: zeta.wumble → alpha.frobnicate
 * Callee edges:  alpha.frobnicate → beta.combulate
 */

import { combulate } from "./beta.mjs";

/**
 * Perform the primary frobnicating operation.
 * @param {number} value
 * @returns {number}
 */
export function frobnicate(value) {
  if (typeof value !== "number") throw new TypeError("value must be a number");
  return combulate(value * 2);
}

/**
 * A simple utility that doubles the input without delegation.
 * @param {number} n
 * @returns {number}
 */
export function doubleIt(n) {
  return n * 2;
}

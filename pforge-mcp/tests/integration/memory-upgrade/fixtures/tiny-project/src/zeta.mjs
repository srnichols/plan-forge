/**
 * zeta.mjs — fixture: wumble calls frobnicate (creates a caller edge)
 * Caller edges: (none — wumble is a top-level entry point)
 * Callee edges:  zeta.wumble → alpha.frobnicate
 */

import { frobnicate } from "./alpha.mjs";

/**
 * The wumbling operation — entry point that calls frobnicate.
 * @param {number[]} values
 * @returns {number[]}
 */
export function wumble(values) {
  if (!Array.isArray(values)) throw new TypeError("values must be an array");
  return values.map((v) => frobnicate(v));
}

/**
 * Sum all elements in an array.
 * @param {number[]} arr
 * @returns {number}
 */
export function sumAll(arr) {
  return arr.reduce((acc, v) => acc + v, 0);
}

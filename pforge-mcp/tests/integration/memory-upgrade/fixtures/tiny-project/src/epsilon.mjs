/**
 * epsilon.mjs — fixture: leaf function snargle (no outgoing edges to .mjs)
 * Caller edges: delta.quibblate → epsilon.snargle
 */

/**
 * The snargling operation — leaf node in the call graph.
 * @param {number} value
 * @returns {number}
 */
export function snargle(value) {
  return value > 0 ? Math.sqrt(value) : 0;
}

/**
 * Format a number to a fixed number of decimal places.
 * @param {number} n
 * @param {number} decimals
 * @returns {string}
 */
export function toFixed(n, decimals = 2) {
  return n.toFixed(decimals);
}

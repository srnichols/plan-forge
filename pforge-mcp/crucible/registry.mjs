/**
 * Plan Forge — Crucible Mode registry (Phase-59 Slice 1).
 *
 * Central store for registered CrucibleMode descriptors. Uses a module-level
 * Map so registration is idempotent across the process lifetime.
 *
 * Only imports from ./mode.mjs (a leaf module) — zero circular-import risk.
 */

import { validateMode } from "./mode.mjs";

const _registry = new Map();

/**
 * Register a mode descriptor. Validates the shape before storing.
 * Re-registering the same id overwrites the previous entry.
 *
 * @param {import('./mode.mjs').CrucibleMode} mode
 * @returns {import('./mode.mjs').CrucibleMode} the registered mode (passthrough)
 * @throws {TypeError} if the mode descriptor is invalid
 */
export function registerMode(mode) {
  validateMode(mode);
  _registry.set(mode.id, mode);
  return mode;
}

/**
 * Retrieve a registered mode by id.
 *
 * @param {string} id
 * @returns {import('./mode.mjs').CrucibleMode}
 * @throws {Error} if no mode is registered under that id
 */
export function getMode(id) {
  if (!_registry.has(id)) {
    throw new Error(`crucible mode not registered: '${id}'`);
  }
  return _registry.get(id);
}

/**
 * Return all registered modes as an array (insertion order).
 *
 * @returns {Array<import('./mode.mjs').CrucibleMode>}
 */
export function listModes() {
  return [..._registry.values()];
}

/**
 * Remove all registered modes. Intended for test isolation only.
 * @internal
 */
export function _resetRegistry() {
  _registry.clear();
}

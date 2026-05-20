/**
 * Plan Forge — Capabilities shim (v2.3)
 *
 * All surface logic has been extracted to ./capabilities/surface.mjs (Phase-51 Slice 4).
 * This file re-exports everything so existing consumers are unaffected.
 *
 * @module capabilities
 */

// ─── Surface builder (extracted) ──────────────────────────────────────
export {
  buildCapabilitySurface,
  buildCapabilities,
  writeToolsJson,
  writeCliSchema,
} from './capabilities/surface.mjs';

// ─── Sub-module re-exports (unchanged) ────────────────────────────────
export { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';
export { CLI_SCHEMA, CONFIG_SCHEMA } from './capabilities/schemas.mjs';
export { SYSTEM_REFERENCE } from './capabilities/reference.mjs';
export { INNER_LOOP_SURFACE } from './capabilities/subsystems.mjs';


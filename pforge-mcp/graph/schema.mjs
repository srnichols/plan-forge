/**
 * Plan Forge Knowledge Graph — Node and Edge type definitions (Phase-38.3).
 * @module graph/schema
 */

/** @readonly */
export const NODE_TYPES = Object.freeze({
  PHASE: "Phase",
  SLICE: "Slice",
  COMMIT: "Commit",
  FILE: "File",
  TEST: "Test",
  BUG: "Bug",
  MEMORY: "Memory",
  RUN: "Run",
});

/** @readonly */
export const EDGE_TYPES = Object.freeze({
  PHASE_TO_SLICE: "Phase→Slice",
  SLICE_TO_COMMIT: "Slice→Commit",
  COMMIT_TO_FILE: "Commit→File",
  FILE_TO_TEST: "File→Test",
  SLICE_TO_BUG: "Slice→Bug",
  SLICE_TO_MEMORY: "Slice→Memory",
  RUN_TO_SLICE: "Run→Slice",
});

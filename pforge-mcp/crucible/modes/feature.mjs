/**
 * Plan Forge — Crucible feature-lane mode descriptor (Phase-59 Slice 2).
 *
 * Self-registering CrucibleMode for the feature lane. Importing this module
 * has the side effect of registering the mode in the central registry.
 *
 * IMPORTANT: must not import from crucible-server.mjs to prevent circular
 * imports (crucible-server.mjs imports this file for its side effect).
 */

import { FEATURE_QUESTIONS } from "../../crucible-interview.mjs";
import { renderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";

const LINKED_BUGS_Q = Object.freeze({
  id: "linked-bugs",
  prompt: "Any related bug IDs or issues to link? (comma-separated, or press Enter to skip)",
  required: false,
  defaultSource: null,
});

const feature = {
  id: "feature",
  label: "Feature",
  criticalFields: new Set(["scope-files", "validation-gates", "forbidden-actions"]),
  questionBank: () => Object.freeze([...FEATURE_QUESTIONS, LINKED_BUGS_Q]),
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  // Finalization is handled by handleFinalize in crucible/core/finalize.mjs.
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(feature);
export default feature;

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

const feature = {
  id: "feature",
  label: "Feature",
  criticalFields: new Set(["scope-files", "validation-gates", "forbidden-actions"]),
  questionBank: () => FEATURE_QUESTIONS,
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  // Finalization is handled by handleFinalize in crucible-server.mjs.
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(feature);
export default feature;

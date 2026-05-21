/**
 * Plan Forge — Crucible full-lane mode descriptor (Phase-59 Slice 2).
 *
 * Self-registering CrucibleMode for the full lane. Importing this module
 * has the side effect of registering the mode in the central registry.
 *
 * IMPORTANT: must not import from crucible-server.mjs to prevent circular
 * imports (crucible-server.mjs imports this file for its side effect).
 */

import { FULL_QUESTIONS } from "../../crucible-interview.mjs";
import { renderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";

const full = {
  id: "full",
  label: "Full",
  criticalFields: new Set(["scope-in", "forbidden-actions", "rollback-plan"]),
  questionBank: () => FULL_QUESTIONS,
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  // Finalization is handled by handleFinalize in crucible-server.mjs.
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(full);
export default full;

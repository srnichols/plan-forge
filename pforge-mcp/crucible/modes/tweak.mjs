/**
 * Plan Forge — Crucible tweak-lane mode descriptor (Phase-59 Slice 2).
 *
 * Self-registering CrucibleMode for the tweak lane. Importing this module
 * has the side effect of registering the mode in the central registry.
 *
 * IMPORTANT: must not import from crucible-server.mjs to prevent circular
 * imports (crucible-server.mjs imports this file for its side effect).
 */

import { TWEAK_QUESTIONS } from "../../crucible-interview.mjs";
import { renderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";

const LINKED_BUGS_Q = Object.freeze({
  id: "linked-bugs",
  prompt: "Any related bug IDs or issues to link? (comma-separated, or press Enter to skip)",
  required: false,
  defaultSource: null,
});

const tweak = {
  id: "tweak",
  label: "Tweak",
  criticalFields: new Set(["scope-file", "validation", "forbidden-actions"]),
  questionBank: () => Object.freeze([...TWEAK_QUESTIONS, LINKED_BUGS_Q]),
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  // Finalization is handled by handleFinalize in crucible/core/finalize.mjs.
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(tweak);
export default tweak;

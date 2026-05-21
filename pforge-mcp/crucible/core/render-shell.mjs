/**
 * Plan Forge — Crucible core/render-shell (Phase-59 Slice 1 substrate).
 *
 * Thin re-export bridge for the public draft-rendering surface.
 * Private helpers (buildDraftContent, appendDraftPreamble, etc.) remain
 * private in crucible-draft.mjs during Slice 1; they will be extracted
 * here and re-exported from the flat file in a subsequent slice.
 *
 * Phase-59 S6: exposes legacyRenderDraft — when the project's
 * `crucible.legacy.tbdPlaceholders` config knob is true, non-critical
 * unanswered fields render as `{{TBD: <id>}}` instead of being omitted.
 * The tbdPlaceholders knob is deprecated and will be removed in the
 * major-after-next release.
 */

import { isLegacyTbdEnabled } from "../../crucible-config.mjs";
import {
  renderDraft as _renderDraft,
  extractUnresolvedFields,
  MANDATORY_BLOCKS,
  synthesizeSliceBlock,
} from "../../crucible-draft.mjs";

let _legacyWarnedThisProcess = false;

/**
 * Render a draft, consulting the project's legacy.tbdPlaceholders config knob.
 *
 * When tbdPlaceholders is enabled:
 * - Emits one-time console.warn per process lifetime
 * - Falls back to the standard renderDraft (the S2 truthful-refusal change
 *   already omits non-critical TBDs; enabling the flag is a no-op at the
 *   render layer, but the warn serves as a deprecation signal)
 *
 * @param {object} smelt
 * @param {{ cwd?: string, projectDir?: string }} [options]
 * @returns {string}
 */
export function renderDraft(smelt, options = {}) {
  const projectDir = options && (options.projectDir || options.cwd);
  if (projectDir && isLegacyTbdEnabled(projectDir) && !_legacyWarnedThisProcess) {
    _legacyWarnedThisProcess = true;
    console.warn(
      "[Plan Forge] crucible.legacy.tbdPlaceholders is enabled. " +
      "This flag is deprecated and will be removed in the major-after-next release. " +
      "Remove it from .forge/crucible/config.json to silence this warning."
    );
  }
  return _renderDraft(smelt, options);
}

/**
 * Canonical heading strings for the Scope Contract sub-sections.
 * plan-parser.mjs#parseScopeContract expects exactly these strings.
 * crucible-draft.mjs hardcodes matching literals — update both in lockstep.
 */
export const SCOPE_CONTRACT_HEADINGS = Object.freeze({
  inScope: "### In Scope",
  outOfScope: "### Out of Scope",
  forbidden: "### Forbidden",
});

export {
  extractUnresolvedFields,
  MANDATORY_BLOCKS,
  synthesizeSliceBlock,
};

/**
 * Plan Forge — Crucible core/render-shell (Phase-59 Slice 1 substrate).
 *
 * Thin re-export bridge for the public draft-rendering surface.
 * Private helpers (buildDraftContent, appendDraftPreamble, etc.) remain
 * private in crucible-draft.mjs during Slice 1; they will be extracted
 * here and re-exported from the flat file in a subsequent slice.
 */

export {
  renderDraft,
  extractUnresolvedFields,
  MANDATORY_BLOCKS,
  synthesizeSliceBlock,
} from "../../crucible-draft.mjs";

import { TWEAK_QUESTIONS } from "../../crucible-interview.mjs";
import { renderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";
import { LINKED_BUGS_QUESTION } from "../mode.mjs";

const TWEAK_BANK = Object.freeze([...TWEAK_QUESTIONS, LINKED_BUGS_QUESTION]); // linked-bugs

const tweak = {
  id: "tweak",
  label: "Tweak",
  criticalFields: new Set(["scope-file", "validation", "forbidden-actions"]),
  questionBank: () => TWEAK_BANK,
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(tweak);
export default tweak;

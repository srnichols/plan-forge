import { FULL_QUESTIONS } from "../../crucible-interview.mjs";
import { renderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";
import { LINKED_BUGS_QUESTION } from "../mode.mjs";

const FULL_BANK = Object.freeze([...FULL_QUESTIONS, LINKED_BUGS_QUESTION]); // linked-bugs

const full = {
  id: "full",
  label: "Full",
  criticalFields: new Set(["scope-in", "forbidden-actions", "rollback-plan"]),
  questionBank: () => FULL_BANK,
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(full);
export default full;

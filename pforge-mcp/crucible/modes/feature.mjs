import { FEATURE_QUESTIONS } from "../../crucible-interview.mjs";
import { renderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";
import { LINKED_BUGS_QUESTION } from "../mode.mjs";

const FEATURE_BANK = Object.freeze([...FEATURE_QUESTIONS, LINKED_BUGS_QUESTION]); // linked-bugs

const feature = {
  id: "feature",
  label: "Feature",
  criticalFields: new Set(["scope-files", "validation-gates", "forbidden-actions"]),
  questionBank: () => FEATURE_BANK,
  renderDraft: (smelt, opts) => renderDraft(smelt, opts),
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(feature);
export default feature;

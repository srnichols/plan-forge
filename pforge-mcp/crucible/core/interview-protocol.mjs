/**
 * Plan Forge — Crucible core/interview-protocol (Phase-59 Slice 1 substrate).
 *
 * Thin re-export bridge for the public interview-engine surface.
 * Logic remains in crucible-interview.mjs in Slice 1.
 */

export {
  TWEAK_QUESTIONS,
  FEATURE_QUESTIONS,
  FULL_QUESTIONS,
  getQuestionBank,
  totalQuestions,
  getNextQuestion,
  recordAnswer,
  buildRecommendedDefault,
} from "../../crucible-interview.mjs";

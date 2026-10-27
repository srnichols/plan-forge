/** Plan Forge — meta-bug #369: a slice whose gate is `[manual]` waits for a person */

import { isManualGateSlice, manualGateText } from "../plan-parser.mjs";

const NO_DESCRIPTION = "(no description)";

/**
 * A `[manual]` gate is the step-2 convention for a check no command can make.
 * It has no command, so nothing at run time paused, skipped or reported the
 * slice: a worker that exited 0 passed it, and a slice that needed a live cloud
 * session or an owner's approval was completed without either.
 *
 * Called once a slice has passed and its work is committed. In auto mode the
 * slice is then recorded as waiting for a person, which stops the run there.
 * It is recorded as failed, with a reason and a flag of its own, and not as a
 * status of its own: the scheduler, summary and exit code all read passed or
 * failed, and a status they do not know would let the run carry on past it.
 * Assisted mode has a person at the keyboard already, so it is left alone, and
 * so is a slice that failed on its own account.
 *
 * @param {object} params
 * @param {{ status: string, statusReason?: string, awaitingManualVerification?: { gate: string } }} params.sliceResult - mutated when the slice is held
 * @param {{ validationGate?: string|null, validationGateDescription?: string }} params.slice
 * @param {string} [params.mode]
 */
export function holdManualGateSlice({ sliceResult, slice, mode }) {
  if (sliceResult.status !== "passed" || mode === "assisted" || !isManualGateSlice(slice)) return;
  const gate = manualGateText(slice) || NO_DESCRIPTION;
  sliceResult.status = "failed";
  sliceResult.statusReason = `manual-verification-required: ${gate}. The slice's changes are committed; verify them, then continue the run with --resume-from.`;
  sliceResult.awaitingManualVerification = { gate };
}

/**
 * The slices of a run that are waiting for a person, each with the slice to
 * continue from: the one after it in the plan, or null for the last.
 *
 * @param {{ slices?: Array<{ number: string|number }> }} plan
 * @param {Array<{ number?: string|number, title?: string, awaitingManualVerification?: { gate: string } }>} results
 * @returns {Array<{ slice: string, title: string|undefined, gate: string, resumeFrom: string|number|null }>}
 */
export function summarizeManualHolds(plan, results) {
  const slices = Array.isArray(plan?.slices) ? plan.slices : [];
  return (results ?? [])
    .filter((result) => result?.awaitingManualVerification)
    .map((result) => {
      const position = slices.findIndex((slice) => String(slice.number) === String(result.number));
      return {
        slice: String(result.number),
        title: result.title,
        gate: result.awaitingManualVerification.gate,
        resumeFrom: position === -1 ? null : (slices[position + 1]?.number ?? null),
      };
    });
}

/** What the run summary says to do about the slices waiting for a person; "" when there are none. */
export function manualHoldReport(holds) {
  return holds
    .map(({ slice, gate, resumeFrom }) => (resumeFrom === null
      ? `Slice ${slice} is waiting for you to verify: ${gate}. It is the last slice, so nothing is left to run`
      : `Slice ${slice} is waiting for you to verify: ${gate}. Then continue with --resume-from ${resumeFrom}`))
    .join(". ");
}

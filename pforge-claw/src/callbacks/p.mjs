import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

let proposalService = null;
let auditTap = null;

export function bindProposalService(service) {
  proposalService = service;
  auditTap = service?.auditProposalTap ?? auditTap;
  return () => {
    if (proposalService === service) proposalService = null;
  };
}

export default Object.freeze({
  prefix: "p",
  sinceSlice: 6,
  available: true,
  roles: [...ROLES],
  async handle(_context, input = {}) {
    const { payload, caller, chatId, threadId } = input;
    if (!proposalService) {
      auditTap?.({ chatId, threadId, id: payload });
      return [];
    }
    if (typeof proposalService.runProposal !== "function") {
      throw new ClawError("SERVICE_UNAVAILABLE");
    }
    return proposalService.runProposal({ ...input, id: payload, caller, chatId, threadId });
  },
});

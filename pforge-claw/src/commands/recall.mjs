import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { parseRecallAll, recallAll, renderRecallAll } from "../crossproject.mjs";
import { getMemoryRuntime, searchAcrossProjects } from "../features/memory.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";

const RECALL_ALL_LIMIT = 5;

async function recallAcrossProjects(query) {
  const runtime = getMemoryRuntime();
  if (!runtime.client) throw new ClawError("SERVICE_UNAVAILABLE");
  const result = await recallAll({
    memory: { fanoutSearch: searchAcrossProjects },
    config: runtime.context?.config ?? {},
    registry: runtime.context?.registry ?? runtime.context?.projectRegistry,
  }, { query, limit: RECALL_ALL_LIMIT });
  return { text: renderRecallAll(result) };
}

export default Object.freeze({
  name: "recall", aliases: [], args: "[--all] <query>", summary: "Search saved memories in this project",
  details: "Search saved memories for the current project; `--all` searches every project except restricted ones. "
    + "Results include their record references.",
  examples: ["/recall deployment — echoes record references", "/recall --all API decisions — every shared project"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: true, sinceSlice: 7, group: "Ask & memory",
  async handle(context, args) {
    const all = parseRecallAll(args?.argsText ?? "");
    if (all) return recallAcrossProjects(all.query);
    const service = this?.service ?? getBoundCaptureService();
    if (!service) throw new ClawError("SERVICE_UNAVAILABLE");
    return service.recall({
      project: args.project ?? context?.project,
      caller: args.caller,
      chatId: args.chatId,
      threadId: args.threadId,
      updateId: args.updateId,
      text: args.argsText ?? "",
    });
  },
});

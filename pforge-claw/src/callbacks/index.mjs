import approval from "./a.mjs";
import budget from "./b.mjs";
import fanout from "./f.mjs";
import cancel from "./x.mjs";
import task from "./t.mjs";
import memory from "./m.mjs";
import confirm from "./c.mjs";
import project from "./p.mjs";
import status from "./s.mjs";

// mirrors Shared Contract enums; enums.mjs owner to adopt
export const CALLBACK_PREFIXES = Object.freeze(["a", "b", "f", "x", "t", "m", "c", "p", "s"]);
export const CALLBACKS = Object.freeze([approval, budget, fanout, cancel, task, memory, confirm, project, status]);

const callbackByPrefix = new Map();
for (const callback of CALLBACKS) {
  if (callbackByPrefix.has(callback.prefix)) throw new Error(`Duplicate callback prefix: ${callback.prefix}`);
  callbackByPrefix.set(callback.prefix, callback);
}
if (CALLBACK_PREFIXES.some((prefix) => !callbackByPrefix.has(prefix))) {
  throw new Error("Callback prefix is missing a module");
}

export function parseCallback(data) {
  if (typeof data !== "string" || Buffer.byteLength(data, "utf8") < 1 || Buffer.byteLength(data, "utf8") > 64) return null;
  const separator = data.indexOf(":");
  if (separator < 1) return null;
  const prefix = data.slice(0, separator);
  const callback = callbackByPrefix.get(prefix);
  return callback ? { prefix, payload: data.slice(separator + 1), callback } : null;
}

export function callbackFor(prefix) {
  return callbackByPrefix.get(prefix);
}

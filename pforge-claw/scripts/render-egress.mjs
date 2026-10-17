import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ClawError } from "../src/errors.mjs";
import { buildJobEgressPolicy } from "../src/k8s/egress-policy.mjs";

/** Render configured egress to stdout only; no cluster access or file mutations. */
export async function renderEgress(args = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args, strict: true, allowPositionals: false,
      options: { config: { type: "string" }, namespace: { type: "string" } },
    }));
  } catch {
    throw new ClawError("K8S_EGRESS_INPUT_INVALID");
  }
  if (!values.config || !values.namespace) throw new ClawError("K8S_EGRESS_INPUT_REQUIRED");
  const config = JSON.parse(await readFile(values.config, "utf8"));
  return buildJobEgressPolicy({ namespace: values.namespace, allow: config?.k8s?.egress?.allow ?? [] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await renderEgress(), null, 2) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error instanceof ClawError ? error.code : "K8S_EGRESS_INPUT_INVALID" }) + "\n");
    process.exitCode = 2;
  }
}

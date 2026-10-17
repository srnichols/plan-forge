import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFixturePath, validateFixtureJob } from "./k8s-fixture-common.mjs";

/** Actual files produced by the injected external agent/plan edge, not synthetic completion evidence. */
export async function writeFixtureRuntimeArtifacts({ cwd, receipt, workdir, execution }) {
  validateFixtureJob(receipt.jobId);
  await assertFixturePath(workdir, cwd);
  const file = path.join(cwd, ".forge", "runs", receipt.jobId, "fixture.json");
  await assertFixturePath(workdir, file);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    jobId: receipt.jobId, projectId: receipt.projectId,
    source: "fixture-agent", choiceDigest: receipt.choiceDigest,
    ...(execution ? { execution } : {}),
  }) + "\n");
  await writeFile(path.join(cwd, ".forge", "openbrain-queue.jsonl"), JSON.stringify({
    id: receipt.jobId, content: "Undelivered disposable fixture memory", type: "lesson",
  }) + "\n");
  await writeFile(path.join(cwd, "fixture.txt"), "Changed by the injected external agent runtime.\n");
}

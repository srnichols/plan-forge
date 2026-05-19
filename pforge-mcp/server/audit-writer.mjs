import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Write the drain result as a `.forge/audits/dev-<ts>.json` audit artifact.
 * Shape matches the blog's documented convention (ts, rounds, findingsByLane,
 * terminated, summary).
 *
 * @param {string} projectDir - Project directory
 * @param {{ rounds, terminated, summary }} drainResult - Result from runTemperingDrain
 * @param {object|null} sliceRef - Optional plan+slice context
 * @returns {string} Path to the written artifact (relative to projectDir)
 */
export function writeAuditArtifact(projectDir, drainResult, sliceRef) {
  const ts = Date.now();
  const auditsDir = resolve(projectDir, ".forge", "audits");
  mkdirSync(auditsDir, { recursive: true });
  const fileName = `dev-${ts}.json`;
  const filePath = resolve(auditsDir, fileName);

  const findingsByLane = { bug: 0, spec: 0, classifier: 0 };
  for (const round of drainResult.rounds || []) {
    if (round.findingCount) {
      findingsByLane.bug += round.realFindings || 0;
      findingsByLane.classifier += round.patterns || 0;
    }
  }

  const artifact = {
    ts: new Date(ts).toISOString(),
    rounds: drainResult.rounds || [],
    findingsByLane,
    terminated: drainResult.terminated,
    summary: drainResult.summary || {},
    sliceRef: sliceRef || null,
  };

  writeFileSync(filePath, JSON.stringify(artifact, null, 2));
  return `.forge/audits/${fileName}`;
}

import { lintGateCommands, computeLockHash, parsePlan } from "../pforge-mcp/orchestrator.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const p = process.argv[2];
const c0 = readFileSync(p, "utf8");
const c1 = c0.replace(/lockHash:\s*\S+/, "lockHash: PLACEHOLDER_LOCKHASH_TO_BE_COMPUTED");
writeFileSync(p, c1);
const pp = parsePlan(p);
const gated = pp.slices.filter(s => s.validationGate).length;
console.log("plan=" + p);
console.log("slices=" + pp.slices.length + " withGates=" + gated);
const r = lintGateCommands(p);
console.log("errors=" + r.errors.length + " warnings=" + r.warnings.length);
for (const e of r.errors) console.log("  ERROR S" + e.slice + " [" + (e.ruleId||e.rule) + "]: " + e.message);
for (const w of r.warnings) console.log("  warn  S" + w.slice + " [" + (w.ruleId||w.rule) + "]: " + w.message);
const c = readFileSync(p, "utf8");
const h = computeLockHash(c);
console.log("lockHash:", h);
if (c.includes("PLACEHOLDER_LOCKHASH_TO_BE_COMPUTED")) {
  const updated = c.replace("lockHash: PLACEHOLDER_LOCKHASH_TO_BE_COMPUTED", "lockHash: " + h);
  writeFileSync(p, updated);
  const round = computeLockHash(updated);
  console.log("post-substitute match=" + (h === round));
}

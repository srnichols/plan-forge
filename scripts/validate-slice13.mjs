import { readFileSync } from "node:fs";

const h = readFileSync("pforge-mcp/dashboard/index.html", "utf-8");
const j = readFileSync("pforge-mcp/dashboard/app.js", "utf-8");
const DQ = String.fromCharCode(34);

const ids = [
  "tab-innerloop",
  "il-summary-reviewer", "il-summary-skills", "il-summary-federation", "il-summary-autofix",
  "il-reviewer-body", "il-gate-suggestions-body", "il-cost-anomalies-body",
  "il-proposed-fixes-body", "il-federation-body",
];
const missingIds = ids.filter((id) => !h.includes(`id=${DQ}${id}${DQ}`));
const hookWired = j.includes("innerloop: loadInnerLoop");
const loaderDefined = j.includes("async function loadInnerLoop");
const panelTestIds = [
  "il-panel-reviewer", "il-panel-gate-suggestions", "il-panel-cost-anomalies",
  "il-panel-proposed-fixes", "il-panel-federation", "il-panel-help",
];
const missingPanels = panelTestIds.filter(
  (id) => !h.includes(`data-testid=${DQ}${id}${DQ}`)
);

if (missingIds.length || missingPanels.length || !hookWired || !loaderDefined) {
  console.error("FAIL", { missingIds, missingPanels, hookWired, loaderDefined });
  process.exit(1);
}
console.log(
  `OK — ${ids.length} IDs + ${panelTestIds.length} panel test-ids present, hook wired, loader defined`
);

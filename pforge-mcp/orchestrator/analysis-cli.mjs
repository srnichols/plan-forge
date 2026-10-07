/**
 * `node orchestrator.mjs --analyze | --diagnose` — the multi-model entry points
 * behind `pforge analyze --quorum` and `pforge diagnose`.
 *
 *   --analyze <plan-or-file> [--mode plan|file] [--models a,b] [--preset power|speed|...]
 *   --diagnose <file> [--models a,b] [--preset power|speed|...]
 *
 * The mode defaults the same way forge_analyze does (analyze-mode.mjs): Markdown
 * targets are plans, anything else is a source file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveAnalyzeMode } from "../analyze-mode.mjs";
import { QUORUM_PRESETS } from "./constants.mjs";
import { analyzeWithQuorum } from "./quorum.mjs";

const BANNER_WIDTH = 60;
const FOOTER_WIDTH = 40;
const MS_PER_SECOND = 1000;

const ANALYSIS_COMMANDS = Object.freeze({
  analyze: Object.freeze({
    usage: "Usage: node orchestrator.mjs --analyze <plan-or-file> [--mode plan|file] [--models model1,model2,...] [--preset <name>]",
    title: "QUORUM ANALYSIS — SYNTHESIZED REPORT",
    errorLabel: "Analysis error",
    reportName: (target) => basename(target, ".md"),
  }),
  diagnose: Object.freeze({
    usage: "Usage: node orchestrator.mjs --diagnose <file> [--models model1,model2,...] [--preset <name>]",
    title: "QUORUM DIAGNOSIS — BUG INVESTIGATION REPORT",
    errorLabel: "Diagnosis error",
    reportName: (target) => `diagnose-${basename(target)}`,
  }),
});

/**
 * @param {string[]} args - orchestrator argv (after `node orchestrator.mjs`)
 * @param {"analyze"|"diagnose"} command
 * @returns {{ target: string, mode: string, models: string[]|null, preset: string|null } | { error: string }}
 */
export function parseAnalysisCliArgs(args, command) {
  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  const target = getArg(`--${command}`);
  if (!target) return { error: ANALYSIS_COMMANDS[command].usage };

  const preset = getArg("--preset");
  if (preset && !Object.hasOwn(QUORUM_PRESETS, preset)) {
    return { error: `Unknown quorum preset "${preset}". Valid: ${Object.keys(QUORUM_PRESETS).join(", ")}` };
  }
  const modelsArg = getArg("--models");
  // Commas or whitespace: a PowerShell array argument ("m1,m2" unquoted) can arrive space-joined.
  const models = modelsArg ? modelsArg.split(/[\s,]+/).filter(Boolean) : null;

  if (command === "diagnose") return { target, mode: "diagnose", models, preset };
  const resolved = resolveAnalyzeMode({ plan: target, mode: getArg("--mode") });
  if (resolved.error) return { error: resolved.error };
  return { target, mode: resolved.mode, models, preset };
}

function printReport(title, result) {
  if (result.synthesis) {
    console.log("\n" + "═".repeat(BANNER_WIDTH));
    console.log(`  ${title}`);
    console.log("═".repeat(BANNER_WIDTH) + "\n");
    console.log(result.synthesis);
  }
  console.log("\n" + "─".repeat(FOOTER_WIDTH));
  console.log(`  Models: ${result.models.join(", ")}`);
  console.log(`  Duration: ${Math.round(result.totalDuration / MS_PER_SECOND)}s`);
  console.log(`  Cost: $${result.totalCost.toFixed(2)}`);
  console.log("─".repeat(FOOTER_WIDTH));
}

function saveReport(cwd, name, result) {
  const reportDir = resolve(cwd, ".forge", "analysis");
  mkdirSync(reportDir, { recursive: true });
  const reportFile = resolve(reportDir, `${name}-${Date.now()}.json`);
  writeFileSync(reportFile, JSON.stringify(result, null, 2));
  return reportFile;
}

/**
 * Run `--analyze` or `--diagnose`; sets process.exitCode (0 on success, 1 on bad input or failure).
 * @param {string[]} args
 * @param {"analyze"|"diagnose"} command
 * @param {{ cwd?: string, analyze?: typeof analyzeWithQuorum }} [deps]
 */
export async function runAnalysisCli(args, command, { cwd = process.cwd(), analyze = analyzeWithQuorum } = {}) {
  const spec = ANALYSIS_COMMANDS[command];
  const parsed = parseAnalysisCliArgs(args, command);
  if (parsed.error) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await analyze({ ...parsed, cwd });
    printReport(spec.title, result);
    const reportFile = saveReport(cwd, spec.reportName(parsed.target), result);
    console.log(`\n  📄 Full report saved: ${reportFile}\n`);
    process.exitCode = 0;
  } catch (err) {
    console.error(`${spec.errorLabel}: ${err.message}`);
    process.exitCode = 1;
  }
}

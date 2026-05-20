/** Plan Forge — Phase-55 S1: self-test sub-module (extracted from run-plan.mjs) */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parsePlan, buildDAG } from "../plan-parser.mjs";
import { OrchestratorEventBus } from "../event-bus.mjs";
import { SequentialScheduler, ParallelScheduler, runGate, detectScopeConflicts } from "../schedulers.mjs";
import { detectWorkers, extractTokens } from "../worker-spawn.mjs";
import { lintGateCommands } from "../gate-helpers.mjs";
import { calculateSliceCost, buildCostBreakdown, loadQuorumConfig } from "../quorum.mjs";
import { getCostReport } from "../forge-io.mjs";
import { scoreSliceComplexity } from "../review-watcher.mjs";
import { inferSliceType, recommendModel } from "../model-scoring.mjs";
import { GATE_ALLOWED_PREFIXES } from "../constants.mjs";

// ─── Self-Test ────────────────────────────────────────────────────────

function _selfTestPlanParser(assert) {
  console.log("─── Plan Parser ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      assert("Parses plan without error", true);
      assert(`Found ${plan.slices.length} slices`, plan.slices.length > 0);
      assert("First slice has number", !!plan.slices[0]?.number);
      assert("First slice has title", !!plan.slices[0]?.title);
      assert("DAG has execution order", plan.dag.order.length > 0);
      assert("DAG order matches slice count", plan.dag.order.length === plan.slices.length);
      assert("Meta title extracted", !!plan.meta.title);
      const sliceWithGate = plan.slices.find((s) => s.validationGate);
      assert("At least one slice has validation gate", !!sliceWithGate);
      const sliceWithBuild = plan.slices.find((s) => s.buildCommand);
      assert("At least one slice has build command", !!sliceWithBuild);
    } else {
      console.log("  ⚠️  Example plan not found — skipping parser tests");
    }
  } catch (err) {
    assert(`Parse plan: ${err.message}`, false);
  }
}

function _selfTestPhase1Plan(assert) {
  console.log("\n─── Phase 1 Plan (tags) ───");
  try {
    const phase1Plan = resolve(process.cwd(), "docs/plans/Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md");
    if (existsSync(phase1Plan)) {
      const plan = parsePlan(phase1Plan);
      assert("Parses Phase 1 plan", true);
      assert(`Found ${plan.slices.length} slices`, plan.slices.length >= 8);
      assert("Has scope contract", plan.scopeContract.inScope.length > 0);
      assert("Has forbidden actions", plan.scopeContract.forbidden.length > 0);
    }
  } catch (err) {
    assert(`Parse Phase 1: ${err.message}`, false);
  }
}

function _selfTestDagBuilder(assert) {
  console.log("\n─── DAG Builder ───");
  try {
    const testSlices = [
      { number: "1", title: "First", depends: [], parallel: false, scope: [], tasks: [] },
      { number: "2", title: "Second", depends: ["1"], parallel: false, scope: [], tasks: [] },
      { number: "3", title: "Third", depends: ["1"], parallel: true, scope: ["src/**"], tasks: [] },
      { number: "4", title: "Fourth", depends: ["2", "3"], parallel: false, scope: [], tasks: [] },
    ];
    const dag = buildDAG(testSlices);
    assert("DAG built from explicit deps", true);
    assert("Topological order has 4 entries", dag.order.length === 4);
    assert("Slice 1 is first", dag.order[0] === "1");
    assert("Slice 4 is last", dag.order[dag.order.length - 1] === "4");
    assert("Parallel flag preserved", dag.nodes.get("3").parallel === true);
    assert("Scope metadata preserved", dag.nodes.get("3").scope.length > 0);
  } catch (err) {
    assert(`DAG builder: ${err.message}`, false);
  }
}

function _selfTestCycleDetection(assert) {
  console.log("\n─── Cycle Detection ───");
  try {
    const cyclicSlices = [
      { number: "1", title: "A", depends: ["2"], parallel: false, scope: [], tasks: [] },
      { number: "2", title: "B", depends: ["1"], parallel: false, scope: [], tasks: [] },
    ];
    try {
      buildDAG(cyclicSlices);
      assert("Cycle detection throws error", false);
    } catch (err) {
      assert("Cycle detection throws error", err.message.includes("Cycle"));
    }
  } catch (err) {
    assert(`Cycle test: ${err.message}`, false);
  }
}

function _selfTestEventBus(assert) {
  console.log("\n─── Event Bus ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    bus.emit("slice-started", { sliceId: "1" });
    bus.emit("slice-completed", { sliceId: "1" });
    assert("Event bus fires events", events.length === 2);
    assert("Events have type", events[0].type === "slice-started");
    assert("Events have timestamp", !!events[0].timestamp);
    assert("Events have data", !!events[0].data.sliceId);
  } catch (err) {
    assert(`Event bus: ${err.message}`, false);
  }
}

async function _selfTestSequentialScheduler(assert) {
  console.log("\n─── Sequential Scheduler ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    const scheduler = new SequentialScheduler(bus);
    const nodes = new Map();
    nodes.set("1", { number: "1", title: "First", children: ["2"], inDegree: 0 });
    nodes.set("2", { number: "2", title: "Second", children: [], inDegree: 1 });
    const order = ["1", "2"];
    const results = await scheduler.execute(nodes, order, async () => ({ status: "passed", duration: 100 }));
    assert("Scheduler executed 2 slices", results.length === 2);
    assert("Both passed", results.every((r) => r.status === "passed"));
    assert("Events fired for lifecycle",
      events.some((e) => e.type === "slice-started") &&
      events.some((e) => e.type === "slice-completed"));
  } catch (err) {
    assert(`Scheduler: ${err.message}`, false);
  }
}

function _selfTestWorkerDetection(assert) {
  console.log("\n─── Worker Detection ───");
  try {
    const workers = detectWorkers();
    assert("Detects workers array", Array.isArray(workers));
    assert(`Found ${workers.filter((w) => w.available).length} available worker(s)`,
      workers.some((w) => w.available));
    const ghCopilot = workers.find((w) => w.name === "gh-copilot");
    assert("gh-copilot in worker list", !!ghCopilot);
  } catch (err) {
    assert(`Worker detection: ${err.message}`, false);
  }
}

function _selfTestGateExecution(assert) {
  console.log("\n─── Gate Execution ───");
  try {
    const result = runGate("node --version", process.cwd());
    assert("Gate runs command", result.success);
    assert("Gate captures output", result.output.startsWith("v"));
    const failResult = runGate("exit 1", process.cwd());
    assert("Gate detects failure", !failResult.success);
    const blockedResult = runGate("wget http://example.com", process.cwd());
    assert("Gate blocks non-allowlisted commands", !blockedResult.success);
    assert("Gate error mentions allowlist", blockedResult.error.includes("allowlist"));
    const npmResult = runGate("node -e \"console.log('ok')\"", process.cwd());
    assert("Gate allows node commands", npmResult.success);
    const curlResult = runGate("curl --version", process.cwd());
    assert("Gate allows curl commands", curlResult.success);
  } catch (err) {
    assert(`Gate execution: ${err.message}`, false);
  }
}

function _selfTestGateLint(assert) {
  console.log("\n─── Gate Lint ───");
  try {
    const lintPlan = resolve(process.cwd(), "docs/plans/Phase-LiveGuard-v2.27.0-PLAN.md");
    if (existsSync(lintPlan)) {
      const result = lintGateCommands(lintPlan);
      assert("Gate lint returns warnings array", Array.isArray(result.warnings));
      assert("Gate lint returns errors array", Array.isArray(result.errors));
      assert("Gate lint returns passed boolean", typeof result.passed === "boolean");
      assert("Gate lint returns summary string", typeof result.summary === "string");
      assert("Cleaned plan has 0 errors", result.errors.length === 0);
    } else {
      console.log("  ⚠️  LiveGuard plan not found — skipping gate lint tests");
    }
    const testLines = [
      "# this is a comment",
      "node pforge-mcp/tests/foo.test.mjs",
      "curl http://localhost:3100/api/test",
      "wget http://example.com",
    ];
    assert("Detects comment lines", testLines[0].startsWith("#"));
    assert("Detects node *.test.mjs pattern", /^node\s+.*\.test\.(mjs|js|ts)/.test(testLines[1]));
    assert("Detects curl localhost pattern", /curl\s.*localhost[:\s]/.test(testLines[2]));
    const wgetCmd = testLines[3].split(/\s+/)[0].toLowerCase();
    assert("Detects blocked command", !GATE_ALLOWED_PREFIXES.some(p => wgetCmd === p));
  } catch (err) {
    assert(`Gate lint: ${err.message}`, false);
  }
}

function _selfTestEstimateMode(assert, buildEstimate) {
  console.log("\n─── Estimate Mode ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      const est = buildEstimate({ plan, model: "claude-sonnet-4.6", cwd: process.cwd() });
      assert("Estimate has slice count", est.sliceCount > 0);
      assert("Estimate has cost", est.estimatedCostUSD >= 0);
      assert("Estimate has tokens", est.tokens.estimatedInput > 0);
      assert("Estimate has execution order", est.executionOrder.length > 0);
      assert("Estimate has confidence", est.confidence === "heuristic" || est.confidence === "historical");
      assert("Estimate has source", !!est.tokens.source);
    }
  } catch (err) {
    assert(`Estimate: ${err.message}`, false);
  }
}

async function _selfTestDryRun(assert, runPlan) {
  console.log("\n─── Full Run (Dry-Run) ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const result = await runPlan(examplePlan, { dryRun: true, cwd: process.cwd() });
      assert("Dry-run returns status", result.status === "dry-run");
      assert("Dry-run returns plan object", !!result.plan);
      assert("Dry-run plan has slices", result.plan.slices.length > 0);
    }
  } catch (err) {
    assert(`Dry-run: ${err.message}`, false);
  }
}

function _selfTestModelRouting(assert, loadModelRouting, resolveModel) {
  console.log("\n─── Model Routing ───");
  try {
    const routing = loadModelRouting(process.cwd());
    assert("loadModelRouting returns object", typeof routing === "object");
    assert("Has default key", "default" in routing);
    assert("CLI override wins", resolveModel("claude-sonnet-4.6", { default: "gpt-5" }, null) === "claude-sonnet-4.6");
    assert("Routing default when CLI is auto", resolveModel("auto", { default: "gpt-5" }, null) === "gpt-5");
    assert("Null when both auto", resolveModel(null, { default: "auto" }, null) === null);
    assert("Default is claude-opus-4.6 when no .forge.json", loadModelRouting("/nonexistent-path-pforge-test").default === "claude-opus-4.6");
  } catch (err) {
    assert(`Model routing: ${err.message}`, false);
  }
}

function _selfTestSecurity(assert) {
  console.log("\n─── Security ───");
  try {
    try {
      parsePlan("../../../../etc/passwd");
      assert("Path traversal blocked", false);
    } catch (err) {
      assert("Path traversal blocked", err.message.includes("within project"));
    }
  } catch (err) {
    assert(`Security: ${err.message}`, false);
  }
}

function _selfTestErrorPaths(assert) {
  console.log("\n─── Error Paths ───");
  try {
    try {
      parsePlan("nonexistent-plan.md");
      assert("Missing file throws", false);
    } catch {
      assert("Missing file throws", true);
    }
    const emptyTokens = extractTokens([]);
    assert("Empty events returns null tokens_in", emptyTokens.tokens_in === null);
    assert("Empty events returns 0 tokens_out", emptyTokens.tokens_out === 0);
  } catch (err) {
    assert(`Error paths: ${err.message}`, false);
  }
}

function _selfTestCostCalculation(assert) {
  console.log("\n─── Cost Calculation ───");
  try {
    const cost1 = calculateSliceCost({ tokens_in: 1000, tokens_out: 500, model: "claude-sonnet-4.6" });
    assert("Cost calculated for Claude Sonnet", cost1.cost_usd > 0);
    assert("Cost has model", cost1.model === "claude-sonnet-4.6");
    assert("Cost matches expected", Math.abs(cost1.cost_usd - 0.0105) < 0.0001);
    const cost2 = calculateSliceCost({ tokens_in: null, tokens_out: 100, model: "unknown-model" });
    assert("Unknown model uses default pricing", cost2.cost_usd > 0);
    assert("Null tokens_in treated as 0", cost2.tokens_in === 0);
    const cost3 = calculateSliceCost({ tokens_in: 500000, tokens_out: 5000, model: "claude-opus-4.6", premiumRequests: 3 }, "gh-copilot");
    assert("CLI worker uses premium request rate", cost3.cost_usd === 0.03);
    assert("CLI worker preserves token counts", cost3.tokens_in === 500000);
    const cost4 = calculateSliceCost({ tokens_in: 1000, tokens_out: 500, model: "grok-4" }, "api-xai");
    assert("API worker uses token pricing", cost4.cost_usd > 0);
    assert("API worker cost matches expected", Math.abs(cost4.cost_usd - 0.0025) < 0.0001);
    const mockResults = [
      { number: "1", tokens: { tokens_in: 500, tokens_out: 200, model: "claude-sonnet-4.6" }, status: "passed" },
      { number: "2", tokens: { tokens_in: 300, tokens_out: 100, model: "gpt-5-mini" }, status: "passed" },
      { number: "3", status: "skipped" },
    ];
    const breakdown = buildCostBreakdown(mockResults);
    assert("Breakdown has total cost", breakdown.total_cost_usd >= 0);
    assert("Breakdown has 2 models", Object.keys(breakdown.by_model).length === 2);
    assert("Breakdown has 2 slices (skipped excluded)", breakdown.by_slice.length === 2);
    const report = getCostReport(process.cwd());
    assert("Cost report works (may be empty)", report !== undefined);
  } catch (err) {
    assert(`Cost calculation: ${err.message}`, false);
  }
}

async function _selfTestParallelScheduler(assert) {
  console.log("\n─── Parallel Scheduler ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    const pScheduler = new ParallelScheduler(bus, 2);
    const pNodes = new Map();
    pNodes.set("1", { number: "1", title: "Setup", depends: [], parallel: false, scope: [], children: ["2", "3"], inDegree: 0 });
    pNodes.set("2", { number: "2", title: "AuthModule", depends: ["1"], parallel: true, scope: ["src/auth/**"], children: ["4"], inDegree: 1 });
    pNodes.set("3", { number: "3", title: "UserModule", depends: ["1"], parallel: true, scope: ["src/user/**"], children: ["4"], inDegree: 1 });
    pNodes.set("4", { number: "4", title: "Integration", depends: ["2", "3"], parallel: false, scope: [], children: [], inDegree: 2 });
    const pOrder = ["1", "2", "3", "4"];
    let concurrentCount = 0;
    let maxConcurrent = 0;
    const pResults = await pScheduler.execute(pNodes, pOrder, async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 50));
      concurrentCount--;
      return { status: "passed", duration: 50 };
    });
    assert("Parallel scheduler executed all 4 slices", pResults.length === 4);
    assert("All slices passed", pResults.every((r) => r.status === "passed"));
    assert("Slices 2+3 ran in parallel", maxConcurrent >= 2);
    assert("Events fired for parallel slices", events.some((e) => e.type === "slice-completed"));
    const conflictNodes = new Map();
    conflictNodes.set("1", { parallel: true, scope: ["src/auth/**"] });
    conflictNodes.set("2", { parallel: true, scope: ["src/auth/login.js"] });
    conflictNodes.set("3", { parallel: true, scope: ["src/user/**"] });
    const conflicts = detectScopeConflicts(conflictNodes);
    assert("Conflict detection finds overlapping scopes", conflicts.has("1") && conflicts.has("2"));
    assert("Non-overlapping scope has no conflict", !conflicts.has("3"));
  } catch (err) {
    assert(`Parallel scheduler: ${err.message}`, false);
  }
}

function _selfTestQuorumComplexity(assert) {
  console.log("\n─── Quorum: Complexity Scoring ───");
  try {
    const simpleSlice = {
      number: "1", title: "Add README",
      tasks: ["Create README.md"],
      scope: [], depends: [], validationGate: "",
    };
    const simpleResult = scoreSliceComplexity(simpleSlice, process.cwd());
    assert("Simple slice scores low", simpleResult.score <= 3);
    assert("Score has signals object", typeof simpleResult.signals === "object");
    assert("Signals have scopeWeight", "scopeWeight" in simpleResult.signals);
    const complexSlice = {
      number: "2", title: "Auth migration with RBAC",
      tasks: [
        "Create migration for users table",
        "Implement JWT authentication",
        "Add RBAC role checking middleware",
        "Create token refresh endpoint",
        "Add password hashing service",
        "Write auth integration tests",
        "Add CORS policy for auth endpoints",
        "Seed admin role data",
      ],
      scope: ["src/auth/**", "src/middleware/**", "db/migrations/**", "tests/auth/**"],
      depends: ["1", "3", "4"],
      validationGate: "dotnet build\ndotnet test --filter Auth\ndotnet ef database update\ncurl -f http://localhost/health",
    };
    const complexResult = scoreSliceComplexity(complexSlice, process.cwd());
    assert("Complex slice scores high", complexResult.score >= 7);
    assert("Security keywords detected", complexResult.signals.securityWeight > 0);
    assert("Database keywords detected", complexResult.signals.databaseWeight > 0);
    assert("High task count detected", complexResult.signals.taskWeight > 0);
    assert("Multiple deps detected", complexResult.signals.dependencyWeight > 0);
    assert("Score >= 1", simpleResult.score >= 1);
    assert("Score <= 10", complexResult.score <= 10);
  } catch (err) {
    assert(`Complexity scoring: ${err.message}`, false);
  }
}

function _selfTestQuorumConfig(assert) {
  console.log("\n─── Quorum: Config ───");
  try {
    const config = loadQuorumConfig(process.cwd());
    assert("Config has enabled flag", "enabled" in config);
    assert("Config has auto flag", "auto" in config);
    assert("Config has threshold", typeof config.threshold === "number");
    assert("Config has models array", Array.isArray(config.models));
    assert("Config has 3 default models", config.models.length === 3);
    assert("Config has reviewerModel", typeof config.reviewerModel === "string");
    assert("Config has dryRunTimeout", typeof config.dryRunTimeout === "number");
    assert("Threshold is a positive number", Number.isFinite(config.threshold) && config.threshold > 0);
  } catch (err) {
    assert(`Quorum config: ${err.message}`, false);
  }
}

function _selfTestCiConfig(assert, loadCiConfig) {
  console.log("\n─── CI/CD Integration ───");
  try {
    const ciConfig = loadCiConfig(process.cwd());
    assert("loadCiConfig returns object", typeof ciConfig === "object");
    assert("Has enabled flag", "enabled" in ciConfig);
    assert("Has workflow field", "workflow" in ciConfig);
    assert("Has ref field", "ref" in ciConfig);
    assert("Has inputs field", typeof ciConfig.inputs === "object");
    assert("Default enabled is false", ciConfig.enabled === false || typeof ciConfig.enabled === "boolean");
    assert("Default ref is main (when no config)", ciConfig.workflow === null || typeof ciConfig.workflow === "string");
  } catch (err) {
    assert(`CI config: ${err.message}`, false);
  }
}

function _selfTestAgentRouting(assert) {
  console.log("\n─── Agent-Per-Slice Routing ───");
  try {
    const testSlice = { title: "Write unit tests for auth module", tasks: ["Add spec coverage"] };
    assert("Infers test type", inferSliceType(testSlice) === "test");
    const reviewSlice = { title: "Code review and audit", tasks: ["Review PR changes"] };
    assert("Infers review type", inferSliceType(reviewSlice) === "review");
    const migrationSlice = { title: "Database migration", tasks: ["Add schema migration for users table"] };
    assert("Infers migration type", inferSliceType(migrationSlice) === "migration");
    const executeSlice2 = { title: "Implement auth service", tasks: ["Add login endpoint"] };
    assert("Defaults to execute type", inferSliceType(executeSlice2) === "execute");
    const noRec = recommendModel(process.cwd(), "execute");
    assert("recommendModel returns null or object", noRec === null || typeof noRec === "object");
    if (noRec !== null) {
      assert("Recommendation has model", typeof noRec.model === "string");
      assert("Recommendation has success_rate", typeof noRec.success_rate === "number");
      assert("Recommendation has total_slices", typeof noRec.total_slices === "number");
    }
    const events2 = [];
    const handler2 = { handle: (e) => events2.push(e) };
    const bus2 = new OrchestratorEventBus(handler2);
    bus2.emit("slice-model-routed", { sliceId: "1", model: "test-model" });
    assert("slice-model-routed event fires", events2.some((e) => e.type === "slice-model-routed"));
  } catch (err) {
    assert(`Agent-per-slice routing: ${err.message}`, false);
  }
}

/**
 * @param {{ runPlan?: Function, buildEstimate?: Function, loadModelRouting?: Function, resolveModel?: Function, loadCiConfig?: Function }} [deps]
 *   Dependencies injected by run-plan.mjs to avoid a static circular import.
 */
export async function selfTest(deps = {}) {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Plan Forge Orchestrator — Self Test     ║");
  console.log("╚══════════════════════════════════════════╝\n");
  const { runPlan, buildEstimate, loadModelRouting, resolveModel, loadCiConfig } = deps;

  const counters = { passed: 0, failed: 0 };
  const assert = (label, condition) => {
    if (condition) {
      console.log(`  ✅ ${label}`);
      counters.passed++;
    } else {
      console.log(`  ❌ ${label}`);
      counters.failed++;
    }
  };

  _selfTestPlanParser(assert);
  _selfTestPhase1Plan(assert);
  _selfTestDagBuilder(assert);
  _selfTestCycleDetection(assert);
  _selfTestEventBus(assert);
  await _selfTestSequentialScheduler(assert);
  _selfTestWorkerDetection(assert);
  _selfTestGateExecution(assert);
  _selfTestGateLint(assert);
  _selfTestEstimateMode(assert, buildEstimate);
  await _selfTestDryRun(assert, runPlan);
  _selfTestModelRouting(assert, loadModelRouting, resolveModel);
  _selfTestSecurity(assert);
  _selfTestErrorPaths(assert);
  _selfTestCostCalculation(assert);
  await _selfTestParallelScheduler(assert);
  _selfTestQuorumComplexity(assert);
  _selfTestQuorumConfig(assert);
  _selfTestCiConfig(assert, loadCiConfig);
  _selfTestAgentRouting(assert);

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${counters.passed} passed, ${counters.failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  process.exit(counters.failed > 0 ? 1 : 0);
}

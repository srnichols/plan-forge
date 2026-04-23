/**
 * Plan Forge — Forge-Master Plan Executor (Phase-38.4, Slice 2).
 *
 * Executes a plan produced by the planner module. Steps are grouped
 * into topological batches — steps with no pending dependencies run
 * in parallel via `Promise.all`; steps with `dependsOn` wait until
 * all named predecessors complete.
 *
 * A hard 30 000 ms timeout cancels remaining steps.
 * A single step failure does NOT abort independent branches — only
 * dependent steps are short-circuited with an error marker.
 *
 * Exports:
 *   - executePlan(plan, deps) → { results, totalDurationMs }
 *   - TIMEOUT_MS — hard timeout constant (30 000)
 *   - topoSort(steps) → string[][] — topological batch grouping
 *
 * @module forge-master/plan-executor
 */

// ─── Constants ──────────────────────────────────────────────────────

/** Hard timeout for the entire plan execution. */
export const TIMEOUT_MS = 30_000;

// ─── Topological sort ───────────────────────────────────────────────

/**
 * Group steps into topological batches using Kahn's algorithm.
 * Each batch is a list of step IDs whose dependencies are satisfied
 * by all preceding batches.
 *
 * @param {import("./planner.mjs").PlanStep[]} steps
 * @returns {string[][]} Ordered batches of step IDs.
 * @throws {Error} If a dependency cycle is detected.
 */
export function topoSort(steps) {
  const ids = new Set(steps.map((s) => s.id));
  const inDegree = new Map();
  const dependents = new Map(); // parent → children

  for (const s of steps) {
    inDegree.set(s.id, 0);
    dependents.set(s.id, []);
  }

  for (const s of steps) {
    if (!s.dependsOn) continue;
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) continue; // skip unknown refs
      inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      dependents.get(dep).push(s.id);
    }
  }

  const batches = [];
  const remaining = new Set(ids);

  while (remaining.size > 0) {
    const batch = [];
    for (const id of remaining) {
      if (inDegree.get(id) === 0) batch.push(id);
    }

    if (batch.length === 0) {
      throw new Error("Dependency cycle detected among steps: " +
        [...remaining].join(", "));
    }

    batches.push(batch);
    for (const id of batch) {
      remaining.delete(id);
      for (const child of dependents.get(id)) {
        inDegree.set(child, inDegree.get(child) - 1);
      }
    }
  }

  return batches;
}

// ─── Executor ───────────────────────────────────────────────────────

/**
 * Execute a plan's steps respecting dependency order, parallelism,
 * error isolation, and a hard timeout.
 *
 * @param {{ steps: import("./planner.mjs").PlanStep[] }} plan
 * @param {{
 *   dispatch: (step: import("./planner.mjs").PlanStep, priorResults: Map<string, any>) => Promise<any>,
 * }} deps
 * @returns {Promise<{
 *   results: Array<{ step: import("./planner.mjs").PlanStep, output: any, error?: string }>,
 *   totalDurationMs: number,
 * }>}
 */
export async function executePlan(plan, deps) {
  const t0 = Date.now();

  if (!plan?.steps?.length) {
    return { results: [], totalDurationMs: Date.now() - t0 };
  }

  const stepMap = new Map(plan.steps.map((s) => [s.id, s]));
  const resultMap = new Map();   // stepId → { step, output, error? }
  const outputMap = new Map();   // stepId → raw output (for injection)

  let batches;
  try {
    batches = topoSort(plan.steps);
  } catch (err) {
    // Cycle → mark all steps as errored
    const results = plan.steps.map((step) => ({
      step,
      output: null,
      error: err.message,
    }));
    return { results, totalDurationMs: Date.now() - t0 };
  }

  let timedOut = false;

  for (const batch of batches) {
    if (timedOut) {
      for (const id of batch) {
        const step = stepMap.get(id);
        resultMap.set(id, { step, output: null, error: "timeout" });
      }
      continue;
    }

    const elapsed = Date.now() - t0;
    const remaining = TIMEOUT_MS - elapsed;

    if (remaining <= 0) {
      timedOut = true;
      for (const id of batch) {
        const step = stepMap.get(id);
        resultMap.set(id, { step, output: null, error: "timeout" });
      }
      continue;
    }

    const batchPromises = batch.map(async (id) => {
      const step = stepMap.get(id);

      // Check if any dependency failed — short-circuit
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          const depResult = resultMap.get(dep);
          if (depResult?.error) {
            resultMap.set(id, {
              step,
              output: null,
              error: `dependency-failed: ${dep}`,
            });
            return;
          }
        }
      }

      try {
        const output = await deps.dispatch(step, outputMap);
        resultMap.set(id, { step, output });
        outputMap.set(id, output);
      } catch (err) {
        resultMap.set(id, {
          step,
          output: null,
          error: err.message || String(err),
        });
      }
    });

    // Race the batch against the remaining timeout
    const timeoutSentinel = Symbol("timeout");
    const timer = new Promise((resolve) =>
      setTimeout(() => resolve(timeoutSentinel), remaining),
    );

    const raceResult = await Promise.race([
      Promise.all(batchPromises).then(() => "done"),
      timer,
    ]);

    if (raceResult === timeoutSentinel) {
      timedOut = true;
      // Mark any steps in this batch without results as timed out
      for (const id of batch) {
        if (!resultMap.has(id)) {
          const step = stepMap.get(id);
          resultMap.set(id, { step, output: null, error: "timeout" });
        }
      }
    }
  }

  // Mark any remaining steps (from subsequent batches after timeout)
  for (const step of plan.steps) {
    if (!resultMap.has(step.id)) {
      resultMap.set(step.id, { step, output: null, error: "timeout" });
    }
  }

  // Preserve original step order
  const results = plan.steps.map((s) => resultMap.get(s.id));
  const totalDurationMs = Date.now() - t0;

  return { results, totalDurationMs };
}

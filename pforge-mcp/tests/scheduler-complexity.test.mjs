// Phase CRUCIBLE-02 Slice 02.1 — scheduler emits complexityScore on slice events
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { SequentialScheduler, ParallelScheduler } from "../orchestrator.mjs";

function collect(bus, type) {
  const out = [];
  bus.on(type, (data) => out.push(data));
  return out;
}

describe("Slice event payload carries complexityScore (CRUCIBLE-02 Slice 02.1)", () => {
  it("SequentialScheduler emits complexityScore on slice-started and slice-completed", async () => {
    const bus = new EventEmitter();
    const started = collect(bus, "slice-started");
    const completed = collect(bus, "slice-completed");

    const nodes = new Map([
      ["1", { id: "1", title: "first", status: "pending", complexityScore: 4 }],
      ["2", { id: "2", title: "second", status: "pending", complexityScore: 8 }],
    ]);

    const scheduler = new SequentialScheduler(bus);
    await scheduler.execute(nodes, ["1", "2"], async () => ({ status: "passed", duration: 1 }));

    expect(started).toHaveLength(2);
    expect(started[0]).toMatchObject({ sliceId: "1", complexityScore: 4 });
    expect(started[1]).toMatchObject({ sliceId: "2", complexityScore: 8 });

    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({ sliceId: "1", complexityScore: 4, status: "passed" });
    expect(completed[1]).toMatchObject({ sliceId: "2", complexityScore: 8, status: "passed" });
  });

  it("SequentialScheduler emits complexityScore on slice-failed", async () => {
    const bus = new EventEmitter();
    const failed = collect(bus, "slice-failed");

    const nodes = new Map([
      ["1", { id: "1", title: "boom", status: "pending", complexityScore: 9 }],
    ]);

    const scheduler = new SequentialScheduler(bus);
    await scheduler.execute(nodes, ["1"], async () => ({ status: "failed", error: "nope" }));

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ sliceId: "1", complexityScore: 9, status: "failed" });
  });

  it("ParallelScheduler emits complexityScore on slice events in single-path mode", async () => {
    const bus = new EventEmitter();
    const started = collect(bus, "slice-started");
    const completed = collect(bus, "slice-completed");

    // Non-parallel slice forces the single-execution branch of ParallelScheduler
    const nodes = new Map([
      ["1", { id: "1", title: "s1", status: "pending", complexityScore: 3, parallel: false, depends: [] }],
    ]);

    const scheduler = new ParallelScheduler(bus, 2);
    await scheduler.execute(nodes, ["1"], async () => ({ status: "passed", duration: 1 }));

    expect(started.some((e) => e.sliceId === "1" && e.complexityScore === 3)).toBe(true);
    expect(completed.some((e) => e.sliceId === "1" && e.complexityScore === 3)).toBe(true);
  });

  it("slice-started emits complexityScore as undefined when slice has no score", async () => {
    const bus = new EventEmitter();
    const started = collect(bus, "slice-started");

    const nodes = new Map([
      ["1", { id: "1", title: "no-score", status: "pending" }],
    ]);

    const scheduler = new SequentialScheduler(bus);
    await scheduler.execute(nodes, ["1"], async () => ({ status: "passed" }));

    expect(started).toHaveLength(1);
    expect(started[0].sliceId).toBe("1");
    expect(started[0].complexityScore).toBeUndefined();
  });
});

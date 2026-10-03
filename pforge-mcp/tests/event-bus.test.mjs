import { describe, it, expect, vi } from "vitest";
import { OrchestratorEventBus } from "../orchestrator/event-bus.mjs";

const recordingHandler = () => ({ handle: vi.fn() });

describe("OrchestratorEventBus", () => {
  it("forwards events that were never on the old fixed list", () => {
    const handler = recordingHandler();
    const bus = new OrchestratorEventBus(handler);
    for (const type of ["run-isolation-started", "copilot-models-discovered", "scheduler-deadlock", "slice-scope-escape"]) {
      bus.emit(type, { marker: type });
    }
    expect(handler.handle.mock.calls.map(([event]) => event.type)).toEqual([
      "run-isolation-started", "copilot-models-discovered", "scheduler-deadlock", "slice-scope-escape",
    ]);
  });

  it("forwards each event exactly once, with its data and a timestamp", () => {
    const handler = recordingHandler();
    const bus = new OrchestratorEventBus(handler);
    bus.emit("slice-started", { sliceId: "1" });
    expect(handler.handle).toHaveBeenCalledTimes(1);
    const [event] = handler.handle.mock.calls[0];
    expect(event).toMatchObject({ type: "slice-started", data: { sliceId: "1" } });
    expect(Date.parse(event.timestamp)).not.toBeNaN();
  });

  it("still delivers events to ordinary listeners", () => {
    const bus = new OrchestratorEventBus(recordingHandler());
    const listener = vi.fn();
    bus.on("slice-completed", listener);
    expect(bus.emit("slice-completed", { sliceId: "2" })).toBe(true);
    expect(listener).toHaveBeenCalledWith({ sliceId: "2" });
  });

  it("does not let a failing handler break the emit", () => {
    const bus = new OrchestratorEventBus({ handle: () => { throw new Error("hub down"); } });
    const listener = vi.fn();
    bus.on("run-started", listener);
    expect(() => bus.emit("run-started", {})).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("defaults to a log handler that writes nowhere", () => {
    const bus = new OrchestratorEventBus();
    expect(() => bus.emit("run-started", { plan: "p" })).not.toThrow();
    expect(bus.handler.events).toHaveLength(1);
  });
});

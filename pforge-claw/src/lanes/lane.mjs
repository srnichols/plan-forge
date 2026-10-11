import { LANE_EVENT_TYPES, LANE_KINDS } from "../enums.mjs";
import { ClawError } from "../errors.mjs";

/**
 * @typedef {object} LaneEvent
 * @property {1} v
 * @property {string} jobId
 * @property {number} seq
 * @property {string} ts
 * @property {string} type
 * @property {object} data
 */

/**
 * @typedef {object} Lane
 * @property {string} id
 * @property {"local"|"remote"|"k8s"} kind
 * @property {object} capabilities
 * @property {(job: object) => AsyncIterable<LaneEvent>} submit
 * @property {(jobId: string) => Promise<object>} cancel
 * @property {() => object} health
 */

export const LANE_EVENT_VERSION = 1;

export function createLaneEvent({ jobId, seq, type, data = {}, now = Date.now }) {
  if (!LANE_EVENT_TYPES.includes(type)) {
    throw new ClawError("LANE_BAD_EVENT", { type });
  }
  return {
    v: LANE_EVENT_VERSION,
    jobId,
    seq,
    ts: new Date(now()).toISOString(),
    type,
    data,
  };
}

export function createSeqCounter() {
  let sequence = 0;
  return () => ++sequence;
}

export function assertLane(lane) {
  const missing = [];
  if (!lane || typeof lane !== "object") {
    missing.push("lane");
  } else {
    if (!LANE_KINDS.includes(lane.kind)) missing.push("kind");
    if (typeof lane.id !== "string") missing.push("id");
    if (!lane.capabilities || typeof lane.capabilities !== "object") {
      missing.push("capabilities");
    }
    for (const method of ["submit", "cancel", "health"]) {
      if (typeof lane[method] !== "function") missing.push(method);
    }
  }
  if (missing.length) throw new ClawError("LANE_BAD_CONTRACT", { missing });
  return lane;
}

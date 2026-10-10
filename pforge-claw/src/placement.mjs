const EMPTY_LANE_STATE = Object.freeze({ v: 1, lanes: Object.freeze({}) });

/**
 * Placement failures returned when no lane can safely accept a job.
 * @type {Readonly<{NO_ELIGIBLE_LANE: string, NO_DEDICATED_LANE: string}>}
 */
export const PLACEMENT_ERRORS = Object.freeze({
  NO_ELIGIBLE_LANE: "NO_ELIGIBLE_LANE",
  NO_DEDICATED_LANE: "NO_DEDICATED_LANE",
});

/**
 * Stable reason labels for lanes excluded during placement.
 * @type {Readonly<Record<string, string>>}
 */
export const SKIP = Object.freeze({
  UNKNOWN: "unknown",
  DISABLED: "disabled",
  OPT_IN_OFF: "opt-in off",
  MISSING_LABELS: "missing labels",
  OFFLINE: "offline",
  NOT_DEDICATED: "not dedicated",
});

function usableObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function queueDepthFor(lane, health) {
  const value = lane?.kind === "local" ? health?.queued : health?.pending;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function isOnline(lane, health) {
  if (health?.ok === true) return true;
  if (health?.ok === false) return false;
  return lane?.kind === "local" || (lane?.kind === "k8s" && lane.enabled !== false);
}

function healthForLane(health, lane) {
  if (typeof health === "function") return health(lane.id, lane);
  if (health instanceof Map) return health.get(lane.id);
  return health?.[lane.id];
}

/**
 * Projects config, opt-in state, and health into one consistent lane status.
 * @param {{lane: object, laneState?: object, health?: object}} options Lane inputs.
 * @returns {{id: string, kind: string, labels: string[], status: "online"|"offline"|"disabled"|"opt-in-off", queueDepth: number|null}}
 */
export function laneStatus({ lane, laneState = {}, health } = {}) {
  const labels = Array.isArray(lane?.labels) ? [...lane.labels] : [];
  let status = "offline";
  if (lane?.enabled === false) status = "disabled";
  else if (lane?.optIn && laneState?.on !== true) status = "opt-in-off";
  else if (isOnline(lane, health)) status = "online";
  return {
    id: String(lane?.id ?? ""),
    kind: String(lane?.kind ?? ""),
    labels,
    status,
    queueDepth: queueDepthFor(lane, health),
  };
}

function preferredLaneIds(project) {
  const preferred = Array.isArray(project?.placement?.prefer) ? project.placement.prefer : [];
  return [...new Set([...preferred, project?.homeLane].filter((id) => typeof id === "string" && id))];
}

function laneIsDedicated(laneId, project, projects) {
  return !(projects ?? []).some((other) => (
    other && other.id !== project?.id
    && (other.homeLane === laneId
      || (Array.isArray(other.placement?.prefer) && other.placement.prefer.includes(laneId)))
  ));
}

function hasRequiredLabels(lane, requires) {
  const labels = Array.isArray(lane.labels) ? lane.labels : [];
  return requires.every((label) => labels.includes(label));
}

function candidateLaneIds({ project, lanes, restricted }) {
  const ids = preferredLaneIds(project);
  if (!restricted) {
    const seen = new Set(ids);
    for (const lane of lanes) {
      if (typeof lane?.id === "string" && !seen.has(lane.id)) {
        ids.push(lane.id);
        seen.add(lane.id);
      }
    }
  }
  return ids;
}

function skippedReason({ lane, id, project, projects, requires, restricted, laneState, health }) {
  if (!lane) return SKIP.UNKNOWN;
  if (lane.enabled === false) return SKIP.DISABLED;
  if (lane.optIn && laneState?.lanes?.[id]?.on !== true) return SKIP.OPT_IN_OFF;
  if (!hasRequiredLabels(lane, requires)) return SKIP.MISSING_LABELS;
  if (restricted && !laneIsDedicated(id, project, projects)) return SKIP.NOT_DEDICATED;
  const status = laneStatus({ lane, laneState: laneState?.lanes?.[id], health: healthForLane(health, lane) });
  return status.status === "online" ? null : SKIP.OFFLINE;
}

/**
 * Selects a launchable lane without relaxing project label or restricted-lane rules.
 * @param {{project: object, projects?: object[], lanes: object[], laneState?: object, health?: object|Map|Function}} options Placement inputs.
 * @returns {{ok: true, laneId: string, skipped: {id: string, reason: string}[], explanation: string}|{ok: false, error: string, skipped: {id: string, reason: string}[], explanation: string}}
 */
export function placeJob({
  project, projects = [], lanes = [], laneState = EMPTY_LANE_STATE, health,
} = {}) {
  const restricted = project?.visibility === "restricted";
  const candidateIds = candidateLaneIds({ project, lanes, restricted });
  const laneById = new Map(lanes.map((lane) => [lane?.id, lane]));
  const requires = Array.isArray(project?.placement?.requires) ? project.placement.requires : [];
  const skipped = [];
  const dedicatedCandidates = restricted
    ? candidateIds.filter((id) => laneById.has(id) && laneIsDedicated(id, project, projects))
    : candidateIds;

  for (const id of candidateIds) {
    const lane = laneById.get(id);
    const reason = skippedReason({ lane, id, project, projects, requires, restricted, laneState, health });
    if (reason === null) return {
        ok: true,
        laneId: id,
        skipped,
        explanation: formatExplanation(id, skipped),
      };
    skipped.push({ id, reason });
  }

  const error = restricted && dedicatedCandidates.length === 0
    ? PLACEMENT_ERRORS.NO_DEDICATED_LANE
    : PLACEMENT_ERRORS.NO_ELIGIBLE_LANE;
  return {
    ok: false,
    error,
    skipped,
    explanation: formatExplanation(error, skipped),
  };
}

/**
 * Produces a concise decision explanation, limiting displayed skip reasons.
 * @param {string} laneId Selected lane or failure code.
 * @param {{id: string, reason: string}[]} skipped Excluded candidate lanes.
 * @returns {string} A bounded explanation string.
 */
export function formatExplanation(laneId, skipped = []) {
  const visible = skipped.slice(0, 3).map(({ id, reason }) => `${id} ${reason}`);
  if (skipped.length > visible.length) visible.push(`+${skipped.length - visible.length} more`);
  return visible.length ? `${laneId} (${visible.join(", ")})` : laneId;
}

/**
 * Reads lane opt-in state, failing closed for missing, corrupt, or invalid files.
 * @param {object} store Store exposing synchronous readJson.
 * @returns {{v: 1, lanes: Record<string, object>}} Validated lane state.
 */
export function readLaneState(store) {
  let value;
  try {
    value = store?.readJson?.("lanes.json", null);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { v: 1, lanes: {} };
  }
  if (!usableObject(value) || value.v !== 1 || !usableObject(value.lanes)) {
    return { v: 1, lanes: {} };
  }
  return value;
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(value ?? Date.now()).toISOString();
}

/**
 * Persists one lane opt-in toggle and appends its audit record synchronously.
 * @param {{store: object, laneId: string, on: boolean, by: string, now?: number|Date|Function}} options Toggle inputs.
 * @returns {{v: 1, lanes: Record<string, object>}} The persisted lane state.
 */
export function setLaneOptIn({ store, laneId, on, by, now } = {}) {
  if (!store || typeof store.readJson !== "function"
    || typeof store.writeJsonAtomic !== "function" || typeof store.append !== "function") {
    throw new TypeError("A synchronous state store is required.");
  }
  const current = readLaneState(store);
  const next = {
    v: 1,
    lanes: { ...current.lanes, [laneId]: { ...current.lanes[laneId], on: on === true } },
  };
  store.writeJsonAtomic("lanes.json", next);
  store.append("audit", {
    kind: "lane.opt-in",
    laneId,
    on: on === true,
    by: String(by ?? ""),
    changedAt: timestamp(now),
  });
  return next;
}

/**
 * Creates placement operations over config, lane state, and optional health.
 * @param {{store: object, config: object, health?: object|Map|Function}} options Placement dependencies.
 * @returns {{config: object, listStatuses: Function, findLane: Function, setOptIn: Function}}
 */
export function createPlacementService({ store, config = {}, health } = {}) {
  return {
    config,
    listStatuses() {
      const state = readLaneState(store);
      return (config.lanes ?? []).map((lane) => laneStatus({
        lane,
        laneState: state.lanes[lane.id],
        health: healthForLane(health, lane),
      }));
    },
    findLane(laneId) {
      return (config.lanes ?? []).find((lane) => lane.id === laneId) ?? null;
    },
    preview({ project } = {}) {
      if (!Array.isArray(config.lanes) || config.lanes.length === 0) return null;
      try {
        return placeJob({
          project,
          projects: config.projects ?? [],
          lanes: config.lanes,
          laneState: readLaneState(store),
          health: typeof health === "function" ? health() : health,
        });
      } catch {
        return null;
      }
    },
    setOptIn(options) {
      return setLaneOptIn({ store, ...options });
    },
  };
}

let placementService = null;

/**
 * Binds the active placement service and returns an identity-safe unbinder.
 * @param {object} service Placement service instance.
 * @returns {Function} Unbind callback.
 */
export function bindPlacementService(service) {
  placementService = service;
  return () => {
    if (placementService === service) placementService = null;
  };
}

/**
 * Returns the currently bound placement service, if any.
 * @returns {object|null} Active placement service.
 */
export function getPlacementService() {
  return placementService;
}

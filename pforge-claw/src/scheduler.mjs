import { ClawError } from "./errors.mjs";

export const TICK_MS = 20_000;
export const CATCH_UP_MS = 3_600_000;
export const STATE_FILE = "schedules.json";

const INVALID_AUDIT_KIND = ["schedule", "invalid"].join(".");
const SCHEDULE_RE = /^(?:daily (\d\d):(\d\d)|weekly (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d\d):(\d\d)|monthly ([1-9]|1\d|2[0-8]) (\d\d):(\d\d)|every (\d+)m)$/;
const FORMATTERS = new Map();
let tickQueue = Promise.resolve();

function invalidSchedule(at, hint = 'use daily HH:MM | weekly Mon HH:MM | monthly D HH:MM | every Nm') {
  return new ClawError("SCHEDULE_INVALID", { at, hint });
}

export function parseSchedule(at) {
  const input = typeof at === "string" ? at.trim() : String(at);
  const match = SCHEDULE_RE.exec(input);
  if (!match) throw invalidSchedule(at);
  if (match[1]) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw invalidSchedule(at);
    return { kind: "daily", hm: `${match[1]}:${match[2]}` };
  }
  if (match[3]) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (hour > 23 || minute > 59) throw invalidSchedule(at);
    return { kind: "weekly", day: match[3], hm: `${match[4]}:${match[5]}` };
  }
  if (match[6]) {
    const hour = Number(match[7]);
    const minute = Number(match[8]);
    if (hour > 23 || minute > 59) throw invalidSchedule(at);
    return { kind: "monthly", dom: match[6].padStart(2, "0"), hm: `${match[7]}:${match[8]}` };
  }
  const n = Number(match[9]);
  if (!Number.isSafeInteger(n) || n < 5) throw invalidSchedule(at, "every Nm requires a safe integer N >= 5");
  return { kind: "every", n };
}

function formatterFor(timeZone) {
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    FORMATTERS.set(timeZone, formatter);
    return formatter;
  } catch {
    throw new ClawError("SCHEDULE_TZ_INVALID", { timeZone });
  }
}

function local(date, timeZone) {
  return Object.fromEntries(formatterFor(timeZone).formatToParts(date)
    .map(({ type, value }) => [type, value]));
}

export function dueKey(spec, date, timeZone) {
  const epochMs = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(epochMs)) return null;
  const current = new Date(epochMs);
  const parts = local(current, timeZone);
  const hm = `${parts.hour}:${parts.minute}`;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  switch (spec.kind) {
    case "daily":
      return hm === spec.hm ? day : null;
    case "weekly":
      return parts.weekday === spec.day && hm === spec.hm ? day : null;
    case "monthly":
      return parts.day === spec.dom && hm === spec.hm ? day : null;
    case "every": {
      const minute = Math.floor(epochMs / 60_000);
      return minute % spec.n === 0 ? String(minute) : null;
    }
    default:
      return null;
  }
}

export function lastDueSlot(spec, nowMs, timeZone, windowMs = CATCH_UP_MS) {
  const latestMinute = Math.floor(nowMs / 60_000) * 60_000;
  const earliestMinute = nowMs - windowMs;
  for (let offset = 0; offset <= 60; offset += 1) {
    const at = latestMinute - offset * 60_000;
    if (at < earliestMinute) break;
    const key = dueKey(spec, new Date(at), timeZone);
    if (key !== null) return { key, at };
  }
  return null;
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : "INTERNAL";
}

function makeAudit(store, logger, callback) {
  return (record) => {
    if (typeof callback === "function") {
      try {
        callback(record);
      } catch (error) {
        logger?.error?.("Scheduler audit write failed", { code: errorCode(error) });
      }
      return;
    }
    try {
      store.append("audit", record);
    } catch (error) {
      logger?.error?.("Scheduler audit write failed", { code: errorCode(error) });
    }
  };
}

function validState(value) {
  return value && value.v === 1 && value.schedules && typeof value.schedules === "object"
    && !Array.isArray(value.schedules);
}

/**
 * Claimed slots are persisted before execution, so a crash after claiming drops
 * that run instead of retrying it; this deliberately provides at-most-once runs.
 */
export function createScheduler({
  store,
  schedules = [],
  timeZone,
  run,
  logger,
  audit,
  now = Date.now,
  tickMs = TICK_MS,
} = {}) {
  if (!store || typeof store.readJson !== "function" || typeof store.writeJsonAtomic !== "function") {
    throw new ClawError("SERVICE_UNAVAILABLE", { service: "store" });
  }
  if (typeof run !== "function") throw new ClawError("SERVICE_UNAVAILABLE", { service: "scheduler-runner" });
  formatterFor(timeZone);
  const appendAudit = makeAudit(store, logger, audit);
  const parsedSchedules = [];
  const ids = new Set();
  for (const schedule of schedules) {
    if (!schedule || typeof schedule.id !== "string" || !schedule.id.trim()) {
      logger?.error?.("SCHEDULE_INVALID", { code: "SCHEDULE_INVALID" });
      appendAudit({ v: 1, kind: INVALID_AUDIT_KIND, scheduleId: schedule?.id ?? null, code: "SCHEDULE_INVALID" });
      continue;
    }
    if (ids.has(schedule.id)) {
      logger?.error?.("SCHEDULE_INVALID", { scheduleId: schedule.id, code: "SCHEDULE_DUPLICATE_ID" });
      appendAudit({ v: 1, kind: INVALID_AUDIT_KIND, scheduleId: schedule.id, code: "SCHEDULE_DUPLICATE_ID" });
      continue;
    }
    try {
      const spec = parseSchedule(schedule.at);
      ids.add(schedule.id);
      parsedSchedules.push({ schedule, spec });
    } catch (error) {
      logger?.error?.("SCHEDULE_INVALID", { scheduleId: schedule.id, code: errorCode(error) });
      appendAudit({ v: 1, kind: INVALID_AUDIT_KIND, scheduleId: schedule.id, code: errorCode(error) });
    }
  }

  let state;
  let interval = null;
  let activeTick = null;
  const running = new Set();

  function recoverState() {
    const recovered = { v: 1, schedules: {} };
    for (const { schedule, spec } of parsedSchedules) {
      const slot = lastDueSlot(spec, now(), timeZone);
      recovered.schedules[schedule.id] = {
        lastKey: slot?.key ?? null,
        lastRunAt: null,
        status: "recovered",
      };
    }
    store.writeJsonAtomic(STATE_FILE, recovered);
    appendAudit({ v: 1, kind: "schedule.state-recovered", code: "SCHEDULE_STATE_CORRUPT" });
    return recovered;
  }

  function readState() {
    try {
      const value = store.readJson(STATE_FILE, { v: 1, schedules: {} });
      if (!validState(value)) return recoverState();
      return value;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return recoverState();
    }
  }

  state = readState();

  function persist(nextState) {
    store.writeJsonAtomic(STATE_FILE, nextState);
    state = nextState;
  }

  async function executeTick() {
    state = readState();
    for (const { schedule, spec } of parsedSchedules) {
      if (running.has(schedule.id)) continue;
      const slot = lastDueSlot(spec, now(), timeZone);
      if (!slot || slot.key === state.schedules[schedule.id]?.lastKey) continue;
      const scheduledAt = new Date(slot.at).toISOString();
      const claimed = {
        ...state,
        v: 1,
        schedules: {
          ...state.schedules,
          [schedule.id]: { lastKey: slot.key, lastRunAt: scheduledAt, status: "claimed" },
        },
      };
      persist(claimed);
      running.add(schedule.id);
      try {
        await run(schedule, { key: slot.key, scheduledAt });
        const done = {
          ...state,
          schedules: {
            ...state.schedules,
            [schedule.id]: { lastKey: slot.key, lastRunAt: scheduledAt, status: "done" },
          },
        };
        persist(done);
        appendAudit({ v: 1, kind: "schedule.fired", scheduleId: schedule.id, key: slot.key, scheduledAt });
      } catch (error) {
        const failed = {
          ...state,
          schedules: {
            ...state.schedules,
            [schedule.id]: {
              lastKey: slot.key,
              lastRunAt: scheduledAt,
              status: "failed",
              errorCode: errorCode(error),
            },
          },
        };
        persist(failed);
        appendAudit({
          v: 1,
          kind: "schedule.failed",
          scheduleId: schedule.id,
          key: slot.key,
          scheduledAt,
          errorCode: errorCode(error),
        });
      } finally {
        running.delete(schedule.id);
      }
    }
  }

  function tick() {
    const nextTick = tickQueue.then(executeTick, executeTick);
    tickQueue = nextTick.catch(() => {});
    activeTick = nextTick;
    return nextTick;
  }

  function start() {
    if (interval) return Promise.resolve();
    return tick().catch((error) => {
      logger?.error?.("Scheduler tick failed", { code: errorCode(error) });
    }).then(() => {
      if (!interval) {
        interval = setInterval(() => {
          void tick().catch((error) => {
            logger?.error?.("Scheduler tick failed", { code: errorCode(error) });
          });
        }, tickMs);
        interval.unref?.();
      }
    });
  }

  async function stop() {
    if (interval) clearInterval(interval);
    interval = null;
    if (activeTick) await activeTick;
  }

  function snapshot() {
    return parsedSchedules.map(({ schedule }) => {
      const saved = state.schedules[schedule.id] ?? {};
      return {
        id: schedule.id,
        kind: schedule.kind,
        at: schedule.at,
        lastRunAt: saved.lastRunAt ?? null,
        status: saved.status ?? "pending",
        ...(saved.errorCode ? { errorCode: saved.errorCode } : {}),
      };
    });
  }

  return { start, stop, tick, snapshot };
}

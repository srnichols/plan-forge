export function createFakeClock(start = "2026-01-01T00:00:00.000Z") {
  let current = new Date(start).getTime();
  if (!Number.isFinite(current)) throw new TypeError("start must be a valid date");
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new TypeError("advance must be a non-negative number");
      }
      current += milliseconds;
      return new Date(current);
    },
  };
}

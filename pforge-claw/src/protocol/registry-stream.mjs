export function createLeaseStream(entry) {
  return {
    [Symbol.asyncIterator]() {
      const listener = { pending: entry.pending.splice(0), waiters: [], closed: false };
      entry.listeners.add(listener);
      return {
        next() {
          if (listener.pending.length) return Promise.resolve({ value: listener.pending.shift(), done: false });
          if (entry.finished || listener.closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => listener.waiters.push(resolve));
        },
        async return() {
          listener.closed = true;
          entry.listeners.delete(listener);
          for (const wake of listener.waiters.splice(0)) wake({ value: undefined, done: true });
          return { value: undefined, done: true };
        },
      };
    },
  };
}

export function enqueueLeaseEvent(entry, event) {
  if (event.type !== "finished") {
    const full = entry.listeners.size === 0
      ? entry.pending.length >= entry.maxReplay
      : [...entry.listeners].some((listener) => !listener.waiters.length && listener.pending.length >= entry.maxReplay);
    if (full) return false;
  }
  if (entry.listeners.size === 0) {
    entry.pending.push(event);
    return true;
  }
  for (const listener of entry.listeners) {
    if (listener.waiters.length) listener.waiters.shift()({ value: event, done: false });
    else {
      listener.pending.push(event);
    }
  }
  return true;
}

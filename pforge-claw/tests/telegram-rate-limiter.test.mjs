import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { createChatLimiter } from "../src/channels/telegram/rate-limiter.mjs";

const limiters = [];

function makeLimiter(options) {
  const limiter = createChatLimiter(options);
  limiters.push(limiter);
  return limiter;
}

describe("Telegram chat limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(async () => {
    await Promise.all(limiters.splice(0).map((limiter) => limiter.close()));
    vi.useRealTimers();
  });

  it("enforces exact per-chat spacing", async () => {
    const limiter = makeLimiter();
    const first = limiter.enqueue("42", () => "first");
    const second = limiter.enqueue("42", () => "second");
    await expect(first).resolves.toBe("first");
    await vi.advanceTimersByTimeAsync(999);
    expect(limiter.size()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe("second");
    await limiter.close();
  });

  it("waits at the group rolling-window cap but not for a private chat", async () => {
    const group = makeLimiter({ perChatMs: 0 });
    let sent = 0;
    const pending = Array.from({ length: 21 }, () => group.enqueue("-42", () => ++sent));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sent).toBe(20);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(pending);
    expect(sent).toBe(21);
    await group.close();

    const privateChat = makeLimiter({ perChatMs: 0 });
    let privateSent = 0;
    await Promise.all(Array.from({ length: 21 }, () => privateChat.enqueue("42", () => ++privateSent)));
    expect(privateSent).toBe(21);
    await privateChat.close();
  });

  it("pauses a chat for retryAfterMs and keeps draining after a rejection", async () => {
    const limiter = makeLimiter({ perChatMs: 0 });
    const failed = limiter.enqueue("42", () => {
      throw new ClawError("TELEGRAM_RATE_LIMITED", { retryAfterMs: 500 });
    });
    const delayed = limiter.enqueue("42", () => "after pause");
    await expect(failed).rejects.toMatchObject({ code: "TELEGRAM_RATE_LIMITED" });
    await vi.advanceTimersByTimeAsync(499);
    expect(limiter.size()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(delayed).resolves.toBe("after pause");
    await limiter.close();
  });

  it("rejects pending items on close and waits for an in-flight item", async () => {
    const limiter = makeLimiter({ perChatMs: 0 });
    let release;
    const inFlight = limiter.enqueue("42", () => new Promise((resolve) => { release = resolve; }));
    const pending = limiter.enqueue("42", () => "never");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const closing = limiter.close();
    await expect(pending).rejects.toMatchObject({ code: "LIMITER_CLOSED" });
    release("done");
    await expect(inFlight).resolves.toBe("done");
    await closing;
    expect(limiter.size()).toBe(0);
  });

  it("retains the clock-zero send across sequential awaited drains", async () => {
    const limiter = makeLimiter();
    const sentAt = [];
    await limiter.enqueue("42", () => { sentAt.push(Date.now()); });
    const delayed = limiter.enqueue("42", () => { sentAt.push(Date.now()); });
    const settled = Promise.allSettled([delayed]);
    await vi.advanceTimersByTimeAsync(999);
    expect(sentAt).toEqual([0]);
    expect(limiter.size()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(sentAt).toEqual([0, 1000]);
  });

  it("retains the group rolling window across separate drains without a calendar reset", async () => {
    const limiter = makeLimiter({ perChatMs: 0 });
    const sentAt = [];
    for (let index = 0; index < 20; index += 1) {
      if (index > 0) await vi.advanceTimersByTimeAsync(1000);
      await limiter.enqueue("-42", () => { sentAt.push(Date.now()); });
    }
    const capped = limiter.enqueue("-42", () => { sentAt.push(Date.now()); });
    const cappedSettled = Promise.allSettled([capped]);
    await vi.advanceTimersByTimeAsync(40_999);
    expect(sentAt).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(1);
    await cappedSettled;
    expect(sentAt.at(-1)).toBe(60_000);
    const rolling = limiter.enqueue("-42", () => { sentAt.push(Date.now()); });
    const rollingSettled = Promise.allSettled([rolling]);
    await vi.advanceTimersByTimeAsync(999);
    expect(sentAt).toHaveLength(21);
    await vi.advanceTimersByTimeAsync(1);
    await rollingSettled;
    expect(sentAt.at(-1)).toBe(61_000);
  });

  it("retains retry-after even when a failed send leaves an empty queue", async () => {
    const limiter = makeLimiter({ perChatMs: 0 });
    await expect(limiter.enqueue("42", () => {
      throw new ClawError("TELEGRAM_RATE_LIMITED", { retryAfterMs: 500 });
    })).rejects.toMatchObject({ code: "TELEGRAM_RATE_LIMITED" });
    const sentAt = [];
    const delayed = limiter.enqueue("42", () => { sentAt.push(Date.now()); });
    const settled = Promise.allSettled([delayed]);
    await vi.advanceTimersByTimeAsync(499);
    expect(sentAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(sentAt).toEqual([500]);
  });

  it("retains a pause applied to an idle chat without blocking another chat", async () => {
    const limiter = makeLimiter({ perChatMs: 0 });
    limiter.pause("42", 500);
    const sentAt = [];
    const delayed = limiter.enqueue("42", () => { sentAt.push(Date.now()); });
    const settled = Promise.allSettled([delayed]);
    await limiter.enqueue("7", () => "independent");
    await vi.advanceTimersByTimeAsync(499);
    expect(sentAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(sentAt).toEqual([500]);
  });

  it("expires idle private-chat history and cancels every retained timer on close", async () => {
    const limiter = makeLimiter();
    for (let index = 0; index < 32; index += 1) {
      await limiter.enqueue(`chat-${index}`, () => index);
    }
    expect(limiter.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(32);
    await vi.advanceTimersByTimeAsync(999);
    expect(vi.getTimerCount()).toBe(32);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(0);
    const sentAt = [];
    const fresh = limiter.enqueue("chat-0", () => { sentAt.push(Date.now()); });
    const settled = Promise.allSettled([fresh]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentAt).toEqual([0]);
    await settled;
    limiter.pause("-42", 70_000);
    expect(vi.getTimerCount()).toBe(2);
    await limiter.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(limiter.size()).toBe(0);
    await expect(limiter.enqueue("chat-0", () => "never")).rejects.toMatchObject({ code: "LIMITER_CLOSED" });
    expect(() => limiter.pause("chat-0", 1)).toThrowError("LIMITER_CLOSED");
  });

  it("keeps group history and longer retry-after until their own expiration", async () => {
    const limiter = makeLimiter();
    await limiter.enqueue("-42", () => "sent");
    limiter.pause("-42", 70_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels its default eligibility timer when closing a waiting queue", async () => {
    const limiter = makeLimiter();
    await limiter.enqueue("42", () => "sent");
    const delayed = limiter.enqueue("42", () => "never");
    const settled = Promise.allSettled([delayed]);
    await vi.advanceTimersByTimeAsync(0);
    expect(limiter.size()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await limiter.close();
    expect(await settled).toEqual([expect.objectContaining({
      status: "rejected", reason: expect.objectContaining({ code: "LIMITER_CLOSED" }),
    })]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors long pauses in bounded timer segments without expiring history early", async () => {
    const timerLimit = 2_147_483_647;
    const limiter = makeLimiter({ perChatMs: 0 });
    const schedule = vi.spyOn(globalThis, "setTimeout");
    try {
      limiter.pause("42", timerLimit + 500);
      const sentAt = [];
      const delayed = limiter.enqueue("42", () => { sentAt.push(Date.now()); });
      const settled = Promise.allSettled([delayed]);
      await vi.advanceTimersByTimeAsync(0);
      expect(schedule.mock.calls.every(([_handler, milliseconds]) => milliseconds <= timerLimit)).toBe(true);
      await vi.advanceTimersByTimeAsync(499);
      expect(sentAt).toEqual([]);
      expect(limiter.size()).toBe(1);
      await vi.advanceTimersByTimeAsync(timerLimit - 499);
      expect(sentAt).toEqual([]);
      await vi.advanceTimersByTimeAsync(500);
      await settled;
      expect(sentAt).toEqual([timerLimit + 500]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      schedule.mockRestore();
    }
  });
});

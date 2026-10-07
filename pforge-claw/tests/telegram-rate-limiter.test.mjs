import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { createChatLimiter } from "../src/channels/telegram/rate-limiter.mjs";

describe("Telegram chat limiter", () => {
  afterEach(() => vi.useRealTimers());

  it("enforces exact per-chat spacing", async () => {
    vi.useFakeTimers();
    const limiter = createChatLimiter();
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
    vi.useFakeTimers();
    const group = createChatLimiter({ perChatMs: 0 });
    let sent = 0;
    const pending = Array.from({ length: 21 }, () => group.enqueue("-42", () => ++sent));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sent).toBe(20);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(pending);
    expect(sent).toBe(21);
    await group.close();

    const privateChat = createChatLimiter({ perChatMs: 0 });
    let privateSent = 0;
    await Promise.all(Array.from({ length: 21 }, () => privateChat.enqueue("42", () => ++privateSent)));
    expect(privateSent).toBe(21);
    await privateChat.close();
  });

  it("pauses a chat for retryAfterMs and keeps draining after a rejection", async () => {
    vi.useFakeTimers();
    const limiter = createChatLimiter({ perChatMs: 0 });
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
    const limiter = createChatLimiter({ perChatMs: 0 });
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
});

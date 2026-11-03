/**
 * A hook may take longer than a test.
 *
 * Fifteen suites start the whole server in a `beforeAll` (`await import("../server.mjs")`), and vite-node transforms
 * every module the server reaches. On a busy machine that took longer than the 30 s hook limit: a 42-minute local
 * run at 97% CPU failed testbed-dashboard-ui's `beforeAll` that way, and the suite passes alone and in CI.
 *
 * A test's own limit stays at 30 s. A test that takes that long is slow; a hook that does is loading the server.
 */

import { describe, expect, it } from "vitest";
import config from "../vitest.config.mjs";

describe("vitest.config.mjs timeouts", () => {
  it("give a hook time to load the whole server on a busy machine", () => {
    expect(config.test.hookTimeout).toBeGreaterThanOrEqual(120_000);
  });

  it("keep a test's own limit below its hook's", () => {
    expect(config.test.testTimeout).toBeLessThan(config.test.hookTimeout);
  });
});

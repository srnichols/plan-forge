/**
 * Plan Forge — Forge-Master Smoke Test (Phase-33, Slice 3).
 *
 * End-to-end smoke test for the Forge-Master reasoning loop over GitHub Models.
 * Guarded by `describe.skipIf(!process.env.FORGE_SMOKE)` — CI passes cleanly
 * with FORGE_SMOKE unset (1 skipped, 0 failed).
 *
 * Run locally after `gh auth login`:
 *
 *   FORGE_SMOKE=1 npx vitest run tests/forge-master.smoke.test.mjs
 *
 * Windows:
 *   set FORGE_SMOKE=1 && npx vitest run tests/forge-master.smoke.test.mjs
 *
 * Asserts (when live):
 *   (a) Classification lane === "advisory"
 *   (b) Reply contains ≥ 3 advisory keywords (case-insensitive)
 *   (c) tokensOut > 0
 *   (d) Completes within 30 s
 */

import { describe, it, expect } from "vitest";
import { classify, LANES } from "../../pforge-master/src/intent-router.mjs";
import { runTurn } from "../../pforge-master/src/reasoning.mjs";

const SMOKE_PROMPT =
  "Should I refactor the orchestrator worker spawn logic or ship Phase-34 first?";

const ADVISORY_KEYWORDS = [
  "architecture",
  "slice",
  "fresh session",
  "triage",
  "evidence",
  "boring",
  "principle",
  "forbidden",
];

describe.skipIf(!process.env.FORGE_SMOKE)(
  "forge-master smoke — live advisory turn",
  () => {
    it(
      "advisory prompt routes to advisory lane and returns substantive response",
      async () => {
        // (a) Lane classification — fast, no model call
        const classification = await classify(SMOKE_PROMPT);
        expect(classification.lane).toBe(LANES.ADVISORY);

        // Full reasoning turn — live model call
        const result = await runTurn({ message: SMOKE_PROMPT });

        expect(result.error).toBeFalsy();

        // (b) Keyword presence — at least 3 of 8
        const text = result.reply.toLowerCase();
        const matched = ADVISORY_KEYWORDS.filter((kw) =>
          text.includes(kw.toLowerCase()),
        );
        expect(
          matched.length,
          `Expected ≥3 advisory keywords in reply, got ${matched.length}: [${matched.join(", ")}]. Full reply:\n${result.reply}`,
        ).toBeGreaterThanOrEqual(3);

        // (c) Token output confirms model was invoked
        expect(result.tokensOut).toBeGreaterThan(0);
      },
      30_000, // (d) 30 s timeout
    );
  },
);

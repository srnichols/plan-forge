import { test } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "../src/text.mjs";

test("truncate keeps short text", () => {
  assert.equal(truncate("abc", 4), "abc");
});

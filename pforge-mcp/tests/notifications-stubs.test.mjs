/**
 * Plan Forge — Notification Extension Stubs Tests
 *
 * Phase FORGE-SHOP-03 Slice 03.2
 *
 * Validates that each notification adapter stub conforms to the adapter
 * contract, returns not-installed from validate(), and rejects from send().
 * Also verifies catalog.json entries.
 */
import { describe, it, expect } from "vitest";
import { validateAdapterShape, ERR_NOT_IMPLEMENTED } from "../notifications/adapter-contract.mjs";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STUBS = [
  { name: "slack", path: "../../extensions/notify-slack/index.mjs" },
  { name: "teams", path: "../../extensions/notify-teams/index.mjs" },
  { name: "email", path: "../../extensions/notify-email/index.mjs" },
  { name: "pagerduty", path: "../../extensions/notify-pagerduty/index.mjs" },
];

describe("notification extension stubs", () => {
  for (const stub of STUBS) {
    describe(stub.name, () => {
      let adapter;
      it("can be imported", async () => {
        const mod = await import(stub.path);
        adapter = mod.adapter;
        expect(adapter).toBeDefined();
      });

      it("conforms to the adapter contract shape", async () => {
        const mod = await import(stub.path);
        const result = validateAdapterShape(mod.adapter);
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
      });

      it("has correct name", async () => {
        const mod = await import(stub.path);
        expect(mod.adapter.name).toBe(stub.name);
      });

      it("validate() returns not-installed without throwing", async () => {
        const mod = await import(stub.path);
        const result = mod.adapter.validate({});
        expect(result).toEqual({ ok: false, reason: "not-installed" });
      });

      it("send() rejects with ERR_NOT_IMPLEMENTED", async () => {
        const mod = await import(stub.path);
        try {
          await mod.adapter.send({});
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err.code).toBe(ERR_NOT_IMPLEMENTED);
        }
      });
    });
  }

  describe("catalog.json entries", () => {
    let catalog;
    it("can be loaded", () => {
      const raw = readFileSync(resolve(__dirname, "../../extensions/catalog.json"), "utf-8");
      catalog = JSON.parse(raw);
      expect(catalog).toBeDefined();
    });

    for (const stubName of ["notify-slack", "notify-teams", "notify-email", "notify-pagerduty"]) {
      it(`has entry for ${stubName}`, () => {
        const raw = readFileSync(resolve(__dirname, "../../extensions/catalog.json"), "utf-8");
        const cat = JSON.parse(raw);
        const entry = cat.extensions[stubName];
        expect(entry).toBeDefined();
        expect(entry.id).toBe(stubName);
        expect(entry.category).toBe("integration");
        expect(entry.verified).toBe(true);
        expect(entry.tags).toContain("notify-adapter");
      });
    }
  });
});

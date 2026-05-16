/**
 * with-tmp-forge-home.mjs — Temporary forge-home wrapper for integration tests.
 *
 * Creates an isolated tmp directory so tests never touch the real `.forge/`
 * directory in the workspace root.  The returned handle exposes `cwd` as a
 * drop-in replacement for `process.cwd()` in all deps/options objects that
 * accept a `cwd` field.
 *
 * Usage:
 *   const home = createTmpForgeHome();
 *   // ... pass home.cwd to modules under test ...
 *   home.cleanup();          // remove the tmp directory
 *
 * Alternatively use the vitest-friendly scoped helper:
 *   const home = useTmpForgeHome();   // auto-cleanup via beforeEach/afterEach hooks
 *
 * Path helpers:
 *   home.forge("anvil")       → <tmpDir>/.forge/anvil
 *   home.forge("lattice", "chunks.jsonl") → <tmpDir>/.forge/lattice/chunks.jsonl
 */

import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach } from "vitest";

/**
 * Create a fresh isolated tmp directory that acts as the forge home.
 * The `.forge/` subdirectory is NOT pre-created — modules create it on demand
 * (matching real behavior).
 *
 * @param {{ prefix?: string }} [opts]
 * @returns {{ cwd: string, forge: (...segments: string[]) => string, cleanup: () => void }}
 */
export function createTmpForgeHome(opts = {}) {
  const prefix = opts.prefix ?? "pforge-test-home-";
  const dir = mkdtempSync(join(tmpdir(), prefix));

  return {
    /** Use this as `deps.cwd` or `opts.cwd` in module calls. */
    cwd: dir,

    /**
     * Resolve a path inside the `.forge/` subdirectory.
     * @param {...string} segments — path segments under .forge/
     * @returns {string}
     */
    forge(...segments) {
      return resolve(dir, ".forge", ...segments);
    },

    /**
     * Ensure a directory under .forge/ exists (creates it if absent).
     * Useful for seeding test fixtures.
     * @param {...string} segments
     * @returns {string} The resolved path.
     */
    mkForgeDir(...segments) {
      const p = this.forge(...segments);
      mkdirSync(p, { recursive: true });
      return p;
    },

    /**
     * Remove the tmp directory and all its contents.
     * Safe to call multiple times — silently ignored on second call.
     */
    cleanup() {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // Non-fatal on Windows when a file handle is briefly held
        }
      }
    },
  };
}

/**
 * Vitest-aware wrapper: calls `createTmpForgeHome` inside `beforeEach` and
 * registers cleanup in `afterEach`.
 *
 * Usage (inside a describe block or at module level):
 *
 *   const home = useTmpForgeHome();
 *
 *   it("writes to .forge/anvil", () => {
 *     withAnvil(fn, opts, { cwd: home.cwd });
 *     expect(existsSync(home.forge("anvil"))).toBe(true);
 *   });
 *
 * @param {{ prefix?: string }} [opts]
 * @returns {{ get cwd(): string, forge: (...segments: string[]) => string }}
 */
export function useTmpForgeHome(opts = {}) {
  let current = null;

  beforeEach(() => {
    current = createTmpForgeHome(opts);
  });

  afterEach(() => {
    current?.cleanup();
    current = null;
  });

  return {
    get cwd() {
      if (!current) throw new Error("useTmpForgeHome: accessed outside of a test — use inside describe/it");
      return current.cwd;
    },
    forge(...segments) {
      if (!current) throw new Error("useTmpForgeHome: accessed outside of a test");
      return current.forge(...segments);
    },
    mkForgeDir(...segments) {
      if (!current) throw new Error("useTmpForgeHome: accessed outside of a test");
      return current.mkForgeDir(...segments);
    },
  };
}

/**
 * Plan Forge — Tempering: stack-adapter registry (Phase TEMPER-02 Slice 02.1)
 *
 * Language-agnostic runner contract. Each supported stack ships a
 * `pforge-mcp/tempering/adapters/<stack>.mjs` that exports a single
 * `temperingAdapter` object:
 *
 *   export const temperingAdapter = {
 *     unit:        { supported, cmd, parseOutput(stdout, stderr, exitCode) },
 *     integration: { supported, cmd, parseOutput(stdout, stderr, exitCode) },
 *   };
 *
 * The runner never speaks a stack's native test tooling directly — all
 * knowledge of `npx vitest` vs `dotnet test` vs `go test -json` lives in
 * the adapter. New stacks land as one adapter file, not core changes.
 *
 * Stubs (php / swift / azure-iac this slice) export the same shape with
 * `supported: false` + a `reason`. The runner surfaces that reason in
 * the run record so operators see *why* a scanner skipped.
 *
 * @module tempering/adapters
 */

/**
 * Map of stack id (as returned by `detectStack`) → adapter module path,
 * *relative to this file*. Kept as a const so tests can assert the full
 * supported matrix without a filesystem scan.
 *
 * These live under `pforge-mcp/` rather than `presets/` because that is the
 * only tree setup copies wholesale into a consuming project. `presets/` is a
 * template directory whose contents are flattened into the consumer's root,
 * so an adapter kept there was unreachable from here in every vendored
 * install and every scanner was silently skipped (meta #269).
 */
export const STACK_ADAPTER_PATHS = Object.freeze({
  typescript: "./adapters/typescript.mjs",
  dotnet: "./adapters/dotnet.mjs",
  python: "./adapters/python.mjs",
  go: "./adapters/go.mjs",
  java: "./adapters/java.mjs",
  rust: "./adapters/rust.mjs",
  php: "./adapters/php.mjs",
  swift: "./adapters/swift.mjs",
  "azure-iac": "./adapters/azure-iac.mjs",
});

/**
 * Which stacks have first-class adapters in this slice. The stubbed
 * stacks (php / swift / azure-iac) are deliberately excluded — dashboards
 * that want to show a "supported matrix" column read from here.
 */
export const SUPPORTED_STACKS_SLICE_02_1 = Object.freeze([
  "typescript", "dotnet", "python", "go", "java", "rust",
]);

/**
 * Validate an adapter object has the shape the runner expects for a
 * single scanner (`unit` or `integration`). Returns `{ ok: true }` or
 * `{ ok: false, reason }`. The runner never throws on a bad adapter —
 * it records the reason and moves on.
 *
 * @param {any} entry
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateAdapterEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { ok: false, reason: "missing-scanner-entry" };
  }
  // Explicitly-unsupported stubs are valid — the runner skips them.
  if (entry.supported === false) return { ok: true };
  if (!Array.isArray(entry.cmd) || entry.cmd.length === 0) {
    return { ok: false, reason: "invalid-cmd-array" };
  }
  if (typeof entry.parseOutput !== "function") {
    return { ok: false, reason: "missing-parseOutput" };
  }
  return { ok: true };
}

/**
 * Dynamically load a stack's temperingAdapter. Tests inject `importFn`
 * to avoid filesystem IO. Real callers use the default ESM `import`.
 *
 * Returns `null` on any failure (unsupported stack, missing module,
 * malformed export). The runner treats `null` as a skip-with-reason,
 * not an error.
 *
 * @param {string} stack
 * @param {{ importFn?: (p: string) => Promise<any> }} [opts]
 * @returns {Promise<object|null>}
 */
export async function loadAdapter(stack, { importFn } = {}) {
  const relPath = STACK_ADAPTER_PATHS[stack];
  if (!relPath) return null;
  // Resolved against this module rather than left bare: STACK_ADAPTER_PATHS is
  // documented as relative to this file, and a variable specifier is resolved
  // against the project root by some runners (notably vitest 4's module runner).
  const doImport = importFn || ((p) => import(new URL(p, import.meta.url).href));
  try {
    const mod = await doImport(relPath);
    const adapter = mod && mod.temperingAdapter;
    if (!adapter || typeof adapter !== "object") return null;
    return adapter;
  } catch {
    return null;
  }
}

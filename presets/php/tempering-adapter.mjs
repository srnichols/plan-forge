/**
 * PHP tempering adapter (Phase TEMPER-02 Slice 02.1 — stub)
 *
 * Intentionally unsupported in this slice. Extension opportunity
 * documented in docs/EXTENSIONS.md. A future extension should export
 * `unit.cmd` wrapping `phpunit --testdox` plus a parser for its
 * summary lines.
 */
export const temperingAdapter = {
  unit: { supported: false, reason: "extension-opportunity-see-EXTENSIONS.md" },
  integration: { supported: false, reason: "extension-opportunity-see-EXTENSIONS.md" },
};

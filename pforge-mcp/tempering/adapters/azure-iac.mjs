/**
 * Azure IaC tempering adapter (Phase TEMPER-02 Slice 02.1 — stub)
 *
 * Intentionally unsupported in this slice. IaC "tests" land in a
 * dedicated phase (bicep lint + terraform validate + policy-as-code
 * checks have different verdict semantics from unit tests). Extension
 * opportunity documented in docs/EXTENSIONS.md.
 */
export const temperingAdapter = {
  unit: { supported: false, reason: "extension-opportunity-see-EXTENSIONS.md" },
  integration: { supported: false, reason: "extension-opportunity-see-EXTENSIONS.md" },
  mutation: { supported: false, reason: "extension-opportunity-see-EXTENSIONS.md" },
};

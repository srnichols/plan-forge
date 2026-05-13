# Spec Kit Fixtures

These fixtures back the deterministic Spec Kit importer tests (`crucible-import.test.mjs`).

## Provenance

> **TODO before merge**: regenerate from a real `github/spec-kit` run and pin the SHA.

These fixtures are **hand-crafted to match the documented Spec Kit template shape** as of:

- Spec Kit reference: <https://github.com/github/spec-kit>
- Manual reference: [docs/manual/spec-kit-interop.html](../../../../docs/manual/spec-kit-interop.html)
- Capture date placeholder: `2026-05-13`
- Spec Kit SHA: `__PIN_BEFORE_MERGE__`

To regenerate from the real Spec Kit CLI:

```bash
# In a scratch directory
git clone https://github.com/github/spec-kit && cd spec-kit
git rev-parse HEAD                           # Record this SHA in the line above
# Run a sample feature through speckit
speckit init demo-feature
# (interview prompts...) → produces specs/demo-feature/{spec,plan,tasks}.md and memory/constitution.md
cp -r specs/demo-feature/. <plan-forge>/pforge-mcp/tests/fixtures/speckit/green/
cp memory/constitution.md   <plan-forge>/pforge-mcp/tests/fixtures/speckit/green/
```

Then derive `partial/` (delete `tasks.md`) and `invalid/` (corrupt `spec.md` to drop `# Title` line).

## Fixture catalogue

| Directory | Shape | Used to test |
|---|---|---|
| `green/`    | All four files present, all required fields populated | Happy-path import |
| `partial/`  | `tasks.md` absent, others present | Importer treats `tasks.md` as optional, emits warning |
| `invalid/`  | `spec.md` lacks `# Title` heading | Importer returns `SPECKIT_IMPORT_MISSING_FIELD` |

## Field-mapping contract under test

These fixtures exercise the field map documented in [spec-kit-interop.html](../../../../docs/manual/spec-kit-interop.html):

| Source                          | Smelt target          |
|---------------------------------|-----------------------|
| `spec.md` `#` heading           | `plan-title`          |
| `spec.md` `## Goals` list       | `objectives[]`        |
| `plan.md` `## Scope` body       | `scope`               |
| `plan.md` `## Slices` list      | `slices[]`            |
| `plan.md` `## Forbidden Actions`| `forbidden-actions`   |
| `tasks.md` table rows           | `slices[].tasks[]`    |
| `constitution.md` `## Rules` list | `agent-constraints` |

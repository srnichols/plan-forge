# Spec Kit Fixtures

These fixtures back the deterministic Spec Kit importer tests (`crucible-import.test.mjs`).

## Provenance

- Spec Kit reference: <https://github.com/github/spec-kit>
- Manual reference: [docs/manual/spec-kit-interop.html](../../../../docs/manual/spec-kit-interop.html)
- Capture date: 2026-05-16
- Spec Kit SHA: `81e9ecd4d955af21adf97c17646b8d3c9b9b67bb`

These fixtures were regenerated to match the real `github/spec-kit` template output shape
at the pinned SHA above. The fixture content is hand-crafted to represent a realistic
`speckit init demo-feature` run for the "Rate Limit Login Endpoint" feature, using the
section headings from the actual spec-kit templates:

| Template file             | Key section headings used               |
|---------------------------|-----------------------------------------|
| `spec-template.md`        | `## Requirements`, `## Success Criteria`, `## Assumptions`, `## User Scenarios & Testing` |
| `plan-template.md`        | `## Summary`, `## Technical Context`, `## Slices`*, `## Forbidden Actions`* |
| `constitution-template.md`| `## Core Principles`, `## Commitments`, `## Boundaries` |

\* `## Slices` and `## Forbidden Actions` are Plan Forge additions not emitted by the raw
spec-kit CLI; they represent the output after a developer has extended the plan for
Plan Forge compatibility.

To regenerate from the real Spec Kit CLI at a future SHA:

```bash
# In a scratch directory
git clone https://github.com/github/spec-kit && cd spec-kit
git rev-parse HEAD                           # Record this SHA above
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

These fixtures exercise the field map documented in [spec-kit-interop.html](../../../../docs/manual/spec-kit-interop.html).
The importer supports both the original Plan Forge convention headings and the real spec-kit
template headings (via aliases):

| Source                                              | Smelt target          | Alias supported            |
|-----------------------------------------------------|-----------------------|----------------------------|
| `spec.md` `#` heading                               | `plan-title`          | strips "Feature Specification: " prefix |
| `spec.md` `## Goals` or `## Requirements` list      | `objectives[]`        | ✓                          |
| `spec.md` `## Acceptance Criteria` or `## Success Criteria` | (plan passthrough) | ✓               |
| `spec.md` `## Out of Scope` or `## Assumptions`     | (plan passthrough)    | ✓                          |
| `plan.md` `## Scope` or `## Summary` body           | `scope`               | ✓                          |
| `plan.md` `## Slices` list                          | `slices[]`            |                            |
| `plan.md` `## Forbidden Actions`                    | `forbidden-actions`   |                            |
| `tasks.md` table rows                               | `slices[].tasks[]`    |                            |
| `constitution.md` `## Rules` or `## Core Principles` list | `agent-constraints` | ✓                    |

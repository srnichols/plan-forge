---
crucibleId: 8c375e4f-16b7-421f-8756-1a7f81fa0373
source: self-hosted
status: draft
phase: TEMPER-03
arc: TEMPER
---

# Phase TEMPER-03: UI sweep — Playwright, accessibility, API contract

> **Status**: 📝 DRAFT (arc-prep, no code yet)
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (browser automation subprocess, first
> artifact-producing scanners — screenshots + HAR files)
> **Target Version**: v2.44.0

See arc overview: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)

---

## Why

A passing unit + integration suite can still hide catastrophic UX
failures: broken navigation, 404'd assets, keyboard traps,
non-contrast buttons, or silently-failing API contracts between the
frontend and backend. This phase adds the three scanners that address
those:

1. **UI link sweep** — crawl every route + every link, confirm each
   loads something (not "page is empty", not 404, not 500)
2. **Accessibility (a11y)** — axe-core per page, WCAG 2.1 AA as the
   default bar (enterprise default; users can dial to A if they must)
3. **API contract** — compare actual API responses against OpenAPI /
   GraphQL schema; catches "works in tests, broken against real
   backend"

These three scanners collectively answer: *"If a user clicks every
link, every button, and every API fires, does the system still work?"*

## Scope Contract

### In-scope

**Slice 03.1 — Playwright UI link sweep + accessibility**

- `pforge-mcp/tempering/scanners/ui-playwright.mjs` — new scanner
  module implementing the preset-adapter contract from TEMPER-02
- **Auto-detection** of app URL:
  1. `.forge/tempering/config.json` → `scanners.ui-playwright.url`
  2. `package.json` scripts containing dev server URLs
  3. Environment-based detection via `.forge/env-config.json`
  4. Fallback: scanner reports "URL unknown — configure manually", no
     bug created
- **Link-sweep algorithm**:
  - Start from app root, BFS every same-origin link
  - Each page: confirm HTTP 200, content-length > 0, no console errors,
    no failed network requests (4xx/5xx) for same-origin assets
  - Cap depth at `config.scanners.ui-playwright.maxDepth` (default 5)
  - Cap total pages at `maxPages` (default 100) — enterprise default
    scales up, users can lower
  - Records violations in `scanners.ui-playwright.violations[]`
- **Accessibility pass** on every crawled page:
  - axe-core via `@axe-core/playwright`
  - Default rule set: WCAG 2.1 AA + best-practices
  - Report severity: critical / serious / moderate / minor
  - Per-page violations saved to
    `.forge/tempering/artifacts/<runId>/a11y/<url-hash>.json`
- **Screenshots captured per page** (baseline for TEMPER-04):
  `.forge/tempering/artifacts/<runId>/screenshots/<url-hash>.png`
- Browser runs **headless by default**, but `config` exposes
  `showBrowser: false` for local debugging
- Hub events `tempering-scanner-completed` with scanner="ui-playwright"
  / "ui-accessibility"
- Dashboard Tempering tab gets a **"UI Sweep"** subsection:
  pages crawled / links checked / a11y violations by severity
- Dashboard gains a **screenshot gallery** reading from
  `.forge/tempering/artifacts/<runId>/screenshots/`
- Tests — ~35 assertions including a fixture site with known violations

**Slice 03.2 — API contract scanner + extension point**

- `pforge-mcp/tempering/scanners/contract.mjs` — new scanner
- **OpenAPI contract**:
  - Reads OpenAPI 3.x spec from common locations:
    `openapi.yaml`, `openapi.json`, `docs/api/openapi.yaml`,
    `src/*/openapi.*`, or config override
  - For each operation, generates a request from the spec (examples
    preferred, schema-synthesized fallback)
  - Fires against configured base URL (same auto-detection as UI
    scanner, plus `X-Tempering-Scan: true` header so backends can
    optionally route to read-only routes)
  - Validates response status + shape against spec
- **GraphQL contract** (if schema.graphql exists):
  - Introspection diff against previous snapshot
  - Sample query for every root field, validation of returned shape
- **Stub slots for**: gRPC proto, tRPC, AsyncAPI — ship as
  extension-opportunity markers in `extensions/catalog.json`
- New anomaly `tempering-contract-mismatch` in watcher rules
- Tests — ~25 assertions

### Out of scope

- Visual-regression comparison (TEMPER-04 — uses the screenshots
  produced in this phase)
- Load / stress (TEMPER-05 — separate concern from sweep)
- Mobile / responsive breakpoints (extension opportunity, not core)
- Authenticated-user flows — scanner supports `config.scanners.
  ui-playwright.auth` hook but the *content* of auth is
  extension-provided (to avoid storing credentials in core)

### Forbidden actions

- Do NOT run sweep against production URLs unless config explicitly
  opts in (`config.scanners.ui-playwright.allowProduction: true`)
- Do NOT follow external-origin links (same-origin only, always)
- Do NOT POST/PUT/DELETE during link sweep — GET / HEAD only, every
  other method is only allowed in the contract scanner
- Do NOT store auth tokens in `.forge/tempering/` — only in
  extension-managed secret storage
- Do NOT commit screenshots to git — `.forge/tempering/artifacts/` is
  gitignored by default; config exposes retention policy (default 7
  days, then GC)

## Slices

### Slice 03.1 — Playwright sweep + a11y

**Files touched:**
- `pforge-mcp/tempering/scanners/ui-playwright.mjs` — new
- `pforge-mcp/tempering/artifacts.mjs` — new (artifact lifecycle /
  retention)
- `pforge-mcp/dashboard/app.js` — UI Sweep section, screenshot gallery
- `pforge-mcp/dashboard/index.html` — gallery DOM
- `pforge-mcp/tests/tempering-ui-sweep.test.mjs` — new, ~35 tests
- `pforge-mcp/tests/fixtures/temper/sweep-site/` — known-violations
  fixture
- `.gitignore` — `.forge/tempering/artifacts/`

### Slice 03.2 — Contract scanner + extension surface

**Files touched:**
- `pforge-mcp/tempering/scanners/contract.mjs` — new
- `pforge-mcp/tempering/scanners/contract-openapi.mjs` — new
- `pforge-mcp/tempering/scanners/contract-graphql.mjs` — new
- `pforge-mcp/tests/tempering-contract.test.mjs` — new
- `extensions/catalog.json` — new extension-opportunity markers for
  gRPC / tRPC / AsyncAPI
- `docs/EXTENSIONS.md` — tempering scanner extension contract documented

## Success Criteria

- Running `forge_tempering_run` against the Plan Forge dashboard
  itself (self-host) crawls all links, captures screenshots, reports
  any a11y violations
- Contract scanner successfully validates at least one OpenAPI-3.x
  fixture end-to-end
- Screenshot gallery renders in dashboard, configurable retention
  observed
- Extension contract documented with a reference implementation stub
- All existing tests continue to pass; new tests +60
- CHANGELOG entry under `v2.44.0`

## Dependencies

- **Requires TEMPER-02** (runner + adapter contract)
- Produces the screenshot baseline that **TEMPER-04** consumes

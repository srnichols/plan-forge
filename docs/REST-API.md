# Plan Forge REST API Reference

> **Server**: `pforge-mcp/server.mjs`
> **Default port**: `3100` (configurable via `PFORGE_PORT`)
> **Base URL**: `http://localhost:3100`
> **Endpoint count**: **~91** (as of v3.12.0)
> **Generated from**: `scripts/dump-rest-routes.mjs`

All endpoints accept and return JSON unless otherwise noted. Every MCP tool can also be invoked over REST through the generic dispatcher (`POST /api/tool/:name`) — the prefixed endpoints below are the "first-class" surfaces used by the dashboard and CLI.

---

## Discovery

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/.well-known/plan-forge.json` | Public discovery manifest — version, capabilities link, dashboard URL |
| `GET` | `/api/capabilities` | Full capability catalog (mirrors `forge_capabilities`) |
| `GET` | `/api/version` | Running server version |
| `GET` | `/api/status` | Liveness + last error |

## Plan Execution & Runs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/runs` | List recent runs |
| `GET` | `/api/runs/latest` | Latest run with status |
| `GET` | `/api/runs/:runIdx` | Specific run by index |
| `POST` | `/api/runs/trigger` | Kick off a plan run (`{ plan, mode, quorum }`) |
| `POST` | `/api/runs/abort` | Abort the active run |
| `GET` | `/api/replay/:runIdx/:sliceId` | Replay events for a slice |
| `GET` | `/api/plans` | Enumerate hardened plans |
| `GET` | `/api/workers` | Active worker processes |
| `GET` | `/api/traces` | List execution traces |
| `GET` | `/api/traces/:runId` | Trace detail for one run |

## Cost & Estimation

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cost` | Cost report (token spend per model + monthly aggregation) |

> Quorum/slice estimation is exposed via MCP tools (`forge_estimate_quorum`, `forge_estimate_slice`) rather than REST. Use `POST /api/tool/forge_estimate_quorum` for REST access.

## Search & Timeline

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/search` | Cross-surface search (plans, events, bugs, incidents, memory) |
| `GET` | `/api/timeline` | Unified event timeline (cursor-paged) |
| `GET` | `/api/hub` | WebSocket upgrade endpoint for live events |

## Memory (L1 / L2 / L3)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/memory` | Memory landing — recent captures + state |
| `GET` | `/api/memory/report` | Aggregate stats (captures/day, hit rate, top thoughts) |
| `POST` | `/api/memory/search` | Search across L2 captures (and L3 if OpenBrain configured) |
| `POST` | `/api/memory/capture` | Capture a thought (broadcasts `memory-captured` hub event) |
| `POST` | `/api/memory/drain` | Drain pending memory queue |
| `GET` | `/api/memory/presets` | Capture-rule presets |
| `GET` | `/api/brain/stats` | OpenBrain integration stats |

## Crucible (Idea Smelting)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/crucible/submit` | Start a new smelt (raw idea) |
| `POST` | `/api/crucible/ask` | Next interview question |
| `GET` | `/api/crucible/preview` | Render current draft + unresolved fields |
| `POST` | `/api/crucible/finalize` | Atomically claim next phase + write `Phase-X-PLAN.md` |
| `POST` | `/api/crucible/abandon` | Mark smelt abandoned |
| `GET` | `/api/crucible/list` | List all smelts (filter by status) |
| `GET` | `/api/crucible/config` | Read Crucible config |
| `POST` | `/api/crucible/config` | Write Crucible config |
| `GET` | `/api/crucible/manual-imports` | List manually-imported smelts (Spec Kit etc.) |
| `GET` | `/api/crucible/governance` | Governance summary (autopilot rate, fallbacks) |

## LiveGuard (Drift, Incidents, Deploys)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/drift` | Current drift score against architecture rules |
| `GET` | `/api/drift/history` | Drift trend over time |
| `GET` | `/api/incidents` | List incidents (severity, MTTR) |
| `POST` | `/api/incident` | Capture a new incident |
| `GET` | `/api/deploy-journal` | List deploys (version, deployer, notes) |
| `POST` | `/api/deploy-journal` | Record a deploy |
| `POST` | `/api/regression-guard` | Run regression gates against codebase |
| `GET` | `/api/runbooks` | List operational runbooks |
| `POST` | `/api/runbook` | Generate or update a runbook |
| `GET` | `/api/health-trend` | Health DNA aggregator (drift + cost + incidents + tests) |
| `GET` | `/api/hotspots` | Git churn hotspots |
| `GET` | `/api/triage` | Prioritized alert list |
| `GET` | `/api/liveguard/traces` | LiveGuard execution traces |
| `GET` | `/api/secret-scan` | Latest secret-scan results (values redacted) |
| `POST` | `/api/secret-scan/run` | Trigger a fresh scan |
| `GET` | `/api/deps/watch` | Latest dependency-vuln snapshot |
| `POST` | `/api/deps/watch/run` | Trigger a fresh dep scan |
| `GET` | `/api/env/diff` | Environment-variable key divergence across `.env` files |

## Quorum & Fix Proposals

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/fix/proposals` | List fix proposals |
| `POST` | `/api/fix/propose` | Generate an actionable fix plan |
| `GET` | `/api/quorum/prompt` | Read XSS-validated quorum prompt |
| `POST` | `/api/quorum/prompt` | Build a quorum prompt from drift/incident/deploy/secret findings |

## Tempering & Bugs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/tempering/artifact` | Latest tempering artifact (scan + score) |
| `POST` | `/api/tempering/bug-stub` | Create a bug stub from a tempering finding |
| `GET` | `/api/bugs/list` | List registered bugs (status/severity/plan filters) |

> Bug create/update is via MCP tools (`forge_bug_register`, `forge_bug_update_status`, `forge_bug_validate_fix`) or the generic dispatcher.

## Skills (Decision Tray)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/skills` | Skill catalog |
| `GET` | `/api/skills/pending` | Pending decisions awaiting accept/reject |
| `POST` | `/api/skills/accept` | Accept a pending decision |
| `POST` | `/api/skills/reject` | Reject a pending decision |
| `POST` | `/api/skills/defer` | Defer a pending decision |

## Inner Loop (v2.57 + v2.58)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/innerloop/status` | All inner-loop subsystem states |
| `GET` | `/api/innerloop/reviewer-calibration` | Reviewer-score calibration trace |
| `GET` | `/api/innerloop/gate-suggestions` | Gate-tightening suggestions from observed failures |
| `GET` | `/api/innerloop/cost-anomalies` | Cost anomalies detected across runs |
| `GET` | `/api/innerloop/proposed-fixes` | Auto-proposed fixes from health-trend signals |
| `GET` | `/api/innerloop/federation` | Federation-mode status (advisory cross-repo learning) |
| `POST` | `/api/innerloop/federation/toggle` | Enable/disable federation |

## Bridge & Approvals

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bridge/status` | Pending approvals waiting for a human-in-the-loop nudge |
| `POST` | `/api/bridge/approve/:runId` | Programmatic approval |
| `GET` | `/api/bridge/approve/:runId` | Browser-link approval (used by VS Code notifications) |

## Copilot Integration

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/copilot-instructions` | Read current `.github/copilot-instructions.md` |
| `POST` | `/api/copilot-instructions/preview` | Preview a regenerated `copilot-instructions.md` |
| `POST` | `/api/copilot-instructions/sync` | Sync `copilot-instructions.md` from project profile + principles |
| `POST` | `/api/openclaw/snapshot` | Post a LiveGuard snapshot to OpenClaw |
| `GET` | `/api/openclaw/config` | OpenClaw endpoint + auth config |

## GitHub & Team Coordination

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/github-metrics` | Live GitHub repo metrics via `gh` CLI |
| `GET` | `/api/github-readiness` | Readiness for Copilot Coding Agent dispatch |
| `GET` | `/api/team-dashboard` | Per-operator stats + conflict-risk assessment |
| `GET` | `/api/team-activity` | Recent run summaries from `.forge/team-activity.jsonl` |

## Notifications & Audit

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/notifications/config` | Notification channel config |
| `POST` | `/api/notifications/config` | Update channels (Slack, Teams, PagerDuty, Email) |
| `GET` | `/api/audit/config` | Audit drain loop config |
| `PUT` | `/api/audit/config` | Update audit config |
| `POST` | `/api/audit/drain` | Trigger one full drain pass |

## Dashboard & Settings

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dashboard-state` | Sticky dashboard tab + filter state |
| `POST` | `/api/dashboard-state` | Persist dashboard state |
| `GET` | `/api/config` | Read merged `.forge.json` config |
| `POST` | `/api/config` | Update config |
| `GET` | `/api/secrets` | Read `.forge/secrets.json` keys (values masked) |
| `POST` | `/api/secrets` | Update local secrets store |
| `GET` | `/api/extensions` | Installed extensions |
| `GET` | `/api/update-status` | Update-check status (latest release, currency) |
| `POST` | `/api/self-update` | Trigger self-update install |
| `POST` | `/api/server/restart` | Soft-restart the MCP server (HMR-friendly) |

## Generic MCP Dispatcher

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/tool/:name` | **Invoke any of the 106 MCP tools over REST.** Body is the tool's input contract. |
| `POST` | `/api/tool/org-rules` | Aliased convenience — `forge_org_rules` |
| `POST` | `/api/tool/run-plan` | Aliased convenience — `forge_run_plan` |

## Image Generation

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/image/generate` | Generate images via xAI Grok Aurora or OpenAI DALL-E |

---

## WebSocket

| Path | Purpose |
|---|---|
| `ws://localhost:3100/api/hub` | Live event stream — `run-*`, `slice-*`, `crucible-*`, `tempering-*`, `bug-*`, `memory-captured`, `incident-*`, `drift-*`, plus all skill events. The dashboard subscribes via the hub and replays events with a backlog buffer. |

---

## Calling the API from outside Plan Forge

```bash
# Run a plan
curl -X POST http://localhost:3100/api/runs/trigger \
  -H 'Content-Type: application/json' \
  -d '{ "plan": "docs/plans/Phase-28-PLAN.md", "mode": "auto", "quorum": "auto" }'

# Search across memory, plans, and bugs
curl 'http://localhost:3100/api/search?q=anvil+cache&type=memory'

# Invoke any MCP tool generically
curl -X POST http://localhost:3100/api/tool/forge_estimate_quorum \
  -H 'Content-Type: application/json' \
  -d '{ "plan": "docs/plans/Phase-28-PLAN.md" }'

# Stream live events
wscat -c ws://localhost:3100/api/hub
```

## Calling the API from the SDK

```js
import { client } from 'pforge-sdk';

const c = client({ baseUrl: 'http://localhost:3100' });

const runs = await c.get('/api/runs/latest');
const estimate = await c.callTool('forge_estimate_quorum', {
  plan: 'docs/plans/Phase-28-PLAN.md',
});
```

See [pforge-sdk/README.md](../pforge-sdk/README.md) for the full SDK surface.

---

## Regenerating this reference

Whenever routes are added or removed, refresh this doc:

```powershell
node scripts/dump-rest-routes.mjs > .rest-routes.txt
# Then update the tables below from .rest-routes.txt
```

The script walks `pforge-mcp/server.mjs`, `bridge.mjs`, `forge-master-routes.mjs`, and `hub.mjs` for `app.get/post/put/delete/patch(...)` calls and prints them grouped by `/api/<area>`.

# Unified System Architecture: Plan Forge + Forge-Claw + Optional OpenBrain

> **Purpose**: Architecture reference for Plan Forge's governed chat front door, execution lanes, Forge-Master reasoning, and optional external integrations.
>
> **Full version**: [planforge.software/manual/how-it-works.html](https://planforge.software/manual/how-it-works.html)
>
> **Last Updated**: 2026-05-16

---

## Executive Summary

| Project | Problem Solved | Analogy |
|---------|---------------|---------|
| **Plan Forge** | AI agents drift without guardrails | The **blueprint** — what to build, how, and when to stop |
| **Forge-Claw** | Chat requests need governed access to work | The **native front door** — Telegram intake, identity, approvals, and execution lanes |
| **OpenBrain (optional)** | Every AI session starts from zero | The **shared memory** — why we decided, what we learned, what failed |
| **OpenClaw (alternative)** | External systems need cross-channel coordination | An **optional coordinator** — separate from Forge-Claw's governed dispatcher |

Forge-Claw is Plan Forge's native, experimental inbound chat front door. A Telegram request enters Forge-Claw, which calls Forge-Master for read-only reasoning and places approved work on governed execution lanes. OpenClaw remains an alternative external coordinator and the Remote Bridge remains an outbound notification path. OpenBrain is optional; Plan Forge's local memory and execution do not require it.

## Architecture (Simplified)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Telegram → Forge-Claw (experimental, opt-in)                            │
│                  │                                                      │
│                  ├── Forge-Master reasoning (proposals only)            │
│                  ├── identity + approval + budget policy                │
│                  └── governed lanes: local | outbound workers | K8s Jobs│
│                                  │                                       │
│                         project home-lane MCP                            │
│                                  │                                       │
│ Plan Forge: hardened plans → validated execution → review and ship      │
│      ├── per-job worktree / clone; dispatcher-owned audit and budgets   │
│      └── Anvil + Lattice + Hallmark memory components                   │
│                                  │                                       │
│                  Optional OpenBrain (cross-project L3)                  │
│                  OpenClaw remains an alternative external integration   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Integration Points

| Integration | How |
|-------------|-----|
| Plan Forge → OpenBrain | Skills run `search_thoughts` before acting, `capture_thought` after completing — wrapped in Hallmark envelope |
| Plan Forge → OpenClaw | Orchestrator sends webhook notifications on slice completion/failure |
| Telegram → Forge-Claw | Native inbound messages pass allowlist, role/runtime policy, and governed dispatch |
| Forge-Claw → Forge-Master | Reasoning requests use caller metadata; proposals remain non-executable until separately authorized |
| Forge-Claw → execution lanes | Approved jobs run locally, on outbound remote workers, or as namespace-scoped Kubernetes Jobs |
| Plan Forge Audit Loop | `forge_tempering_drain` iterates scan → triage → fix; findings route to bug registry or Crucible |
| OpenBrain → Copilot Memory | `forge_sync_memories` generates hints Copilot Memory auto-discovers |
| OpenClaw → Plan Forge | Routes "build this feature" requests → triggers `forge_run_plan` |

## Memory Layers

| Layer | Scope | Persistence | Content |
|-------|-------|-------------|---------|
| **Copilot Memory** | Repo | 28 days (auto-expire) | Auto-discovered conventions |
| **Plan Forge** | Per-run | Permanent (`.forge/runs/`) | Slice results, gate outcomes, cost |
| **Anvil cache** | Per-repo | Until source changes | Δ-only content hashes (`.forge/anvil/`) |
| **Lattice index** | Per-repo | Until rebuild | Code structure — callers, blast radius (`.forge/lattice/`) |
| **OpenBrain** | Cross-project | Permanent (pgvector) | Architecture decisions, lessons learned — provenance-stamped (v0.7.0+) |

### Memory subsystem integration (v2.95.0)

| Integration | How |
|-------------|-----|
| Plan Forge → Anvil | Every `captureMemory()` call routes through Anvil for Δ-dedup before writing L2 |
| Plan Forge → Lattice | Code-emitting tools notify Lattice; `forge_run_plan` queries `forge_lattice_blast` per slice |
| Plan Forge → Hallmark | Every L3 write via `captureMemory()` is wrapped in a Hallmark provenance envelope |
| Hallmark → OpenBrain | Capability negotiation via `/health` before first write; graceful fallback to bare thoughts |
| Anvil DLQ → Slag-Heap | Rejected L3 writes land in `.forge/anvil/dlq/` for replay via `forge_anvil_dlq_drain` |

## Configuration

Plan Forge works standalone. Forge-Claw is experimental and opt-in; OpenBrain and OpenClaw are optional integrations:

```json
// .forge.json
{
  "openbrain": {
    "enabled": true,
    "endpoint": "http://localhost:5200",
    "project": "my-project"
  },
  "notifications": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/...",
    "events": ["run-complete", "slice-failed", "review-passed"]
  },
  "audit": {
    "mode": "off",
    "maxRounds": 5,
    "autoThresholds": { "minFilesChanged": 5, "minDaysSinceLastDrain": 3, "requireFindings": true },
    "environments": ["dev", "staging"],
    "forbidProduction": true
  }
}
```

> **Audit Loop** (v2.80+): The `audit` object controls automatic audit drain activation. Set `mode` to `"auto"` for threshold-gated runs or `"always"` for unconditional drains after plan completion. `"off"` (default) disables automatic drains. Use `pforge audit-loop` for manual one-shot runs regardless of config.

> **Full architecture details** including deployment topology, workspace layout, security model, session management, notification flows, and worked examples are available in the [Interactive Manual](https://planforge.software/manual/how-it-works.html) and preserved in git history (pre-v2.21).

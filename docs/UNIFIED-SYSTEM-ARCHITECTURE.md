# Unified System Architecture: Plan Forge + OpenBrain + OpenClaw

> **Purpose**: Architecture reference for integrating Plan Forge, OpenBrain, and OpenClaw into a single automated development system.
>
> **Full version**: [planforge.software/manual/how-it-works.html](https://planforge.software/manual/how-it-works.html)
>
> **Last Updated**: 2026-04-10

---

## Executive Summary

| Project | Problem Solved | Analogy |
|---------|---------------|---------|
| **Plan Forge** | AI agents drift without guardrails | The **blueprint** — what to build, how, and when to stop |
| **OpenBrain** | Every AI session starts from zero | The **memory** — why we decided, what we learned, what failed |
| **OpenClaw** | AI is locked inside one tool/surface | The **nervous system** — always-on orchestration across every channel |

Together they form a closed-loop system: describe a feature from any device → Plan Forge hardens into execution contract → Copilot builds it → OpenBrain captures every decision → OpenClaw notifies you on Slack/Telegram → fresh session reviews with full history.

## Architecture (Simplified)

```
┌─────────────────────────────────────────────────────────────────┐
│                   UNIFIED DEVELOPMENT SYSTEM                     │
│                                                                  │
│  OpenClaw (orchestrator + reach)                                │
│    └── Routes requests from any channel, sends notifications     │
│                                                                  │
│  Plan Forge (methodology + guardrails)                          │
│    └── 7-step pipeline, instruction files, validation gates      │
│                                                                  │
│  OpenBrain (memory + context)                                   │
│    └── Semantic search over prior decisions, cross-session       │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Points

| Integration | How |
|-------------|-----|
| Plan Forge → OpenBrain | Skills run `search_thoughts` before acting, `capture_thought` after completing |
| Plan Forge → OpenClaw | Orchestrator sends webhook notifications on slice completion/failure |
| OpenBrain → Copilot Memory | `forge_sync_memories` generates hints Copilot Memory auto-discovers |
| OpenClaw → Plan Forge | Routes "build this feature" requests → triggers `forge_run_plan` |

## Memory Layers

| Layer | Scope | Persistence | Content |
|-------|-------|-------------|---------|
| **Copilot Memory** | Repo | 28 days (auto-expire) | Auto-discovered conventions |
| **Plan Forge** | Per-run | Permanent (`.forge/runs/`) | Slice results, gate outcomes, cost |
| **OpenBrain** | Cross-project | Permanent (pgvector) | Architecture decisions, lessons learned |

## Configuration

Plan Forge works standalone. OpenBrain and OpenClaw are optional enhancements:

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
  }
}
```

> **Full architecture details** including deployment topology, workspace layout, security model, session management, notification flows, and worked examples are available in the [Interactive Manual](https://planforge.software/manual/how-it-works.html) and preserved in git history (pre-v2.21).

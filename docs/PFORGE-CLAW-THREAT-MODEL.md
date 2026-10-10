# PForge Claw Threat Model

**Scope:** PForge Claw dispatcher, Telegram adapter, workers, repositories, and
memory integrations. This is a slice-level threat model, not a claim that
worktrees or containers are equivalent to an operating-system sandbox.

## Assets

- Telegram bot token and webhook secret; GitHub, Copilot, and BYOK provider tokens.
- Worker authentication secrets and approval callback nonces.
- User repositories, isolated worktrees, and any credentials mounted into workers.
- Claw's `.forge` L2 state, including jobs, approvals, captures, and audit records.
- OpenBrain L3 memories, including provenance and visibility metadata.
- Runtime and quorum budgets, including provider spend and worker capacity.

## Trust boundaries

```text
 Telegram
    ↕
 Telegram adapter / poller → router and identity + rate gates
                                 ↕
                     dispatcher services
                       ↙           ↘
                workers / pods     project MCP / Forge-Master
                    ↕                       ↕
             repos / worktrees          OpenBrain L3
                    ↕
          GH CLI / Copilot / BYOK
```

Messages and callbacks cross the Telegram boundary as untrusted input. The
router authenticates the sender before dispatch; forwarded messages are
captured only when their normalized update preserves forward provenance.
Worker permission callbacks constrain requested operations but do not create an
OS boundary around a worktree. Captured memory crosses into the project MCP
with `origin: "untrusted"` and must remain data rather than instructions.

## STRIDE analysis

| Threat | Entry point | Mitigation | Owning slice | Test | Status |
|---|---|---|---|---|---|
| Spoofing | Telegram sender and callback identity | Allowlist and role checks precede dispatch; approval nonces are bound to requester, approver, chat, and topic | 5, 10, 18, 19 | `pforge-claw/tests/router.test.mjs`, `approvals.test.mjs`, `security-e2e.test.mjs` | tested |
| Tampering, including poisoned memory | Telegram text, forwards, callbacks, and memory recall | Forwarded normalized updates are fail-closed into capture; memory provenance is retained, fenced, and proposal actions are marked untrusted | 3, 9, 10, 15, 24, 25, 26 | `pforge-claw/tests/security-e2e.test.mjs`; companion recall fence: `pforge-master/tests/recall-fencing.test.mjs` | **blocked** |
| Repudiation | Command, approval, and state transitions | Append-only audit and job records record accepted, refused, throttled, and approval actions | 3, 5, 10, 12 | `pforge-claw/tests/security-e2e.test.mjs`, `approvals.test.mjs` | tested |
| Information disclosure | Logs, L2 state, Telegram output, snapshots, and secret-backed requests | Secret resolver redaction is applied at state and Telegram boundaries; error responses are sanitized; approval nonces are not persisted | 2, 4, 15/16, 23, 24, 26 | `pforge-claw/tests/security-e2e.test.mjs`, `secrets.test.mjs` | tested |
| Denial of service | Authenticated inbound messages and callback traffic | Synchronous per-user sliding-window admission bounds regular messages and audits only the first drop in a window | 11, 22, 26 | `pforge-claw/tests/security-e2e.test.mjs`, `telegram-rate-limiter.test.mjs` | tested |
| Elevation of privilege | Mutating commands, callbacks, and worker tool permissions | Role/scope policy, stored approval transitions, callback verification, and per-job permission rules constrain execution | 5, 8, 9, 10, 18, 20, 22, 23 | `pforge-claw/tests/permission-policy.test.mjs`, `approvals.test.mjs`, `router.test.mjs` | **blocked** |

## Residual risks

- Forward normalization and typed untrusted-context repairs are
  targeted-verified offline: source type is retained without original sender
  identity, and captured bytes are not placed in trusted instructions.
  [#333](https://github.com/srnichols/plan-forge/issues/333) and
  [#335](https://github.com/srnichols/plan-forge/issues/335) remain acceptance
  references until the quiescent whole-suite and live evidence are recorded.
- Dispatcher workspace, authenticated home routing and application-ACK wiring
  are targeted-verified in the local and one-shot fixtures. The remaining
  retry-consumer integration and global regression are not cleared by an
  earlier smoke pass; [#332](https://github.com/srnichols/plan-forge/issues/332)
  remains an acceptance reference.
- Callback traffic is not covered by the inbound message rate limiter; callback
  spam remains a residual denial-of-service vector.
- The default inbound rate limit has no discoverable config key. The router
  option is injectable, but configuration remains a follow-up in
  [#334](https://github.com/srnichols/plan-forge/issues/334).
- Worker command policy permits indirect execution paths through `npm` and
  `npx`; command permission checks do not eliminate risks in package scripts.
- Kubernetes `NetworkPolicy` enforcement depends on the cluster's CNI.
- Git worktrees are not an OS sandbox. A worker with process execution and
  mounted credentials can exceed repository-only boundaries if its runtime
  policy or deployment is misconfigured.
- Memory poisoning coverage exercises Claw persistence and prompt assembly
  using a fake memory backend. End-to-end Forge-Master behavior is separately
  covered by the companion package's recall-fencing tests.

## Secret-scan record

- **Invocation:** local `forge_secret_scan` handler, `since: "planning/main...HEAD"`.
- **Revision range:** `planning/main...HEAD` in the current Plan Forge repository.
- **Effective root:** repository root. The handler has no pathspec option, so
  this run was not restricted to `pforge-claw/`; it examined 211 changed files
  across the range, including Claw files. It does not include uncommitted
  worktree changes.
- **Findings:** 1,311 indicators in 170 files; 15 high-, 111 medium-, and
  1,185 low-confidence. Values are omitted. `clean: false`; these are scanner
  indicators, not individually verified credentials.
- **Supplementary package scan:** the same handler examined a temporary,
  package-only Git root containing the current `pforge-claw/` snapshot:
  208 files, 1,339 indicators in 208 files (18 high-, 115 medium-, and
  1,206 low-confidence), `clean: false`. The snapshot used an empty synthetic
  baseline because `pforge-claw/` is absent from the actual `planning/main`
  ref; it is not an actual `planning/main...HEAD` package diff. The temporary
  root was removed after scanning.
- **Date:** 2026-10-08.

Both scans inspect a **git diff**, not every file in the live package. The
primary scan is a real repository-range scan but cannot scope to Claw; the
supplementary scan includes the current package snapshot but has a synthetic
baseline. Neither is reported as clean. `.forge/secret-scan-cache.json` is
operational output and is not part of this change.

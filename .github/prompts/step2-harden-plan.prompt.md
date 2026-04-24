---
description: "Pipeline Step 2 — Harden a draft plan into an execution contract with scope contracts, execution slices, validation gates, and TBD resolution."
---

# Step 2: Harden the Plan

> **Pipeline**: Step 2 of 5 (Session 1 — Plan Hardening)
> **When**: After pre-flight passes (Step 1)
> **Model suggestion**: Claude (best at structured plan generation and scope contract design)
> **Next Step**: `step3-execute-slice.prompt.md` (new session)

> ⚠️ **Do not harden plans with headless `gh copilot`** (meta-bug [#86](https://github.com/srnichols/plan-forge/issues/86)).
> `gh copilot` in `-p` / `--autopilot` mode runs in a sandboxed session that cannot write to your
> repository regardless of the flags you pass (`--allow-all`, `--allow-all-tools --allow-all-paths
> --no-ask-user`, `--yolo --no-ask-user` all fail the same way). The CLI will either exit 1 with
> `Permission denied and could not request permission from user`, or exit 0 with the edits written
> to `~/.copilot/session-state/<sid>/files/` instead of your repo.
>
> **Use interactive hardening instead**: open this prompt in VS Code Copilot chat (agent mode),
> or call `forge_master_ask` with `mode: "harden"`. Both can write to the workspace directly.

Replace `<YOUR-PLAN>` with your plan filename (without path or `.md` extension).

---

Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md
2. docs/plans/<YOUR-PLAN>.md
3. docs/plans/DEPLOYMENT-ROADMAP.md
4. .github/copilot-instructions.md

Also check for prior phase lessons (if they exist — skip if not found):
- `/memories/repo/conventions.md` — patterns and conventions from earlier phases
- `/memories/repo/lessons-learned.md` — past mistakes to avoid
- `/memories/repo/forbidden-patterns.md` — patterns that caused regressions

**Prior plan postmortems (Phase-25 L5 closed loop)**:
Before hardening, also scan `.forge/plans/<plan-basename>/postmortem-*.json` for
the plan you are hardening (same basename as the draft). If any exist, read the
newest 3 and factor them into the Scope Contract:

- If `retriesPerSlice` shows a slice that flapped 3+ times, strengthen its
  validation gate or split it into smaller slices.
- If `gateFlaps > 0` on multiple prior runs, your gate commands are unstable —
  replace grep/pipe-based gates with allowlisted node assertions.
- If `topFailureReason` repeats across postmortems, add a mitigation in the
  current plan's Risks section and reference the prior failure.
- If `costDelta.delta` trends upward across runs, flag a budget risk in the
  plan's Budget section.
- If no postmortems exist, note "No prior postmortems — first execution."

This is a READ of the postmortems — do NOT modify them. Pure signal for the
hardener.

Now act as a PLAN HARDENING AGENT (see the Plan Hardening Prompt in the runbook).

**CLARIFICATION CHECK**: Before hardening, scan the plan for `[NEEDS CLARIFICATION]` markers.
If any exist, list them all and wait for the user to resolve them before proceeding.

Harden <YOUR-PLAN>.md by adding all 6 Mandatory Template Blocks from the runbook:
- Scope Contract (in-scope, out-of-scope, forbidden actions)
- Required Decisions (flag anything implicit as TBD)
- Acceptance Criteria (use **MUST**: and **SHOULD**: prefixes for each criterion — the analyzer scores these)
- Execution Slices (30-120 min each, with Depends On + Context Files + Parallelism tag)
- Re-anchor Checkpoints
- Definition of Done (must include Reviewer Gate checkbox)
- Stop Conditions

**IMPORTANT**: Format Acceptance Criteria as:
```
- **MUST**: Description of required criterion
- **SHOULD**: Description of recommended criterion
```
Do NOT use `- [ ]` checkbox format — the analyzer cannot score checkboxes as effectively.

For each Execution Slice:
- Tag as [parallel-safe] (with Parallel Group) or [sequential]
- Include relevant .github/instructions/*.instructions.md files in Context Files
- List only instruction files whose domain matches the slice (not all 17 — each consumes context budget)
- Add a Parallel Merge Checkpoint after each parallel group
- **Validation gates MUST be executable commands**, not prose descriptions:
  - **Good**: `**Validation Gate**:\n\`\`\`bash\ndotnet test\n\`\`\``
  - **Good**: `**Validation Gate**: \`dotnet build\``
  - **Bad**: `**Validation Gate**: Files compile, DTOs have correct properties`
  - For manual checks that can't be automated, prefix with `[manual]`: `**Validation Gate**: [manual] UI layout matches mockup`

Do NOT add features or expand scope. Only structure what already exists.

After hardening, run a TBD RESOLUTION SWEEP:
1. Scan Required Decisions for TBD entries.
2. Resolve using context from the plan, roadmap, and guardrails.
3. If a TBD requires human judgment, list it and ask the user.
4. Wait for all TBDs to be resolved before finalizing.

Also validate parallelism tags:
- Are [parallel-safe] slices truly independent (no shared files)?
- Are Parallel Merge Checkpoints present after each parallel group?

After all sections are drafted, run a **PLAN QUALITY SELF-CHECK** before outputting:

1. Does every Execution Slice have at least one validation gate with an exact command?
2. Does every [parallel-safe] slice avoid touching files shared by other slices in the same group?
3. Are all REQUIRED DECISIONS resolved (no TBD remaining)?
4. Does the Definition of Done include "Reviewer Gate passed (zero 🔴 Critical)"?
5. Do the Stop Conditions cover: build failure, test failure, scope violation, and security breach?
6. Does every slice list only the instruction files relevant to its domain (not all 17)?
7. Are MUST acceptance criteria from the spec traceable to at least one slice's validation gate?
8. Do all validation gate commands pass the **Gate Portability Rules** below?

### Gate Portability Rules

Gate commands run via `execSync` on the host OS — on Windows this means `cmd.exe`, not bash.
Every gate command MUST be cross-platform. Apply these rules when writing gates:

> **Windows + Git for Windows note**: If the user has Git for Windows installed, the orchestrator
> auto-wraps gate commands that contain Unix-shell syntax (`grep`, `test`, `sed`, `awk`, `cat`, etc.)
> in `bash -c "..."` automatically. In that case, Unix-shell gates work fine. Without Git for Windows,
> only `node`, `npx`, and `npm` commands are safe in gates on Windows — use `node -e` one-liners
> for all non-vitest checks.

| Rule | Bad | Good |
|------|-----|------|
| **No Unix-only commands** | `grep -c "foo" file.md` | `node -e "const c=require('fs').readFileSync('file.md','utf8');if(!c.includes('foo'))throw new Error('missing');console.log('ok');"` |
| **No `/dev/stdin`** | `curl ... \| node -e "...readFileSync('/dev/stdin',...)"` | `readFileSync(0,'utf8')` for fd 0, or move to vitest |
| **No `/tmp/` or `/dev/null`** | `echo '{}' > /tmp/test.json` | `node -e "require('fs').writeFileSync(require('os').tmpdir()+'/test.json','{}')"` |
| **No pipe to grep** | `git status \| grep -c "Ignored"` | `node -e "const{execSync}=require('child_process');const o=execSync('git status',{encoding:'utf8'});..."` |
| **No `//` comments in `node -e`** | `node -e "const x=1; // comment"` | Remove comments — `//` swallows the rest of a one-liner |
| **No `--grep` with vitest** | `npx vitest run --grep "pattern"` | Run the full suite: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"` |
| **No `pforge` CLI in gates** | `pforge runbook plan.md` | `pwsh ./pforge.ps1 runbook plan.md` or rewrite as `node -e` |
| **No `pforge analyze` in gates** | `pforge analyze docs/plans/Phase-X.md` | Omit — the orchestrator auto-runs analyze post-execution. Use `pforge regression-guard <plan>` if you need a doc-integrity gate. `pforge analyze` exits 1 on noisy text-match coverage heuristics and reliably false-negatives Slice 5 recursive-hardening gates (observed on Phases 38.1-38.8). |
| **No multi-line `node -e`** | `node -e "\n import(...)...\n"` | Collapse to single line |
| **No `cat FILE`** | `cat VERSION` | `node -e "console.log(require('fs').readFileSync('VERSION','utf8').trim())"` |
| **`npx vitest` from project root** | `npx vitest run` (picks up wrong version) | `bash -c "cd pforge-mcp && npx vitest run"` |
| **curl localhost:* in non-final slices** | `curl http://localhost:3100/api/...` | Move runtime API checks to vitest integration tests |
| **No nested escaped quotes inside `bash -c "..."`** (meta-bug [#93](https://github.com/srnichols/plan-forge/issues/93)) | `bash -c "grep -q onclick=\"forgeMasterPickPrompt\" file.html"` — collapses on Windows `cmd → bash` with `/bin/bash: -c: line 1: unexpected EOF while looking for matching quote` | Use single quotes inside double: `bash -c "grep -q onclick='forgeMasterPickPrompt' file.html"`, OR move to `node -e` with `.includes()`, OR rely on an existing vitest test that already proves the absence/presence. Never stack three levels of escapes (`\\\"`) — they survive some quoting layers and break on others. |

**Preferred gate pattern** (covers 90% of slices):
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

Add additional `node -e` checks only when the vitest suite doesn't cover a specific validation (e.g., checking a file exists, verifying an export).

If any check fails, revise the plan before outputting. Do not present a plan that fails its own quality check.

**After hardening, run the automated gate linter** (if `forge_analyze` or the orchestrator is available):
```
node --input-type=module -e "import{lintGateCommands}from'./pforge-mcp/orchestrator.mjs';const r=lintGateCommands('<plan-file>');console.log(r.summary);r.errors.forEach(e=>console.log('ERR:',e.message));r.warnings.forEach(w=>console.log('WARN:',w.message));"
```
Fix all errors and warnings before declaring the plan hardened. The same lint runs as a pre-flight check in `runPlan()` — errors will block execution.

Finally, run a **SESSION BUDGET CHECK**:

- Count total slices
- If 8+ slices: recommend a session break point (e.g., "Plan for a session break after Slice N —
  commit progress, start a new session, resume from Slice N+1")
- If any single slice has 5+ Context Files: flag it and suggest trimming to the 3 most relevant

Output a TBD summary:
| # | Decision | Status | Resolution |
|---|----------|--------|------------|

If ALL TBDs resolved: "Plan hardened ✅ — proceed to Step 3 (Execute Slices)"
If ANY need input: list them and WAIT.

---

## Persistent Memory (if OpenBrain is configured)

- **Before hardening**: `search_thoughts("<phase topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode")` — load prior decisions, patterns, and post-mortem lessons that inform scope and slicing
- **During TBD resolution**: `search_thoughts("<ambiguous topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — check if prior decisions already resolve the ambiguity
- **After hardening**: `capture_thought("Plan hardened: <phase name> — N slices, key decisions: ...", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-2-hardening", type: "decision")` — persist hardening decisions for the execution session

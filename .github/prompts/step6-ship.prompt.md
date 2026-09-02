---
description: "Pipeline Step 6 — Ship the completed phase: commit, update roadmap, capture postmortem, optionally push and create PR."
---

# Step 6: Ship

> **Pipeline**: Step 6 of 6 (Session 4 — Ship)
> **When**: After the Review Gate passes (Step 5)
> **Model suggestion**: Any model / Copilot Auto (10% token savings) — commit, roadmap update, and postmortem are straightforward
> **Prerequisite**: Step 5 verdict must be **PASS**

Replace `<YOUR-HARDENED-PLAN>` with your hardened plan filename.

---

Read these files first:
1. docs/plans/<YOUR-HARDENED-PLAN>.md (Definition of Done + Execution Slices)
2. docs/plans/DEPLOYMENT-ROADMAP.md
3. .github/instructions/git-workflow.instructions.md

> **Plan Forge maintainers shipping a framework release** (i.e., bumping the `pforge` version itself, not just closing a project phase): follow [docs/RELEASE-CHECKLIST.md](../../docs/RELEASE-CHECKLIST.md) instead of this prompt. The checklist covers VERSION/package.json sync, hooks mirror, instruction enumeration, the mandatory `gh release create` step, and bump-back-to-dev.

Now act as a SHIPPING AGENT. The Review Gate has passed — your job is to finalize and close out this phase.

---

### 1. VERIFY REVIEW PASSED

Confirm that the Review Gate (Step 5) issued a **PASS** verdict.
If the verdict was LOCKOUT or unknown, direct me back to Step 5 before proceeding.

### 2. COMMIT

1. Run `git status` — list all changed/created files
2. Run `git diff --stat` — summarize scope of changes
3. Read the hardened plan's phase name and goal
4. Generate a conventional commit message:
   - Type: `feat` / `fix` / `refactor` (based on phase type)
   - Scope: derived from phase name
   - Body: list execution slices completed
5. Show the proposed commit message and **ask for confirmation**
6. Run `git add -A` then `git commit -m "<message>"`

### 3. UPDATE ROADMAP

1. Read `docs/plans/DEPLOYMENT-ROADMAP.md`
2. Find the entry for this phase
3. Update status from 🚧 (or 📋) to ✅ Complete
4. Commit: `docs(roadmap): mark Phase N complete`

### 4. CAPTURE POSTMORTEM

Compile a brief postmortem and append it to the plan file as a `## Postmortem` section:

- **What went well** — slices that passed cleanly
- **What was tricky** — slices that required retries or amendments
- **Lessons learned** — patterns to remember for next time
- **Future work** — anything deferred or flagged during review

Commit: `docs(phase-N): add postmortem`

### 5. PUSH & PR (ask first)

**Do NOT push automatically.** Ask me:

> "Push to remote and create a PR? [Yes / Push only / Skip]"

- **Yes**: `git push origin <branch>` + offer to create PR
- **Push only**: `git push origin <branch>`
- **Skip**: Leave commits local

### 6. SUMMARY

Output:

```
Phase: <name>
Status: ✅ Complete
Commits: N
Files: N created, N modified
Roadmap: Updated
Pushed: Yes/No
```

If phase is complete: "Phase shipped ✅ — ready for the next feature."

---

### 7. CAPTURE LESSONS TO MEMORY

After shipping, persist lessons learned so future phases benefit from this experience.
This step uses Copilot's built-in memory system — no external tools required.

**Save to `/memories/repo/`** (workspace-scoped, survives across sessions).

**Name each file by its subject**, one topic per file — `prisma-migration-fk-syntax.md`,
`gate-portability-windows-shim.md`, `release-procedure.md`. A future hardener finds them
by enumerating the directory and reading titles, so the title is the index.

**Do not create `conventions.md`, `lessons-learned.md`, or `forbidden-patterns.md`.**
Those three catch-alls were prescribed here for a long time and were never actually
written, because one unbounded append-only file is unreadable and authors naturally
reach for topic names. Meanwhile the hardener was told to look for exactly those three
filenames, so it reported "no prior lessons exist" on every project — a closed loop that
always reported absence (meta-bug [#257](https://github.com/srnichols/plan-forge/issues/257)).

Write one file per lesson worth carrying:

- A pattern or convention this phase established, and why the alternative was rejected
- A slice that needed retries, with the symptom that misled you and the tell that resolved it
- A pattern that caused a regression or was flagged by the Review Gate
- A gate or command form that behaved differently than expected, with the measured evidence

Keep each file short and specific enough that its filename predicts its contents. Append
to an existing topic file rather than starting a near-duplicate; never overwrite prior entries.

> **Why this matters**: Without memory, every phase starts from zero. With memory,
> Phase N+1 avoids Phase N's mistakes and reuses its patterns automatically. The
> hardening step (Step 2) enumerates this directory to inform scope and slicing decisions.

---

## MCP Tools (if Plan Forge MCP server is running)

- **Pre-ship validation**: call `forge_analyze` with the plan file — verify consistency score meets threshold before committing
- **Final sweep**: call `forge_sweep` to confirm zero deferred-work markers remain
- **Scope check**: call `forge_diff` to verify no forbidden files were touched

> Run these before the commit step. If forge_analyze scores below 80, flag for the user before proceeding.

---

## Persistent Memory (if OpenBrain is configured)

- **Before shipping**: `search_thoughts("postmortem lessons", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load lessons from prior phase postmortems to check for recurring shipping issues (failed pushes, missed changelog entries, forgotten tags)
- **After postmortem**: `capture_thoughts([...lessons], project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "phase-N-postmortem", type: "postmortem")` — batch capture all lessons, patterns, architecture decisions, bugs, and conventions from this phase
- **Include**: architecture decisions, patterns discovered, bugs encountered, conventions established, and anything flagged for future phases

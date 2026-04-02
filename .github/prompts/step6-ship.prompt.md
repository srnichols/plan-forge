---
description: "Pipeline Step 6 — Ship the completed phase: commit, update roadmap, capture postmortem, optionally push and create PR."
---

# Step 6: Ship

> **Pipeline**: Step 6 of 6 (Session 4 — Ship)  
> **When**: After the Review Gate passes (Step 5)  
> **Prerequisite**: Step 5 verdict must be **PASS**

Replace `<YOUR-HARDENED-PLAN>` with your hardened plan filename.

---

Read these files first:
1. docs/plans/<YOUR-HARDENED-PLAN>.md (Definition of Done + Execution Slices)
2. docs/plans/DEPLOYMENT-ROADMAP.md
3. .github/instructions/git-workflow.instructions.md

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

## Persistent Memory (if OpenBrain is configured)

- **After postmortem**: `capture_thoughts([...lessons], project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "phase-N-postmortem")` — batch capture all lessons, patterns, architecture decisions, bugs, and conventions from this phase
- **Include**: architecture decisions, patterns discovered, bugs encountered, conventions established, and anything flagged for future phases

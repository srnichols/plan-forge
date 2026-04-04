# Quickstart Walkthrough: Your First Feature with Plan Forge

> **Time**: ~30 minutes  
> **Prerequisites**: VS Code installed, GitHub Copilot signed in, `setup.ps1` already run  
> **What you'll build**: A `GET /health` endpoint — a tiny feature, but you'll run the full pipeline to learn how it works

---

## What You'll Learn

By the end of this walkthrough, you'll have:

- ✅ Specified a feature with Step 0
- ✅ Created and hardened a plan (Steps 1–2)
- ✅ Executed the plan slice-by-slice (Steps 3–4)
- ✅ Run an independent review (Step 5)
- ✅ Shipped the feature (Step 6)

> **Three ways to run the pipeline**: This walkthrough uses the **Prompt Template** approach
> (attaching `.prompt.md` files in Copilot Chat) because it's the most educational — you see
> exactly what each step does. After completing this walkthrough, try the **Pipeline Agent**
> approach (select the Specifier agent, click handoff buttons) for a smoother experience.
> If you don't use VS Code, the **Copy-Paste Prompts** in
> `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md` work in any AI tool.
> See [README → Three Ways to Run the Pipeline](../README.md#three-ways-to-run-the-pipeline) for a comparison.

---

## Before You Start

Make sure setup is done:

```powershell
.\validate-setup.ps1
```

Or use the CLI equivalent:
```powershell
.\pforge.ps1 smith    # Inspect the forge (environment + setup health)
.\pforge.ps1 check    # Validate setup files
```

All checks should pass. If not, re-run `.\setup.ps1 -Preset <your-stack>`.

> **Using Claude, Cursor, or Codex?** Add `-Agent claude` (or `cursor`, `codex`, `all`) to your setup command to generate native files for those tools alongside Copilot.

---

## Step 0: Specify the Feature

1. Open VS Code
2. Open Copilot Chat: `Ctrl+Shift+I` (Windows) or `Cmd+Shift+I` (Mac)
3. Select **Agent Mode** at the bottom of the chat panel
4. Click the **📎 attach file** button and select `.github/prompts/step0-specify-feature.prompt.md`
5. Replace `<FEATURE-NAME>` with `health-endpoint` and send

The agent will ask if you have an existing doc. Say **"no"** — we're starting fresh.

Then it will interview you. Here are example answers:

> **Problem Statement**: "We need a health check endpoint so load balancers and monitoring tools can verify the service is running."
>
> **User Scenarios**: "A load balancer sends GET /health every 30 seconds. It expects a 200 OK with `{"status": "healthy"}`. If the service is down, it gets a connection refused."
>
> **Acceptance Criteria**: "GET /health returns 200 with JSON body. Response time under 50ms. No authentication required."
>
> **Edge Cases**: "If the database is unreachable, return 503 with `{"status": "degraded", "reason": "database"}`. If an unknown path is hit, normal 404 still works."
>
> **Out of Scope**: "No deep dependency checks (Redis, external APIs). No custom health check UI. No metrics endpoint (that's a separate phase)."
>
> **Open Questions**: None — this is straightforward.

The agent compiles your answers into a specification block and creates `docs/plans/Phase-1-HEALTH-ENDPOINT-PLAN.md`.

**When it says "Specification complete"** — you're ready for the next step.

---

## Steps 1–2: Pre-flight & Harden (same session)

Still in the same chat session:

1. Attach `.github/prompts/step1-preflight-check.prompt.md`
2. Replace `<YOUR-PLAN>` with `Phase-1-HEALTH-ENDPOINT-PLAN` and send

The agent checks your git state, guardrail files, and roadmap. Everything should pass.

3. Now attach `.github/prompts/step2-harden-plan.prompt.md`
4. Replace `<YOUR-PLAN>` with `Phase-1-HEALTH-ENDPOINT-PLAN` and send

The agent adds the 6 mandatory blocks to your plan:

- **Scope Contract** — what's in, what's out, what's forbidden
- **Execution Slices** — for a health endpoint, probably 2 small slices
- **Validation Gates** — build & test commands
- **Definition of Done** — measurable completion criteria

When it says **"Plan hardened"** — Session 1 is done.

---

## Steps 3–4: Execute & Sweep

1. **Start a NEW chat session** — click the `+` button in the chat panel (important!)
2. Select **Agent Mode**
3. Attach `.github/prompts/step3-execute-slice.prompt.md`
4. Replace `<YOUR-HARDENED-PLAN>` with `Phase-1-HEALTH-ENDPOINT-PLAN` and send

The agent reads the hardened plan and executes Slice 1:
- Creates the health endpoint file
- Runs the build command
- Runs the test command
- Reports pass/fail

Then it moves to Slice 2 (tests), and after that runs the **Completeness Sweep** — scanning for any TODO/FIXME/stub markers.

When it says **"Execution complete"** — Session 2 is done.

---

## Step 5: Independent Review

1. **Start a NEW chat session** — click `+` again
2. Select **Agent Mode** (or **Ask Mode** for a truly read-only review)
3. Attach `.github/prompts/step5-review-gate.prompt.md`
4. Replace `<YOUR-HARDENED-PLAN>` with `Phase-1-HEALTH-ENDPOINT-PLAN` and send

The agent reviews all changes against the Scope Contract:
- Were any forbidden files touched?
- Does the code follow architecture patterns?
- Are tests included?
- Any scope creep?

For a health endpoint, this should be a clean **PASS**.

---

## Step 6: Ship

1. **Start a NEW chat session** (or continue if context allows)
2. Attach `.github/prompts/step6-ship.prompt.md`
3. Replace `<YOUR-HARDENED-PLAN>` with `Phase-1-HEALTH-ENDPOINT-PLAN` and send

The agent:
- Commits with a conventional message: `feat(health): add GET /health endpoint`
- Updates `DEPLOYMENT-ROADMAP.md` to mark Phase 1 as ✅ Complete
- Captures a brief postmortem
- Asks if you want to push

Say **"yes"** to push, or **"skip"** to keep it local.

**Congratulations — you've run the full Plan Forge pipeline!** 🎉

---

## What Just Happened?

```
Session 1 (Specify & Plan)    → You described what you wanted, the AI structured it
Session 2 (Execute)            → The AI built it slice-by-slice with validation gates
Session 3 (Review)             → A fresh AI session checked for mistakes and drift
Session 4 (Ship)               → The AI committed, updated docs, and captured lessons
```

Each session was isolated — the reviewer didn't carry bias from the builder, and every step had guardrails loaded automatically from your `.github/instructions/` files.

---

## Alternative: Pipeline Agents (Click-Through)

Instead of attaching prompt files, you can use pipeline agents with handoff buttons:

1. Select the **Specifier** agent from the agent picker dropdown
2. Describe your feature
3. Click **"Start Plan Hardening →"** when done
4. Click **"Start Execution →"** when hardened
5. Click **"Run Review Gate →"** when executed
6. Click **"Ship It →"** when review passes

Same pipeline, fewer copy-paste steps.

---

## Next Steps

- **Run a real feature** through the pipeline — something that takes 2+ hours
- **Generate a Project Profile** — attach `.github/prompts/project-profile.prompt.md` to customize guardrails
- **Define Project Principles** — attach `.github/prompts/project-principles.prompt.md` to declare non-negotiable rules
- **Explore agents** — try the Security Reviewer or Architecture Reviewer on your codebase
- **Add CI validation** — drop `uses: srnichols/plan-forge-validate@v1` into your PR workflow to automate quality gates
- **Read the full guide** — [docs/COPILOT-VSCODE-GUIDE.md](COPILOT-VSCODE-GUIDE.md) for advanced tips

---
name: stakeholder-briefing
description: Generate a per-organisation stakeholder briefing for Plan Forge from the canonical template, optionally drafting the prospect-specific sections from a source directory of customer materials. Use when an internal champion needs to walk a colleague or VP through the decision to adopt Plan Forge.
argument-hint: "[--source-dir <path>] [--out <path>]"
tools: [read_file, run_in_terminal, file_search, grep_search]
---

# Stakeholder Briefing Skill

## Trigger

"Generate a stakeholder briefing" / "Draft an adoption briefing for &lt;company&gt;" / "Tailor the Plan Forge briefing for my org" / `/stakeholder-briefing`

## Inputs

The skill needs five placeholders. Prompt the user for any that are not supplied:

| Placeholder | What to ask | Example answer |
|---|---|---|
| `<<COMPANY>>` | "What organisation is the briefing for?" | "Contoso" |
| `<<SQUADS>>` | "One sentence on how their engineering org is structured." | "Platform team plus five product squads; SRE shared across all." |
| `<<KPIS>>` | "Two or three KPIs they actually report on." | "Defect escape rate, cost per shipped feature, story-point throughput." |
| `<<PILOT_TIMELINE>>` | "Proposed pilot window?" | "30 days starting 2026-06-01" |
| `<<THE_ASK>>` | "What do you need this stakeholder to do at the end?" | "Approve the 30-day pilot with the Payments squad, decision by 2026-05-25." |

If any answer is "I don't know yet", leave the corresponding placeholder in the output for the user to fill manually — do **not** invent.

Optional flags:

- `--source-dir <path>` — directory of customer materials (slides converted to text, strategy docs, RFP drafts, public blog posts). When present, the skill uses `forge_search` and `grep_search` against it to draft the prospect-specific sections (2, 3, 5, 7, 10, 12).
- `--out <path>` — output path for the filled briefing. Default: `./stakeholder-briefing-<<company-slug>>.md`. The skill writes markdown; if the user wants HTML they can run a markdown→HTML conversion downstream.

## Steps

### 1. Load the canonical template

```bash
# Locate the template — try local repo first, fall back to GitHub raw
TEMPLATE_LOCAL="docs/manual/stakeholder-briefing-template.md"
TEMPLATE_URL="https://raw.githubusercontent.com/srnichols/plan-forge/master/docs/manual/stakeholder-briefing-template.md"

if [ -f "$TEMPLATE_LOCAL" ]; then
  cp "$TEMPLATE_LOCAL" /tmp/briefing-draft.md
else
  curl -fsSL "$TEMPLATE_URL" -o /tmp/briefing-draft.md
fi
```

### Conditional: Template fetch failed

> If neither the local file nor the URL is reachable → tell the user to clone the Plan Forge repo or download the template manually, and stop. Do **not** synthesise the template from memory — it must be the canonical source so the briefing and the manual cannot drift.

### 2. Substitute the five placeholders

Use a simple find-replace pass. Do **not** use regex with greedy match — the placeholders are exact tokens.

```bash
sed -i "s|<<COMPANY>>|${COMPANY}|g" /tmp/briefing-draft.md
sed -i "s|<<SQUADS>>|${SQUADS}|g" /tmp/briefing-draft.md
sed -i "s|<<KPIS>>|${KPIS}|g" /tmp/briefing-draft.md
sed -i "s|<<PILOT_TIMELINE>>|${PILOT_TIMELINE}|g" /tmp/briefing-draft.md
sed -i "s|<<THE_ASK>>|${THE_ASK}|g" /tmp/briefing-draft.md
```

### 3. (Optional) Draft prospect-specific sections from `--source-dir`

If `--source-dir` is supplied, draft sections 2, 3, 5, 7, 10, 12 from the user's existing materials.

| Section | What to look for in `--source-dir` |
|---|---|
| **2. Reading alongside** | Strategy decks, RFP documents, architecture proposals. Cite slide numbers / document section headings explicitly. |
| **3. Where it hurts** | Interview notes, support-ticket summaries, retro outputs, RFP problem statements. Lift verbatim phrases when possible. |
| **5. Mapping to squads** | Org charts, team-page screenshots, README contributor sections. Build the squad-to-station table from explicit org structure, not guesses. |
| **7. Mapping to KPIs** | OKR dashboards, board-deck KPI slides, public earnings transcripts. Use the user's KPI names, not Plan Forge's. |
| **10. Pilot proposal** | Calendar / release-train docs to honour their existing rhythm. Pilot weeks should align with their sprint or release cadence. |
| **12. The ask** | Approval-process docs to know who actually approves what at this org. The ask must be answerable by the named recipient. |

For each section, run two passes:

```bash
# Pass 1: semantic search for the section's topic across the source directory
# (Plan Forge MCP — use forge_search if available; otherwise grep)
forge_search "engineering organisation structure" --source-dir "$SOURCE_DIR" --limit 5

# Pass 2: cite the strongest 2–3 sources verbatim in the section
# Do NOT paraphrase if a one-sentence quote works better.
```

Replace the HTML-comment guidance blocks in the template with the drafted prose. Keep the guidance comments visible above the prose so the user can see what the section was supposed to contain — they will edit further.

### Conditional: No `--source-dir` supplied

> If no `--source-dir`, leave sections 2, 3, 5, 7, 10, 12 with their HTML-comment guidance intact. Tell the user explicitly which sections they need to write themselves, and remind them the template was designed so half the briefing is canonical and half is theirs — that is the point.

### 4. Validate the draft

Run the checklist before writing the output file:

- [ ] All five placeholders replaced (grep for `<<` in the draft; result should be empty)
- [ ] If `--source-dir` was used: the cited sources are actually in `$SOURCE_DIR` (no hallucinated citations)
- [ ] Total word count is between 2400 and 3400 (target ~3000 — see audit §3 risk note about scope creep)
- [ ] Section 10 has a named timeline, not "TBD"
- [ ] Section 12 (The ask) is one sentence, answerable yes/no/let-me-think — not "let me know"

```bash
# Quick checks
grep -c "<<" /tmp/briefing-draft.md  # expect 0
wc -w /tmp/briefing-draft.md         # expect 2400–3400
```

### Conditional: Validation fails

> If any check fails → fix in place and re-run validation. Do not write the output file until all checks pass. If the word count is below 2400 the briefing is probably missing prospect-specific sections; if it is above 3400 the briefing has drifted from "skimmable in 15 minutes" — trim.

### 5. Write the output

```bash
OUTPUT_PATH="${OUT:-./stakeholder-briefing-$(echo $COMPANY | tr '[:upper:] ' '[:lower:]-').md}"
mv /tmp/briefing-draft.md "$OUTPUT_PATH"
echo "Briefing written to: $OUTPUT_PATH"
```

Report back to the user:

- Output path
- Word count
- Which sections were drafted from `--source-dir` (with source citations) vs which were left with guidance comments for the user to write
- A reminder: "The canonical sections (1, 4, 6, 8, 9, 11) are sourced from `docs/manual/stakeholder-briefing.html`. If you edit them locally, consider opening a PR upstream so the canonical version improves too."

## Safety Rules

- **NEVER invent placeholder values.** If the user does not know an answer, leave the `<<TOKEN>>` in place for them to fill manually.
- **NEVER hallucinate citations.** If `--source-dir` is supplied, every cited source must be a real file in that directory; every quoted phrase must appear verbatim in a real file.
- **NEVER edit the canonical sections (1, 4, 6, 8, 9, 11) to make a specific prospect happier.** Those sections are sourced from the manual to prevent drift; if they need editing for general accuracy, that's an upstream PR.
- **ASK before sending to anyone.** The skill outputs a draft. The human champion sends it.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll let the model generate Section 3 (where it hurts) from general knowledge of the industry" | The whole reason the prospect listens to Section 3 is that it lifts their own words. Generic industry pain is generic and reads as such. |
| "Section 10 (pilot proposal) can be a placeholder; the customer will fill it in" | The pilot section is the most concrete commitment in the briefing. If you leave it generic, the stakeholder reads the briefing as "they don't know what they want from us either" and the conversation stalls. |
| "Section 12 (the ask) can stay open-ended — 'let me know your thoughts'" | An open-ended ask is an ask the recipient defers. The whole point of writing a briefing is that there is a concrete next step on the table. |
| "If the canonical section sounds outdated for this prospect, I'll quietly rewrite it" | The canonical sections cite the same numbers as the manual. Rewriting them locally creates drift between the briefing and the book. Open an upstream PR instead. |
| "I'll skip the validation step (word count, no `<<` left) — the user can spot mistakes" | The whole point of automating the briefing is that the user doesn't have to. A briefing with an unfilled placeholder reaching a VP is the failure mode the skill exists to prevent. |

## Warning Signs

- Output file still contains `<<COMPANY>>` or any other placeholder — substitution step missed a token
- A cited "verbatim quote from `<<COMPANY>>`'s strategy deck" is not actually in `--source-dir` — model hallucinated the citation
- Sections 2, 3, 5, 7, 10, 12 are identical across two different prospects — model fell back to generic prose instead of using `--source-dir`
- Total word count is over 4000 — the briefing has drifted from "10-15 min read"; trim
- Section 12 (the ask) contains "let me know" or "happy to chat" — not a concrete ask; rewrite

## Exit Proof

After completing this skill, confirm:

- [ ] Output file exists at the reported path
- [ ] `grep -c "<<" "$OUTPUT_PATH"` returns 0
- [ ] Word count is between 2400 and 3400
- [ ] User has been told which sections still need manual editing (if any)
- [ ] The "edit canonical sections upstream, not locally" reminder has been delivered

## Persistent Memory (if OpenBrain is configured)

- **Before drafting**: `search_thoughts("stakeholder briefing", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — load prior briefings for this prospect or sibling prospects, so the new draft can reuse phrasing that previously landed.
- **After draft is written**: `capture_thought("Stakeholder briefing drafted for <<COMPANY>>: <KPIs targeted>, <pilot timeline>, <the ask>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-stakeholder-briefing")` — persist the per-prospect framing so a follow-up briefing six weeks later can pick up from the prior draft.

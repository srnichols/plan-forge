# Plan Forge Manual — AI Agent Maintenance Guide

> **Audience**: AI agents (and humans) editing the user-facing Plan Forge Manual under `docs/manual/`.
> **Authority**: This README is the **single source of truth** for manual conventions.
>   When a chapter and this README disagree, this README wins — fix the chapter to match.
> **Scope**: Everything under `docs/manual/`. Other docs (`docs/blog/`, `docs/research/`, `docs/plans/`) follow their own rules.

---

## 1 · The hard rules (read first, every time)

These are non-negotiable. The maintainer script (`maintain.mjs`) flags violations.

| # | Rule | Severity if violated |
|---|------|---------------------|
| 1 | **Every HTML file in `docs/manual/` MUST be registered in `CHAPTERS`** in [assets/manual.js](assets/manual.js) | HIGH — won't appear in the sidebar |
| 2 | **Every internal link MUST resolve** to an existing `.html` file in `docs/manual/` | HIGH — broken navigation |
| 3 | **No local `.md` links in body prose.** Link to an HTML page in the manual, or use a full `https://github.com/srnichols/plan-forge/...` URL labelled "on GitHub" | HIGH — readers can't read .md in the browser |
| 4 | **Every chapter MUST have the standard shell** — `lang="en"`, `#manual-sidebar`, `.chapter-content`, `assets/manual.js` include | HIGH — sidebar won't render |
| 5 | **Never hand-write a count that lives in `MANUAL_COUNTS`.** Use a `<!--c:KEY-->NUMBER<!--/c-->` token. | MEDIUM — drift across chapters |
| 6 | **Never hand-number a `<figure class="manual-figure">`.** The maintainer assigns `Figure {chapter.num}-{counter}` automatically. | LOW — number conflicts |
| 7 | **Never edit a file in audit mode.** `--audit` is read-only. Run without `--audit` to write changes. | n/a (script enforces) |

**Run after every edit:**

```pwsh
node docs/manual/maintain.mjs           # audit + regenerate (fixes drift, refreshes generated pages)
node docs/manual/maintain.mjs --audit   # read-only — for CI / pre-commit hooks
```

---

## 2 · File layout

```
docs/manual/
├── README.md                    ← you are here
├── maintain.mjs                 ← build pipeline (run after every edit)
├── index.html                   ← the cover page
├── conventions.html             ← reader-facing "how to read this manual" page
├── book-index.html              ← Appendix O · auto-generated A–Z index
├── list-of-figures.html         ← Appendix P · auto-generated figure index
├── glossary.html                ← Appendix A
├── quickstart-*.html            ← Q1 / Q2 / Q3 — the 30-minute path
├── *.html                       ← numbered chapters + appendices + sub-chapters
└── assets/
    ├── manual.css               ← all chapter styles
    ├── manual.js                ← sidebar, search, CHAPTERS registry, MANUAL_COUNTS
    ├── chapter-heroes/          ← per-chapter hero images (.jpg)
    └── diagrams/                ← inline SVGs and rasters
```

---

## 3 · The chapter shell

Every chapter file (anything except `index.html`) MUST start with this shell. Copy from any existing chapter — don't hand-build it.

Required elements (the maintainer audits these):

- `<html lang="en" class="scroll-smooth">`
- `<aside id="manual-sidebar" class="manual-sidebar"><nav id="sidebar-nav"></nav></aside>` — sidebar mount point
- `<div class="chapter-content">` — the body wrapper that styles H1/H2/H3, code, tables, etc.
- `<script src="assets/manual.js"></script>` — sidebar, search, prev/next navigation
- The mobile sidebar button + overlay (boilerplate at the top of `<body>`)

Body order inside `.chapter-content`:

1. **Chapter number badge** — `<div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Chapter 5</div>` (use `Appendix K`, `Quickstart · Step 1 of 3`, or `Front Matter` as appropriate)
2. **`<h1>`** — the chapter title
3. **One-line tagline** in `<p class="text-lg text-slate-400 mb-8">`
4. **(Optional)** Hero image: `<img src="assets/chapter-heroes/chN-hero.jpg" alt="..." class="chapter-hero" />`
5. **Body sections** — `<h2>` per major section with `id="..."` for deep links
6. **Prev/Next nav** — close with `<div id="chapter-prev-next" class="chapter-nav"></div>` (populated by `manual.js`)

---

## 4 · Registering a new chapter

Open [assets/manual.js](assets/manual.js) and add an entry to `CHAPTERS` in the right Part. Order in the array determines sidebar order and prev/next sequencing.

```js
{ id: "my-new-chapter",  file: "my-new-chapter.html",  num: "12",  title: "My New Chapter",  act: "II" },
```

Field rules:

| Field | Rule |
|-------|------|
| `id` | URL-safe slug, must match the filename minus `.html`. Used for status pills. |
| `file` | The HTML filename. MUST exist on disk. |
| `num` | `"1"`–`"24"` for numbered chapters · `"Q1"`–`"Q3"` for Quickstart · `"A"`–`"P"` for appendices · `""` for sub-chapters and deep dives |
| `title` | Sentence-case, ≤ 60 chars. Use `&` (HTML entity) sparingly. |
| `act` | `"Quickstart"` · `"I"` · `"II"` · `"III"` · `"IV"` · `"Appendix"` · `"Front Matter"` |

**Numbering matters**: Only chapters with a non-empty `num` get **Figure {num}-{n}** numbering and appear in the List of Figures. Sub-chapters and deep dives still get figure captions but no number.

---

## 5 · Conventions reference (matches `conventions.html`)

### 5.1 · Status pills (in `STATUS` map of `manual.js`)

```js
"forge-master": { label: "NEW", version: "v2.78" },
```

Three labels: `"NEW"` · `"UPDATED"` · `"BETA"`. Pills render in the sidebar and on the cover. Drop the entry once the version is no longer recent (rule of thumb: 3+ minor versions old).

### 5.2 · Callouts

Three flavors. Use sparingly — they're aside boxes, not content carriers.

```html
<div class="callout callout-info">    <strong>Note</strong> — context, see-also pointers.</div>
<div class="callout callout-tip">     <strong>Tip</strong>  — shortcuts, sane defaults.</div>
<div class="callout callout-warning"> <strong>Warning</strong> — foot-guns, known pitfalls.</div>
```

Lead with a bold one-word lead-in (`<strong>Note</strong>`, etc.) followed by an em-dash. Body should be one or two sentences max — if it grows, promote it to a section.

### 5.3 · Code blocks

```html
<div class="cmd-block">
  <div class="cmd-block-header"><span>Terminal</span><button class="cmd-copy-btn">Copy</button></div>
  <pre><code>node docs/manual/maintain.mjs</code></pre>
</div>
```

Header label rules:

- `Terminal` — for shell commands you'd literally paste into a terminal
- A file path (e.g. `.forge.json`, `pforge-mcp/server.mjs`) — for config snippets / source samples
- `Output` — for command output samples
- Skip the `<button class="cmd-copy-btn">Copy</button>` for output-only blocks

### 5.4 · Inline code, italics, monospace

- `<code>foo()</code>` — literal names: file paths, env vars, tool IDs, CLI flags
- `<em>foo</em>` — placeholders the reader fills in
- Bold (`<strong>`) — emphasis only, not to mark code

### 5.5 · Tables

```html
<table>
  <thead><tr><th>Column</th><th>Column</th></tr></thead>
  <tbody>
    <tr><td>...</td><td>...</td></tr>
  </tbody>
</table>
```

`.chapter-content table` styles handle everything. Don't add Tailwind classes to `<table>`.

### 5.6 · Diagrams and figures

**Don't** hand-write `<figure>` wrappers for new diagrams. Just write the bare image:

```html
<img src="assets/diagrams/my-flow.svg"
     alt="Concise title clause: detailed prose description that a screen reader (or a skim reader) can use to understand the diagram without seeing it."
     class="diagram-img diagram-img-md" />
```

The next `node docs/manual/maintain.mjs` run will:

1. Wrap it in `<figure class="manual-figure">` with `<figcaption>`
2. Derive the caption from the **title clause** (everything before the first colon or sentence-stop)
3. Number it `Figure {chapter.num}-{N}` if the chapter has a `num`
4. Add a stable `id="fig-{num}-{N}"` for deep-linking
5. Register it in [list-of-figures.html](list-of-figures.html)

Sizes: `diagram-img-sm` (700&thinsp;px) · `diagram-img-md` (750&thinsp;px) · `diagram-img-lg` (800&thinsp;px). All centred.

**To override the auto-caption with hand-authored prose:**

```html
<figcaption class="manual-figcaption">Hand-written caption here — no auto marker.</figcaption>
```

The absence of the `<!--cap:auto-->` marker tells `maintain.mjs` to leave it alone forever. Use this for diagrams where the alt text title clause doesn't read well as a caption (rare).

### 5.7 · Live numbers (count tokens)

Numbers like "74 tools", "18 instruction files", "9 presets" change between releases. Don't hand-write them in chapter prose — use a token:

```html
<p>Plan Forge ships <!--c:tools-->74<!--/c--> MCP tools and <!--c:instructions-->18<!--/c--> instruction files.</p>
```

The number between the tokens is rewritten on every `maintain.mjs` run from `MANUAL_COUNTS` in [assets/manual.js](assets/manual.js).

**Available keys** (always check `MANUAL_COUNTS` for the current set — it grows):

| Key | What it counts | Source of truth |
|-----|----------------|-----------------|
| `tools` | MCP tools | `pforge-mcp/tools.json` (array length) |
| `instructions` | `.instructions.md` files per preset | `presets/dotnet/.github/instructions/` |
| `agents` | `.agent.md` files per stack | aggregate per `copilot-instructions.md` |
| `skills` | `/skills/` subdirectories per preset | aggregate per `copilot-instructions.md` |
| `hooks` | hook entry points | aggregate (SessionStart, PreToolUse, PostToolUse, Stop, PreDeploy, PostSlice, PreAgentHandoff) |
| `prompts` | `step*.prompt.md` files | `presets/dotnet/.github/prompts/` |
| `presets` | top-level stack presets | `presets/*` excluding `shared` |
| `chapters` | numbered chapters 1-N | hand-counted from CHAPTERS where `num` matches `^\d+$` |
| `appendices` | lettered appendices A-N | hand-counted, excludes O / P |
| `parts` | top-level Parts (Smelt, Forge, Guard, Learn) | constant: 4 |
| `htmlFiles` | total `.html` files in `docs/manual/` | hand-counted |

**To add a new key**: edit `MANUAL_COUNTS` in `assets/manual.js`, document the source-of-truth on the comment line, then run `maintain.mjs`. Tokens referencing unknown keys raise a MEDIUM audit issue.

**To bump an existing key after a release**: edit the value in `MANUAL_COUNTS`, run `maintain.mjs`, commit both the JS file and any chapter files the substitution touched.

---

## 6 · Editorial style

### 6.1 · Voice and register

- **Active voice**, second person where natural (*"Run `pforge smith` to verify."*)
- **Plain English**. Reach for "lets you" before "enables you to". Reach for "use" before "utilize".
- **One thought per sentence**. Long sentences with multiple clauses are an anti-signal — split them.
- **Don't oversell**. "Plan Forge solves AI drift" is marketing prose; "Plan Forge gates each slice with executable validation" is documentation.

### 6.2 · Punctuation and typography

- **Em-dash `—`** for parenthetical breaks. With or without surrounding spaces — both are accepted (lint isn't in the maintainer yet). Pick one per page and stay consistent.
- **En-dash `–`** for ranges (`v2.5–v2.83`).
- **Hyphens** for compound modifiers (`AI-native`, `multi-agent`).
- **Curly quotes are fine** in body prose; **straight quotes** inside `<code>` and `<pre>`.
- **HTML entities**: `&mdash;` `&ndash;` `&thinsp;` (thin space, used between numerals and units like `750&thinsp;px`). Avoid `&nbsp;` unless forced.

### 6.3 · Headings

- `<h1>` — chapter title (one per page)
- `<h2 id="...">` — major sections. The `id` enables deep links and the book-index pipeline.
- `<h3>` — subsection. Don't use `<h4>` or deeper — if you reach for it, the chapter wants splitting.
- Sentence case for all headings. Initial-caps are reserved for **Part** and **Appendix** pseudo-titles.

### 6.4 · Length

- **Numbered chapters**: 800–2,500 words. Below 800 is too thin (consider merging); above 2,500 is too long (consider splitting into a sub-chapter).
- **Sub-chapters / deep dives**: 600–4,000 words. Looser ceiling because deep dives are reference material.
- **Appendices**: 300–8,000 words. Reference appendices (Glossary, Quick Reference, MCP Server Reference) are uncapped — they're intentionally exhaustive.

---

## 7 · The `maintain.mjs` pipeline

Read [maintain.mjs](maintain.mjs) for the full flow. Quick summary:

| Step | What it does | Touches files? |
|------|--------------|----------------|
| 1 | Parse `assets/manual.js` to extract `CHAPTERS`, `SEARCH_SECTIONS`, `MANUAL_COUNTS` | No |
| 2 | Scan all `*.html` in the directory | No |
| 3 | Verify every HTML file is registered in `CHAPTERS` | No (audit only) |
| 4 | Verify every internal `href` resolves | No (audit only) |
| 4b | Forbid local `.md` links in body | No (audit only) |
| 5 | Verify the chapter shell on every page | No (audit only) |
| 6 | Substitute `<!--c:KEY-->...<!--/c-->` tokens against `MANUAL_COUNTS` | Yes (rewrites drift) |
| 6b | Wrap bare `<img class="diagram-img">` in `<figure>` + `<figcaption>` | Yes (idempotent) |
| 6c | Number figures and collect for List of Figures | Yes (idempotent) |
| 7 | Regenerate `book-index.html` from `CHAPTERS` + `SEARCH_SECTIONS` | Yes (always rewrites) |
| 8 | Regenerate `list-of-figures.html` from collected figures | Yes (always rewrites) |

**Idempotency contract**: Running `maintain.mjs` twice in a row touches `book-index.html` and `list-of-figures.html` (always regenerated) but **does not touch any other file** the second time. If a chapter file gets rewritten on a second run, that's a bug — file an issue.

**CLI flags**:

- `--audit` — read-only mode. Reports drift but doesn't write. Use in CI.
- `--quiet` — suppresses progress output. Combine with `--audit` for clean CI logs.

---

## 8 · Common tasks

### 8.1 · Add a new chapter

1. Copy an existing chapter as the shell template (`cp quickstart-install.html my-chapter.html`).
2. Rewrite the H1, tagline, body, and chapter-number badge.
3. Drop a hero image into `assets/chapter-heroes/` if you want one.
4. Register it in `CHAPTERS` in `assets/manual.js`.
5. Run `node docs/manual/maintain.mjs` — it will validate the shell, wire up the sidebar, and number any figures.
6. If the chapter introduces a new "live number", add a key to `MANUAL_COUNTS`.

### 8.2 · Add a new appendix

Same as a chapter, but use the next available letter for `num` (current cap: `P` = List of Figures). Set `act: "Appendix"`.

### 8.3 · Add a diagram

1. Drop the SVG (preferred) or WebP into `assets/diagrams/`.
2. Add the bare `<img>` tag with a rich `alt` attribute. The first colon in the `alt` text becomes the auto-caption.
3. Pick a size class: `diagram-img-sm` · `-md` · `-lg`.
4. Run `maintain.mjs`. The figure will be wrapped, captioned, numbered, and indexed.

### 8.4 · Add a number that should stay in sync across chapters

1. Open `assets/manual.js`. Find `MANUAL_COUNTS`.
2. Add the key with a comment naming the **source of truth** (a file path or a count rule).
3. Reference it in chapter prose with a `<!--c:KEY-->...<!--/c-->` token.
4. Run `maintain.mjs`.

### 8.5 · Update a count after a Plan Forge release

1. Edit the value in `MANUAL_COUNTS`.
2. Update the comment if the source-of-truth path changed.
3. Run `maintain.mjs`. It will sweep every chapter and rewrite drift.
4. Commit both `assets/manual.js` and any chapter files the substitution touched.

### 8.6 · Rename or move a chapter

1. Rename the file on disk.
2. Update the `file` field in `CHAPTERS`.
3. Run `maintain.mjs --audit` to find any broken inbound links and fix them.
4. Run `maintain.mjs` to regenerate the book-index and list-of-figures.

### 8.7 · Deprecate a chapter

Don't delete it — too many inbound links from blog posts, GitHub issues, and external sites. Instead:

1. Replace the body with a short "This chapter has moved to [X]" stub.
2. Keep the entry in `CHAPTERS` so the sidebar still shows the redirect.
3. Add a `<meta http-equiv="refresh" content="3; url=new-page.html">` if you want auto-redirect.

---

## 9 · Anti-patterns (don't do these)

| Don't | Why |
|-------|-----|
| Hand-write a number that has a `MANUAL_COUNTS` key | Drift across chapters within one release |
| Hand-number a figure (`Figure 5-1.`) in a `<figcaption>` you wrote yourself | The maintainer will inject `Figure 5-1.` again, producing `Figure 5-1. Figure 5-1. ...` |
| Add Tailwind classes inside `.chapter-content` for prose styling | The `.chapter-content` typography stack already handles H1/H2/H3, P, UL, OL, code, table — adding Tailwind on top creates inconsistency |
| Use `<h4>` and below | Sign that the chapter wants splitting. Promote the section or move it to a sub-chapter. |
| Link to `.md` files from chapter prose | Readers see raw markdown in the browser. Link to the HTML page in the manual, or use a full GitHub URL labelled "on GitHub" |
| Skip `alt` text on a diagram | Accessibility regression and the auto-caption pipeline can't derive a caption |
| Edit `book-index.html` or `list-of-figures.html` directly | Both are regenerated by `maintain.mjs` — your edits will be wiped |
| Add a callout for trivia ("Did you know?") | Callouts are for footguns and shortcuts. Trivia goes in body prose or a sidebar. |
| Reference a chapter by file path in body prose (`See writing-plans.html`) | Use a real link with title text: `See <a href="writing-plans.html">Chapter 4</a>` |

---

## 10 · Pre-commit checklist (for AI agents and humans)

Before committing changes to anything under `docs/manual/`:

- [ ] Ran `node docs/manual/maintain.mjs` and saw `✓ All checks passed`
- [ ] If new HTML file: registered in `CHAPTERS` with the right `act` and `num`
- [ ] If new diagram: alt text has a clear title clause; picked a size class
- [ ] If new live number: added a key to `MANUAL_COUNTS` with source-of-truth comment
- [ ] No `.md` links in body prose
- [ ] No hand-written counts that should be tokens
- [ ] No hand-numbered figures
- [ ] `book-index.html` and `list-of-figures.html` were regenerated (they should always show up in the diff if the source set changed)
- [ ] Conventions still match what's documented in `conventions.html` — if you introduced a new pattern, document it here AND in the conventions page

---

## 11 · When in doubt

1. **Read [conventions.html](conventions.html)** — the reader-facing version of these rules
2. **Read an adjacent chapter** that does the same thing well (e.g., `writing-plans.html` for tables and callouts; `audit-loop.html` for diagrams; `mcp-server-reference.html` for long reference tables)
3. **Run `maintain.mjs --audit`** — it tells you what's wrong before you commit
4. **Check [docs/research/manual-apress-publisher-review.md](../research/manual-apress-publisher-review.md)** — the editorial north-star this manual is being shaped toward

---

*Last reviewed: every change to `maintain.mjs`, `assets/manual.js`, or `assets/manual.css` must update the relevant section above. If a contributor has to ask how something works, the answer belongs here.*

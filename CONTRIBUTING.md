# Contributing to Plan Forge

Thanks for your interest in improving Plan Forge!

## How to Contribute

### Reporting Issues

Open a [GitHub Issue](https://github.com/srnichols/plan-forge/issues) with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your preset (dotnet, typescript, python, java, go, swift, azure-iac, custom)

### Suggesting Features

Open an issue with the `enhancement` label. Describe the problem you're solving, not just the solution you want.

### Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. If you edited `docs/assets/tailwind.css`, rebuild the docs CSS: `npm run build:css` (also commits the updated `tailwind.built.css.sha256` — `node docs/manual/maintain.mjs` will flag CSS drift if you skip this)
5. Run validation: `.\validate-setup.ps1` or `./validate-setup.sh` (or `pforge check` / `pforge smith`)
6. If your repo has CI configured, the **Plan Forge Validate** action runs automatically on PR
7. Commit using [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat(scope): description"`

> **Multi-agent users**: If you test with Claude, Cursor, or Codex, run setup with `-Agent <name>` and verify agent-specific files are generated.
8. Push and open a Pull Request

### What Can You Contribute?

| Contribution | Where | Guidelines |
|-------------|-------|-----------|
| **New tech preset** | `presets/<stack>/` | See CUSTOMIZATION.md → "Adding a New Tech Preset" |
| **New extension** | `.forge/extensions/` | See [docs/EXTENSIONS.md](docs/EXTENSIONS.md) + [extensions/PUBLISHING.md](extensions/PUBLISHING.md) |
| **Instruction file improvements** | `presets/<stack>/.github/instructions/` | Keep under 150 lines, include `applyTo` frontmatter |
| **Prompt template improvements** | `presets/<stack>/.github/prompts/` | Include stack-specific code examples |
| **Documentation fixes** | `docs/`, `README.md`, etc. | Fix typos, clarify confusing sections, add examples |
| **Setup script improvements** | `setup.ps1`, `setup.sh` | Test on both PowerShell and Bash |
| **CLI improvements** | `pforge.ps1`, `pforge.sh` | Include `--help` for new commands, show manual equivalent |

### Commit Convention

```
feat(scope): add new feature
fix(scope): fix a bug
docs(scope): documentation only
refactor(scope): code restructure
test(scope): add or update tests
chore(scope): build, deps, config
```

### Code Style

- PowerShell: Follow existing patterns in `setup.ps1`
- Bash: Follow existing patterns in `setup.sh`
- Markdown: Use ATX headings (`#`), fenced code blocks, tables for structured data

## Branch Model

Plan Forge intentionally keeps `master` **clean as a template** for forkers,
AI agents reading the repo for context, and casual GitHub web browsers.
Plan Forge's own dev planning artifacts live on a separate long-lived
branch.

| Branch | Purpose | What lives here |
|--------|---------|-----------------|
| **`master`** | Production template — what consumers install via `setup.ps1` / `setup.sh` and what forkers see by default | Framework code, instruction/prompt/hook/agent files, templates, examples, public docs site, runbook docs, CHANGELOG |
| **`planning/main`** | Long-lived superset of `master` — adds all Plan Forge's own dev artifacts | Everything on `master` **plus** active `Phase-*-PLAN.md` drafts, shipped phase records (`archive/`), internal `DEPLOYMENT-ROADMAP.md`, testbed findings, cleanup catalogs, retros |
| **`planning/<topic>`** | Short-lived topic branches forked off `planning/main` for in-flight phase batches | DRAFT phase plans being hardened; merged back to `planning/main` once HARDENED or shipped |
| **`archive/plans-v2.52.x`** | Frozen historical archive | Older completed phase plans (v2.33 → v2.52.x) |

### What goes where

- **Plan Forge dev plans (`docs/plans/Phase-*-PLAN.md`)**: NEVER land on `master`. Live on `planning/main` (or a `planning/<topic>` branch while in flight).
- **Phase ship-out**: only the consumer-facing residue is promoted to `master` — CHANGELOG entry, VERSION bump, code changes, instruction / prompt / hook / agent updates. The phase plan **file** stays on `planning/main` as the durable record.
- **Consumer-facing template artifacts** (`docs/plans/DEPLOYMENT-ROADMAP-TEMPLATE.md`, `PROJECT-PRINCIPLES-TEMPLATE.md`, `AI-Plan-Hardening-Runbook.md`, `examples/`): always on `master`.
- **Runtime output directories** (`docs/plans/auto/`, `docs/plans/testbed-findings/`): structural placeholders on `master`; populated content lives on `planning/main` or in consuming-project repos.
- **`.gitattributes` `export-ignore`** rules give belt-and-suspenders coverage: if a dev artifact ever leaks back to `master`, it's filtered out of `git archive` tarballs and GitHub "Download ZIP".

### Sync flow

- **master → planning/main**: automated via [`.github/workflows/sync-master-to-planning.yml`](.github/workflows/sync-master-to-planning.yml). Runs on push-to-master + weekly cron. Fast-forwards when possible; on merge conflict, the workflow fails noisily with resolution instructions in the workflow log.
- **planning/main → master**: manual PR. Cherry-pick or PR only the consumer-shipped artifacts (code, instruction updates, CHANGELOG). The dev-plan file itself stays on `planning/main`.
- **planning/&lt;topic&gt; → planning/main**: standard PR when the topic is HARDENED or shipped.

### Contributor quickstart

1. **Improving Plan Forge framework code, instructions, prompts, or shipped templates**: branch off `master` (`feat/...` or `fix/...`), PR to `master`. Auto-sync workflow propagates the change to `planning/main`.
2. **Working on a Plan Forge dev phase**: branch off `planning/main` (`planning/phase-43-foo`), PR back to `planning/main` when DRAFT → HARDENED.
3. **Both** (e.g. shipping a phase that adds new instruction files): land the framework changes on `master` via normal PR; the phase plan file stays on `planning/main`; reference each other.

## Releasing (maintainers)

Every tagged release MUST follow [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md). It covers:

- Distribution sync invariants (hooks mirror, instruction enumeration, prompt globs)
- Version-file synchronization (`VERSION` + `pforge-mcp/package.json` + CHANGELOG)
- The 9-step tag → push → release → bump-back sequence
- Test triage policy and disaster recovery

> **A pushed tag is NOT a Release.** Skipping `gh release create` makes the version invisible to `pforge self-update`. We've shipped that bug before — the checklist exists to prevent it again.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

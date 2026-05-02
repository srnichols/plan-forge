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
4. Run validation: `.\validate-setup.ps1` or `./validate-setup.sh` (or `pforge check` / `pforge smith`)
5. If your repo has CI configured, the **Plan Forge Validate** action runs automatically on PR
6. Commit using [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat(scope): description"`

> **Multi-agent users**: If you test with Claude, Cursor, or Codex, run setup with `-Agent <name>` and verify agent-specific files are generated.
7. Push and open a Pull Request

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

## Releasing (maintainers)

Every tagged release MUST follow [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md). It covers:

- Distribution sync invariants (hooks mirror, instruction enumeration, prompt globs)
- Version-file synchronization (`VERSION` + `pforge-mcp/package.json` + CHANGELOG)
- The 9-step tag → push → release → bump-back sequence
- Test triage policy and disaster recovery

> **A pushed tag is NOT a Release.** Skipping `gh release create` makes the version invisible to `pforge self-update`. We've shipped that bug before — the checklist exists to prevent it again.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

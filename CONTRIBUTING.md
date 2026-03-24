# Contributing to Plan Forge

Thanks for your interest in improving Plan Forge!

## How to Contribute

### Reporting Issues

Open a [GitHub Issue](https://github.com/srnichols/plan-forge/issues) with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your preset (dotnet, typescript, python, java, go, custom)

### Suggesting Features

Open an issue with the `enhancement` label. Describe the problem you're solving, not just the solution you want.

### Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run validation: `.\validate-setup.ps1` or `./validate-setup.sh`
5. Commit using [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat(scope): description"`
6. Push and open a Pull Request

### What Can You Contribute?

| Contribution | Where | Guidelines |
|-------------|-------|-----------|
| **New tech preset** | `presets/<stack>/` | See CUSTOMIZATION.md → "Adding a New Tech Preset" |
| **New extension** | `.forge/extensions/` | See docs/EXTENSIONS.md → "Creating an Extension" |
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

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

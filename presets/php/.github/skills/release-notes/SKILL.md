---
name: release-notes
description: Generate release notes from git history and CHANGELOG for a Laravel application. Formats for GitHub Release, Slack, or email. Use before tagging a release.
argument-hint: "[version tag, e.g. 'v1.2.0']"
tools: [run_in_terminal, read_file]
---

# Release Notes Skill

## Trigger
"Generate release notes" / "Prepare release" / "What changed since last release?"

## Steps

### 1. Identify Release Range
```bash
git describe --tags --abbrev=0
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

### Conditional: No Tags Found
> If no tags exist, ask the user for the commit range.

### 2. Categorize Changes
Parse conventional commit prefixes:

| Prefix | Category | Show In Notes |
|--------|----------|---------------|
| `feat` | New Features | Always |
| `fix` | Bug Fixes | Always |
| `perf` | Performance | Always |
| `docs` | Documentation | If user-visible |
| `refactor` | Internal | Only when behavior or maintenance risk changed |
| `test` | Tests | Skip unless test tooling changed user workflow |
| `chore` | Maintenance | Skip unless dependency/security relevant |
| `ci` | CI/CD | Include if deploy or release process changed |

### 3. Check Laravel-Specific Changes
Look for:

- New or removed API routes: `php artisan route:list --path=v1`
- Migration files and data backfills
- Queue job, event, listener, or scheduler changes
- Dockerfile, compose, nginx, or environment variable changes
- Security fixes, dependency updates, and `composer audit` output

### 4. Check CHANGELOG
Read `CHANGELOG.md`:

- Confirm unreleased entries match commits.
- Move relevant entries under the target version.
- Note missing migration or deployment instructions.

### 5. Generate Release Notes
```markdown
## What's New

### Features
- **Feature name**: user-facing impact (#PR)

### Bug Fixes
- Fix description (#PR)

### Deployment Notes
- Migration, queue restart, config, or Docker change.

## Breaking Changes
- Change with migration instructions.

## Verification
- `php artisan test`: PASS / FAIL
- `composer audit`: PASS / FAIL
```

### 6. Verify
```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
composer audit
```

## Safety Rules

- NEVER fabricate changes not present in git history or CHANGELOG.
- ALWAYS flag migrations, queue changes, and environment variable changes.
- ALWAYS call out breaking API or response-shape changes.
- Ask for human review before publishing notes.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Only PHP code changed" | Migrations, queues, config, and Docker changes can require operator action. |
| "Internal API consumers will read commits" | Release notes are the stable operational summary. |
| "Dependency bumps are boring" | Security and framework bumps can change runtime requirements. |

## Warning Signs

- Release notes omit migrations.
- Queue workers do not appear in deployment notes after job changes.
- API routes changed but OpenAPI docs are not mentioned.
- Version tag and CHANGELOG version differ.

## Exit Proof

After completing this skill, confirm:

- [ ] Version matches intended tag
- [ ] Git range verified
- [ ] CHANGELOG checked
- [ ] Migrations and queue changes called out
- [ ] Verification commands included with results

## Persistent Memory for Releases

- **Before generating notes**: `search_thoughts("Laravel release", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")`
- **After notes are finalized**: `capture_thought("Laravel release: v<version> - <key changes>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-release-notes")`

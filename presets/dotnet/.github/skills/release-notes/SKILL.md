---
name: release-notes
description: Generate release notes from git history and CHANGELOG. Formats for GitHub Release, Slack, or email. Use before tagging a release.
argument-hint: "[version tag, e.g. 'v1.2.0']"
---

# Release Notes Skill

## Trigger
"Generate release notes" / "Prepare release" / "What changed since last release?"

## Steps

### 1. Identify Release Range
```bash
# Find the last tag
git describe --tags --abbrev=0

# List commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

### 2. Categorize Changes
Parse commit messages using conventional commit prefixes:

| Prefix | Category | Show In Notes |
|--------|----------|---------------|
| `feat` | New Features | ✅ Always |
| `fix` | Bug Fixes | ✅ Always |
| `perf` | Performance | ✅ Always |
| `docs` | Documentation | ✅ If significant |
| `refactor` | Internal | ⚠️ Only if user-visible |
| `test` | Tests | ❌ Skip |
| `chore` | Maintenance | ❌ Skip |
| `ci` | CI/CD | ❌ Skip |

### 3. Check CHANGELOG
Read `CHANGELOG.md` for additional context:
- Are there entries not yet in the CHANGELOG?
- Does the CHANGELOG match the git history?

### 4. Generate Release Notes

Format for **GitHub Release**:
```markdown
## What's New

### Features
- **Feature name**: brief description (#PR)

### Bug Fixes
- Fix description (#PR)

### Performance
- Improvement description (#PR)

## Breaking Changes
- (list any breaking changes with migration steps)

## Contributors
- @username (N commits)
```

### 5. Verify
- [ ] All features from this release are listed
- [ ] No unreleased features included
- [ ] Breaking changes have migration instructions
- [ ] Commit references are correct

## Safety Rules
- NEVER fabricate changes not in the git log
- ALWAYS flag breaking changes prominently
- Include migration steps for any breaking change
- Ask for human review before publishing

## Persistent Memory (if OpenBrain is configured)

- **Before generating notes**: `search_thoughts("release", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — load prior release decisions, breaking change precedents, and versioning conventions
- **After release notes are finalized**: `capture_thought("Release: v<version> — <key changes summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-release-notes")` — persist release history for future changelog continuity

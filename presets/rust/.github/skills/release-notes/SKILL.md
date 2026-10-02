---
name: release-notes
description: Generate Rust service release notes from git history, Cargo changes, migrations, OpenAPI changes, and CHANGELOG. Use before tagging or publishing a container image.
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
> If no tags are present, ask the user for the commit range or previous release commit.

### 2. Categorize Changes
Parse conventional commits and Rust-specific surfaces:

| Prefix or File | Category | Show In Notes |
|----------------|----------|---------------|
| `feat` | New Features | Always |
| `fix` | Bug Fixes | Always |
| `perf` | Performance | Always |
| `migrations/` | Database Changes | Always |
| `Cargo.toml` / `Cargo.lock` | Dependency Changes | If runtime, security, or MSRV relevant |
| `docs` | Documentation | If user-facing |
| `refactor` | Internal | Only if behavior or operator workflow changed |
| `test` | Tests | Skip unless test tooling changed |

### 3. Check Project Records
Read `CHANGELOG.md`, `Cargo.toml`, `Cargo.lock`, OpenAPI specs, and migration filenames:
- Does the version match `Cargo.toml` package metadata?
- Are database migrations backward-compatible?
- Did `rust-version` or the Docker base image change?
- Did endpoint paths, request bodies, or response schemas change?

### 4. Generate Release Notes

```markdown
## What's New

### Features
- **Feature name**: brief user-visible impact (#PR)

### Bug Fixes
- Fix description and affected route or workflow (#PR)

### Operations
- Container, migration, telemetry, or readiness change.

### Dependencies
- Notable Cargo updates, MSRV changes, or security remediations.

## Database Migrations
- Migration filename and compatibility notes.

## Breaking Changes
- API, config, database, or deployment changes with migration steps.

## Container Image
- Image tag, Rust base image, runtime image, and verification gate.
```

### 5. Verify
- [ ] Commit range is correct.
- [ ] Cargo version and release tag agree.
- [ ] Breaking API, config, and migration changes are called out.
- [ ] Container image and migration notes are operator-ready.
- [ ] CHANGELOG entry matches the generated notes.

## Safety Rules

- Never fabricate changes not present in git, Cargo, migrations, or API docs.
- Mark breaking changes prominently with migration steps.
- Include database compatibility and rollback implications.
- Ask for human review before publishing notes or tagging.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Cargo.lock noise can be ignored" | Transitive updates can change TLS, database, telemetry, or security behavior. |
| "Migrations are implementation details" | Operators need ordering, compatibility, and rollback guidance. |
| "Container tags explain themselves" | Release consumers need to know the exact binary, base image, and verification status. |
| "Internal API users can read the diff" | API consumers need curated contract changes, not source archaeology. |

## Warning Signs

- Release notes omit `rust-version` or base image changes.
- Database migrations appear in git but not in notes.
- OpenAPI changes are not categorized as breaking or non-breaking.
- Cargo dependencies changed without security or runtime impact analysis.
- Notes include commits outside the selected range.

## Exit Proof

After completing this skill, confirm:
- [ ] Version number matches the release tag and Cargo metadata
- [ ] Git range verified with `git log`
- [ ] CHANGELOG entry drafted or updated
- [ ] Database and OpenAPI changes reviewed
- [ ] Breaking changes include migration guidance

## Persistent Memory — release notes

- **Before drafting notes**: recall prior release formatting, breaking-change thresholds, and migration lessons.
- **After finalizing notes**: capture release tag, major changes, and any follow-up documentation work.

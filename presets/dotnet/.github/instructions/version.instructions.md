---
description: Version management — Semantic versioning, auto-increment, commit-driven version bumps, release tagging
applyTo: '**/*.csproj,**/Directory.Build.props'
---

# Version Management (.NET)

## Versioning Scheme

```
MAJOR.MINOR.PATCH.BUILD
  3  .  7  .  2  . 142
```

| Segment | When to Increment | Trigger |
|---------|-------------------|---------|
| **MAJOR** | Breaking API changes | Manual approval required |
| **MINOR** | New features (backward-compatible) | `feat:` commit prefix |
| **PATCH** | Bug fixes, performance, refactors | `fix:` / `perf:` / `refactor:` prefix |
| **BUILD** | Every build (auto-increment) | `docs:` / `chore:` / `test:` / `ci:` / `style:` |

## Commit Message → Version Bump

| Commit Prefix | Version Impact | Example |
|---|---|---|
| `feat:` | MINOR +1 | 3.6.0.0 → 3.7.0.0 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 | 3.6.5.0 → 3.6.6.0 |
| `docs:` / `chore:` / `test:` / `style:` / `ci:` | BUILD +1 | 3.6.5.418 → 3.6.5.419 |
| `feat!:` / `BREAKING CHANGE:` | Requires manual MAJOR bump | Approval workflow |

## Implementation with Directory.Build.props

```xml
<Project>
  <PropertyGroup>
    <VersionPrefix>3.7.2</VersionPrefix>
    <VersionSuffix></VersionSuffix>
    <!-- BUILD number auto-incremented by CI or build script -->
    <FileVersion>$(VersionPrefix).$(BuildNumber)</FileVersion>
    <InformationalVersion>$(VersionPrefix)+$(GitCommitHash)</InformationalVersion>
  </PropertyGroup>
</Project>
```

## Version Endpoint

Expose version info at runtime:
```csharp
app.MapGet("/api/version", () => new
{
    Version = typeof(Program).Assembly.GetName().Version?.ToString(),
    Informational = typeof(Program).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
    Environment = app.Environment.EnvironmentName
});
```

## Rules

- **NEVER** manually edit version numbers in `.csproj` — use build scripts
- **ALWAYS** use conventional commit prefixes to drive version bumps
- **ALWAYS** tag releases: `git tag v3.7.0` after MINOR/MAJOR bumps
- MAJOR bumps require explicit approval — never automatic
- CI pipeline reads commit messages and calls appropriate bump script
- `InformationalVersion` should include Git SHA for traceability

## Git Tag Workflow

```bash
# After release decision
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## Changelog Generation

Use CI to auto-generate changelogs from conventional commits:

```bash
# Install dotnet-releaser or use GitHub Actions changelog generator
dotnet tool install -g dotnet-releaser

# Or use conventional-changelog via Node.js tooling in CI
npx conventional-changelog -p angular -i CHANGELOG.md -s
```

### Changelog Format

```markdown
## [3.7.0] - 2025-01-15
### Added
- Producer bulk import endpoint (#142)
- Tenant-scoped caching for catalog queries (#138)
### Fixed
- Race condition in order processing (#145)
### Changed
- Upgraded to .NET 9 (#140)
```

### Rules
- **ALWAYS** generate changelog before tagging a release
- One changelog entry per conventional commit (squash merge = one entry)
- Link PR numbers in entries for traceability

## Pre-release Versioning

Use SemVer pre-release identifiers for non-production builds:

```
3.7.0-alpha.1    → Early development, breaking changes expected
3.7.0-beta.1     → Feature-complete, testing in progress
3.7.0-rc.1       → Release candidate, final validation
3.7.0            → Production release
```

```xml
<!-- Directory.Build.props -->
<PropertyGroup>
  <VersionPrefix>3.7.0</VersionPrefix>
  <VersionSuffix>rc.1</VersionSuffix>  <!-- Remove for production -->
</PropertyGroup>
```

### NuGet / Package Pre-release
```bash
# CI publishes pre-release packages with suffix
dotnet pack -c Release --version-suffix "beta.$(BuildNumber)"
# Consumers: dotnet add package Contoso.Api --version 3.7.0-beta.42
```

### Rules
- Pre-release tags sort correctly: `alpha.1 < beta.1 < rc.1 < release`
- **NEVER** deploy pre-release versions to production
- Beta/RC builds go to staging environment only

## API Version Deprecation Timeline

Coordinate API deprecation with `api-patterns.instructions.md` versioning:

| Phase | Timeline | Action |
|-------|----------|--------|
| **Announce** | v(N+1) release | Add `Sunset` header to v(N), update docs |
| **Warn** | +3 months | Log warnings for v(N) consumers, notify via email |
| **Deprecate** | +6 months | Return `Deprecation` header, reduce rate limits |
| **Remove** | +12 months | Return `410 Gone` for v(N) endpoints |

### Deprecation Headers (.NET)
```csharp
// Middleware to add sunset headers for deprecated API versions
app.Use(async (context, next) =>
{
    await next();
    if (context.Request.Path.StartsWithSegments("/api/v1"))
    {
        context.Response.Headers.Append("Sunset", "Sat, 01 Jan 2026 00:00:00 GMT");
        context.Response.Headers.Append("Deprecation", "true");
        context.Response.Headers.Append("Link",
            "</api/v2/docs>; rel=\"successor-version\"");
    }
});
```

## See Also

- `api-patterns.instructions.md` — API versioning strategy, URL/header versioning
- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```

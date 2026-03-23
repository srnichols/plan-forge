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

## See Also

- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```

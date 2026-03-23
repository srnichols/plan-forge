---
description: Version management — Semantic versioning, auto-increment, commit-driven version bumps, release tagging
applyTo: '**/pom.xml,**/build.gradle*'
---

# Version Management (Java/Spring Boot)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Uses [Semantic Versioning 2.0.0](https://semver.org/):

| Segment | When to Increment | Trigger |
|---------|-------------------|---------|
| **MAJOR** | Breaking API changes | Manual approval required |
| **MINOR** | New features (backward-compatible) | `feat:` commit prefix |
| **PATCH** | Bug fixes, performance, refactors | `fix:` / `perf:` / `refactor:` prefix |

## Commit Message → Version Bump

| Commit Prefix | Version Impact | Example |
|---|---|---|
| `feat:` | MINOR +1 | 3.6.0 → 3.7.0 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 | 3.6.5 → 3.6.6 |
| `docs:` / `chore:` / `test:` / `style:` / `ci:` | No version bump | — |
| `feat!:` / `BREAKING CHANGE:` | MAJOR +1 | 3.6.5 → 4.0.0 |

## Implementation

### Maven (pom.xml)
```xml
<project>
    <groupId>com.contoso</groupId>
    <artifactId>api-service</artifactId>
    <version>3.7.2</version>
</project>
```

### Gradle (build.gradle.kts)
```kotlin
group = "com.contoso"
version = "3.7.2"
```

## Automated Versioning

```xml
<!-- Maven: versions-maven-plugin -->
<plugin>
    <groupId>org.codehaus.mojo</groupId>
    <artifactId>versions-maven-plugin</artifactId>
</plugin>
```

```bash
# Bump version via Maven
mvn versions:set -DnewVersion=3.8.0

# Or use JReleaser for full automation
# .jreleaser.yml reads conventional commits
```

## Version Endpoint (Actuator)

```yaml
# application.yml
management:
  info:
    env:
      enabled: true
    build:
      enabled: true   # Exposes /actuator/info with build metadata
    git:
      mode: full       # Include git commit info
```

```java
// Or custom endpoint
@RestController
public class VersionController {
    @GetMapping("/api/version")
    public Map<String, String> version() {
        return Map.of(
            "version", buildProperties.getVersion(),
            "artifact", buildProperties.getArtifact(),
            "commit", gitProperties.getCommitId()
        );
    }
}
```

## Rules

- **NEVER** manually edit version in `pom.xml` / `build.gradle` — use tooling
- **ALWAYS** use conventional commit prefixes to drive version bumps
- **ALWAYS** tag releases: `git tag v3.7.0`
- MAJOR bumps require explicit approval
- Use `spring-boot-starter-actuator` with `build-info` goal for runtime version
- Use `git-commit-id-maven-plugin` for Git metadata in builds

## Git Tag Workflow

```bash
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## Changelog Generation

Auto-generate changelogs from conventional commits:

```yaml
# .jreleaser.yml — JReleaser generates changelog from Git history
release:
  github:
    changelog:
      formatted: ALWAYS
      preset: conventional-commits
      contributors:
        enabled: true
```

```bash
# Generate changelog
jreleaser changelog
# Or use git-changelog-maven-plugin
mvn git-changelog-maven-plugin:git-changelog
```

### Changelog Format

```markdown
## [3.7.0] - 2025-01-15
### Features
- Producer bulk import endpoint (#142)
- Tenant-scoped caching for catalog queries (#138)
### Bug Fixes
- Race condition in order processing (#145)
### Dependencies
- Upgraded Spring Boot to 3.4 (#140)
```

### Rules
- **ALWAYS** generate changelog before tagging a release
- One changelog entry per conventional commit (squash merge = one entry)
- Link PR numbers in entries for traceability

## Pre-release Versioning

Use SemVer pre-release identifiers:

```
3.7.0-alpha.1    → Early development, breaking changes expected
3.7.0-beta.1     → Feature-complete, testing in progress
3.7.0-RC1        → Release candidate, final validation
3.7.0            → Production release
```

```xml
<!-- Maven: pom.xml -->
<version>3.7.0-RC1</version>
```

```kotlin
// Gradle: build.gradle.kts
version = "3.7.0-RC1"
```

```bash
# Publish snapshot/pre-release to Maven repo
mvn deploy -DaltDeploymentRepository=snapshots::https://repo.contoso.com/snapshots
# Consumers: <version>3.7.0-RC1</version>
```

### Rules
- Maven treats `-SNAPSHOT` as a special mutable version — use for dev only
- Pre-release tags (`-alpha.1`, `-beta.1`, `-RC1`) are immutable releases
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

### Deprecation Headers (Spring)
```java
@Component
public class DeprecationHeaderFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(request, response);
        if (request.getRequestURI().startsWith("/api/v1")) {
            response.setHeader("Sunset", "Sat, 01 Jan 2026 00:00:00 GMT");
            response.setHeader("Deprecation", "true");
            response.setHeader("Link",
                "</api/v2/docs>; rel=\"successor-version\"");
        }
    }
}
```

## See Also

- `api-patterns.instructions.md` — API versioning strategy, URL/header versioning
- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```

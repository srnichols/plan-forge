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

## See Also

- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```

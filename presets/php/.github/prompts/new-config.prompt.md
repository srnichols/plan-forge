---
description: "Scaffold Laravel configuration files and typed value objects backed by environment variables."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Module

Scaffold deploy-safe configuration that is read through Laravel config and validated before use.

## Required Pattern

### Config File

```text
config/{section-name}.php

return [
    'base_url' => env('{SECTION_PREFIX}_BASE_URL'),
    'timeout_seconds' => (int) env('{SECTION_PREFIX}_TIMEOUT_SECONDS', 30),
    'retry_count' => (int) env('{SECTION_PREFIX}_RETRY_COUNT', 3),
];
```

### Typed Config Object

```text
app/Support/Config/{SectionName}Config.php

final readonly class {SectionName}Config
{
    public function __construct(
        public string $baseUrl,
        public int $timeoutSeconds,
        public int $retryCount,
    ) {
        if ($this->baseUrl === '') {
            throw new InvalidArgumentException('{SectionName} base URL is required.');
        }
    }

    public static function fromConfig(): self
    {
        return new self(
            baseUrl: (string) config('{section-name}.base_url'),
            timeoutSeconds: (int) config('{section-name}.timeout_seconds'),
            retryCount: (int) config('{section-name}.retry_count'),
        );
    }
}
```

### Service Provider Binding

```text
app/Providers/AppServiceProvider.php

public function register(): void
{
    $this->app->singleton({SectionName}Config::class, static fn (): {SectionName}Config => {SectionName}Config::fromConfig());
}
```

### Environment Template

```text
.env.example

{SECTION_PREFIX}_BASE_URL=
{SECTION_PREFIX}_TIMEOUT_SECONDS=30
{SECTION_PREFIX}_RETRY_COUNT=3
```

## Rules

- Read `env()` only from config files.
- Use `config()` or injected typed config objects everywhere else.
- Do not put secret values in `.env.example`.
- Validate required config during startup or provider registration.
- Keep production secrets in environment variables or a secret store.
- Document each key with a safe default when a default is valid.
- Run `php artisan config:clear` locally after changing config keys.

## Reference Files

- [Multi-environment configuration](../instructions/multi-environment.instructions.md)
- [Security instructions](../instructions/security.instructions.md)
- [Configuration layering guidance](../instructions/architecture-principles.instructions.md)

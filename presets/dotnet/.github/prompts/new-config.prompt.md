---
description: "Scaffold strongly-typed configuration with IOptions<T>, validation, and environment-specific overrides."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Section

Scaffold a strongly-typed configuration class bound from `appsettings.json` using the Options pattern.

## Required Pattern

### Configuration Class
```csharp
public class {SectionName}Options
{
    public const string SectionName = "{SectionName}";

    [Required, Url]
    public string BaseUrl { get; set; } = string.Empty;

    [Required]
    public string ApiKey { get; set; } = string.Empty;

    [Range(1, 300)]
    public int TimeoutSeconds { get; set; } = 30;

    public int RetryCount { get; set; } = 3;
}
```

### Registration with Validation
```csharp
builder.Services
    .AddOptions<{SectionName}Options>()
    .BindConfiguration({SectionName}Options.SectionName)
    .ValidateDataAnnotations()
    .ValidateOnStart();  // Fail fast if config is invalid
```

### appsettings.json
```json
{
  "{SectionName}": {
    "BaseUrl": "https://api.example.com",
    "ApiKey": "",
    "TimeoutSeconds": 30,
    "RetryCount": 3
  }
}
```

### Environment Override (appsettings.Production.json)
```json
{
  "{SectionName}": {
    "ApiKey": "#{APIKEY_FROM_KEYVAULT}#"
  }
}
```

### Injection Pattern
```csharp
// Prefer IOptions<T> for singleton config; IOptionsSnapshot<T> for scoped/reloadable
public class MyService
{
    private readonly {SectionName}Options _options;

    public MyService(IOptions<{SectionName}Options> options)
    {
        _options = options.Value;
    }
}
```

### Complex Validation (FluentValidation or IValidateOptions)
```csharp
public class {SectionName}OptionsValidator : IValidateOptions<{SectionName}Options>
{
    public ValidateOptionsResult Validate(string? name, {SectionName}Options options)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey))
            return ValidateOptionsResult.Fail("ApiKey is required.");

        if (options.TimeoutSeconds < 1)
            return ValidateOptionsResult.Fail("TimeoutSeconds must be at least 1.");

        return ValidateOptionsResult.Success;
    }
}

// Register:
builder.Services.AddSingleton<IValidateOptions<{SectionName}Options>,
    {SectionName}OptionsValidator>();
```

## Rules

- ALWAYS use `ValidateOnStart()` — fail fast on startup, not at first request
- NEVER read `IConfiguration` directly — always bind to typed Options classes
- NEVER store secrets in `appsettings.json` — use User Secrets, Key Vault, or env vars
- Use `IOptions<T>` for singleton lifetime, `IOptionsSnapshot<T>` for scoped/reloadable
- One Options class per configuration section
- Keep Options classes in `Configuration/` or `Options/` folder

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)

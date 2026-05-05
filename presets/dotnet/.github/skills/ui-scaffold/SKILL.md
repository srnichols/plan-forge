---
name: ui-scaffold
description: Scaffold a new Blazor page with proper layering — service interface, page component (markup + code-behind split), DTO, validation, error handling, and bUnit test. Enforces architecture-principles + blazor-fluent-ui conventions. Use when adding any new UI surface to a Blazor Server app.
argument-hint: "<entity-name> [--read-only | --crud | --form-only] [--no-test]"
tools: [read_file, replace_string_in_file, create_file, file_search, grep_search]
---

# UI Scaffold Skill (Blazor + Fluent UI)

## Trigger
"Scaffold a Clients page" / "Add a UI for invoices" / "Create a Blazor form for time entries" / `/ui-scaffold Clients --crud`

## Why This Skill Exists

A naïve scaffold produces a `.razor` file that injects the `DbContext`, queries directly, and ships with no tests, no error UI, no accessibility. That's vibe-coded UI — exactly what Plan-Forge exists to prevent. This skill enforces the layered architecture from `architecture-principles.instructions.md` and the component discipline from `blazor-fluent-ui.instructions.md` on every new page.

## Preconditions (verify before scaffolding)

1. The project is a Blazor Server app (or Blazor United host) on .NET 8+
2. `Microsoft.FluentUI.AspNetCore.Components` is referenced in the Web project
3. The entity model exists in a Core/Domain project (e.g., `TimeTracker.Core/Models/Client.cs`)
4. `.github/instructions/blazor-fluent-ui.instructions.md` is present (loaded by setup)

If any precondition fails, **stop and surface the gap** — do not scaffold against an incompatible project.

## Steps

### 1. Confirm Scope
Read the entity model and any existing service for the same entity.

```
read_file path: src/<Project>.Core/Models/<Entity>.cs
file_search query: src/**/Services/I<Entity>Service.cs
```

If a service already exists, scaffold the UI against it. If not, scaffold the service interface first (Step 2). **Do not** let the page reach into the `DbContext` even temporarily — every shortcut becomes permanent.

### 2. Service Layer (if missing)

Generate or update:

- **`src/<Api or Web>/Services/I<Entity>Service.cs`** — interface with `GetAllAsync(CancellationToken)`, `GetByIdAsync(Guid, CancellationToken)`, plus `CreateAsync`/`UpdateAsync`/`DeleteAsync` for `--crud` mode.
- **`src/<Api or Web>/Services/<Entity>Service.cs`** — implementation that takes `DbContext` (or repository) via constructor injection.

Register the service in `Program.cs`:
```csharp
builder.Services.AddScoped<IClientService, ClientService>();
```

### 3. Form Model / DTO (for `--crud` and `--form-only`)

Create a DTO under `src/<Web>/Models/<Entity>FormModel.cs`. **Never** bind `EditForm` to the EF entity directly. Decorate with `DataAnnotations` for client-side validation:

```csharp
public class ClientFormModel
{
    [Required, StringLength(200)]
    public string Name { get; set; } = "";

    [Range(0.01, 10_000)]
    public decimal HourlyRate { get; set; }

    public bool IsActive { get; set; } = true;
}
```

Add `ToCommand()` / `FromEntity()` mapping methods on the DTO.

### 4. Page Component (Markup + Code-Behind Split)

For non-trivial pages, **always** use the `.razor` + `.razor.cs` partial-class pattern. Single-file `@code` blocks are reserved for trivial display components.

**`src/<Web>/Pages/<Entities>.razor`** (markup):
- `@page "/<entities>"`
- `@rendermode InteractiveServer` at the page boundary
- `<PageTitle>` set
- Layout via `FluentStack` / `FluentGrid` — no inline `style` for spacing
- Three render branches: `_loading` → `<FluentProgressRing>`, `_loadError` → `<FluentMessageBar Intent="Error">`, success → `<FluentDataGrid>`
- All interactive elements have visible text or `aria-label`

**`src/<Web>/Pages/<Entities>.razor.cs`** (code-behind):
- `partial class` implementing `IDisposable`
- `[Inject]` properties (never `@inject` directives in code-behind pages)
- Single `CancellationTokenSource _cts = new();` cancelled in `Dispose`
- `OnInitializedAsync` wrapped in try/catch with three branches:
  - `OperationCanceledException` → silent (navigation aborted)
  - `Exception` → log structured + set `_loadError`
  - `finally` → `_loading = false;`
- `ILogger<T>` injected for structured logging

For `--crud` add: `Edit/Create.razor` + code-behind with `EditForm`, `DataAnnotationsValidator`, submit-disabled-while-in-flight, success/error `FluentToast` via `IToastService`.

### 5. bUnit Test (skip with `--no-test` only when explicitly justified)

**`tests/<Web>.Tests/Pages/<Entities>Tests.cs`**:
```csharp
public class ClientsTests : TestContext
{
    [Fact]
    public void Renders_progress_ring_while_loading()
    {
        var service = Substitute.For<IClientService>();
        service.GetAllAsync(Arg.Any<CancellationToken>())
               .Returns(new TaskCompletionSource<IReadOnlyList<Client>>().Task);
        Services.AddSingleton(service);

        var cut = RenderComponent<Clients>();

        cut.Markup.ShouldContain("FluentProgressRing");
    }

    [Fact]
    public async Task Renders_grid_with_data_after_load() { /* … */ }

    [Fact]
    public async Task Renders_error_message_when_service_throws() { /* … */ }
}
```

At minimum cover: loading state, success state with non-empty data, error state when the service throws.

### 6. Accessibility Pass (mandatory)

Before declaring the scaffold done, verify against `blazor-fluent-ui.instructions.md`:

- [ ] `<PageTitle>` set
- [ ] Every `FluentButton` has visible text OR `aria-label`
- [ ] Every form field has `Label="…"`
- [ ] Loading/error regions have `aria-live` (or use Fluent components that handle it)
- [ ] No CSS overrides removing the focus ring

### 7. Hand-off Report

```
UI Scaffold Complete: <Entity>

Created:
  ✓ src/<Project>.Web/Services/I<Entity>Service.cs (if missing)
  ✓ src/<Project>.Web/Services/<Entity>Service.cs   (if missing)
  ✓ src/<Project>.Web/Models/<Entity>FormModel.cs    (--crud / --form-only)
  ✓ src/<Project>.Web/Pages/<Entities>.razor + .razor.cs
  ✓ src/<Project>.Web/Pages/<Entity>Edit.razor + .razor.cs (--crud)
  ✓ tests/<Project>.Web.Tests/Pages/<Entities>Tests.cs

Modified:
  ✓ src/<Project>.Web/Program.cs (service registration)

Verified:
  ✓ No DbContext injected into components
  ✓ Code-behind split (markup ≤ 100 lines, code-behind ≤ 250 lines)
  ✓ CancellationToken propagated through all async lifecycle methods
  ✓ Loading + success + error states all render
  ✓ Accessibility checklist passes
  ✓ bUnit tests cover loading / success / error

Run:
  dotnet build
  dotnet test --filter "FullyQualifiedName~<Entities>Tests"
  dotnet run --project src/<Project>.Web
```

## Constraints

- **Never** scaffold a page that injects `DbContext` directly. If the service interface is missing, scaffold it first (Step 2). No exceptions.
- **Never** bind `EditForm` to an EF entity. Always go through a DTO.
- **Never** skip the test (`--no-test`) without an explicit, recorded justification. The test is part of the scaffold; it is what makes the scaffold "enterprise-grade" instead of vibe-coded.
- **Never** reach across UI frameworks. If the project uses Fluent UI, the scaffold uses Fluent UI — do not introduce Bootstrap, MudBlazor, or hand-rolled CSS just because a snippet is faster to write.
- Match the project's existing folder structure — read `presets/dotnet/.github/instructions/blazor-fluent-ui.instructions.md` for the canonical patterns.

## Modes

| Flag | Generates |
|---|---|
| `--read-only` (default) | List page only — `<Entities>.razor` with `FluentDataGrid` |
| `--crud` | List + Create + Edit + Delete confirm + DTO + form |
| `--form-only` | Just the form (Create/Edit) — for sub-pages of an existing parent |
| `--no-test` | Skip bUnit test (must be justified — surface a warning) |

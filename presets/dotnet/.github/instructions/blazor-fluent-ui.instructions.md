---
description: Blazor Server + Microsoft Fluent UI patterns — component layering, state, lifecycle, accessibility. Auto-loads when editing .razor / .razor.cs files.
applyTo: '**/*.razor,**/*.razor.cs,**/*.razor.css,**/Components/**,**/Pages/**,**/Shared/**'
---

# Blazor + Fluent UI Patterns

> **Stack assumption**: Blazor Server (interactive server rendering) on .NET 10 with `Microsoft.FluentUI.AspNetCore.Components` 4.x. Adapt selectively for Blazor WebAssembly or Blazor United.

---

## The Layering Rule (Non-Negotiable)

A `.razor` component is **Presentation**. It does ONE thing: render UI and dispatch events. Everything else is delegated.

```
.razor / .razor.cs (Presentation)
   ↓ inject
Application service interface (IClientService, IBillingService, …)
   ↓ implementation
Repository / DbContext (Data Access)
```

### Forbidden in `.razor` / `.razor.cs`

| Anti-pattern | Why | Fix |
|---|---|---|
| `@inject MyDbContext Db` | Components become untestable; couples UI to ORM | Inject a service interface; service owns the `DbContext` |
| Inline LINQ over `DbSet<T>` | Same — embeds query logic in presentation | Move query into the service; component calls `service.GetXAsync(ct)` |
| Business rules (`if (entry.Hours > 8) entry.IsOvertime = true`) | Logic that must hold across surfaces (UI, API, jobs) cannot live in one of them | Move to a domain method or service |
| `HttpClient` instantiated with `new` | No DI, no testability, leaks sockets | Use `IHttpClientFactory` or a typed client registered in DI |
| `Task.Run(() => …)` to "make it async" | Wastes a thread; doesn't make the call truly async | If the underlying API is sync, leave it sync; otherwise call the real async API |
| `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` in lifecycle methods | Deadlocks Blazor Server's render loop | `await` properly inside `OnInitializedAsync` / `OnParametersSetAsync` |
| Catch `Exception` and silently swallow | Hides defects; user sees a half-rendered page with no signal | Catch specific types, log structured, surface a `MessageBar` or `Toast` |

---

## Component Anatomy (Code-Behind Preferred)

For anything beyond a trivial display component, separate markup from code-behind. This makes the component reviewable and unit-testable with bUnit.

### Markup — `Pages/Clients.razor`
```razor
@page "/clients"
@attribute [StreamRendering]

<PageTitle>Clients</PageTitle>

<FluentStack Orientation="Orientation.Vertical" VerticalGap="16">
    <FluentLabel Typo="Typography.PageTitle">Clients</FluentLabel>

    @if (_loading)
    {
        <FluentProgressRing aria-label="Loading clients" />
    }
    else if (_loadError is not null)
    {
        <FluentMessageBar Intent="MessageIntent.Error" Title="Failed to load clients">
            @_loadError
        </FluentMessageBar>
    }
    else
    {
        <FluentDataGrid Items="@_clients" GridTemplateColumns="2fr 1fr 1fr auto">
            <PropertyColumn Property="@(c => c.Name)" Sortable="true" />
            <PropertyColumn Property="@(c => c.HourlyRate)" Format="C" />
            <PropertyColumn Property="@(c => c.IsActive)" Title="Active" />
            <TemplateColumn Title="Actions">
                <FluentButton Appearance="Appearance.Lightweight"
                              OnClick="@(() => EditAsync(context.Id))">Edit</FluentButton>
            </TemplateColumn>
        </FluentDataGrid>
    }
</FluentStack>
```

### Code-behind — `Pages/Clients.razor.cs`
```csharp
using Microsoft.AspNetCore.Components;
using TimeTracker.Core.Models;
using TimeTracker.Web.Services;

namespace TimeTracker.Web.Pages;

public partial class Clients : ComponentBase, IDisposable
{
    [Inject] private IClientService ClientService { get; set; } = default!;
    [Inject] private NavigationManager Nav { get; set; } = default!;
    [Inject] private ILogger<Clients> Logger { get; set; } = default!;

    private readonly CancellationTokenSource _cts = new();
    private IQueryable<ClientListItem> _clients = Enumerable.Empty<ClientListItem>().AsQueryable();
    private bool _loading = true;
    private string? _loadError;

    protected override async Task OnInitializedAsync()
    {
        try
        {
            var items = await ClientService.GetAllAsync(_cts.Token);
            _clients = items.AsQueryable();
        }
        catch (OperationCanceledException) { /* navigation aborted load */ }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to load clients");
            _loadError = "We couldn't load clients. Try refreshing.";
        }
        finally
        {
            _loading = false;
        }
    }

    private Task EditAsync(Guid id)
    {
        Nav.NavigateTo($"/clients/{id}/edit");
        return Task.CompletedTask;
    }

    public void Dispose() => _cts.Cancel();
}
```

Why this shape:
- `[Inject]` properties live on the partial class, not in `@inject` directives — easier to find, easier to mock in bUnit.
- A single `CancellationTokenSource` is cancelled on `Dispose` so navigating away during a slow load doesn't update an already-disposed component.
- Separate `_loading` / `_loadError` state — never render a half-loaded grid.
- The catch-all branch logs structured and surfaces a user-friendly message; the technical detail goes to logs, not the user.

---

## Lifecycle Discipline

| Method | When | Use For | Don't |
|---|---|---|---|
| `OnInitializedAsync` | Once per component instance | Load initial data | Re-fetch on parameter change (use `OnParametersSetAsync`) |
| `OnParametersSetAsync` | Every parameter change | Re-fetch when route/cascading params change | Set `[Parameter]` properties yourself |
| `OnAfterRenderAsync(firstRender)` | After every render | JS interop, focus, scroll-into-view | Mutate state without `StateHasChanged` (you'll loop) |
| `Dispose` / `DisposeAsync` | Component teardown | Cancel CTS, unsubscribe events, dispose timers | Forget it — Blazor Server holds connections; leaks are persistent |

**Always** accept and propagate a `CancellationToken` into service calls. Blazor Server keeps a SignalR circuit open per user — without cancellation, abandoned loads keep the DbContext busy.

---

## State Management

| Scope | Pattern | Lifetime |
|---|---|---|
| Single component | Private fields | Component lifetime |
| Parent ↔ child | `[Parameter]` + `EventCallback` | Render |
| Sibling components | Cascading parameter or scoped service | Circuit |
| Cross-page within session | Scoped service registered in DI | SignalR circuit |
| Cross-user / persistent | Database (via service) | Forever |

**Do not use `static` fields for shared state in Blazor Server.** A static field is shared across **every user on the server**. Use scoped services.

```csharp
// ❌ NEVER
public static class CurrentClient { public static Client? Selected; }

// ✅ ALWAYS — registered as Scoped in Program.cs
public class ClientSelectionState
{
    public event Action? OnChange;
    private Client? _selected;
    public Client? Selected
    {
        get => _selected;
        set { _selected = value; OnChange?.Invoke(); }
    }
}
```

---

## Forms & Validation

Use `EditForm` + DataAnnotations or FluentValidation. Never roll your own validation in the component.

```razor
<EditForm Model="_form" OnValidSubmit="SubmitAsync">
    <DataAnnotationsValidator />
    <FluentStack Orientation="Orientation.Vertical" VerticalGap="12">
        <FluentTextField @bind-Value="_form.Name" Label="Name" Required="true" />
        <ValidationMessage For="@(() => _form.Name)" />

        <FluentNumberField @bind-Value="_form.HourlyRate" Label="Hourly Rate" />
        <ValidationMessage For="@(() => _form.HourlyRate)" />

        <FluentButton Type="ButtonType.Submit"
                      Appearance="Appearance.Accent"
                      Disabled="@_submitting">
            @(_submitting ? "Saving…" : "Save")
        </FluentButton>
    </FluentStack>
</EditForm>
```

Rules:
- Validate at **two boundaries**: client-side (UX), server-side service (truth). Never trust client validation alone.
- The form model is a separate DTO — never bind directly to the EF entity.
- Disable the submit button while in-flight to prevent double-submission.

---

## Fluent UI Conventions

Use Fluent UI components — do **not** mix Bootstrap, MudBlazor, or hand-rolled CSS frameworks.

| Need | Component |
|---|---|
| Layout (vertical/horizontal stack) | `FluentStack`, `FluentGrid` |
| Tables | `FluentDataGrid` (built-in sorting, paging, virtualization) |
| Forms | `FluentTextField`, `FluentNumberField`, `FluentSelect`, `FluentDatePicker`, `FluentCheckbox` |
| Buttons | `FluentButton` with `Appearance` (`Accent`, `Lightweight`, `Outline`, `Stealth`) |
| Feedback | `FluentMessageBar`, `FluentProgressRing`, `FluentToast` (via `IToastService`) |
| Navigation | `FluentNavMenu`, `FluentBreadcrumb`, `FluentTabs` |
| Modals | `IDialogService` (never roll your own overlay) |
| Charts | `Blazor-ApexCharts` (`<ApexChart>`) for KPIs and dashboards |

**Never** put inline `style="…"` on Fluent components for layout. Use `FluentStack` / `FluentGrid` for spacing and alignment so the design system handles theming.

---

## Accessibility (WCAG 2.1 AA — Non-Negotiable)

Every page ships with these or it doesn't ship:

- [ ] Every interactive element has either visible text or `aria-label` (icon-only buttons)
- [ ] All form fields have `<label>` (Fluent does this when you set `Label="…"`)
- [ ] Keyboard navigable — Tab order is logical, Esc closes dialogs, Enter submits forms
- [ ] Focus is visible on every interactive element (don't override the focus ring)
- [ ] Color contrast ≥ 4.5:1 for text — use the Fluent theme tokens, don't hand-pick colors
- [ ] `<PageTitle>` is set on every routed page
- [ ] Loading and error states are announced (`aria-live="polite"` on dynamic regions)
- [ ] Tables use `FluentDataGrid` (rendered as `<table>` with proper headers), not `<div>` grids

---

## Render-Mode Discipline (.NET 8+)

Be explicit about render mode at the page boundary:

```razor
@page "/dashboard"
@rendermode InteractiveServer
```

| Mode | When |
|---|---|
| `InteractiveServer` | Real-time data, server-side state, low-latency users (default for this project) |
| `InteractiveAuto` | Public pages where first render speed matters |
| `Static` | Truly static content (login splash, marketing) |

Don't mix render modes within a page tree without a clear reason — it produces subtle hydration bugs.

---

## Performance

- **Virtualize long lists**: `<Virtualize>` for >100 rows, or `FluentDataGrid` with `Virtualize="true"`
- **Avoid re-render storms**: components that observe a service must `StateHasChanged` only when they actually change — wrap event subscriptions in try/finally to unsubscribe in `Dispose`
- **Don't fetch in render**: never call services from `@code` block expressions evaluated during render — only from lifecycle methods
- **Use `@key` on dynamic lists** so Blazor's diff doesn't reorder the wrong DOM nodes

---

## Testing

| Layer | Tool | What to test |
|---|---|---|
| Service contract | xUnit | Business logic in isolation (mock `DbContext` with `Microsoft.EntityFrameworkCore.InMemory` or interface-mock) |
| Component | bUnit | Renders correct markup for given state; events fire correctly; lifecycle behaves under cancellation |
| End-to-end | Playwright | Critical user flows (login → create entity → see it in list) |

**A page that renders a `FluentDataGrid` of clients gets a bUnit test that asserts**:
1. While `_loading` is true, `<FluentProgressRing>` is rendered.
2. After `OnInitializedAsync` completes, the grid contains the expected row count.
3. If the service throws, the error `<FluentMessageBar>` is rendered (no crash).

---

## Code Review Checklist (Blazor)

Before approving a `.razor` change, verify:

- [ ] No `DbContext` injected into the component
- [ ] No business logic in markup or code-behind (delegated to a service)
- [ ] All async lifecycle methods accept the component's `CancellationToken`
- [ ] `Dispose` cancels the CTS and unsubscribes events
- [ ] Loading, success, **and** error states are all rendered
- [ ] Form validation present (server-side, not just client)
- [ ] Accessibility checklist passes (labels, contrast, keyboard, page title)
- [ ] No `static` fields used for state
- [ ] Render mode is explicit at the page boundary
- [ ] bUnit test exists for non-trivial components

---

## Warning Signs

Observable patterns indicating these principles are being violated:

- A `.razor.cs` file imports `Microsoft.EntityFrameworkCore` (presentation reaching into data access)
- A component has more than three `[Inject]` services (likely doing too much — split it)
- A page exceeds 250 lines of code-behind (decompose into child components)
- A lifecycle method does not accept or propagate a `CancellationToken`
- `StateHasChanged()` is called from `OnAfterRenderAsync` without a guard — infinite render loop incoming
- A form binds an `EditForm` directly to an EF entity rather than a DTO
- Inline `style="…"` overrides Fluent UI spacing or color tokens
- A `static` field is declared inside a Blazor Server component or service

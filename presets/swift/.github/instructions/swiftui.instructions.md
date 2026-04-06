---
description: SwiftUI patterns — state management, navigation, async data loading, previews
applyTo: '**/*View.swift,**/*ViewModel.swift,**/*Screen.swift,**/Views/**'
---

# SwiftUI Patterns

## State Management

### Property Wrappers Guide

| Wrapper | Use Case |
|---------|----------|
| `@State` | Local view state (primitive types) |
| `@Binding` | Two-way binding from parent |
| `@StateObject` | Owned ViewModel (created by this view) |
| `@ObservedObject` | Injected ViewModel (created externally) |
| `@EnvironmentObject` | App-wide shared state |
| `@Environment` | System values (colorScheme, dismiss, etc.) |

### ViewModel Pattern
```swift
@MainActor
final class ItemListViewModel: ObservableObject {
    @Published private(set) var items: [Item] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let service: any ItemService

    init(service: some ItemService) {
        self.service = service
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await service.fetchAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
```

### Rules
- **Always `@MainActor`** on ViewModels that publish to `@Published`
- **Never call `DispatchQueue.main.async`** — use `@MainActor` instead
- **Inject services via `init`** — not as globals or singletons
- **Use `@StateObject` when the view owns the VM**; `@ObservedObject` when injected

## View Structure

```swift
struct ItemListView: View {
    @StateObject private var viewModel: ItemListViewModel

    init(service: some ItemService) {
        _viewModel = StateObject(wrappedValue: ItemListViewModel(service: service))
    }

    var body: some View {
        content
            .navigationTitle("Items")
            .task { await viewModel.load() }
            .alert("Error", isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading {
            ProgressView()
        } else {
            List(viewModel.items) { item in
                ItemRow(item: item)
            }
        }
    }
}
```

## Navigation (NavigationStack)

```swift
struct AppView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ItemListView()
                .navigationDestination(for: Item.self) { item in
                    ItemDetailView(item: item)
                }
        }
    }
}
```

## Async Data Loading

```swift
// ✅ Use .task modifier — cancels automatically on view disappear
.task {
    await viewModel.load()
}

// ✅ Use .task(id:) to reload when a value changes
.task(id: selectedCategory) {
    await viewModel.load(category: selectedCategory)
}

// ❌ NEVER: Use onAppear with Task manually (leaks if view disappears)
.onAppear {
    Task { await viewModel.load() }
}
```

## Previews

```swift
#Preview {
    ItemListView(service: MockItemService(items: [
        Item(id: UUID(), name: "Sample Item")
    ]))
}

// For complex previews
struct ItemListView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ItemListView(service: MockItemService(items: []))
                .previewDisplayName("Empty")
            ItemListView(service: MockItemService(items: [Item(id: UUID(), name: "Widget")]))
                .previewDisplayName("With Items")
        }
    }
}
```

## Anti-Patterns

```
❌ Business logic inside View body — move to ViewModel
❌ @ObservedObject for a VM the view creates — use @StateObject
❌ DispatchQueue.main.async inside @MainActor — redundant and misleading
❌ Singletons for services — inject via init for testability
❌ Force-unwrap in View body — use optional binding
```

## See Also

- `testing.instructions.md` — ViewInspector, ViewModel unit tests
- `naming.instructions.md` — View/ViewModel file naming
- `performance.instructions.md` — Lazy loading, list optimization

import Foundation
protocol View {}
protocol PreviewProvider { associatedtype Previews: View; static var previews: Previews { get } }
@propertyWrapper struct StateObject<Value> { var wrappedValue: Value; init(wrappedValue: Value) { self.wrappedValue = wrappedValue } }
@propertyWrapper struct ObservedObject<Value> { var wrappedValue: Value; init(wrappedValue: Value) { self.wrappedValue = wrappedValue } }
@propertyWrapper struct State<Value> { var wrappedValue: Value; var projectedValue: Binding<Value> { Binding(get: { self.wrappedValue }, set: { _ in }) }; init(wrappedValue: Value) { self.wrappedValue = wrappedValue } }
@propertyWrapper struct Published<Value> { var wrappedValue: Value; init(wrappedValue: Value) { self.wrappedValue = wrappedValue } }
protocol ObservableObject {}
@resultBuilder enum ViewBuilder { static func buildBlock<T>(_ t: T) -> T { t } }
struct Text: View { init(_ text: String) {} }
struct ProgressView: View { init() {} }
struct NavigationPath: Hashable { init() {} }
struct Binding<Value> { let get: () -> Value; let set: (Value) -> Void; init(get: @escaping () -> Value, set: @escaping (Value) -> Void) { self.get = get; self.set = set } }
struct NavigationStack<Content: View>: View { init(path: Binding<NavigationPath>, @ViewBuilder content: () -> Content) {} }
struct List<Data: Sequence, Content: View>: View { init(_ data: Data, @ViewBuilder rowContent: (Data.Element) -> Content) {} }
struct Button<Label: View>: View { init(_ title: String, action: () -> Void) {} }
struct Group<Content: View>: View { init(@ViewBuilder _ content: () -> Content) {} }
extension View {
    func navigationTitle(_ title: String) -> some View { self }
    func task(_ work: () async -> Void) -> some View { self }
    func task(id: AnyHashable?, _ work: () async -> Void) -> some View { self }
    func alert<A: View, M: View>(_ title: String, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A, @ViewBuilder message: () -> M) -> some View { self }
    func navigationDestination<T, D: View>(for: T.Type, destination: (T) -> D) -> some View { self }
    func previewDisplayName(_ name: String) -> some View { self }
}
protocol ItemService { func fetchAll() async throws -> [Item] }
struct Item: Identifiable { let id: UUID; let name: String }
struct ItemRow: View { init(item: Item) {} }
struct ItemDetailView: View { init(item: Item) {} }
struct MockItemService: ItemService { let items: [Item]; func fetchAll() async throws -> [Item] { items } }
extension ItemListView {
    init() {
        self.init(service: MockItemService(items: []))
    }
}

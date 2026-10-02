import App
import Vapor

@main
struct RunApp {
    static func main() async throws {
        let app = try await Application.make(.testing)
        try await configure(app)
        try routes(app)
        try await app.asyncShutdown()
    }
}

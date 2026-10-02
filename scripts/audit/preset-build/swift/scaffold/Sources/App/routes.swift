import Vapor

public func routes(_ app: Application) throws {
    app.get("health") { _ in HTTPStatus.ok }
}

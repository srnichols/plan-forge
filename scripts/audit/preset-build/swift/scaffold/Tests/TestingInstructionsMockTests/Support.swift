import Foundation

/// Minimal view-layer DTO + mock service/view-model stand-ins for the MVVM mock
/// sample in testing.instructions.md. See the explanatory comment in this
/// target's Samples.swift for why these live in a standalone target rather than
/// TestingInstructionsTests.
struct User {
    let id: UUID
    let name: String
}

final class MockUserService {
    var usersToReturn: [User] = []
}

final class UserListViewModel {
    private let userService: MockUserService
    private(set) var users: [User] = []
    private(set) var hasError = false

    init(userService: MockUserService) {
        self.userService = userService
    }

    func loadUsers() async {
        users = userService.usersToReturn
    }
}

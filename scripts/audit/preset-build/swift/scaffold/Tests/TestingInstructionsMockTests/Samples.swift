// Common import header for extracted preset samples. Pre-populated here
// (not part of any manifest block) so manifest entries can safely use
// mode "append" without ever clobbering the imports a sample needs but
// doesn't itself declare.
//
// This target deliberately does NOT `import App` or `import Vapor`: the
// testing.instructions.md MVVM-mock sample mapped here declares its own
// plain `User` DTO (id + name only), which would collide with the
// Fluent-backed `App.User` model (id + name + email) used by the
// Vapor-API samples in TestingInstructionsTests. Keeping this sample in
// its own import-light target avoids that same-module name collision.
import Foundation
import XCTest

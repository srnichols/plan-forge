import Foundation

public typealias CFDictionary = [String: Any]
public typealias OSStatus = Int32
public let errSecSuccess: OSStatus = 0
public let kSecRandomDefault: Int32 = 0
public let kSecClass = "kSecClass"
public let kSecClassGenericPassword = "kSecClassGenericPassword"
public let kSecAttrService = "kSecAttrService"
public let kSecAttrAccount = "kSecAttrAccount"
public let kSecValueData = "kSecValueData"
public let kSecAttrAccessible = "kSecAttrAccessible"
public let kSecAttrAccessibleWhenUnlockedThisDeviceOnly = "kSecAttrAccessibleWhenUnlockedThisDeviceOnly"
public let kSecReturnData = "kSecReturnData"
public let kSecMatchLimit = "kSecMatchLimit"
public let kSecMatchLimitOne = "kSecMatchLimitOne"
public func SecItemDelete(_ query: CFDictionary) {}
public func SecItemAdd(_ query: CFDictionary, _ result: UnsafeMutablePointer<AnyObject?>?) -> OSStatus { errSecSuccess }
public func SecItemCopyMatching(_ query: CFDictionary, _ result: inout AnyObject?) -> OSStatus {
    result = Data() as AnyObject
    return errSecSuccess
}
public func SecRandomCopyBytes(_ source: Int32, _ count: Int, _ bytes: inout [UInt8]) -> Int32 { 0 }
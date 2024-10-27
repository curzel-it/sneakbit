import Foundation

protocol WorldRevisionsStorage {
    func store(revision: UInt32, forWorld worldId: UInt32)
    func lastKnownRevision(for worldId: UInt32) -> UInt32
}

class WorldRevisionsUserDefaults: WorldRevisionsStorage {
    private let kWorldsWithRevisions = "kWorldsWithRevisions"
    private let defaults = UserDefaults.standard
    
    func store(revision: UInt32, forWorld worldId: UInt32) {
        var values = allStoredValues()
        values[worldId] = revision
        let dict = values.reduce(into: [String: UInt32]()) { $0["\($1.key)"] = $1.value }
        defaults.set(dict, forKey: kWorldsWithRevisions)
    }
    
    func lastKnownRevision(for worldId: UInt32) -> UInt32 {
        return allStoredValues()[worldId] ?? 0
    }
    
    private func allStoredValues() -> [UInt32: UInt32] {
        guard let stored = defaults.dictionary(forKey: kWorldsWithRevisions) as? [String: UInt32] else {
            return [:]
        }
        var result = [UInt32: UInt32]()
        for (key, value) in stored {
            if let keyUInt = UInt32(key) {
                result[keyUInt] = value
            }
        }
        return result
    }
}

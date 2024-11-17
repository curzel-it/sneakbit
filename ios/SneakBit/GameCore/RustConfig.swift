import Foundation

func currentLang() -> String {
    Locale.current.identifier
        .replacingOccurrences(of: "-", with: "_")
        .lowercased()
        .components(separatedBy: "_")
        .first ?? "en"
}

func dataFolder() -> String {
    folderContaining(name: "1001", extension: "json", folder: "data")
}

func speciesJson() -> String {
    filePath(name: "species", extension: "json", folder: "data")
}

func saveJson() -> String {
    saveFilePath()
}

func langFolder() -> String {
    folderContaining(name: "en", extension: "stringx", folder: "lang")
}

private func filePath(name: String, extension ext: String, folder: String) -> String {
    Bundle.main.url(forResource: name, withExtension: ext, subdirectory: folder)?
        .absoluteString
        .replacingOccurrences(of: "file:///", with: "/") ?? "iOS file not found \(folder)/\(name).\(ext)"
}

private func folderContaining(name: String, extension ext: String, folder: String) -> String {
    filePath(name: name, extension: ext, folder: folder)
        .replacingOccurrences(of: "/\(name).\(ext)", with: "")
}

private func saveFilePath() -> String {
    let fileManager = FileManager.default
    let documentsDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    let saveFileURL = documentsDirectory.appendingPathComponent("save.json")
    
    if !fileManager.fileExists(atPath: saveFileURL.path) {
        let defaultContents = "{\"always\": 1}".data(using: .utf8)
        fileManager.createFile(atPath: saveFileURL.path, contents: defaultContents, attributes: nil)
    }
    return saveFileURL.path
}

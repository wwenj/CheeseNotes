import SwiftUI
import SwiftData

@main struct MyNoteApp: App {
  var body: some Scene { WindowGroup { RootView().modelContainer(for: CachedNote.self) } }
}

@Model final class CachedNote { @Attribute(.unique) var path: String; var content: String; var revision: String; var updatedAt: Date; init(path: String, content: String, revision: String) { self.path = path; self.content = content; self.revision = revision; self.updatedAt = .now } }

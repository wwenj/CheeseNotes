import SwiftUI
import SwiftData
import WebKit

struct NoteDTO: Codable, Identifiable { var id: String { path }; let path: String; let revision: String?; let updated_at: String? }
struct ContentDTO: Codable { let path: String; let content: String; let revision: String }
struct SyncDTO: Codable { let state: String; let pendingCount: Int; let conflictCount: Int; let lastSuccessAt: String; let lastError: String }
struct RootView: View {
 @Query private var cache: [CachedNote]; @State private var notes: [NoteDTO] = []; @State private var sync: SyncDTO?; @State private var showEditor = false
 var body: some View { TabView { NavigationStack { List(notes) { note in NavigationLink(note.path) { ReaderView(path: note.path) } }.navigationTitle("笔记").toolbar { Button("＋") { showEditor = true } }.task { await reload() }.sheet(isPresented: $showEditor) { EditorView() } }.tabItem { Label("笔记", systemImage: "note.text") }; SearchView().tabItem { Label("搜索", systemImage: "magnifyingglass") }; NavigationStack { VStack(alignment: .leading, spacing: 16) { Text(sync?.state ?? "未连接").font(.title2.bold()); Text("待同步 \(sync?.pendingCount ?? 0) · 冲突 \(sync?.conflictCount ?? 0)"); if let error = sync?.lastError, !error.isEmpty { Text(error).foregroundStyle(.red) }; Button("立即同步") { Task { await triggerSync() } }.buttonStyle(.borderedProminent); Spacer() }.padding().navigationTitle("同步") }.tabItem { Label("同步", systemImage: "arrow.triangle.2.circlepath") }; SettingsView().tabItem { Label("设置", systemImage: "gearshape") } } }
 func reload() async { notes = (try? await APIClient.shared.request("api/tree")) ?? []; sync = try? await APIClient.shared.request("api/sync/status") }
 func triggerSync() async { sync = try? await APIClient.shared.request("api/sync", method: "POST") }
}
struct ReaderView: View { let path: String; @State private var note: ContentDTO?; var body: some View { ScrollView { Text(note?.content ?? "加载中").frame(maxWidth: .infinity, alignment: .leading).padding() }.navigationTitle(path).task { note = try? await APIClient.shared.request("api/notes/content?path=\(path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path)") } } }
struct EditorView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var path = "收件箱/\(ISO8601DateFormatter().string(from: .now).prefix(10)).md"
  @State private var content = "# 新笔记\n"
  var body: some View {
    NavigationStack {
      Form { TextField("路径", text: $path); TextEditor(text: $content).frame(minHeight: 280) }
        .navigationTitle("新建笔记")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("保存") { Task { struct Input: Encodable { let path: String; let content: String }; let _: ContentDTO? = try? await APIClient.shared.request("api/notes", method: "POST", body: Input(path: path, content: content)); dismiss() } } } }
    }
  }
}
struct SearchView: View { @State private var q = ""; var body: some View { NavigationStack { TextField("搜索笔记路径", text: $q).textFieldStyle(.roundedBorder).padding().navigationTitle("搜索") } } }
struct SettingsView: View { @AppStorage("serverURL") private var server = ""; @State private var state = ""; var body: some View { NavigationStack { Form { TextField("服务地址", text: $server).textInputAutocapitalization(.never); Button("保存并测试") { Task { await APIClient.shared.configure(url: server); struct Health: Decodable { let ok: Bool }; if let result: Health = try? await APIClient.shared.request("api/health"), result.ok { state = "服务连接正常" } else { state = "无法连接服务" } } }; Text(state) }.navigationTitle("设置") } } }

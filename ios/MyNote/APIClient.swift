import Foundation

actor APIClient {
  static let shared = APIClient(); private let defaults = UserDefaults.standard
  var baseURL: URL? { URL(string: defaults.string(forKey: "serverURL") ?? "") }
  func configure(url: String) { defaults.set(url, forKey: "serverURL") }
  func request<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T { guard let baseURL else { throw URLError(.badURL) }; var request = URLRequest(url: baseURL.appending(path: path)); request.httpMethod = method; if let body { request.httpBody = try JSONEncoder().encode(AnyEncodable(body)); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }; let (data, response) = try await URLSession.shared.data(for: request); guard (response as? HTTPURLResponse)?.statusCode ?? 500 < 300 else { throw URLError(.badServerResponse) }; return try JSONDecoder().decode(T.self, from: data) }
}
struct AnyEncodable: Encodable { let value: Encodable; init(_ value: Encodable) { self.value = value }; func encode(to encoder: Encoder) throws { try value.encode(to: encoder) } }

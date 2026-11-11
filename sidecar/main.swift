// xencrm-afm: sidecar de Apple Foundation Models para XENCRM.
// Protocolo: una línea JSON por petición en stdin, una línea JSON por respuesta en stdout.
//   {"id":1,"op":"health"}
//   {"id":2,"op":"count","text":"..."}
//   {"id":3,"op":"chat","session":"wa:57300...","instructions":"...","prompt":"...","history":"...",
//      "temperature":0.7,"max_tokens":300,"fresh":false,"max_turns":0,"schema":{"properties":[...]}}
//   {"id":4,"op":"reset","session":"..."}
// Compilar: sidecar/build.sh  (solo necesita Command Line Tools; no usa macros @Generable)
import Foundation
import FoundationModels

struct SchemaProperty: Decodable {
  let name: String
  let type: String?
  let `enum`: [String]?
  let description: String?
}
struct SchemaSpec: Decodable { let properties: [SchemaProperty] }
struct Request: Decodable {
  let id: Int
  let op: String
  let session: String?
  let instructions: String?
  let prompt: String?
  let history: String?
  let text: String?
  let temperature: Double?
  let max_tokens: Int?
  let max_turns: Int?
  let fresh: Bool?
  let schema: SchemaSpec?
}

func log(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.withoutEscapingSlashes]),
        let s = String(data: data, encoding: .utf8) else { return }
  print(s)
  fflush(stdout)
}

actor Engine {
  struct Entry {
    var session: LanguageModelSession
    let instructionsHash: Int
    var turns: Int
    var lastUsed: Date
  }
  let model = SystemLanguageModel.default
  var sessions: [String: Entry] = [:]
  let ttl: TimeInterval = 30 * 60

  func handle(_ r: Request) async -> [String: Any] {
    switch r.op {
    case "health": return health(r)
    case "count":
      guard let t = r.text else { return err(r, "bad_request", "falta text") }
      do { return ["id": r.id, "ok": true, "tokens": try await model.tokenCount(for: Instructions(t))] }
      catch { return err(r, "other", "\(error)") }
    case "reset":
      if let s = r.session { sessions[s] = nil } else { sessions.removeAll() }
      return ["id": r.id, "ok": true]
    case "chat": return await chat(r)
    default: return err(r, "bad_request", "op desconocida: \(r.op)")
    }
  }

  func health(_ r: Request) -> [String: Any] {
    var out: [String: Any] = ["id": r.id, "ok": true, "availability": "\(model.availability)"]
    if case .available = model.availability {
      out["available"] = true
      out["context_size"] = model.contextSize
      out["languages"] = model.supportedLanguages.map { $0.minimalIdentifier }.sorted()
    } else {
      out["available"] = false
    }
    return out
  }

  func err(_ r: Request, _ code: String, _ message: String) -> [String: Any] {
    ["id": r.id, "ok": false, "error": code, "message": message]
  }

  func chat(_ r: Request) async -> [String: Any] {
    guard case .available = model.availability else { return err(r, "unavailable", "\(model.availability)") }
    guard let prompt = r.prompt else { return err(r, "bad_request", "falta prompt") }
    let instructions = r.instructions ?? ""
    let key = r.session ?? UUID().uuidString
    let hash = instructions.hashValue
    let maxTurns = r.max_turns ?? 0
    evictIdle()

    var forceFresh = r.fresh ?? false
    let started = Date()
    for attempt in 0..<2 {
      var isNew = false
      var entry: Entry
      if !forceFresh, let e = sessions[key], e.instructionsHash == hash, maxTurns == 0 || e.turns < maxTurns {
        entry = e
      } else {
        let s = LanguageModelSession(model: model, instructions: instructions)
        entry = Entry(session: s, instructionsHash: hash, turns: 0, lastUsed: Date())
        isNew = true
      }
      var fullPrompt = prompt
      if isNew, let h = r.history, !h.isEmpty {
        fullPrompt = "Conversación previa con este cliente:\n\(h)\n\n\(prompt)"
      }
      let options = GenerationOptions(temperature: r.temperature ?? 0.7, maximumResponseTokens: r.max_tokens ?? 300)
      do {
        let content: String
        if let spec = r.schema {
          let schema = try buildSchema(spec)
          let res = try await entry.session.respond(to: fullPrompt, schema: schema, options: options)
          content = res.content.jsonString
        } else {
          let res = try await entry.session.respond(to: fullPrompt, options: options)
          content = res.content
        }
        entry.turns += 1
        entry.lastUsed = Date()
        sessions[key] = entry
        return ["id": r.id, "ok": true, "content": content, "new_session": isNew,
                "turns": entry.turns, "ms": Int(Date().timeIntervalSince(started) * 1000)]
      } catch let e as LanguageModelSession.GenerationError {
        let (code, retryable) = classify(e)
        if retryable && attempt == 0 && !isNew {
          sessions[key] = nil
          forceFresh = true
          continue // reintenta con sesión nueva + historial condensado
        }
        sessions[key] = nil
        return err(r, code, "\(e)")
      } catch {
        let d = "\(error)"
        let code = d.localizedCaseInsensitiveContains("context") ? "context" : "other"
        if code == "context" && attempt == 0 && !isNew { sessions[key] = nil; forceFresh = true; continue }
        sessions[key] = nil
        return err(r, code, d)
      }
    }
    return err(r, "context", "no cupo ni en una sesión nueva")
  }

  func classify(_ e: LanguageModelSession.GenerationError) -> (String, Bool) {
    switch e {
    case .exceededContextWindowSize: return ("context", true)
    case .rateLimited: return ("rate_limited", false)
    case .guardrailViolation: return ("guardrail", false)
    case .refusal: return ("refusal", false)
    case .unsupportedLanguageOrLocale: return ("language", false)
    case .assetsUnavailable: return ("unavailable", false)
    case .concurrentRequests: return ("busy", false)
    case .decodingFailure: return ("decoding", false)
    case .unsupportedGuide: return ("bad_schema", false)
    @unknown default: return ("other", false)
    }
  }

  func buildSchema(_ spec: SchemaSpec) throws -> GenerationSchema {
    var props: [DynamicGenerationSchema.Property] = []
    for p in spec.properties {
      let s: DynamicGenerationSchema
      if let values = p.enum, !values.isEmpty {
        s = DynamicGenerationSchema(name: p.name.capitalized + "Kind", anyOf: values)
      } else {
        switch p.type ?? "string" {
        case "number": s = DynamicGenerationSchema(type: Double.self)
        case "integer": s = DynamicGenerationSchema(type: Int.self)
        case "boolean": s = DynamicGenerationSchema(type: Bool.self)
        default: s = DynamicGenerationSchema(type: String.self)
        }
      }
      props.append(.init(name: p.name, description: p.description, schema: s))
    }
    return try GenerationSchema(root: DynamicGenerationSchema(name: "Root", properties: props), dependencies: [])
  }

  func evictIdle() {
    let now = Date()
    for (k, e) in sessions where now.timeIntervalSince(e.lastUsed) > ttl { sessions[k] = nil }
  }
}

@main
struct Main {
  static func main() async {
    let engine = Engine()
    emit(["ready": true, "pid": ProcessInfo.processInfo.processIdentifier])
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        guard let data = line.data(using: .utf8), !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
        do {
          let req = try JSONDecoder().decode(Request.self, from: data)
          emit(await engine.handle(req))
        } catch {
          emit(["id": -1, "ok": false, "error": "bad_request", "message": "\(error)"])
        }
      }
    } catch {
      log("[xencrm-afm] stdin cerrado: \(error)")
    }
  }
}

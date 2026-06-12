export type ProfileSummary = {
  id: string
  name: string
  device_name: string | null
  active: boolean
  created_at: number
  updated_at: number
}

export type ProfileCategory = {
  category: string
  enabled: boolean
}

export type ProfileRule = {
  id: number
  rule: string
  type: "allow" | "block"
  created_at: number
}

export type Profile = ProfileSummary & {
  categories: ProfileCategory[]
  rules: ProfileRule[]
}

export type Category = {
  id: string
  name: string
  description: string
  lists: string[]
  blocked_services?: string[]
  manual_rules: string[]
  rules_count: number
  refreshed_at: number | null
  error: string | null
}

export type Credentials = {
  profile_id: string
  doh: string
  dot: string
  doh_path: string
  plain_dns: string | null
}

export type Status = {
  ok: boolean
  status: "ok" | "degraded" | string
  database: {
    ok?: boolean
    profiles?: number
    active_profiles?: number
    cached_blocklists?: number
  }
  adguard: {
    ok: boolean
    protection_enabled?: boolean | null
    running?: boolean | null
    version?: string | null
    error?: string
  }
  sync: {
    last_error: {
      profile_id: string
      action: string
      status: string
      message: string
      created_at: number
    } | null
  }
}

export type QueryLogEntry = {
  time: string | null
  domain: string | null
  type: string | null
  client: string | null
  client_name: string | null
  status: "allowed" | "blocked"
  reason: string
  service_name: string | null
  rule: string | null
  filter_id: number | null
}

export type Session = {
  authenticated: boolean
}

export type EventSnapshot = {
  profile_id: string | null
  profiles: ProfileSummary[]
  status: Status
  logs: QueryLogEntry[]
  emitted_at: number
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown
  token?: string
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (response.status === 204) {
    return null as T
  }

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Clave invalida o sesion vencida.")
    }

    throw new Error(data?.message || data?.error || `HTTP ${response.status}`)
  }

  return data as T
}

export function getSession() {
  return apiRequest<Session>("/api/session")
}

export function createSession(token: string) {
  return apiRequest<Session>("/api/session", {
    method: "POST",
    body: { token },
  })
}

export function clearSession() {
  return apiRequest<Session>("/api/session", {
    method: "DELETE",
  })
}

export function ruleRowsFromTextarea(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(allow|block)\s+(.+)$/i)
      if (match) {
        return {
          type: match[1].toLowerCase(),
          rule: match[2].trim(),
        }
      }

      return {
        type: line.startsWith("@@") ? "allow" : "block",
        rule: line,
      }
    })
}

export function rulesToTextarea(rules: ProfileRule[]) {
  return rules.map((row) => `${row.type} ${row.rule}`).join("\n")
}

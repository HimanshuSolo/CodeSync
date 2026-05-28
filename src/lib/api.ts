// base api configuration
// All fetch calls go through these helpers

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

// ── generic request helper ──────────────────────────────
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("codesync_token")
      : null

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || "Request failed")
  }

  return res.json()
}

// ── auth endpoints ───────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user_id: string; username: string; avatar_color: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }
    ),

  register: (email: string, username: string, password: string) =>
    request<{ token: string; user_id: string; username: string; avatar_color: string }>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, username, password }),
      }
    ),

  me: () =>
    request<{ id: string; email: string; username: string; avatar_color: string }>(
      "/auth/me"
    ),
}

// ── session endpoints ────────────────────────────────────
export const sessionApi = {
  list: () =>
    request<{ sessions: import("@/types").Session[] }>("/sessions"),

  create: (name: string, language: import("@/types").Language) =>
    request<{ session: import("@/types").Session }>("/sessions", {
      method: "POST",
      body: JSON.stringify({ name, language }),
    }),

  get: (id: string) =>
    request<{ session: import("@/types").Session }>(`/sessions/${id}`),

  delete: (id: string) =>
    request<{ message: string }>(`/sessions/${id}`, { method: "DELETE" }),
}
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ── generic request helper ────────────────────────────────────────────────────
async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("codesync_token")
      : null;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || "Request failed");
  }

  return res.json();
}

// ── auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{
      token: string;
      user: {
        id: string;
        email: string;
        username: string;
        avatar_color: string;
        created_at: string;
      };
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, username: string, password: string) =>
    request<{
      token: string;
      user: {
        id: string;
        email: string;
        username: string;
        avatar_color: string;
        created_at: string;
      };
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password }),
    }),

  me: () =>
    request<{
      id: string;
      email: string;
      username: string;
      avatar_color: string;
      created_at: string;
    }>("/auth/me"),
};

// ── sessions ──────────────────────────────────────────────────────────────────
export const sessionApi = {
  list: () => request<{ sessions: import("@/types").Session[] }>("/sessions"),

  create: (name: string, language: import("@/types").Language) =>
    request<{ session: import("@/types").Session }>("/sessions", {
      method: "POST",
      body: JSON.stringify({ name, language }),
    }),

  get: (id: string) =>
    request<{ session: import("@/types").Session }>(`/sessions/${id}`),

  delete: (id: string) =>
    request<{ message: string }>(`/sessions/${id}`, {
      method: "DELETE",
    }),
};

// ── isolated code execution ─────────────────────────────────────────────────
export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
}

export const runnerApi = {
  run: (language: import("@/types").Language, code: string, stdin: string) =>
    request<RunResult>("/run", {
      method: "POST",
      body: JSON.stringify({ language, code, stdin }),
    }),
};

// ── repository workspaces ───────────────────────────────────────────────────
export interface RepositoryStatus {
  branch: string;
  changes: string[];
}

export const repositoryApi = {
  import: (sessionId: string, repoUrl: string, branch: string, githubToken: string) =>
    request<{ message: string }>(`/sessions/${sessionId}/repository`, {
      method: "POST",
      body: JSON.stringify({
        repo_url: repoUrl,
        branch: branch || null,
        github_token: githubToken || null,
      }),
    }),

  tree: (sessionId: string) =>
    request<{ files: string[] }>(`/sessions/${sessionId}/repository/tree`),

  readFile: (sessionId: string, path: string) =>
    request<{ path: string; content: string }>(
      `/sessions/${sessionId}/repository/file?path=${encodeURIComponent(path)}`,
    ),

  writeFile: (sessionId: string, path: string, content: string) =>
    request<{ message: string }>(`/sessions/${sessionId}/repository/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),

  status: (sessionId: string) =>
    request<RepositoryStatus>(`/sessions/${sessionId}/repository/status`),

  commit: (sessionId: string, message: string) =>
    request<{ message: string }>(`/sessions/${sessionId}/repository/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  push: (sessionId: string, branch: string, githubToken: string) =>
    request<{ message: string }>(`/sessions/${sessionId}/repository/push`, {
      method: "POST",
      body: JSON.stringify({
        branch: branch || null,
        github_token: githubToken || null,
      }),
    }),
};

export interface User {
  id: string
  email: string
  username: string
  avatarColor: string 
}

export type Language =
  | "typescript"
  | "javascript"
  | "rust"
  | "python"
  | "go"
  | "cpp"
  | "java"
  | "markdown"

export interface Session {
  id: string
  name: string
  language: Language
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface Participant {
  userId: string
  username: string
  avatarColor: string
  cursorLine: number
  cursorCol: number
  isOnline: boolean
}

export type OpType = "insert" | "delete"

export interface EditOp {
  position: number
  text: string
  opType: OpType
  revision: number
  userId: string
  clientId?: string
}

export interface CursorPosition {
  userId: string
  username: string
  avatarColor: string
  line: number
  col: number
}

export type AiMessageRole = "user" | "assistant"

export interface AiMessage {
  id: string
  role: AiMessageRole
  content: string
  isStreaming: boolean
  timestamp: string
}

export interface AiRequest {
  prompt: string
  selectedCode: string
  language: Language
  startLine: number
  endLine: number
}

export interface AuthUser {
  id: string
  email: string
  username: string
  avatarColor: string
  token: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  username: string
  password: string
}

export interface ApiResponse<T> {
  data: T
  message: string
}

export interface ApiError {
  message: string
  statusCode: number
}
import type { EditOp, CursorPosition, AiRequest, AiMessage, Participant } from "@/types"

export type ClientMessage =
  | { type: "edit";       payload: EditOp }
  | { type: "cursor";     payload: CursorPosition }
  | { type: "ai_request"; payload: AiRequest }
  | { type: "ping" }

export type ServerMessage =
  | { type: "edit";         payload: EditOp }
  | { type: "cursor";       payload: CursorPosition }
  | { type: "ai_token";     payload: { token: string; messageId: string } }
  | { type: "ai_done";      payload: { messageId: string } }
  | { type: "user_joined";  payload: Participant }
  | { type: "user_left";    payload: { userId: string } }
  | { type: "session_state";payload: { document: string; participants: Participant[]; revision: number } }
  | { type: "error";        payload: { message: string } }
  | { type: "pong" }

export function encodeMessage(msg: ClientMessage): string {
  return JSON.stringify(msg)
}

export function decodeMessage(raw: string): ServerMessage | null {
  try {
    return JSON.parse(raw) as ServerMessage
  } catch {
    console.error("[WS] Failed to parse message:", raw)
    return null
  }
}
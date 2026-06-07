"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useAiStore } from "@/store/aiStore";
import { decodeMessage, encodeMessage } from "@/lib/ws-messages";
import type { ClientMessage } from "@/lib/ws-messages";
import { useSessionStore } from "@/store/sessionStore";
import { EditOp } from "@/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

type WsStatus = "connecting" | "connected" | "disconnected" | "error";

export function useWebSocket(
  sessionId: string,
  token: string | null,
  ready: boolean = false,
  onRemoteEdit?: (op: EditOp) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const [status, setStatus] = useState<WsStatus>("disconnected");

  // store actions
  const {
    setDocument,
    setRevision,
    setParticipants,
    updateCursor,
    addParticipant,
    removeParticipant,
  } = useSessionStore();

  const { appendToken, finishStreaming } = useAiStore();

  // ── message handler ──────────────────────────────────
  const handleMessage = useCallback(
    (raw: string) => {
      const msg = decodeMessage(raw);
      if (!msg) return;

      switch (msg.type) {
        // full document state on first connect
        case "session_state":
          if (!useSessionStore.getState().document) {
            setDocument(msg.payload.document);
          }

          setDocument(msg.payload.document);
          setRevision(msg.payload.revision);
          setParticipants(msg.payload.participants);
          break;

        // incoming edit op — already OT-resolved by server
        case "edit":
          onRemoteEdit?.(msg.payload);
          break;

        // another user moved their cursor
        case "cursor":
          updateCursor(msg.payload.userId, msg.payload.line, msg.payload.col);
          break;

        // single AI token — append to streaming message
        case "ai_token":
          appendToken(msg.payload.messageId, msg.payload.token);
          break;

        // AI response finished streaming
        case "ai_done":
          finishStreaming(msg.payload.messageId);
          break;

        // someone joined the session
        case "user_joined":
          addParticipant(msg.payload);
          break;

        // someone left
        case "user_left":
          removeParticipant(msg.payload.userId);
          break;

        case "error":
          console.error("[WS] Server error:", msg.payload.message);
          break;

        case "pong":
          // keepalive acknowledged — nothing to do
          break;
      }
    },
    [
      setDocument,
      setRevision,
      setParticipants,
      updateCursor,
      addParticipant,
      removeParticipant,
      appendToken,
      finishStreaming,
      onRemoteEdit,
    ],
  );

  // ── connect ──────────────────────────────────────────
  const connect = useCallback(() => {
    if (!token || !sessionId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");

    const url = `${WS_URL}/session/${sessionId}/ws?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected to session", sessionId);
      setStatus("connected");
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => handleMessage(event.data);

    ws.onerror = (err) => {
      console.error("[WS] Error:", err);
      setStatus("error");
    };

    ws.onclose = () => {
      console.log("[WS] Disconnected");
      setStatus("disconnected");
      wsRef.current = null;

      // exponential backoff reconnect — max 30s
      const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
      reconnectAttempts.current += 1;
      reconnectRef.current = setTimeout(() => connectRef.current(), delay);
    };
  }, [sessionId, token, handleMessage]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ── send a message ───────────────────────────────────
  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(encodeMessage(msg));
    } else {
      console.warn("[WS] Tried to send while disconnected", msg);
    }
  }, []);

  // ── keepalive ping every 30s ─────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: "ping" });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [send]);

  // ── connect on mount, cleanup on unmount ─────────────
  useEffect(() => {
    if (!ready) return;
    connect();
    return () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect, ready]);

  return { status, send };
}

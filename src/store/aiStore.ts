import { create } from "zustand";
import type { AiMessage, CodeSelection } from "@/types";

interface AiState {
  messages: AiMessage[];
  isStreaming: boolean;
  streamingMessageId: string | null;

  addUserMessage: (content: string, selection?: CodeSelection) => string;
  startStreaming: (messageId: string) => void;
  appendToken: (messageId: string, token: string) => void;
  finishStreaming: (messageId: string) => void;
  loadMessages: (messages: AiMessage[]) => void;
  clearMessages: () => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useAiStore = create<AiState>((set) => ({
  messages: [],
  isStreaming: false,
  streamingMessageId: null,

  addUserMessage: (content, selection) => {
    const id = generateId();
    const message: AiMessage = {
      id,
      role: "user",
      content,
      isStreaming: false,
      timestamp: new Date().toISOString(),
    };
    const assistantId = generateId();
    const assistantMsg: AiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
      timestamp: new Date().toISOString(),
      selection,
    };
    set((state) => ({ messages: [...state.messages, message, assistantMsg] }));
    return assistantId;
  },

  startStreaming: (messageId) =>
    set({ isStreaming: true, streamingMessageId: messageId }),

  appendToken: (messageId, token) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + token } : m,
      ),
    })),

  finishStreaming: (messageId) =>
    set((state) => ({
      isStreaming: false,
      streamingMessageId: null,
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, isStreaming: false } : m,
      ),
    })),

  loadMessages: (messages) =>
    set({
      messages: messages.map((message) => ({ ...message, isStreaming: false })),
      isStreaming: false,
      streamingMessageId: null,
    }),

  clearMessages: () =>
    set({ messages: [], isStreaming: false, streamingMessageId: null }),
}));

import { create } from "zustand";
import type { ChatMessage } from "@/types";

interface ChatState {
  messages: ChatMessage[];
  unread: number;

  addMessage: (message: ChatMessage) => void;
  loadMessages: (messages: ChatMessage[]) => void;
  clearUnread: () => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  unread: 0,

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
      unread: state.unread + 1,
    })),

  loadMessages: (messages) => set({ messages, unread: 0 }),

  clearUnread: () => set({ unread: 0 }),

  clearMessages: () => set({ messages: [], unread: 0 }),
}));

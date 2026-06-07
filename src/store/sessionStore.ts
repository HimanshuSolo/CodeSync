import { create } from "zustand";
import type { Session, Participant, EditOp } from "@/types";

interface SessionState {
  currentSession: Session | null;
  document: string;
  revision: number;
  participants: Participant[];

  sessions: Session[];
  currentUserId: string | null;

  setCurrentSession: (session: Session) => void;
  setCurrentUserId: (id: string) => void;
  setDocument: (doc: string) => void;
  applyRemoteEdit: (op: EditOp) => void;
  setRevision: (rev: number) => void;
  setParticipants: (participants: Participant[]) => void;
  updateCursor: (userId: string, line: number, col: number) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (userId: string) => void;
  setSessions: (sessions: Session[]) => void;
  reset: () => void;
}

const initialState = {
  currentSession: null,
  document: "",
  revision: 0,
  participants: [],
  sessions: [],
  currentUserId: null, // ← add this
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setCurrentSession: (session) => set({ currentSession: session }),

  setCurrentUserId: (id) => set({ currentUserId: id }),

  setDocument: (doc) => set({ document: doc }),

  applyRemoteEdit: (op) =>
    set((state) => {
      // skip edits from ourselves — Monaco already shows them
      if (state.currentUserId && op.userId === state.currentUserId) {
        return { revision: op.revision }; // just update revision
      }

      const chars = state.document.split("");
      if (op.opType === "insert") {
        chars.splice(op.position, 0, ...op.text.split(""));
      } else {
        chars.splice(op.position, op.text.length);
      }
      return { document: chars.join(""), revision: op.revision };
    }),

  setRevision: (rev) => set({ revision: rev }),

  setParticipants: (participants) => set({ participants }),

  updateCursor: (userId, line, col) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.userId === userId ? { ...p, cursorLine: line, cursorCol: col } : p,
      ),
    })),

  addParticipant: (participant) =>
    set((state) => ({
      participants: state.participants.some((p) => p.userId === participant.userId)
        ? state.participants.map((p) =>
            p.userId === participant.userId ? { ...p, ...participant, isOnline: true } : p,
          )
        : [...state.participants, participant],
    })),

  removeParticipant: (userId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.userId !== userId),
    })),

  setSessions: (sessions) => set({ sessions }),

  reset: () => set(initialState),
}));

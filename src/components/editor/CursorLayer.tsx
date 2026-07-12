"use client"

import { useEffect, useRef } from "react"
import type * as Monaco from "monaco-editor"
import type { Participant } from "@/types"

interface CursorLayerProps {
  editor: Monaco.editor.IStandaloneCodeEditor | null
  participants: Participant[]
  currentUserId: string
}

// Monaco's ContentWidgetPositionPreference.EXACT. Hardcoded rather than
// importing monaco-editor's runtime module (which would pull it into SSR --
// the editor itself is loaded with `ssr: false` for the same reason; see
// useEditor.ts's Cmd+K keybinding for the same pattern).
const EXACT_POSITION_PREFERENCE = 0

/**
 * Renders every other online participant's live cursor position as a
 * floating Monaco content widget -- a thin caret in their color plus a
 * small name tag. The server already tracks cursor positions (see
 * ws_handler's cursor messages / sessionStore's participants); this is
 * what was missing to actually show them, which is the core "you can see
 * someone else working in the same file" signal a collaborative editor
 * needs.
 */
export function CursorLayer({ editor, participants, currentUserId }: CursorLayerProps) {
  const widgetsRef = useRef(new Map<string, Monaco.editor.IContentWidget>())

  useEffect(() => {
    if (!editor) return

    const remote = participants.filter(
      (p) => p.userId !== currentUserId && p.isOnline && p.cursorLine > 0,
    )
    const remoteIds = new Set(remote.map((p) => p.userId))

    for (const [userId, widget] of widgetsRef.current) {
      if (!remoteIds.has(userId)) {
        editor.removeContentWidget(widget)
        widgetsRef.current.delete(userId)
      }
    }

    for (const participant of remote) {
      const previous = widgetsRef.current.get(participant.userId)
      if (previous) editor.removeContentWidget(previous)

      const node = document.createElement("div")
      node.className = "remote-cursor"

      const caret = document.createElement("div")
      caret.className = "remote-cursor-caret"
      caret.style.backgroundColor = participant.avatarColor
      node.appendChild(caret)

      const label = document.createElement("div")
      label.className = "remote-cursor-label"
      label.style.backgroundColor = participant.avatarColor
      label.textContent = participant.username
      node.appendChild(label)

      const widget: Monaco.editor.IContentWidget = {
        getId: () => `remote-cursor-${participant.userId}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: participant.cursorLine, column: participant.cursorCol },
          preference: [EXACT_POSITION_PREFERENCE],
        }),
      }

      editor.addContentWidget(widget)
      widgetsRef.current.set(participant.userId, widget)
    }
  }, [editor, participants, currentUserId])

  // Full cleanup only on unmount (e.g. leaving the session) -- the effect
  // above already removes individual widgets as participants leave.
  useEffect(() => {
    return () => {
      if (!editor) return
      for (const widget of widgetsRef.current.values()) {
        editor.removeContentWidget(widget)
      }
      widgetsRef.current.clear()
    }
  }, [editor])

  return null
}

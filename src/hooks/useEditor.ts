"use client"

import { useCallback, useRef } from "react"
import type * as Monaco from "monaco-editor"
import { useSessionStore } from "@/store/sessionStore"
import { useAiStore } from "@/store/aiStore"
import type { ClientMessage } from "@/lib/ws-messages"
import type { EditOp, AiRequest } from "@/types"

interface UseEditorProps {
  send: (msg: ClientMessage) => void
  userId: string
  language: string
}

export function useEditor({ send, userId, language }: UseEditorProps) {
  const editorRef   = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const revisionRef = useRef(0)

  const { revision, setDocument } = useSessionStore()
  const { addUserMessage, startStreaming } = useAiStore()

  // ── called when Monaco mounts ────────────────────────
  const handleEditorMount = useCallback((
    editor: Monaco.editor.IStandaloneCodeEditor
  ) => {
    editorRef.current = editor
    revisionRef.current = revision

    // Cmd+K → trigger AI on selected code
    editor.addAction({
      id:    "codesync.askAi",
      label: "Ask AI about this code",
      keybindings: [
        // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyK
        2048 | 41
      ],
      contextMenuGroupId: "codesync",
      contextMenuOrder:   1,
      run: (ed) => {
        const selection = ed.getSelection()
        const model     = ed.getModel()
        if (!selection || !model) return

        const selectedCode = model.getValueInRange(selection)
        if (!selectedCode.trim()) return

        handleAiRequest(
          "Explain this code",
          selectedCode,
          selection.startLineNumber,
          selection.endLineNumber
        )
      },
    })
  }, [revision])

  // ── called on every keystroke ────────────────────────
  const handleChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    setDocument(value)

    // TODO: diff against previous value to generate
    // a precise EditOp (insert/delete at position)
    // For now we send the full document as a placeholder
    // This gets replaced with real OT in Phase 12
    const op: EditOp = {
      position: 0,
      text:     value,
      opType:   "insert",
      revision: revisionRef.current,
      userId,
    }

    send({ type: "edit", payload: op })
  }, [send, userId, setDocument])

  // ── called on cursor move ────────────────────────────
  const handleCursorChange = useCallback((
    e: Monaco.editor.ICursorPositionChangedEvent
  ) => {
    send({
      type: "cursor",
      payload: {
        userId,
        username: "",       // filled by server from JWT
        avatarColor: "",    // filled by server
        line: e.position.lineNumber,
        col:  e.position.column,
      },
    })
  }, [send, userId])

  // ── send an AI request ───────────────────────────────
  const handleAiRequest = useCallback((
    prompt: string,
    selectedCode: string,
    startLine: number,
    endLine: number
  ) => {
    const assistantMsgId = addUserMessage(prompt)
    startStreaming(assistantMsgId)

    const request: AiRequest = {
      prompt,
      selectedCode,
      language: language as import("@/types").Language,
      startLine,
      endLine,
    }

    send({ type: "ai_request", payload: request })
  }, [send, language, addUserMessage, startStreaming])

  // ── apply a remote edit to the editor ───────────────
  // Called when the server broadcasts a resolved EditOp
  const applyRemoteEdit = useCallback((op: EditOp) => {
    const editor = editorRef.current
    const model  = editor?.getModel()
    if (!model) return

    revisionRef.current = op.revision

    // convert flat position to line/column
    const start = model.getPositionAt(op.position)

    if (op.opType === "insert") {
      model.applyEdits([{
        range: {
          startLineNumber: start.lineNumber,
          startColumn:     start.column,
          endLineNumber:   start.lineNumber,
          endColumn:       start.column,
        },
        text: op.text,
      }])
    } else {
      const end = model.getPositionAt(op.position + op.text.length)
      model.applyEdits([{
        range: {
          startLineNumber: start.lineNumber,
          startColumn:     start.column,
          endLineNumber:   end.lineNumber,
          endColumn:       end.column,
        },
        text: "",
      }])
    }
  }, [])

  return {
    handleEditorMount,
    handleChange,
    handleCursorChange,
    handleAiRequest,
    applyRemoteEdit,
    editorRef,
  }
}
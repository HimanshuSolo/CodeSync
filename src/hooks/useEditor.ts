"use client"

import { useCallback, useEffect, useRef } from "react"
import type * as Monaco from "monaco-editor"
import { useSessionStore } from "@/store/sessionStore"
import { useAiStore } from "@/store/aiStore"
import type { ClientMessage } from "@/lib/ws-messages"
import type { EditOp, AiRequest } from "@/types"

interface UseEditorProps {
  send: (msg: ClientMessage) => void
  userId: string
  clientId: string
  language: string
}

export function useEditor({ send, userId, clientId, language }: UseEditorProps) {
  const editorRef   = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const revisionRef = useRef(0)
  const documentRef = useRef("")
  const applyingRemoteEditRef = useRef(false)

  const { document, revision, setDocument, setRevision } = useSessionStore()
  const { addUserMessage, startStreaming } = useAiStore()

  useEffect(() => {
    revisionRef.current = revision
  }, [revision])

  useEffect(() => {
    documentRef.current = document
  }, [document])

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

    if (applyingRemoteEditRef.current) {
      documentRef.current = value
      setDocument(value)
      return
    }

    const previousValue = documentRef.current
    if (value === previousValue) return

    setDocument(value)

    documentRef.current = value

    let index = 0
    while (
      index < previousValue.length &&
      index < value.length &&
      previousValue[index] === value[index]
    ) {
      index += 1
    }

    if (value.length > previousValue.length) {
      const insertedText = value.slice(index, index + (value.length - previousValue.length))
      const op: EditOp = {
        position: index,
        text: insertedText,
        opType: "insert",
        revision: revisionRef.current,
        userId,
        clientId,
      }

      send({ type: "edit", payload: op })
      return
    }

    if (value.length < previousValue.length) {
      const deletedText = previousValue.slice(index, index + (previousValue.length - value.length))
      const op: EditOp = {
        position: index,
        text: deletedText,
        opType: "delete",
        revision: revisionRef.current,
        userId,
        clientId,
      }

      send({ type: "edit", payload: op })
    }
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
    if (op.clientId && op.clientId === clientId) {
      revisionRef.current = op.revision
      setRevision(op.revision)
      return
    }

    const editor = editorRef.current
    const model  = editor?.getModel()
    if (!model) return

    revisionRef.current = op.revision
    applyingRemoteEditRef.current = true

    try {
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

      const nextValue = model.getValue()
      documentRef.current = nextValue
      setDocument(nextValue)
    } finally {
      applyingRemoteEditRef.current = false
    }
  }, [clientId, setDocument, setRevision])

  return {
    handleEditorMount,
    handleChange,
    handleCursorChange,
    handleAiRequest,
    applyRemoteEdit,
    editorRef,
  }
}
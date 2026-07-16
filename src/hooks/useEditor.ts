"use client"

import { useCallback, useEffect, useRef } from "react"
import type * as Monaco from "monaco-editor"
import { useSessionStore } from "@/store/sessionStore"
import { useAiStore } from "@/store/aiStore"
import type { ClientMessage } from "@/lib/ws-messages"
import type { EditOp, AiRequest, CodeSelection } from "@/types"

interface UseEditorProps {
  send: (msg: ClientMessage) => void
  userId: string
  clientId: string
  language: string
  onSelectionChange?: (selection: CodeSelection | null) => void
}

export function useEditor({ send, userId, clientId, language, onSelectionChange }: UseEditorProps) {
  const editorRef   = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const revisionRef = useRef(0)
  const documentRef = useRef("")
  const applyingRemoteEditRef = useRef(false)

  const { document, revision, setDocument, setRevision } = useSessionStore()
  const { addUserMessage, startStreaming } = useAiStore()

  const emitSelection = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    const model = editor.getModel()
    const selection = editor.getSelection()

    if (!model || !selection || selection.isEmpty()) {
      onSelectionChange?.(null)
      return
    }

    onSelectionChange?.({
      code: model.getValueInRange(selection),
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
    })
  }, [onSelectionChange])

  useEffect(() => {
    revisionRef.current = revision
  }, [revision])

  useEffect(() => {
    documentRef.current = document
    const model = editorRef.current?.getModel()
    if (model && model.getValue() !== document) {
      applyingRemoteEditRef.current = true
      try {
        model.setValue(document)
      } finally {
        applyingRemoteEditRef.current = false
      }
    }
  }, [document])

  // ── send an AI request ───────────────────────────────
  const handleAiRequest = useCallback((
    prompt: string,
    selectedCode: string,
    startLine: number,
    endLine: number
  ) => {
    // Only attach a selection (and therefore offer "Apply" later) when this
    // request was actually scoped to a real selection, not a whole-document
    // fallback -- applying a reply back onto "the whole file" is ambiguous.
    const selection = selectedCode.trim()
      ? { code: selectedCode, startLine, endLine }
      : undefined
    const assistantMsgId = addUserMessage(prompt, selection)
    startStreaming(assistantMsgId)

    const request: AiRequest = {
      requestId: assistantMsgId,
      prompt,
      selectedCode,
      language: language as import("@/types").Language,
      startLine,
      endLine,
    }

    send({ type: "ai_request", payload: request })
  }, [send, language, addUserMessage, startStreaming])

  // ── called when Monaco mounts ────────────────────────
  const handleEditorMount = useCallback((
    editor: Monaco.editor.IStandaloneCodeEditor
  ) => {
    editorRef.current = editor
    revisionRef.current = revision

    editor.onDidChangeCursorPosition((event) => {
      send({
        type: "cursor",
        payload: {
          userId,
          username: "",
          avatarColor: "",
          line: event.position.lineNumber,
          col:  event.position.column,
        },
      })
    })

    editor.onDidChangeCursorSelection(() => emitSelection(editor))
    editor.onDidChangeModelContent(() => emitSelection(editor))

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
  }, [emitSelection, handleAiRequest, revision, send, userId])

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

    // Diff via common prefix AND common suffix, not prefix alone. A prefix-only
    // diff assumes the edit is a pure insert or pure delete, but "select some
    // text and type over it" (or any other replace) removes a middle chunk and
    // inserts a different one in its place. Prefix-only either mis-slices the
    // changed region, or -- when old and new text happen to be the same length
    // -- sends no op at all, since neither the insert nor delete branch fires.
    let prefix = 0
    const maxPrefix = Math.min(previousValue.length, value.length)
    while (prefix < maxPrefix && previousValue[prefix] === value[prefix]) {
      prefix += 1
    }

    let suffix = 0
    const maxSuffix = maxPrefix - prefix
    while (
      suffix < maxSuffix &&
      previousValue[previousValue.length - 1 - suffix] === value[value.length - 1 - suffix]
    ) {
      suffix += 1
    }

    const deletedText = previousValue.slice(prefix, previousValue.length - suffix)
    const insertedText = value.slice(prefix, value.length - suffix)

    if (deletedText.length > 0) {
      const op: EditOp = {
        position: prefix,
        text: deletedText,
        opType: "delete",
        revision: revisionRef.current,
        userId,
        clientId,
      }
      send({ type: "edit", payload: op })
    }

    if (insertedText.length > 0) {
      const op: EditOp = {
        position: prefix,
        text: insertedText,
        opType: "insert",
        revision: revisionRef.current,
        userId,
        clientId,
      }
      send({ type: "edit", payload: op })
    }
  }, [clientId, send, userId, setDocument])

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

  // ── apply an AI-suggested code block back into the editor ──
  // Reuses the exact same path a manual keystroke takes: executeEdits
  // mutates the Monaco model, which fires onDidChangeModelContent, which
  // @monaco-editor/react turns into an onChange call -- handleChange then
  // diffs it against documentRef.current and sends the resulting EditOp
  // over the WebSocket like any other edit. No separate broadcast/OT path
  // to keep correct -- applying an AI suggestion is collaboratively safe
  // for free, the same way it's safe for every other participant's edits.
  const applyAiSuggestion = useCallback((code: string, selection: CodeSelection) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return

    const startLine = Math.min(selection.startLine, model.getLineCount())
    const endLine = Math.min(selection.endLine, model.getLineCount())

    editor.executeEdits("ai-apply", [{
      range: {
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: model.getLineMaxColumn(endLine),
      },
      text: code,
    }])
    editor.focus()
  }, [])

  return {
    handleEditorMount,
    handleChange,
    handleCursorChange,
    handleAiRequest,
    applyAiSuggestion,
    applyRemoteEdit,
    editorRef,
  }
}

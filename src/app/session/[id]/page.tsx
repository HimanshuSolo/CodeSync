"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import Link from "next/link"
import type * as Monaco from "monaco-editor"
import { Bot, Code2, Share2, Settings, ChevronLeft, Globe, Check, Loader2, Terminal, GitFork, Users, MessageSquare } from "lucide-react"
import { Button }    from "@/components/ui/button"
import { Badge }     from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import UserPresence  from "@/components/session/UserPresence"
import RepositoryPanel from "@/components/session/RepositoryPanel"
import ChatPanel     from "@/components/session/ChatPanel"
import AiPanel       from "@/components/ai/AiPanel"
import { CursorLayer } from "@/components/editor/CursorLayer"
import { useAuth }   from "@/hooks/useAuth"
import { useWebSocket }  from "@/hooks/useWebSocket"
import { useEditor }     from "@/hooks/useEditor"
import { runnerApi, sessionApi, type RunResult } from "@/lib/api"
import { useSessionStore } from "@/store/sessionStore"
import { useChatStore } from "@/store/chatStore"
import type { CodeSelection, Language, Session } from "@/types"
import type { ClientMessage } from "@/lib/ws-messages"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type SessionWithDocument = Session & {
  document?: string
}

const LANGUAGE_BADGE: Record<Language, string> = {
  rust:       "bg-orange-950 text-orange-400 border-orange-900",
  typescript: "bg-blue-950   text-blue-400   border-blue-900",
  javascript: "bg-yellow-950 text-yellow-400 border-yellow-900",
  python:     "bg-green-950  text-green-400  border-green-900",
  go:         "bg-cyan-950   text-cyan-400   border-cyan-900",
  cpp:        "bg-purple-950 text-purple-400 border-purple-900",
  java:       "bg-red-950    text-red-400    border-red-900",
  markdown:   "bg-zinc-900   text-zinc-400   border-zinc-800",
}

function editorLanguage(activeFile: string | null, fallback: Language): string {
  if (!activeFile) return fallback
  const extension = activeFile.split(".").pop()?.toLowerCase()
  return {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    rs: "rust",
    py: "python",
    go: "go",
    cpp: "cpp",
    cc: "cpp",
    h: "cpp",
    java: "java",
    md: "markdown",
    json: "json",
    css: "css",
    html: "html",
    yml: "yaml",
    yaml: "yaml",
  }[extension || ""] || "plaintext"
}

function executableLanguage(activeFile: string | null, fallback: Language): Language | null {
  if (!activeFile) return fallback === "markdown" ? null : fallback
  const extension = activeFile.split(".").pop()?.toLowerCase()
  return {
    ts: "typescript",
    js: "javascript",
    rs: "rust",
    py: "python",
    go: "go",
    cpp: "cpp",
    cc: "cpp",
    java: "java",
  }[extension || ""] as Language | undefined || null
}

function ShareButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(`${window.location.origin}/session/${sessionId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 gap-1.5 border-border px-2 text-xs sm:px-2.5">
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Share2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copied!" : "Share"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent><p className="text-xs">Copy invite link</p></TooltipContent>
    </Tooltip>
  )
}

export default function SessionPage() {
  const params    = useParams()
  const router    = useRouter()
  const sessionId = params.id as string
  const { user }  = useAuth()
  const { document: doc, activeFile, setDocument, participants } = useSessionStore()
  const { messages: chatMessages, unread: unreadChat, clearUnread: clearUnreadChat } = useChatStore()
  const [clientId] = useState(() => crypto.randomUUID())
  const currentUserId = user?.id || ""
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  // Mirrors editorRef.current in state — reading a ref during render (as
  // <CursorLayer editor={editorRef.current}> did) doesn't trigger a
  // re-render when the ref is set on mount, so CursorLayer could end up
  // stuck rendering against a stale/null editor until something unrelated
  // happened to re-render this component.
  const [editorInstance, setEditorInstance] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null)

  const [session, setSession]       = useState<Session | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState("")
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [stdin, setStdin] = useState("")
  const [sessionReady, setSessionReady] = useState(false)
  const [sidebarMode, setSidebarMode] = useState<"repository" | "people" | "chat">("repository")
  const [mobileView, setMobileView] = useState<"files" | "editor" | "ai" | "chat">("editor")
  const [isDesktop, setIsDesktop] = useState(false)
  const [codeSelection, setCodeSelection] = useState<CodeSelection | null>(null)
  const sendRef = useRef<((msg: ClientMessage) => void) | null>(null)

  const token = typeof window !== "undefined"
    ? localStorage.getItem("codesync_token") : null

  const { handleEditorMount, handleChange, handleAiRequest, applyAiSuggestion, applyRemoteEdit, editorRef } = useEditor({
    send:     useCallback((msg: ClientMessage) => sendRef.current?.(msg), []),
    userId:   currentUserId,
    clientId,
    language: session?.language || "typescript",
    onSelectionChange: setCodeSelection,
  })

  const handleSessionDeleted = useCallback(() => {
    router.replace("/")
  }, [router])

  const { status, send } = useWebSocket(
    sessionId,
    token,
    sessionReady,
    applyRemoteEdit,
    handleSessionDeleted,
  )

  useEffect(() => { sendRef.current = send }, [send])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (!token) { router.push("/login"); return }
    if (currentUserId) useSessionStore.getState().setCurrentUserId(currentUserId)

    sessionApi.get(sessionId)
      .then((res) => {
        const sessionData = res.session as SessionWithDocument
        setSession(sessionData)
        setDocument(sessionData.document || "")
        setSessionReady(true)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [sessionId, token, router, setDocument, currentUserId])

  const wsColor = { connected: "bg-green-500", connecting: "bg-yellow-500 animate-pulse", disconnected: "bg-zinc-500", error: "bg-red-500" }[status]
  const scheduleEditorResize = useCallback(() => {
    const editor = editorRef.current
    const container = editorContainerRef.current
    if (!editor || !container) return

    requestAnimationFrame(() => {
      editor.layout({
        width: container.clientWidth,
        height: container.clientHeight,
      })
    })
  }, [editorRef])

  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    const observer = new ResizeObserver(scheduleEditorResize)
    observer.observe(container)
    scheduleEditorResize()

    return () => observer.disconnect()
  }, [isDesktop, mobileView, scheduleEditorResize])

  const handleRun = useCallback(async () => {
    const language = executableLanguage(activeFile, session?.language || "typescript")
    if (!language) return

    setRunning(true)
    setRunResult(null)

    try {
      const result = await runnerApi.run(language, doc, stdin)
      setRunResult(result)
    } catch (err) {
      setRunResult({
        success: false,
        stdout: "",
        stderr: err instanceof Error ? err.message : "Execution failed",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
      })
    } finally {
      setRunning(false)
      scheduleEditorResize()
    }
  }, [activeFile, doc, scheduleEditorResize, session?.language, stdin])

  const handleAiPanelSend = useCallback((prompt: string) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()

    if (model && selection && !selection.isEmpty()) {
      handleAiRequest(
        prompt,
        model.getValueInRange(selection),
        selection.startLineNumber,
        selection.endLineNumber,
      )
      return
    }

    handleAiRequest(prompt, doc.slice(0, 30000), 1, model?.getLineCount() || 1)
  }, [doc, editorRef, handleAiRequest])

  const handleOpenRepositoryFile = useCallback((path: string, document: string) => {
    setCodeSelection(null)
    send({ type: "open_file", payload: { path, document } })
    setMobileView("editor")
  }, [send])

  const handleSendChat = useCallback((text: string) => {
    send({ type: "chat", payload: { text } })
  }, [send])

  const chatVisible = (isDesktop && sidebarMode === "chat") || (!isDesktop && mobileView === "chat")
  useEffect(() => {
    if (chatVisible) clearUnreadChat()
  }, [chatVisible, chatMessages.length, clearUnreadChat])

  if (loading) return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-violet-600 flex items-center justify-center">
          <Code2 className="w-4 h-4 text-white" />
        </div>
        <p className="text-sm text-muted-foreground">Loading session...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <p className="text-red-400 text-sm">{error}</p>
        <Link href="/"><Button variant="outline" size="sm">Back to dashboard</Button></Link>
      </div>
    </div>
  )

  const sidebarPanel = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 border-b border-border px-3 py-3 sm:px-4">
        <div className="mb-2 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-muted-foreground">
            /session/{sessionId.slice(0, 8)}...
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${wsColor}`} />
          <span className="text-xs capitalize text-muted-foreground">{status}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-muted/40 p-1">
          <Button
            variant={sidebarMode === "repository" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setSidebarMode("repository")}
          >
            <GitFork className="h-3 w-3" /> Repo
          </Button>
          <Button
            variant={sidebarMode === "people" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setSidebarMode("people")}
          >
            <Users className="h-3 w-3" /> People
          </Button>
          <Button
            variant={sidebarMode === "chat" ? "secondary" : "ghost"}
            size="xs"
            className="relative"
            onClick={() => setSidebarMode("chat")}
          >
            <MessageSquare className="h-3 w-3" /> Chat
            {unreadChat > 0 && sidebarMode !== "chat" && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-[9px] text-white">
                {unreadChat > 9 ? "9+" : unreadChat}
              </span>
            )}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {sidebarMode === "repository" && (
          <RepositoryPanel
            sessionId={sessionId}
            activeFile={activeFile}
            document={doc}
            onOpenFile={handleOpenRepositoryFile}
          />
        )}
        {sidebarMode === "people" && (
          <div className="h-full overflow-y-auto py-2">
            <UserPresence ownerId={session?.ownerId} />
          </div>
        )}
        {sidebarMode === "chat" && (
          <ChatPanel messages={chatMessages} currentUserId={currentUserId} onSend={handleSendChat} />
        )}
      </div>
    </div>
  )

  const editorPanel = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {activeFile || (session ? `main.${session.language === "typescript" ? "ts" : session.language === "javascript" ? "js" : session.language}` : "file")}
        </span>
        {executableLanguage(activeFile, session?.language || "typescript") && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleRun}
            disabled={running}
            className="flex-shrink-0 text-xs"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />}
            Run
          </Button>
        )}
      </div>
      <div ref={editorContainerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <MonacoEditor
          width="100%"
          height="100%"
          className="h-full w-full min-w-0"
          language={editorLanguage(activeFile, session?.language || "typescript")}
          defaultValue={doc}
          onChange={handleChange}
          onMount={(editor) => {
            handleEditorMount(editor)
            setEditorInstance(editor)
          }}
          theme="vs-dark"
          options={{
            fontSize:                   14,
            fontFamily:                 "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures:              true,
            lineHeight:                 1.6,
            minimap:                    { enabled: false },
            scrollBeyondLastLine:       false,
            wordWrap:                   "on",
            tabSize:                    4,
            renderLineHighlight:        "gutter",
            smoothScrolling:            true,
            cursorBlinking:             "smooth",
            cursorSmoothCaretAnimation: "on",
            padding:                    { top: 16, bottom: 16 },
            bracketPairColorization:    { enabled: true },
            automaticLayout:            true,
          }}
        />
        <CursorLayer editor={editorInstance} participants={participants} currentUserId={currentUserId} />
      </div>
      {executableLanguage(activeFile, session?.language || "typescript") && (
        <div className="max-h-[35vh] flex-shrink-0 overflow-auto border-t border-border bg-zinc-950 px-3 py-3 font-mono text-xs sm:max-h-56 sm:px-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className={runResult?.success ? "text-green-400" : running ? "text-yellow-400" : runResult ? "text-red-400" : "text-muted-foreground"}>
              {running ? "Running in isolated container..." : runResult?.success ? "Execution succeeded" : runResult?.timed_out ? "Execution timed out" : runResult ? "Execution failed" : "Docker runner ready"}
            </span>
            <span className="flex-shrink-0 text-muted-foreground">
              {runResult ? `${runResult.duration_ms}ms` : ""}
            </span>
          </div>
          <label className="mb-1 block text-muted-foreground">Standard input</label>
          <textarea
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            placeholder="Optional input passed to the program"
            rows={2}
            disabled={running}
            className="mb-3 w-full resize-y rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-200 outline-none focus:border-violet-700"
          />
          {runResult?.stdout && <pre className="whitespace-pre-wrap break-words text-zinc-300">{runResult.stdout}</pre>}
          {runResult?.stderr && <pre className="whitespace-pre-wrap break-words text-red-300">{runResult.stderr}</pre>}
          {!runResult?.stdout && !runResult?.stderr && (
            <pre className="whitespace-pre-wrap text-zinc-500">
              {running ? "Starting container..." : "Program output will appear here"}
            </pre>
          )}
        </div>
      )}
    </div>
  )

  const aiPanel = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <AiPanel
        key={sessionId}
        sessionId={sessionId}
        onSend={handleAiPanelSend}
        selection={codeSelection}
        onApply={applyAiSuggestion}
      />
    </div>
  )

  const chatPanel = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <ChatPanel messages={chatMessages} currentUserId={currentUserId} onSend={handleSendChat} />
    </div>
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">

      {/* toolbar */}
      <header className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border bg-background px-2 sm:gap-3 sm:px-4">
        <Link href="/" className="flex flex-shrink-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="w-4 h-4" />
          <div className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center">
            <Code2 className="w-3 h-3 text-white" />
          </div>
        </Link>

        <Separator orientation="vertical" className="hidden h-5 sm:block" />

        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:max-w-[200px] sm:flex-none">{session?.name}</h1>

        {session && (
          <Badge variant="outline" className={`hidden text-xs font-mono sm:inline-flex ${LANGUAGE_BADGE[session.language as Language]}`}>
            {session.language}
          </Badge>
        )}

        <div className="hidden items-center gap-1.5 text-xs md:flex">
          <span className={`w-1.5 h-1.5 rounded-full ${wsColor}`} />
          <span className="text-muted-foreground capitalize">{status}</span>
        </div>

        <div className="hidden flex-1 sm:block" />

        <div className="flex items-center gap-2">
          <ShareButton sessionId={sessionId} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="hidden h-8 w-8 text-muted-foreground sm:inline-flex">
                <Settings className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Session settings</p></TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isDesktop ? (
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full w-full min-w-0"
            onLayoutChange={scheduleEditorResize}
            onLayoutChanged={scheduleEditorResize}
          >
            <ResizablePanel defaultSize="20%" minSize="15%" maxSize="30%">
              <div className="h-full border-r border-border">{sidebarPanel}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="53%" minSize="30%">
              {editorPanel}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="27%" minSize="20%" maxSize="60%">
              <div className="h-full border-l border-border">{aiPanel}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              {mobileView === "files" && sidebarPanel}
              {mobileView === "editor" && editorPanel}
              {mobileView === "ai" && aiPanel}
              {mobileView === "chat" && chatPanel}
            </div>
            <nav className="grid h-14 flex-shrink-0 grid-cols-4 border-t border-border bg-background px-1 pb-[env(safe-area-inset-bottom)]">
              {[
                { value: "files" as const, label: "Files", icon: GitFork },
                { value: "editor" as const, label: "Editor", icon: Code2 },
                { value: "chat" as const, label: "Chat", icon: MessageSquare },
                { value: "ai" as const, label: "AI", icon: Bot },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMobileView(value)}
                  className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-xs transition-colors ${
                    mobileView === value
                      ? "bg-violet-950/60 text-violet-300"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {value === "chat" && unreadChat > 0 && mobileView !== "chat" && (
                    <span className="absolute top-1 right-[calc(50%-16px)] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-[9px] text-white">
                      {unreadChat > 9 ? "9+" : unreadChat}
                    </span>
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
        )}
      </div>
    </div>
  )
}

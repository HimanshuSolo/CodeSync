"use client"

import * as React from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  Code2, Share2, Settings,
  ChevronLeft, Globe, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import UserPresence from "@/components/session/UserPresence"
import AiPanel from "@/components/ai/AiPanel"
import { useAuth } from "@/hooks/useAuth"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useEditor } from "@/hooks/useEditor"
import { sessionApi } from "@/lib/api"
import { useSessionStore } from "@/store/sessionStore"
import type { Language, Session } from "@/types"
import type { ClientMessage } from "@/lib/ws-messages"


const MonacoEditor = dynamic(
  () => import("@monaco-editor/react"),
  { ssr: false }
)

const LANGUAGE_BADGE: Record<Language, string> = {
  rust: "bg-orange-950 text-orange-400 border-orange-900",
  typescript: "bg-blue-950   text-blue-400   border-blue-900",
  javascript: "bg-yellow-950 text-yellow-400 border-yellow-900",
  python: "bg-green-950  text-green-400  border-green-900",
  go: "bg-cyan-950   text-cyan-400   border-cyan-900",
  cpp: "bg-purple-950 text-purple-400 border-purple-900",
  java: "bg-red-950    text-red-400    border-red-900",
  markdown: "bg-zinc-900   text-zinc-400   border-zinc-800",
}

function ShareButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/session/${sessionId}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="gap-1.5 h-8 text-xs border-border"
        >
          {copied
            ? <><Check className="w-3.5 h-3.5 text-green-400" />Copied!</>
            : <><Share2 className="w-3.5 h-3.5" />Share</>
          }
        </Button>
      </TooltipTrigger>
      <TooltipContent><p className="text-xs">Copy invite link</p></TooltipContent>
    </Tooltip>
  )
}

export default function SessionPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string
  const { user } = useAuth()
  const { document: doc, setDocument } = useSessionStore()
  const clientId = useRef(globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [sessionReady, setSessionReady] = useState(false)
  const sendRef = useRef<((msg: ClientMessage) => void) | null>(null)

  // get token for WS connection
  const token = typeof window !== "undefined"
    ? localStorage.getItem("codesync_token")
    : null

  // editor logic
  const {
    handleEditorMount,
    handleChange,
    handleCursorChange,
    applyRemoteEdit,
  } = useEditor({
    send: useCallback((msg: ClientMessage) => sendRef.current?.(msg), []),
    userId: user?.id || "",
    clientId: clientId.current,
    language: session?.language || "typescript",
  })

  // connect WebSocket
  const { status, send } = useWebSocket(
    sessionId,
    token,
    sessionReady,
    applyRemoteEdit
  )

  // wire send into the ref after it's available
  useEffect(() => {
    sendRef.current = send
  }, [send])

  // fetch session data
  useEffect(() => {
    if (!token) { router.push("/login"); return }
    if (user?.id) {
      useSessionStore.getState().setCurrentUserId(user.id)
    }

    sessionApi.get(sessionId)
      .then((res) => {
        setSession(res.session)
        setDocument(((res.session as any).document) || "")
        setSessionReady(true)
      })
      .catch((err) => {
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [sessionId, token, router, setDocument])

  const wsStatusColor = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500 animate-pulse",
    disconnected: "bg-zinc-500",
    error: "bg-red-500",
  }[status]

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-violet-600 flex items-center justify-center">
            <Code2 className="w-4 h-4 text-white" />
          </div>
          <p className="text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-red-400 text-sm">{error}</p>
          <Link href="/">
            <Button variant="outline" size="sm">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">

      {/* toolbar */}
      <header className="h-12 border-b border-border bg-background flex-shrink-0 flex items-center px-4 gap-3">
        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          <div className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center">
            <Code2 className="w-3 h-3 text-white" />
          </div>
        </Link>

        <Separator orientation="vertical" className="h-5" />

        <h1 className="text-sm font-semibold truncate max-w-[200px]">
          {session?.name}
        </h1>

        {session && (
          <Badge
            variant="outline"
            className={`text-xs font-mono ${LANGUAGE_BADGE[session.language as Language]}`}
          >
            {session.language}
          </Badge>
        )}

        <div className="flex items-center gap-1.5 text-xs">
          <span className={`w-1.5 h-1.5 rounded-full ${wsStatusColor}`} />
          <span className="text-muted-foreground capitalize">{status}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <ShareButton sessionId={sessionId} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <Settings className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Session settings</p></TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* three panel layout */}
      {/* three panel layout */}
      <div className="flex-1 overflow-hidden" style={{ height: "calc(100vh - 48px)" }}>
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full w-full"
        >
          {/* LEFT */}
          <ResizablePanel
            defaultSize={20}
            minSize={15}
            maxSize={30}
            style={{ overflow: "hidden" }}
          >
            <div className="flex flex-col h-full bg-background border-r border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    /session/{sessionId.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${wsStatusColor}`} />
                  <span className="text-xs text-muted-foreground capitalize">
                    {status}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <UserPresence ownerId={session?.ownerId} />
              </div>
              <div className="px-3 py-3 border-t border-border flex-shrink-0">
                <p className="text-xs text-muted-foreground font-medium mb-1.5">Shortcuts</p>
                <div className="space-y-1">
                  {[["Cmd+K", "Ask AI"], ["Cmd+/", "Comment"], ["Cmd+S", "Save"]].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <kbd className="text-xs bg-muted border border-border rounded px-1.5 py-0.5 font-mono">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTRE */}
          <ResizablePanel
            defaultSize={53}
            minSize={30}
            style={{ overflow: "hidden" }}
          >
            <div className="h-full flex flex-col bg-background overflow-hidden">
              <div className="h-9 border-b border-border flex items-center px-4 gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground font-mono">
                  {session
                    ? `main.${session.language === "typescript" ? "ts"
                      : session.language === "javascript" ? "js"
                        : session.language}`
                    : "file"
                  }
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <MonacoEditor
                  height="100%"
                  language={session?.language || "typescript"}
                  defaultValue={doc}
                  onChange={handleChange}
                  onMount={handleEditorMount}
                  theme="vs-dark"
                  options={{
                    fontSize: 14,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontLigatures: true,
                    lineHeight: 1.6,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 4,
                    renderLineHighlight: "gutter",
                    smoothScrolling: true,
                    cursorBlinking: "smooth",
                    cursorSmoothCaretAnimation: "on",
                    padding: { top: 16, bottom: 16 },
                    bracketPairColorization: { enabled: true },
                  }}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT */}
          <ResizablePanel
            defaultSize={27}
            minSize={20}
            maxSize={45}
            style={{ overflow: "hidden" }}
          >
            <div className="h-full flex flex-col bg-background border-l border-border overflow-hidden">
              <AiPanel />
            </div>
          </ResizablePanel>

        </ResizablePanelGroup>
      </div>

    </div>
  )
}
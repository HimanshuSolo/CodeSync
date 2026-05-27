"use client"

import { useState, useCallback, use } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  Code2, Share2, Play, Settings,
  ChevronLeft, Globe, Copy, Check
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import UserPresence from "@/components/session/UserPresence"
import AiPanel from "@/components/ai/AiPanel"
import { useSessionStore } from "@/store/sessionStore"
import type { Language } from "@/types"

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react"),
  { ssr: false }
)

const MOCK_SESSION = {
  id:       "1",
  name:     "Auth Service Refactor",
  language: "rust" as Language,
  ownerId:  "u1",
}

const MOCK_CODE = `use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginPayload {
    pub email:    String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token:    String,
    pub user_id:  String,
    pub username: String,
}

/// POST /auth/login
/// Validates credentials and returns a signed JWT
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginPayload>,
) -> Result<Json<AuthResponse>, StatusCode> {
    // 1. fetch user from database
    let user = state.db
        .get_user_by_email(&payload.email)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // 2. verify password hash
    let valid = argon2::verify_encoded(
        &user.password_hash,
        payload.password.as_bytes()
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !valid {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 3. sign JWT
    let token = state.jwt_keys
        .sign(user.id, &user.username)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(AuthResponse {
        token,
        user_id:  user.id.to_string(),
        username: user.username,
    }))
}
`

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

// ── copy link button ──
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
            ? <><Check className="w-3.5 h-3.5 text-green-400" /> Copied!</>
            : <><Share2 className="w-3.5 h-3.5" /> Share</>
          }
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Copy invite link</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { document, setDocument } = useSessionStore()
  const [code, setCode]           = useState(MOCK_CODE)

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value)
      setDocument(value)
    }
  }, [setDocument])

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">

      <header className="h-12 border-b border-border bg-background flex-shrink-0 flex items-center px-4 gap-3">

        {/* back + logo */}
        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          <div className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center">
            <Code2 className="w-3 h-3 text-white" />
          </div>
        </Link>

        <Separator orientation="vertical" className="h-5" />

        <h1 className="text-sm font-semibold truncate max-w-[200px]">
          {MOCK_SESSION.name}
        </h1>

        <Badge
          variant="outline"
          className={`text-xs font-mono ${LANGUAGE_BADGE[MOCK_SESSION.language]}`}
        >
          {MOCK_SESSION.language}
        </Badge>

        <div className="flex items-center gap-1.5 text-xs text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Live
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <ShareButton sessionId={id} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <Settings className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Session settings</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup {...({ direction: "horizontal" } as any)} className="h-full">

          <ResizablePanel
            defaultSize={18}
            minSize={14}
            maxSize={28}
            className="min-w-0 bg-background border-r overflow-hidden border-border"
          >
            <div className="flex flex-col h-full min-w-0">

              <div className="px-4 py-3 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    /session/{id}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-xs text-muted-foreground">
                    2 editing now
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto py-2">
                <UserPresence ownerId={MOCK_SESSION.ownerId} />
              </div>

              <div className="px-3 py-3 border-t border-border flex-shrink-0">
                <p className="text-xs text-muted-foreground font-medium mb-1.5">
                  Shortcuts
                </p>
                <div className="space-y-1">
                  {[
                    ["Cmd+K", "Ask AI"],
                    ["Cmd+/", "Comment"],
                    ["Cmd+S", "Save"],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <kbd className="text-xs bg-muted border border-border rounded px-1.5 py-0.5 font-mono">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={45}
            minSize={30}
            className="min-w-0 overflow-hidden"
          >
            <div className="h-full flex flex-col min-w-0">

              <div className="h-9 border-b border-border bg-background flex items-center px-4 gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground font-mono">
                  main.rs
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" title="unsaved changes" />
                <div className="flex-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                      <Play className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Run (coming soon)</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="flex-1 overflow-hidden min-h-0 min-w-0">
                <MonacoEditor
                  height="100%"
                  language={MOCK_SESSION.language}
                  value={code}
                  onChange={handleEditorChange}
                  theme="vs-dark"
                  options={{
                    fontSize:             14,
                    fontFamily:           "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                    fontLigatures:        true,
                    lineHeight:           1.6,
                    minimap:              { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap:             "on",
                    tabSize:              4,
                    renderLineHighlight:  "gutter",
                    smoothScrolling:      true,
                    cursorBlinking:       "smooth",
                    cursorSmoothCaretAnimation: "on",
                    padding:              { top: 16, bottom: 16 },
                    bracketPairColorization: { enabled: true },
                    formatOnPaste:        true,
                    suggest:              { showKeywords: true },
                    automaticLayout:       true,
                  }}
                />
              </div>

            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={30}
            minSize={22}
            maxSize={45}
            className="min-w-0 bg-background overflow-hidden border-l border-border"
          >
            <AiPanel />
          </ResizablePanel>

        </ResizablePanelGroup>
      </div>

    </div>
  )
}
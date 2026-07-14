"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, Send, Sparkles, Trash2, Code } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import AiMessage from "@/components/ai/AiMessage"
import { useAiStore } from "@/store/aiStore"
import type { CodeSelection } from "@/types"
interface AiPanelProps {
  sessionId: string
  onSend: (prompt: string) => void
  selection: CodeSelection | null
  onApply?: (code: string, selection: CodeSelection) => void
}

const CHAT_STORAGE_PREFIX = "codesync_ai_chat:"

export default function AiPanel({ sessionId, onSend, selection, onApply }: AiPanelProps) {
  const [input, setInput] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const { messages, isStreaming, loadMessages, clearMessages } = useAiStore()

  const displayMessages = messages

  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        const stored = localStorage.getItem(`${CHAT_STORAGE_PREFIX}${sessionId}`)
        loadMessages(stored ? JSON.parse(stored) : [])
      } catch {
        loadMessages([])
      } finally {
        setHydrated(true)
      }
    }, 0)
    return () => clearTimeout(timeout)
  }, [loadMessages, sessionId])

  useEffect(() => {
    if (!hydrated) return
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(`${CHAT_STORAGE_PREFIX}${sessionId}`, JSON.stringify(messages))
      } catch {
        // Browser storage can be unavailable or full; chat remains usable in memory.
      }
    }, 250)
    return () => clearTimeout(timeout)
  }, [hydrated, messages, sessionId])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport || !shouldAutoScrollRef.current) return

    const frame = requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: isStreaming ? "auto" : "smooth" })
    })
    return () => cancelAnimationFrame(frame)
  }, [displayMessages, isStreaming])

  function handleClear() {
    clearMessages()
    localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${sessionId}`)
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const viewport = e.currentTarget
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom < 80
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    if (!input.trim() || isStreaming) return
    shouldAutoScrollRef.current = true
    onSend(input.trim())
    setInput("")
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">

      {/* header */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-violet-950 border border-violet-800 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <span className="truncate text-sm font-semibold">AI Assistant</span>
          <span className="hidden flex-shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground min-[360px]:inline-flex">
            llama-3.3-70b
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Clear conversation</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={scrollRef}
        onScrollCapture={handleScroll}
      >
        <div className="px-4 py-4">
        {displayMessages.length === 0 ? (
          // empty state
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-violet-950 border border-violet-800 flex items-center justify-center">
              <Bot className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium">AI Assistant ready</p>
              <p className="text-xs text-muted-foreground mt-1">
                Select code and ask me anything
              </p>
            </div>
            <div className="flex flex-col gap-2 mt-2 w-full max-w-[200px]">
              {[
                "Explain this code",
                "Find bugs",
                "Refactor this function",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="text-xs text-left px-3 py-2 rounded-lg border border-border hover:border-violet-800 hover:bg-violet-950/30 transition-all text-muted-foreground hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {displayMessages.map((msg) => (
              <AiMessage key={msg.id} message={msg} onApply={onApply} />
            ))}
          </div>
        )}
        </div>
      </ScrollArea>

      <Separator className="bg-border/50" />

      <div className="flex-shrink-0 px-3 pt-2 sm:px-4">
        <div
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
            selection
              ? "border-violet-800/70 bg-violet-950/30 text-violet-300"
              : "border-border/50 bg-muted/40 text-muted-foreground"
          }`}
          title={selection?.code}
        >
          <Code className="w-3 h-3 flex-shrink-0" />
          <span className="truncate font-mono">
            {selection
              ? `${selection.startLine === selection.endLine ? "Line" : "Lines"} ${selection.startLine}${
                  selection.startLine === selection.endLine ? "" : `-${selection.endLine}`
                } selected · ${selection.code.length} characters`
              : "No code selected — select lines in the editor"}
          </span>
        </div>
      </div>

      <div className="flex-shrink-0 p-3 sm:p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <div className="relative min-w-0">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the code... (Enter to send, Shift+Enter for newline)"
              rows={3}
              disabled={isStreaming}
              className="block max-h-[min(35vh,240px)] min-h-16 w-full resize-y overflow-y-auto rounded-xl border border-border bg-muted px-3 py-2.5 text-sm leading-5 placeholder:text-muted-foreground focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600 disabled:opacity-50"
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            size="icon"
            className="bg-violet-600 hover:bg-violet-700 text-white h-10 w-10 flex-shrink-0 rounded-xl disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Powered by Groq · LLaMA 3.3 70B
        </p>
      </div>

    </div>
  )
}

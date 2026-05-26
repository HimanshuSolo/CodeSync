"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, Send, Sparkles, Trash2, Code } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import AiMessage from "@/components/ai/AiMessage"
import { useAiStore } from "@/store/aiStore"
import type { AiMessage as AiMessageType } from "@/types"

// mock messages to show the UI working
const MOCK_MESSAGES: AiMessageType[] = [
  {
    id: "1",
    role: "user",
    content: "Can you explain what this function does?",
    isStreaming: false,
    timestamp: "2026-05-26T09:35:00.000Z",
  },
  {
    id: "2",
    role: "assistant",
    content: "Sure! This function implements a token bucket rate limiter.\n\nHere's how it works:\n\n1. A bucket holds a maximum of N tokens\n2. Tokens are added at a fixed rate\n3. Each request consumes one token\n4. If the bucket is empty, the request is rejected\n\nThis is exactly the pattern used in your Axum middleware.",
    isStreaming: false,
    timestamp: "2026-05-26T09:37:00.000Z",
  },
]
export default function AiPanel() {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { messages, isStreaming, clearMessages } = useAiStore()

  // use mock messages if store is empty
  const displayMessages = messages.length > 0 ? messages : MOCK_MESSAGES

  // auto scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayMessages])

  // auto resize textarea
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = "auto"
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    if (!input.trim() || isStreaming) return
    // TODO: wire to useWebSocket in Phase 12
    console.log("AI request:", input)
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">

      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-violet-950 border border-violet-800 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <span className="text-sm font-semibold">AI Assistant</span>
          <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            llama-3.3-70b
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-foreground"
              onClick={clearMessages}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Clear conversation</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* messages */}
      <ScrollArea className="flex-1 px-4 py-4" ref={scrollRef}>
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
            {/* quick action chips */}
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
              <AiMessage key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </ScrollArea>

      <Separator className="bg-border/50" />

      {/* context indicator — shows selected code */}
      <div className="px-4 pt-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/50">
          <Code className="w-3 h-3 flex-shrink-0" />
          <span className="truncate font-mono">No code selected — select lines in the editor</span>
        </div>
      </div>

      {/* input area */}
      <div className="p-4 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the code... (Enter to send, Shift+Enter for newline)"
              rows={1}
              disabled={isStreaming}
              className="w-full resize-none bg-muted border border-border rounded-xl px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-600 focus:border-violet-600 transition-all disabled:opacity-50 min-h-[40px]"
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
"use client"

import { useEffect, useRef, useState } from "react"
import { MessageSquare, Send } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import type { ChatMessage } from "@/types"

interface ChatPanelProps {
  messages: ChatMessage[]
  currentUserId: string
  onSend: (text: string) => void
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export default function ChatPanel({ messages, currentUserId, onSend }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport || !shouldAutoScrollRef.current) return

    const frame = requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const viewport = e.currentTarget
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom < 80
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    const text = input.trim()
    if (!text) return
    shouldAutoScrollRef.current = true
    onSend(text)
    setInput("")
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">

      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-3 sm:px-4">
        <div className="w-6 h-6 rounded-md bg-blue-950 border border-blue-800 flex items-center justify-center">
          <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
        </div>
        <span className="truncate text-sm font-semibold">Chat</span>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={scrollRef}
        onScrollCapture={handleScroll}
      >
        <div className="px-3 py-4 sm:px-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-950 border border-blue-800 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium">No messages yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Say hello to your collaborators
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg) => {
                const isMe = msg.userId === currentUserId
                return (
                  <div key={msg.id} className={`flex items-start gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                    <Avatar className="w-6 h-6 flex-shrink-0 mt-0.5">
                      <AvatarFallback
                        className="text-[10px] font-bold text-white"
                        style={{ backgroundColor: msg.avatarColor }}
                      >
                        {getInitials(msg.username)}
                      </AvatarFallback>
                    </Avatar>
                    <div className={`flex min-w-0 max-w-[85%] flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-1.5 px-0.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {isMe ? "You" : msg.username}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <div
                        className={`mt-0.5 whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${
                          isMe
                            ? "bg-blue-600 text-white"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex-shrink-0 p-3 sm:p-4 border-t border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            className="block w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim()}
            size="icon"
            className="bg-blue-600 hover:bg-blue-700 text-white h-10 w-10 flex-shrink-0 rounded-xl disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

    </div>
  )
}

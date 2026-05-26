"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, User, Copy, Check } from "lucide-react"
import { useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AiMessage as AiMessageType } from "@/types"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
        >
          {copied
            ? <Check className="w-3 h-3 text-green-400" />
            : <Copy  className="w-3 h-3 text-muted-foreground" />
          }
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{copied ? "Copied!" : "Copy"}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default function AiMessage({ message }: { message: AiMessageType }) {
  const isUser = message.role === "user"

  return (
    <div className={`flex gap-2.5 group ${isUser ? "flex-row-reverse" : "flex-row"}`}>

      {/* avatar */}
      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 ${
        isUser
          ? "bg-violet-600"
          : "bg-zinc-800 border border-border"
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-white" />
          : <Bot  className="w-3.5 h-3.5 text-zinc-400" />
        }
      </div>

      {/* bubble */}
      <div className={`flex flex-col gap-1 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-violet-600 text-white rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        }`}>

          {isUser ? (
            // user messages — plain text
            <p className="text-sm">{message.content}</p>
          ) : (
            // AI messages — markdown rendered
            <div className="prose prose-invert prose-sm max-w-none
              prose-p:my-1 prose-p:leading-relaxed
              prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:text-xs
              prose-code:bg-zinc-900 prose-code:text-violet-300 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
              prose-headings:text-foreground prose-headings:font-semibold
              prose-strong:text-foreground
              prose-ul:my-1 prose-li:my-0.5
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || " "}
              </ReactMarkdown>

              {/* streaming cursor */}
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-3.5 bg-violet-400 ml-0.5 animate-pulse rounded-sm align-middle" />
              )}
            </div>
          )}
        </div>

        {/* copy button + timestamp */}
        <div className={`flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          {!isUser && !message.isStreaming && (
            <CopyButton text={message.content} />
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour:   "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

    </div>
  )
}
"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, User, Copy, Check, Wand2 } from "lucide-react"
import { isValidElement, useState, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AiMessage as AiMessageType, CodeSelection } from "@/types"

// react-markdown renders fenced code blocks as plain string children (no
// syntax-highlight plugin is installed), but walk defensively in case that
// ever changes -- nested elements or arrays should still yield the raw text.
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children)
  }
  return ""
}

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

function ApplyButton({ onApply }: { onApply: () => void }) {
  const [applied, setApplied] = useState(false)

  function handleClick() {
    onApply()
    setApplied(true)
    setTimeout(() => setApplied(false), 2000)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 transition-colors hover:bg-violet-950/60 hover:text-violet-200"
        >
          {applied
            ? <Check className="w-3 h-3 text-green-400" />
            : <Wand2 className="w-3 h-3" />
          }
          {applied ? "Applied" : "Apply"}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{applied ? "Applied to editor" : "Replace the selected code with this"}</p>
      </TooltipContent>
    </Tooltip>
  )
}

interface CodeBlockProps {
  children?: ReactNode
  selection?: CodeSelection
  onApply?: (code: string, selection: CodeSelection) => void
}

function CodeBlock({ children, selection, onApply }: CodeBlockProps) {
  const codeElement = Array.isArray(children) ? children[0] : children
  const className = isValidElement(codeElement)
    ? String((codeElement.props as { className?: string }).className ?? "")
    : ""
  const language = /language-(\w+)/.exec(className)?.[1]
  const codeText = extractText(codeElement).replace(/\n$/, "")

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-zinc-900">
      <div className="flex items-center justify-between border-b border-border/60 bg-zinc-950/60 px-2.5 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {language || "code"}
        </span>
        <div className="flex items-center gap-0.5">
          <CopyButton text={codeText} />
          {onApply && selection && (
            <ApplyButton onApply={() => onApply(codeText, selection)} />
          )}
        </div>
      </div>
      <pre className="!m-0 overflow-x-auto !rounded-none !border-0 !bg-transparent p-3 text-xs">
        {children}
      </pre>
    </div>
  )
}

export default function AiMessage({
  message,
  onApply,
}: {
  message: AiMessageType
  onApply?: (code: string, selection: CodeSelection) => void
}) {
  const isUser = message.role === "user"

  return (
    <div className={`group flex min-w-0 gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>

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
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        <div className={`min-w-0 max-w-full overflow-hidden break-words rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-violet-600 text-white rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        }`}>

          {isUser ? (
            // user messages — plain text
            <p className="text-sm">{message.content}</p>
          ) : (
            // AI messages — markdown rendered
            <div className="prose prose-invert prose-sm min-w-0 max-w-full break-words
              prose-p:my-1 prose-p:leading-relaxed
              prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:text-xs
              prose-code:bg-zinc-900 prose-code:text-violet-300 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
              prose-headings:text-foreground prose-headings:font-semibold
              prose-strong:text-foreground
              prose-ul:my-1 prose-li:my-0.5
            ">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre: (preProps) => (
                    <CodeBlock
                      {...preProps}
                      selection={message.selection}
                      onApply={message.isStreaming ? undefined : onApply}
                    />
                  ),
                }}
              >
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

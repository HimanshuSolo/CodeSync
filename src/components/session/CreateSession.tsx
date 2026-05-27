"use client"

import { useState } from "react"
import { Plus, Loader2, Code2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Language } from "@/types"

const LANGUAGES: { value: Language; label: string; color: string }[] = [
  { value: "rust",       label: "Rust",       color: "text-orange-400" },
  { value: "typescript", label: "TypeScript", color: "text-blue-400"   },
  { value: "javascript", label: "JavaScript", color: "text-yellow-400" },
  { value: "python",     label: "Python",     color: "text-green-400"  },
  { value: "go",         label: "Go",         color: "text-cyan-400"   },
  { value: "cpp",        label: "C++",        color: "text-purple-400" },
  { value: "java",       label: "Java",       color: "text-red-400"    },
  { value: "markdown",   label: "Markdown",   color: "text-zinc-400"   },
]

interface CreateSessionProps {
  onCreated?: (name: string, language: Language) => void
}

export default function CreateSession({ onCreated }: CreateSessionProps) {
  const [open, setOpen]         = useState(false)
  const [name, setName]         = useState("")
  const [language, setLanguage] = useState<Language>("typescript")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState("")

  function reset() {
    setName("")
    setLanguage("typescript")
    setError("")
    setLoading(false)
  }

  async function handleCreate() {
    setError("")

    if (!name.trim()) {
      setError("Session name is required")
      return
    }
    if (name.trim().length < 3) {
      setError("Name must be at least 3 characters")
      return
    }

    setLoading(true)
    await new Promise((r) => setTimeout(r, 800))
    setLoading(false)

    onCreated?.(name.trim(), language)
    setOpen(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
          <Plus className="w-4 h-4" />
          New Session
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <DialogTitle className="text-lg font-bold">
              New Session
            </DialogTitle>
          </div>
          <DialogDescription>
            Create a collaborative coding session and invite your team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">

          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="session-name">Session name</Label>
            <Input
              id="session-name"
              placeholder="e.g. Auth Service Refactor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              disabled={loading}
              className="bg-background"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Language</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as Language)}
              disabled={loading}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {LANGUAGES.map((lang) => (
                  <SelectItem
                    key={lang.value}
                    value={lang.value}
                    className="cursor-pointer"
                  >
                    <span className={`font-mono text-sm ${lang.color}`}>
                      {lang.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              What happens next
            </p>
            {[
              "A unique session link is generated",
              "Share it with your team to collaborate",
              "AI assistant is available immediately",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                <span className="text-xs text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>

        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => { setOpen(false); reset() }}
            disabled={loading}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
              : "Create Session"
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
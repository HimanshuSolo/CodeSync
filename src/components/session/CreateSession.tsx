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
import { sessionApi } from "@/lib/api"

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "rust", label: "Rust" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "cpp", label: "C++" },
  { value: "java", label: "Java" },
  { value: "markdown", label: "Markdown" },
]

interface CreateSessionProps {
  onCreated?: (name: string, language: Language) => void
}

export default function CreateSession({ onCreated }: CreateSessionProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [language, setLanguage] = useState<Language>("typescript")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

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
    try {
      const res = await sessionApi.create(name.trim(), language)
      onCreated?.(name.trim(), language)
      setOpen(false)
      reset()
      // navigate to the new session
      window.location.href = `/session/${res.session.id}`
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
          <Plus className="w-4 h-4" />
          New Session
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg bg-card">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">
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
            <Label htmlFor="session-name" className="text-foreground">Session name</Label>
            <Input
              id="session-name"
              placeholder="e.g. Auth Service Refactor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              disabled={loading}
              className="h-10 bg-background border-border text-foreground"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Language</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as Language)}
              disabled={loading}
            >
              <SelectTrigger className="h-10 w-full bg-background border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="start"
                className="bg-popover border-border shadow-xl"
              >
                {LANGUAGES.map((lang) => (
                  <SelectItem
                    key={lang.value}
                    value={lang.value}
                    className="cursor-pointer py-2.5 focus:bg-violet-500/15"
                  >
                    <span className="font-mono text-sm font-medium text-foreground">
                      {lang.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted/50 border border-border rounded-lg p-3.5 space-y-2">
            <p className="text-xs font-semibold text-foreground">
              What happens next
            </p>
            {[
              "A unique session link is generated",
              "Share it with your team to collaborate",
              "AI assistant is available immediately",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                <span className="text-xs text-foreground/80">{item}</span>
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

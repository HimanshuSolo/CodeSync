"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Code2, Users, Clock, ChevronRight,
  Zap, Search
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import type { Session, Language } from "@/types"
import CreateSession from "@/components/session/CreateSession"


// just mock data, will be replaced by real backend data in furthur phases...........
const MOCK_SESSIONS: Session[] = [
  { id: "1", name: "Auth Service Refactor", language: "rust", ownerId: "u1", createdAt: "2024-01-15T10:00:00Z", updatedAt: "2024-01-15T14:32:00Z" },
  { id: "2", name: "API Rate Limiter", language: "rust", ownerId: "u1", createdAt: "2024-01-14T09:00:00Z", updatedAt: "2024-01-14T17:00:00Z" },
  { id: "3", name: "Dashboard Components", language: "typescript", ownerId: "u1", createdAt: "2024-01-13T11:00:00Z", updatedAt: "2024-01-13T16:45:00Z" },
  { id: "4", name: "Data Pipeline Script", language: "python", ownerId: "u1", createdAt: "2024-01-12T08:00:00Z", updatedAt: "2024-01-12T12:00:00Z" },
  { id: "5", name: "WebSocket Load Test", language: "go", ownerId: "u1", createdAt: "2024-01-11T14:00:00Z", updatedAt: "2024-01-11T18:00:00Z" },
  { id: "6", name: "Markdown Parser", language: "typescript", ownerId: "u1", createdAt: "2024-01-10T10:00:00Z", updatedAt: "2024-01-10T15:00:00Z" },
]

const LANGUAGE_COLORS: Record<Language, string> = {
  rust: "bg-orange-950 text-orange-400 border-orange-900",
  typescript: "bg-blue-950   text-blue-400   border-blue-900",
  javascript: "bg-yellow-950 text-yellow-400 border-yellow-900",
  python: "bg-green-950  text-green-400  border-green-900",
  go: "bg-cyan-950   text-cyan-400   border-cyan-900",
  cpp: "bg-purple-950 text-purple-400 border-purple-900",
  java: "bg-red-950    text-red-400    border-red-900",
  markdown: "bg-zinc-900   text-zinc-400   border-zinc-800",
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (h < 1) return "just now"
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function SessionCard({ session }: { session: Session }) {
  return (
    <Link href={`/session/${session.id}`}>
      <Card className="border-border bg-card hover:border-violet-800 hover:bg-card/80 transition-all duration-200 cursor-pointer group">
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight group-hover:text-violet-300 transition-colors line-clamp-1">
              {session.name}
            </h3>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-violet-400 flex-shrink-0 transition-colors" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">

          <Badge
            variant="outline"
            className={`text-xs font-mono font-medium ${LANGUAGE_COLORS[session.language]}`}
          >
            {session.language}
          </Badge>

          <Separator className="bg-border/50" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {timeAgo(session.updatedAt)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="w-3 h-3" />
              <span>1</span>
            </div>
          </div>

        </CardContent>
      </Card>
    </Link>
  )
}

export default function DashboardPage() {
  const [search, setSearch] = useState("")

  const filtered = MOCK_SESSIONS.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.language.toLowerCase().includes(search.toLowerCase())
  )

  function handleSessionCreated(name: string, language: Language) {
    // TODO: add to real session list in Phase 12
    console.log("Session created:", name, language)
  }

  return (
    <div className="min-h-screen bg-background">

      <header className="h-14 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center justify-between h-full px-6 max-w-6xl mx-auto">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">
              Code<span className="text-violet-400">Sync</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-violet-900 text-violet-200 text-xs font-bold">
                HI
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Sessions</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pick up where you left off or start something new
            </p>
          </div>
          <CreateSession onCreated={handleSessionCreated} />
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard icon={Code2} label="Total sessions" value={String(MOCK_SESSIONS.length)} color="bg-violet-950 text-violet-400" />
          <StatCard icon={Zap} label="Active today" value="x" color="bg-green-950 text-green-400" />
          <StatCard icon={Users} label="Collaborators" value="y" color="bg-blue-950 text-blue-400" />
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <Code2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No sessions found</p>
          </div>
        )}

      </main>
    </div>
  )
}
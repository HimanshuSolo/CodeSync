"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Code2, Plus, Users, Clock,
  ChevronRight, Zap, Search, LogOut,
} from "lucide-react"
import { Button }                from "@/components/ui/button"
import { Input }                 from "@/components/ui/input"
import { Badge }                 from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator }             from "@/components/ui/separator"
import { Skeleton }              from "@/components/ui/skeleton"
import CreateSession             from "@/components/session/CreateSession"
import { useAuth }               from "@/hooks/useAuth"
import { sessionApi }            from "@/lib/api"
import { useSessionStore }       from "@/store/sessionStore"
import type { Session, Language } from "@/types"

const LANGUAGE_COLORS: Record<Language, string> = {
  rust:       "bg-orange-950 text-orange-400 border-orange-900",
  typescript: "bg-blue-950   text-blue-400   border-blue-900",
  javascript: "bg-yellow-950 text-yellow-400 border-yellow-900",
  python:     "bg-green-950  text-green-400  border-green-900",
  go:         "bg-cyan-950   text-cyan-400   border-cyan-900",
  cpp:        "bg-purple-950 text-purple-400 border-purple-900",
  java:       "bg-red-950    text-red-400    border-red-900",
  markdown:   "bg-zinc-900   text-zinc-400   border-zinc-800",
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h    = Math.floor(diff / 3600000)
  const d    = Math.floor(diff / 86400000)
  if (h < 1)  return "just now"
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
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

function SessionCardSkeleton() {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3 pt-4 px-4">
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <Skeleton className="h-5 w-16" />
        <Separator className="bg-border/50" />
        <div className="flex justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-8" />
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const router              = useRouter()
  const { user, logout }    = useAuth()
  const { sessions, setSessions } = useSessionStore()
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState("")

  // redirect to login if not authenticated
  useEffect(() => {
    const token = localStorage.getItem("codesync_token")
    if (!token) router.push("/login")
  }, [router])

  // fetch real sessions from backend
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await sessionApi.list()
        setSessions(res.sessions)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sessions")
      } finally {
        setLoading(false)
      }
    }
    fetchSessions()
  }, [setSessions])

  function handleSessionCreated(name: string, language: Language) {
    // refetch sessions after creation
    sessionApi.list()
      .then((res) => setSessions(res.sessions))
      .catch(console.error)
  }

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.language.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-background">
      {/* navbar */}
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
            <span className="text-sm text-muted-foreground">
              {user?.username}
            </span>
            <Avatar className="w-8 h-8">
              <AvatarFallback
                className="text-xs font-bold text-white"
                style={{ backgroundColor: user?.avatarColor || "#7c3aed" }}
              >
                {user?.username?.slice(0, 2).toUpperCase() || "??"}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              className="w-8 h-8 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Sessions</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pick up where you left off or start something new
            </p>
          </div>
          <CreateSession onCreated={handleSessionCreated} />
        </div>

        {/* stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-950 text-violet-400 flex items-center justify-center">
                <Code2 className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total sessions</p>
                <p className="text-lg font-bold">{sessions.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-green-950 text-green-400 flex items-center justify-center">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active today</p>
                <p className="text-lg font-bold">
                  {sessions.filter(s =>
                    Date.now() - new Date(s.updatedAt).getTime() < 86400000
                  ).length}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-950 text-blue-400 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Your account</p>
                <p className="text-lg font-bold truncate max-w-[100px]">
                  {user?.username || "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>

        {/* error */}
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2 mb-6">
            {error}
          </div>
        )}

        {/* session grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <SessionCardSkeleton key={i} />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((s) => <SessionCard key={s.id} session={s} />)}
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <Code2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {sessions.length === 0
                ? "No sessions yet — create your first one"
                : "No sessions match your search"
              }
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
"use client"

import { useCallback, useEffect, useState } from "react"
import { FileCode2, GitBranch, GitCommit, GitFork, Loader2, RefreshCw, Save, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { repositoryApi, type RepositoryStatus } from "@/lib/api"

interface RepositoryPanelProps {
  sessionId: string
  activeFile: string | null
  document: string
  onOpenFile: (path: string, content: string) => void
}

export default function RepositoryPanel({
  sessionId,
  activeFile,
  document,
  onOpenFile,
}: RepositoryPanelProps) {
  const [files, setFiles] = useState<string[]>([])
  const [status, setStatus] = useState<RepositoryStatus | null>(null)
  const [repoUrl, setRepoUrl] = useState("")
  const [branch, setBranch] = useState("")
  const [token, setToken] = useState("")
  const [commitMessage, setCommitMessage] = useState("")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const refresh = useCallback(async () => {
    try {
      const [tree, gitStatus] = await Promise.all([
        repositoryApi.tree(sessionId),
        repositoryApi.status(sessionId),
      ])
      setFiles(tree.files)
      setStatus(gitStatus)
      setBranch(gitStatus.branch)
      setError("")
    } catch (err) {
      setFiles([])
      setStatus(null)
      const message = err instanceof Error ? err.message : "Failed to load repository"
      if (!message.includes("No repository imported")) setError(message)
    }
  }, [sessionId])

  useEffect(() => {
    const timeout = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timeout)
  }, [refresh])

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label)
    setError("")
    setNotice("")
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repository operation failed")
    } finally {
      setBusy("")
    }
  }

  async function saveActiveFile() {
    if (!activeFile) throw new Error("Open a repository file first")
    await repositoryApi.writeFile(sessionId, activeFile, document)
  }

  if (!status) {
    return (
      <div className="space-y-2 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <GitFork className="h-3.5 w-3.5" />
          Import GitHub repository
        </div>
        <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" className="h-8 text-xs" />
        <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Branch (optional)" className="h-8 text-xs" />
        <Input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="GitHub token for private repos" className="h-8 text-xs" />
        <Button
          size="sm"
          className="w-full"
          disabled={!repoUrl.trim() || !!busy}
          onClick={() => run("import", async () => {
            await repositoryApi.import(sessionId, repoUrl.trim(), branch.trim(), token.trim())
            setNotice("Repository imported")
            await refresh()
          })}
        >
          {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />}
          Import repository
        </Button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-violet-400" />
          <span className="flex-1 truncate text-xs font-medium">{status.branch || "detached HEAD"}</span>
          <Button variant="ghost" size="icon-xs" onClick={refresh} disabled={!!busy}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!activeFile || !!busy}
          onClick={() => run("save", async () => {
            await saveActiveFile()
            setNotice("File saved to workspace")
            await refresh()
          })}
        >
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save active file
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Files</p>
        {files.map((file) => (
          <button
            key={file}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 ${activeFile === file ? "bg-violet-950/50 text-violet-300" : "text-muted-foreground"}`}
            onClick={() => run("open", async () => {
              const result = await repositoryApi.readFile(sessionId, file)
              onOpenFile(result.path, result.content)
            })}
          >
            <FileCode2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{file}</span>
          </button>
        ))}
      </div>

      <div className="space-y-2 border-t border-border px-3 py-3">
        <p className="text-xs text-muted-foreground">{status.changes.length} changed file(s)</p>
        <Input value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Commit message" className="h-8 text-xs" />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!commitMessage.trim() || !!busy}
          onClick={() => run("commit", async () => {
            if (activeFile) await saveActiveFile()
            await repositoryApi.commit(sessionId, commitMessage.trim())
            setCommitMessage("")
            setNotice("Changes committed")
            await refresh()
          })}
        >
          <GitCommit className="h-3.5 w-3.5" />
          Commit all changes
        </Button>
        <Input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="GitHub token for push" className="h-8 text-xs" />
        <Button
          size="sm"
          className="w-full"
          disabled={!!busy}
          onClick={() => run("push", async () => {
            await repositoryApi.push(sessionId, status.branch, token.trim())
            setNotice("Pushed to GitHub")
            await refresh()
          })}
        >
          {busy === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Push branch
        </Button>
        {notice && <p className="text-xs text-green-400">{notice}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}

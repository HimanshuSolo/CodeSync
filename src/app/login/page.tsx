"use client"

import { useState } from "react"
import Link from "next/link"
import { Code2, Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card, CardContent, CardDescription,
  CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"

export default function LoginPage() {
  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)

  const { login, loading, error, clearError } = useAuth()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    if (!email || !password) return
    await login(email, password)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 w-fit hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
            <Code2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-base tracking-tight">
            Code<span className="text-violet-400">Sync</span>
          </span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Card className="border-border bg-card">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
              <CardDescription>Sign in to your CodeSync account</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="bg-background"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPass ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      className="bg-background pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPass
                        ? <EyeOff className="w-4 h-4" />
                        : <Eye    className="w-4 h-4" />
                      }
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={loading}
                >
                  {loading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</>
                    : "Sign in"
                  }
                </Button>
              </form>
            </CardContent>

            <CardFooter className="pt-0">
              <p className="text-sm text-muted-foreground text-center w-full">
                Don&apos;t have an account?{" "}
                <Link href="/register" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
                  Create one
                </Link>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
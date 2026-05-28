"use client"

import { useState } from "react"
import Link from "next/link"
import { Code2, Eye, EyeOff, Loader2, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"


const rules = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One number", test: (p: string) => /[0-9]/.test(p) },
]

export default function RegisterPage() {
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const { register, loading, error, clearError } = useAuth()
  const [showRules, setShowRules] = useState(false)
  const allRulesPassed = rules.every((r) => r.test(password))

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    if (!username || !email || !password || !allRulesPassed) return
    await register(email, username, password)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* top bar */}
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

      {/* centred card */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">

          <Card className="border-border bg-card">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl font-bold">Create account</CardTitle>
              <CardDescription>
                Start collaborating with your team
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleRegister} className="space-y-4">

                {/* error banner */}
                {error && (
                  <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}

                {/* username */}
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="himanshu"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                    className="bg-background"
                  />
                </div>

                {/* email */}
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

                {/* password */}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPass ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setShowRules(true)}
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
                        : <Eye className="w-4 h-4" />
                      }
                    </button>
                  </div>

                  {/* password rules — show on focus */}
                  {showRules && (
                    <div className="space-y-1.5 pt-1">
                      {rules.map((rule) => {
                        const passed = rule.test(password)
                        return (
                          <div key={rule.label} className="flex items-center gap-2">
                            {passed
                              ? <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
                              : <X className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            }
                            <span className={`text-xs transition-colors ${passed ? "text-green-400" : "text-muted-foreground"}`}>
                              {rule.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* submit */}
                <Button
                  type="submit"
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={loading}
                >
                  {loading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account...</>
                    : "Create account"
                  }
                </Button>

              </form>
            </CardContent>

            <CardFooter className="pt-0">
              <p className="text-sm text-muted-foreground text-center w-full">
                Already have an account?{" "}
                <Link href="/login" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </Card>

        </div>
      </div>
    </div>
  )
}
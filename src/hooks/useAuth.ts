"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { authApi } from "@/lib/api"
import type { AuthUser } from "@/types"

// key used for localStorage
const TOKEN_KEY = "codesync_token"
const USER_KEY  = "codesync_user"

export function useAuth() {
  const router                  = useRouter()
  const [user, setUser]         = useState<AuthUser | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // ── load user from localStorage on mount ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem(USER_KEY)
      if (stored) setUser(JSON.parse(stored))
    } catch {
      // corrupted storage — clear it
      localStorage.removeItem(USER_KEY)
      localStorage.removeItem(TOKEN_KEY)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── persist user to localStorage whenever it changes ──
  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      localStorage.setItem(TOKEN_KEY, user.token)
    }
  }, [user])

  // ── login ──
  const login = useCallback(async (email: string, password: string) => {
    setError(null)
    setLoading(true)
    try {
      const res = await authApi.login(email, password)
      const authUser: AuthUser = {
        id:          res.user_id,
        email,
        username:    res.username,
        avatarColor: res.avatar_color,
        token:       res.token,
      }
      setUser(authUser)
      router.push("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }, [router])

  // ── register ──
  const register = useCallback(async (
    email: string,
    username: string,
    password: string
  ) => {
    setError(null)
    setLoading(true)
    try {
      const res = await authApi.register(email, username, password)
      const authUser: AuthUser = {
        id:          res.user_id,
        email,
        username:    res.username,
        avatarColor: res.avatar_color,
        token:       res.token,
      }
      setUser(authUser)
      router.push("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setLoading(false)
    }
  }, [router])

  // ── logout ──
  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    router.push("/login")
  }, [router])

  // ── clear error ──
  const clearError = useCallback(() => setError(null), [])

  return {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    clearError,
  }
}
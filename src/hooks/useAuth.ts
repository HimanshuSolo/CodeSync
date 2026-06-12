"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import type { AuthUser } from "@/types";

const TOKEN_KEY = "codesync_token";
const USER_KEY = "codesync_user";

export function useAuth() {
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load user from localStorage AFTER hydration
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        const stored = localStorage.getItem(USER_KEY);

        if (stored) {
          setUser(JSON.parse(stored) as AuthUser);
        }
      } catch {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        setHydrated(true);
      }
    }, 0)
    return () => clearTimeout(timeout)
  }, []);

  // Persist user
  useEffect(() => {
    if (!hydrated) return;

    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      localStorage.setItem(TOKEN_KEY, user.token);
    }
  }, [user, hydrated]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);

      try {
        const res = await authApi.login(email, password);

        const authUser: AuthUser = {
          id: res.user.id,
          email: res.user.email,
          username: res.user.username,
          avatarColor: res.user.avatar_color,
          token: res.token,
        };

        setUser(authUser);
        router.push("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      setError(null);
      setLoading(true);

      try {
        const res = await authApi.register(email, username, password);

        const authUser: AuthUser = {
          id: res.user.id,
          email: res.user.email,
          username: res.user.username,
          avatarColor: res.user.avatar_color,
          token: res.token,
        };

        setUser(authUser);
        router.push("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    router.push("/login");
  }, [router]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    user,
    hydrated,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    clearError,
  };
}

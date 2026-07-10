/**
 * Auth Context - Provides session state throughout the app
 */

"use client";

import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { type AuthSession, type AuthUser, authClient } from "@/lib/auth-client";

interface AuthContextType {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  isSuperAdmin: boolean;
  login: (
    email: string,
    password: string,
    organizationId?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  canRead: (resource: string) => boolean;
  canWrite: (resource: string) => boolean;
  canAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load session on mount
    const sess = authClient.getSession();
    setSession(sess);

    if (sess) {
      // Try to fetch user data
      authClient
        .getUserOrganizations()
        .then((userData) => setUser(userData))
        .catch((err) => {
          console.error("Failed to load user:", err);
          // Only clear session on actual auth errors (token expired/invalid),
          // not on network/server errors — keep session so email is still shown
          if (
            err.message === "Session expired" ||
            err.message === "Not authenticated"
          ) {
            authClient.logout();
            setSession(null);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    // Poll every 30 s to detect deactivated accounts
    const interval = setInterval(() => {
      if (!authClient.getSession()) return;
      authClient.getUserOrganizations().catch((err: Error) => {
        if (
          err.message === "Session expired" ||
          err.message === "Not authenticated"
        ) {
          setSession(null);
          setUser(null);
        }
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  const login = async (
    email: string,
    password: string,
    organizationId?: string,
  ) => {
    try {
      setLoading(true);
      const newSession = await authClient.login({
        email,
        password,
        organizationId,
      });
      setSession(newSession);

      const userData = await authClient.getUserOrganizations();
      setUser(userData);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    await authClient.logout();
    setSession(null);
    setUser(null);
    setLoading(false);
  };

  const switchOrganization = async (organizationId: string) => {
    try {
      setLoading(true);
      const newSession = await authClient.switchOrganization(organizationId);
      setSession(newSession);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        isSuperAdmin: session?.platformRole === "superAdmin",
        login,
        logout,
        switchOrganization,
        canRead: authClient.canRead.bind(authClient),
        canWrite: authClient.canWrite.bind(authClient),
        canAdmin: authClient.canAdmin.bind(authClient),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

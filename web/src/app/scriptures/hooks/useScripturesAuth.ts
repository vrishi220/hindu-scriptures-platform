"use client";

import { useState, useRef, useEffect } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { getMe, invalidateMeCache } from "../../../lib/authClient";
import type { BasketItem } from "../../../lib/scriptureTypes";

export function useScripturesAuth({
  router,
  setBasketItemsRef,
  setUrlInitializedRef,
}: {
  router: AppRouterInstance;
  setBasketItemsRef: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<BasketItem[]>> | null
  >;
  setUrlInitializedRef: React.MutableRefObject<((value: boolean) => void) | null>;
}) {
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authUserId, setAuthUserId] = useState<number | null>(null);
  const [canView, setCanView] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canImport, setCanImport] = useState(false);

  const loadAuth = async (force = false) => {
    try {
      const data = await getMe(force ? { force: true } : undefined);
      if (!data) {
        setAuthEmail(null);
        setAuthUserId(null);
        setAuthStatus("Not authenticated");
        setCanView(false);
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        setCanImport(false);
        return;
      }
      setAuthUserId(data.id ?? null);
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      const canViewPermission = (data.permissions as { can_view?: boolean } | undefined)?.can_view;
      const canImportPermission = (data.permissions as { can_import?: boolean } | undefined)?.can_import;
      setCanView(Boolean(canViewPermission || data.role === "viewer" || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
      setCanImport(Boolean(canImportPermission || data.permissions?.can_admin || data.role === "admin"));
    } catch {
      setAuthEmail(null);
      setAuthUserId(null);
      setAuthStatus("Auth check failed");
      setCanView(false);
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
      setCanImport(false);
    } finally {
      setAuthResolved(true);
    }
  };

  const handleSignOut = async () => {
    setBasketItemsRef.current?.([]);
    invalidateMeCache();
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      router.push("/");
    } catch {
      router.push("/");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { detail?: string; message?: string } | null;
        const detail = payload?.detail || payload?.message || "Login failed";
        throw new Error(`Login failed (${response.status}): ${detail}`);
      }
      setAuthMessage("Logged in.");
      setEmail("");
      setPassword("");
      setShowLogin(false);
      invalidateMeCache();
      await loadAuth();
      setUrlInitializedRef.current?.(false);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    }
  };

  useEffect(() => {
    void loadAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    authEmail,
    showLogin,
    setShowLogin,
    email,
    setEmail,
    password,
    setPassword,
    authMessage,
    setAuthMessage,
    authStatus,
    authResolved,
    authUserId,
    canView,
    canAdmin,
    canContribute,
    canEdit,
    canImport,
    loadAuth,
    handleLogin,
    handleSignOut,
  };
}

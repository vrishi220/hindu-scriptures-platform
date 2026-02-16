"use client";

import { useEffect, useState } from "react";

type User = {
  id: number;
  email: string;
  username?: string | null;
  full_name?: string | null;
  role: string;
  permissions?: Record<string, boolean> | null;
  is_active: boolean;
};

type PermissionKey =
  | "can_view"
  | "can_contribute"
  | "can_edit"
  | "can_moderate"
  | "can_admin";

const permissionLabels: Record<PermissionKey, string> = {
  can_view: "View",
  can_contribute: "Contribute",
  can_edit: "Edit",
  can_moderate: "Moderate",
  can_admin: "Admin",
};

const rolePermissions: Record<
  string,
  Record<PermissionKey, boolean>
> = {
  viewer: {
    can_view: true,
    can_contribute: false,
    can_edit: false,
    can_moderate: false,
    can_admin: false,
  },
  contributor: {
    can_view: true,
    can_contribute: true,
    can_edit: false,
    can_moderate: false,
    can_admin: false,
  },
  editor: {
    can_view: true,
    can_contribute: true,
    can_edit: true,
    can_moderate: false,
    can_admin: false,
  },
  moderator: {
    can_view: true,
    can_contribute: true,
    can_edit: true,
    can_moderate: true,
    can_admin: false,
  },
  admin: {
    can_view: true,
    can_contribute: true,
    can_edit: true,
    can_moderate: true,
    can_admin: true,
  },
};

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState("viewer");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [authEmail, setAuthEmail] = useState<string | null>(null);

  const parsePayload = (raw: string) => {
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };

  const getErrorMessage = (raw: string, fallback: string) => {
    const parsed = parsePayload(raw) as { detail?: string } | null;
    if (parsed?.detail) {
      return parsed.detail;
    }
    const trimmed = raw?.trim();
    return trimmed ? trimmed : fallback;
  };

  const loadUsers = async () => {
    setLoading(true);
    setToast(null);
    setAccessDenied(false);
    try {
          const response = await fetch("/api/admin/users", {
        credentials: "include",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as User[] | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setUsers([]);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Load failed")}`
        );
      }
      if (!payload) {
        throw new Error("Unexpected response payload");
      }
      setUsers(payload as User[]);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Load failed",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAuth = async () => {
    try {
      const response = await fetch("/api/users/me", { credentials: "include" });
      if (response.ok) {
        const data = (await response.json()) as {
          email?: string;
          role?: string;
        };
        setAuthEmail(data.email || null);
      }
    } catch {
      // Ignore auth errors on admin page
    }
  };

  useEffect(() => {
    loadAuth();
    loadUsers();
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setToast(null);
    try {
          const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          role: createRole,
        }),
        credentials: "include",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as User | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Create failed")}`
        );
      }
      if (!payload) {
        throw new Error("Unexpected response payload");
      }
      setCreateEmail("");
      setCreatePassword("");
      setCreateRole("viewer");
      setShowCreateModal(false);
      setToast({ type: "success", message: "User created." });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Create failed",
      });
    }
  };

  const updatePermission = async (
    userId: number,
    permissions: Record<string, boolean>,
    role: string
  ) => {
    setToast(null);
    try {
          const response = await fetch(`/api/admin/users/${userId}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...permissions, role }),
        credentials: "include",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as User | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Update failed")}`
        );
      }
      if (!payload) {
        throw new Error("Unexpected response payload");
      }
      setToast({ type: "success", message: "Permissions updated." });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  };

  const toggleUserActive = async (userId: number, isActive: boolean) => {
    setToast(null);
    try {
          const response = await fetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: isActive }),
        credentials: "include",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as User | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Status update failed")}`
        );
      }
      if (!payload) {
        throw new Error("Unexpected response payload");
      }
      setToast({
        type: "success",
        message: isActive ? "User activated." : "User deactivated.",
      });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Status update failed",
      });
    }
  };

  const deleteUser = async (userId: number) => {
    if (!confirm("Permanently delete this user? This cannot be undone.")) {
      return;
    }
    setToast(null);
    try {
          const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        const raw = await response.text();
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Delete failed")}`
        );
      }
      setToast({ type: "success", message: "User deleted." });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Delete failed",
      });
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      window.location.href = "/";
    } catch {
      window.location.href = "/";
    }
  };

  const toggleUserDetails = (userId: number) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  return (
    <div className="grainy-bg min-h-screen">
      <nav className="border-b border-black/10 bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <a href="/" className="flex items-center gap-2">
              <img
                src="/logo-mark.svg"
                alt="Hindu Scriptures"
                className="h-8 w-8"
              />
              <span className="text-sm font-semibold text-[color:var(--deep)]">
                Hindu Scriptures
              </span>
            </a>
            <div className="hidden items-center gap-4 text-sm text-zinc-600 sm:flex">
              <a href="/" className="hover:text-[color:var(--accent)]">
                Home
              </a>
              <a href="/scriptures" className="hover:text-[color:var(--accent)]">
                Scriptures
              </a>
              <a href="/explorer" className="hover:text-[color:var(--accent)]">
                Explorer
              </a>
              <a href="/admin" className="font-semibold text-[color:var(--deep)]">
                Users
              </a>
              <a href="/admin/schemas" className="hover:text-[color:var(--accent)]">
                Schemas
              </a>
            </div>
          </div>
          <div className="relative flex flex-col items-end gap-2">
            <button
              onClick={handleLogout}
              className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              title={authEmail || ""}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Users</p>
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
            User access control
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Create users and assign permissions for contributions and moderation.
          </p>
        </header>
        {toast && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              toast.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {toast.message}
          </div>
        )}
        {accessDenied && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-sm">
            Admin access required. Sign in with an admin account to manage users.
            <a
              className="ml-2 font-semibold text-amber-800 underline"
              href="/#"
            >
              Go to sign in
            </a>
          </div>
        )}

        <section
          className={`rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg ${
            accessDenied ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Users
            </h2>
            <div className="flex items-center gap-3">
              {loading && <span className="text-xs text-zinc-500">Loading...</span>}
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-50 text-lg text-emerald-700 transition hover:border-emerald-500/60 hover:shadow-md"
                title="Create user"
              >
                +
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            {users.map((user) => {
              const currentPermissions = {
                can_view: user.permissions?.can_view ?? true,
                can_contribute: user.permissions?.can_contribute ?? false,
                can_edit: user.permissions?.can_edit ?? false,
                can_moderate: user.permissions?.can_moderate ?? false,
                can_admin: user.permissions?.can_admin ?? false,
              };
              const isExpanded = expandedUsers.has(user.id);

              return (
                <div
                  key={user.id}
                  className={`rounded-2xl border border-black/10 bg-white/90 p-4 ${
                    !user.is_active ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[color:var(--deep)]">
                          {user.email}
                        </p>
                        {!user.is_active && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-amber-700">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">
                        {user.username || "No username"} · {user.role}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleUserActive(user.id, !user.is_active)}
                        className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-600 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                      >
                        {user.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => deleteUser(user.id)}
                        className="rounded-full border border-rose-200 bg-rose-50/80 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                      >
                        Delete
                      </button>
                      <select
                        value={user.role}
                        onChange={(event) => {
                          const newRole = event.target.value;
                          const newPermissions = rolePermissions[newRole] || currentPermissions;
                          updatePermission(user.id, newPermissions, newRole);
                        }}
                        className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-zinc-600"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="contributor">Contributor</option>
                        <option value="editor">Editor</option>
                        <option value="moderator">Moderator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {(Object.keys(permissionLabels) as PermissionKey[]).map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-full border border-black/10 bg-zinc-50/80 px-3 py-1 text-xs text-zinc-500"
                      >
                        <input
                          type="checkbox"
                          checked={currentPermissions[key]}
                          disabled
                          className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)] opacity-60"
                        />
                        {permissionLabels[key]}
                      </label>
                    ))}
                    <button
                      onClick={() => toggleUserDetails(user.id)}
                      className="ml-auto rounded-full border border-black/10 bg-white/80 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-600 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                    >
                      {isExpanded ? "Hide Details" : "Show Details"}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 rounded-xl border border-black/5 bg-zinc-50/50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        User Details
                      </p>
                      <div className="mt-2 grid gap-2 text-xs text-zinc-600">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">User ID:</span>
                          <span className="font-medium">{user.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Full Name:</span>
                          <span className="font-medium">{user.full_name || "Not set"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Status:</span>
                          <span className="font-medium">{user.is_active ? "Active" : "Inactive"}</span>
                        </div>
                        {/* Future fields can be added here:
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Created:</span>
                          <span className="font-medium">{user.created_at}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Last Login:</span>
                          <span className="font-medium">{user.last_login}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Contributions:</span>
                          <span className="font-medium">{user.contribution_count}</span>
                        </div>
                        */}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                Create User
              </h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateEmail("");
                  setCreatePassword("");
                  setCreateRole("viewer");
                }}
                className="text-2xl text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
            <form className="flex flex-col gap-4" onSubmit={handleCreateUser}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Email
                </label>
                <input
                  value={createEmail}
                  onChange={(event) => setCreateEmail(event.target.value)}
                  placeholder="user@example.com"
                  type="email"
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Password
                </label>
                <input
                  value={createPassword}
                  onChange={(event) => setCreatePassword(event.target.value)}
                  placeholder="••••••••"
                  type="password"
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Role
                </label>
                <select
                  value={createRole}
                  onChange={(event) => setCreateRole(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                  <option value="editor">Editor</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateEmail("");
                    setCreatePassword("");
                    setCreateRole("viewer");
                  }}
                  className="flex-1 rounded-xl border border-black/10 bg-white/80 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

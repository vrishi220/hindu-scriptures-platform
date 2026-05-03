"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { getMe } from "@/lib/authClient";
import InlineClearButton from "@/components/InlineClearButton";

type User = {
  id: number;
  email: string;
  username?: string | null;
  full_name?: string | null;
  role: string;
  permissions?: Record<string, boolean> | null;
  is_active: boolean;
  created_at?: string | null;
  account_lifecycle_status?: "invited" | "registered";
  lifecycle_age_days?: number | null;
};

type PermissionKey =
  | "can_view"
  | "can_contribute"
  | "can_import"
  | "can_edit"
  | "can_moderate"
  | "can_admin";

type Toast = {
  type: "success" | "error";
  message: string;
};

type UserOwnedBook = {
  id: number;
  book_name: string;
  book_code?: string | null;
  visibility: "private" | "public";
  status: "draft" | "published";
};

type ModalMode = "create" | "edit" | "view";

const permissionLabels: Record<PermissionKey, string> = {
  can_view: "View",
  can_contribute: "Contribute",
  can_import: "Import",
  can_edit: "Edit",
  can_moderate: "Moderate",
  can_admin: "Admin",
};

const rolePermissions: Record<string, Record<PermissionKey, boolean>> = {
  viewer: {
    can_view: true,
    can_contribute: false,
    can_import: false,
    can_edit: false,
    can_moderate: false,
    can_admin: false,
  },
  contributor: {
    can_view: true,
    can_contribute: true,
    can_import: true,
    can_edit: false,
    can_moderate: false,
    can_admin: false,
  },
  editor: {
    can_view: true,
    can_contribute: true,
    can_import: true,
    can_edit: true,
    can_moderate: false,
    can_admin: false,
  },
  moderator: {
    can_view: true,
    can_contribute: true,
    can_import: true,
    can_edit: true,
    can_moderate: true,
    can_admin: false,
  },
  admin: {
    can_view: true,
    can_contribute: true,
    can_import: true,
    can_edit: true,
    can_moderate: true,
    can_admin: true,
  },
};

const parsePayload = (raw: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const getErrorMessage = (raw: string, fallback: string) => {
  const parsed = parsePayload(raw) as { detail?: string } | null;
  if (parsed?.detail) return parsed.detail;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : fallback;
};

const formatLifecycleLabel = (user: User) => {
  const status = user.account_lifecycle_status === "invited" ? "Invited" : "Registered";
  const ageDays =
    typeof user.lifecycle_age_days === "number" && Number.isFinite(user.lifecycle_age_days)
      ? Math.max(0, Math.floor(user.lifecycle_age_days))
      : null;
  if (ageDays === null) {
    return status;
  }
  if (ageDays === 0) {
    return `${status} today`;
  }
  if (ageDays === 1) {
    return `${status} 1 day ago`;
  }
  return `${status} ${ageDays} days ago`;
};

export default function AdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [userOwnedBooks, setUserOwnedBooks] = useState<UserOwnedBook[]>([]);
  const [userOwnedBooksLoading, setUserOwnedBooksLoading] = useState(false);
  const [openUserActionsId, setOpenUserActionsId] = useState<number | null>(null);
  const userActionsMenuRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | "invited" | "registered">("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createConfirmPassword, setCreateConfirmPassword] = useState("");
  const [createRole, setCreateRole] = useState("viewer");

  const isStrongPassword = (value: string) =>
    /[A-Z]/.test(value) && /[a-z]/.test(value) && /[^A-Za-z0-9]/.test(value) && value.length >= 8;

  const [selectedRole, setSelectedRole] = useState("viewer");

  const selectedUser = users.find((user) => user.id === selectedUserId) || null;

  const availableRoles = useMemo(() => {
    const roles = new Set<string>(["viewer", "contributor", "editor", "moderator", "admin"]);
    users.forEach((user) => {
      if (user.role) roles.add(user.role);
    });
    return Array.from(roles);
  }, [users]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (statusFilter === "active" && !user.is_active) return false;
      if (statusFilter === "inactive" && user.is_active) return false;
      const lifecycleStatus = user.account_lifecycle_status === "invited" ? "invited" : "registered";
      if (lifecycleFilter !== "all" && lifecycleStatus !== lifecycleFilter) return false;

      if (!normalizedQuery) return true;
      const haystack = [
        user.email,
        user.username || "",
        user.full_name || "",
        user.role,
        user.id.toString(),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [users, query, roleFilter, statusFilter, lifecycleFilter]);

  const loadAuth = async () => {
    try {
      const me = await getMe();
      const admin = Boolean(me?.permissions?.can_admin || me?.role === "admin");
      setCanAdmin(admin);
      setCurrentUserId(typeof me?.id === "number" ? me.id : null);
      setAccessDenied(!admin);
      return admin;
    } catch {
      setCanAdmin(false);
      setCurrentUserId(null);
      setAccessDenied(true);
      return false;
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", { credentials: "include" });
      const raw = await response.text();
      const payload = parsePayload(raw) as User[] | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setUsers([]);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Load failed")}`);
      }
      setUsers(payload || []);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Load failed",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await loadAuth();
      await loadUsers();
      setAuthChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!modalOpen || !selectedUserId || !canAdmin || modalMode === "create") {
      setUserOwnedBooks([]);
      setUserOwnedBooksLoading(false);
      return;
    }

    let cancelled = false;

    const loadUserOwnedBooks = async () => {
      setUserOwnedBooksLoading(true);
      try {
        const response = await fetch(`/api/admin/users/${selectedUserId}/books`, {
          credentials: "include",
        });
        const raw = await response.text();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setAccessDenied(true);
            return;
          }
          throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to load user books")}`);
        }

        const payload = parsePayload(raw) as UserOwnedBook[] | null;
        if (!cancelled) {
          setUserOwnedBooks(Array.isArray(payload) ? payload : []);
        }
      } catch (err) {
        if (!cancelled) {
          setUserOwnedBooks([]);
          setToast({
            type: "error",
            message: err instanceof Error ? err.message : "Failed to load user books",
          });
        }
      } finally {
        if (!cancelled) {
          setUserOwnedBooksLoading(false);
        }
      }
    };

    void loadUserOwnedBooks();

    return () => {
      cancelled = true;
    };
  }, [modalOpen, modalMode, selectedUserId, canAdmin]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (openUserActionsId === null) return;
      const menu = userActionsMenuRefs.current[openUserActionsId];
      const target = event.target as Node;
      if (menu && !menu.contains(target)) {
        setOpenUserActionsId(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openUserActionsId]);

  const resetCreateForm = () => {
    setCreateEmail("");
    setCreatePassword("");
    setCreateConfirmPassword("");
    setCreateRole("viewer");
  };

  const openCreate = () => {
    setModalMode("create");
    setSelectedUserId(null);
    resetCreateForm();
    setModalOpen(true);
  };

  const openUser = (user: User) => {
    setModalMode(canAdmin ? "edit" : "view");
    setSelectedUserId(user.id);
    setSelectedRole(user.role || "viewer");
    setModalOpen(true);
  };

  const handleCreateUser = async () => {
    if (!createEmail.trim() || !createPassword.trim()) {
      setToast({ type: "error", message: "Email and password are required." });
      return;
    }

    if (!isStrongPassword(createPassword)) {
      setToast({
        type: "error",
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, and special character.",
      });
      return;
    }

    if (createPassword !== createConfirmPassword) {
      setToast({ type: "error", message: "Password and confirm password do not match." });
      return;
    }

    setSaving(true);
    setToast(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createEmail.trim(),
          password: createPassword,
          role: createRole,
        }),
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Create failed")}`);
      }

      setToast({ type: "success", message: "User created." });
      setModalOpen(false);
      resetCreateForm();
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Create failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const updatePermission = async (userId: number, role: string) => {
    setSaving(true);
    setToast(null);
    try {
      const permissions = rolePermissions[role] || rolePermissions.viewer;
      const response = await fetch(`/api/admin/users/${userId}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...permissions, role }),
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Update failed")}`);
      }

      setToast({ type: "success", message: "Permissions updated." });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleUserActive = async (user: User) => {
    setStatusUpdatingId(user.id);
    setToast(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Status update failed")}`);
      }

      setToast({
        type: "success",
        message: user.is_active ? "User deactivated." : "User activated.",
      });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Status update failed",
      });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const deleteUser = async (user: User) => {
    if (!window.confirm(`Delete user \"${user.email}\"? This cannot be undone.`)) {
      return;
    }

    setDeletingId(user.id);
    setToast(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const raw = await response.text();
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Delete failed")}`);
      }

      if (selectedUserId === user.id) {
        setModalOpen(false);
        setSelectedUserId(null);
      }

      setToast({ type: "success", message: "User deleted." });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const currentPermissions = selectedUser
    ? {
        can_view: selectedUser.permissions?.can_view ?? true,
        can_contribute: selectedUser.permissions?.can_contribute ?? false,
        can_import: selectedUser.permissions?.can_import ?? false,
        can_edit: selectedUser.permissions?.can_edit ?? false,
        can_moderate: selectedUser.permissions?.can_moderate ?? false,
        can_admin: selectedUser.permissions?.can_admin ?? false,
      }
    : rolePermissions.viewer;

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-6">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Users</h1>
        <p className="text-sm text-zinc-600">Manage user access in a searchable table view.</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        <a href="/admin" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Users</a>
        <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white px-3 py-1">Schemas</a>
        <a href="/admin/metadata/properties" className="rounded-full border border-black/10 bg-white px-3 py-1">Properties</a>
        <a href="/admin/metadata/categories" className="rounded-full border border-black/10 bg-white px-3 py-1">Categories</a>
        <a href="/admin/media-bank" className="rounded-full border border-black/10 bg-white px-3 py-1">Multimedia Repo</a>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {toast.message}
        </div>
      )}

      {accessDenied && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Admin access required. Sign in with an admin account to manage users.
          <Link className="ml-2 font-semibold underline" href="/signin">
            Sign in
          </Link>
        </div>
      )}

      <section className={`rounded-xl border border-black/10 bg-white p-4 space-y-3 ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Users</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="group relative">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users"
                className="rounded-lg border border-black/10 px-3 py-1.5 pr-10 text-sm"
              />
              <InlineClearButton
                visible={Boolean(query)}
                onClear={() => setQuery("")}
                ariaLabel="Clear user search"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All roles</option>
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={lifecycleFilter}
              onChange={(event) =>
                setLifecycleFilter(event.target.value as "all" | "invited" | "registered")
              }
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All lifecycle</option>
              <option value="invited">Invited only</option>
              <option value="registered">Registered only</option>
            </select>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            {canAdmin && (
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg border border-black/10 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Create
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600">Loading...</p>
        ) : filteredUsers.length === 0 ? (
          <p className="text-sm text-zinc-600">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-zinc-600">
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Lifecycle</th>
                  <th className="px-3 py-2 font-medium">Permissions</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const perms = {
                    can_view: user.permissions?.can_view ?? true,
                    can_contribute: user.permissions?.can_contribute ?? false,
                    can_import: user.permissions?.can_import ?? false,
                    can_edit: user.permissions?.can_edit ?? false,
                    can_moderate: user.permissions?.can_moderate ?? false,
                    can_admin: user.permissions?.can_admin ?? false,
                  };
                  const permissionSummary = (Object.keys(permissionLabels) as PermissionKey[])
                    .filter((key) => perms[key])
                    .map((key) => permissionLabels[key])
                    .join(", ");
                  const isCurrentUser = currentUserId !== null && user.id === currentUserId;
                  const isAdminUser = user.role === "admin";
                  const isInvitedUser = user.account_lifecycle_status === "invited";
                  const actions: Array<{
                    key: "toggle" | "delete";
                    label: string;
                    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
                    disabled: boolean;
                    loadingLabel?: string;
                    destructive?: boolean;
                  }> = [];

                  if (canAdmin && !isCurrentUser && !isAdminUser) {
                    actions.push({
                      key: "toggle",
                      label: user.is_active ? "Deactivate" : "Activate",
                      loadingLabel: "Updating...",
                      disabled: statusUpdatingId === user.id,
                      onClick: (event) => {
                        event.stopPropagation();
                        setOpenUserActionsId(null);
                        void toggleUserActive(user);
                      },
                    });

                  }

                  if (canAdmin && !isCurrentUser && (!isAdminUser || isInvitedUser)) {
                    actions.push({
                      key: "delete",
                      label: deletingId === user.id ? "Deleting…" : "Delete",
                      disabled: deletingId === user.id,
                      destructive: true,
                      onClick: (event) => {
                        event.stopPropagation();
                        setOpenUserActionsId(null);
                        void deleteUser(user);
                      },
                    });
                  }

                  return (
                    <tr key={user.id} onClick={() => openUser(user)} className="cursor-pointer border-b border-black/5 hover:bg-zinc-50">
                      <td className="px-3 py-2 font-medium text-zinc-900">{user.email}</td>
                      <td className="px-3 py-2 text-zinc-700">{user.role}</td>
                      <td className="px-3 py-2 text-zinc-700">{user.is_active ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2 text-zinc-700">{formatLifecycleLabel(user)}</td>
                      <td className="px-3 py-2 text-zinc-700">{permissionSummary || "—"}</td>
                      <td className="px-3 py-2">
                        {actions.length > 1 ? (
                          <div
                            ref={(element) => {
                              userActionsMenuRefs.current[user.id] = element;
                            }}
                            className="relative"
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenUserActionsId((prev) => (prev === user.id ? null : user.id));
                              }}
                              aria-label="User actions"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                            >
                              <MoreVertical size={16} />
                            </button>
                            {openUserActionsId === user.id && (
                              <div className="absolute right-0 z-40 mt-2 w-44 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                                {actions.map((action) => (
                                  <button
                                    key={action.key}
                                    type="button"
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                      action.destructive
                                        ? "text-red-700 hover:bg-red-50"
                                        : "text-zinc-700 hover:bg-zinc-50"
                                    }`}
                                  >
                                    {action.disabled && action.loadingLabel ? action.loadingLabel : action.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : actions.length === 1 ? (
                          <button
                            type="button"
                            onClick={actions[0].onClick}
                            disabled={actions[0].disabled}
                            className={`rounded-lg border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              actions[0].destructive
                                ? "border-red-200 text-red-700 hover:bg-red-50"
                                : "border-black/10 text-zinc-700 hover:bg-zinc-50"
                            }`}
                          >
                            {actions[0].disabled && actions[0].loadingLabel
                              ? actions[0].loadingLabel
                              : actions[0].label}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-black/10 bg-white p-4 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900">
                {modalMode === "create" ? "Create user" : modalMode === "edit" ? "Edit user" : "View user"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setSelectedUserId(null);
                  resetCreateForm();
                }}
                className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
              >
                X
              </button>
            </div>

            {modalMode === "create" ? (
              <div className="space-y-3">
                <label className="block text-sm text-zinc-700">
                  Email
                  <input
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                    type="email"
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm text-zinc-700">
                  Password
                  <input
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    type="password"
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                </label>
                <p className="-mt-1 text-xs text-zinc-500">
                  Use at least 8 characters with uppercase, lowercase, and special character.
                </p>
                <label className="block text-sm text-zinc-700">
                  Confirm password
                  <input
                    value={createConfirmPassword}
                    onChange={(event) => setCreateConfirmPassword(event.target.value)}
                    type="password"
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm text-zinc-700">
                  Role
                  <select
                    value={createRole}
                    onChange={(event) => setCreateRole(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  >
                    {availableRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCreateUser()}
                    disabled={
                      saving ||
                      !createEmail.trim() ||
                      !createPassword.trim() ||
                      !createConfirmPassword.trim() ||
                      createPassword !== createConfirmPassword ||
                      !isStrongPassword(createPassword)
                    }
                    className="rounded-lg border border-black/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Create"}
                  </button>
                </div>
              </div>
            ) : selectedUser ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-zinc-700">
                    Email
                    <input value={selectedUser.email} disabled className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100" />
                  </label>
                  <label className="text-sm text-zinc-700">
                    Username
                    <input value={selectedUser.username || ""} disabled className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100" />
                  </label>
                  <label className="text-sm text-zinc-700">
                    Full name
                    <input value={selectedUser.full_name || ""} disabled className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100" />
                  </label>
                  <label className="text-sm text-zinc-700">
                    Status
                    <input value={selectedUser.is_active ? "Active" : "Inactive"} disabled className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100" />
                  </label>
                </div>

                <label className="block text-sm text-zinc-700">
                  Role
                  <select
                    value={selectedRole}
                    onChange={(event) => setSelectedRole(event.target.value)}
                    disabled={modalMode === "view" || !canAdmin}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                  >
                    {availableRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-lg border border-black/10 p-3">
                  <p className="text-sm font-medium text-zinc-900">Effective permissions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(Object.keys(permissionLabels) as PermissionKey[]).map((key) => (
                      <span
                        key={key}
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
                          currentPermissions[key]
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {permissionLabels[key]}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-black/10 p-3">
                  <p className="text-sm font-medium text-zinc-900">User books</p>
                  {userOwnedBooksLoading ? (
                    <p className="mt-2 text-sm text-zinc-600">Loading books...</p>
                  ) : userOwnedBooks.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-600">No owned books.</p>
                  ) : (
                    <div className="mt-2 max-h-48 overflow-auto rounded-md border border-black/5">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-black/10 bg-zinc-50 text-left text-zinc-600">
                            <th className="px-2 py-1.5 font-medium">Book</th>
                            <th className="px-2 py-1.5 font-medium">Code</th>
                            <th className="px-2 py-1.5 font-medium">Visibility</th>
                            <th className="px-2 py-1.5 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userOwnedBooks.map((book) => (
                            <tr key={book.id} className="border-b border-black/5 last:border-0 text-zinc-700">
                              <td className="px-2 py-1.5">{book.book_name}</td>
                              <td className="px-2 py-1.5">{book.book_code || "-"}</td>
                              <td className="px-2 py-1.5">{book.visibility}</td>
                              <td className="px-2 py-1.5">{book.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {canAdmin && modalMode !== "view" ? (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void updatePermission(selectedUser.id, selectedRole)}
                      disabled={saving}
                      className="rounded-lg border border-black/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

    </main>
  );
}

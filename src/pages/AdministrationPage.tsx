import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth, getUserById, deleteUser, resetUserPassword, type User, type PortalId, ALL_PORTAL_IDS } from "@/lib/authContext";
import { usePortalUsers } from "@/hooks/usePortalUsers";
import type { Role } from "@/lib/permissions";
import { usePortalDB } from "@/lib/portalContextDB";
import { supabase } from "@/lib/supabase";
import { PORTALS, usePortal } from "@/lib/portalContext";
import { usePermission } from "@/lib/permissions";
import { ProtectedPage } from "@/components/ProtectedPage";
import { MOCK_GOALS, type Goal } from "@/lib/profileData";
import {
  INITIAL_COMPANY_SETTINGS, INITIAL_SECURITY_SETTINGS,
  getAuditLog, subscribeAudit, addAuditEntry,
  type AuditLogEntry, type CompanySettings, type SecuritySettings,
} from "@/lib/adminStore";
import {
  ShieldCheck, Search, Plus, X, Users, Shield, ScrollText, Building2, Lock,
  Eye, EyeOff, Pencil, MoreVertical, UserPlus, Target, Trash2, ExternalLink,
} from "lucide-react";
import { ActionMenu, type ActionMenuEntry } from "@/components/ActionMenu";
import { format, formatDistanceToNow, isToday, isYesterday, subDays } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { RoleBadge } from "@/components/RoleBadge";

type AdminTab = "users" | "roles" | "audit" | "company" | "security";

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`;

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session ? `Bearer ${data.session.access_token}` : "";
}

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  top_role: string;
  portals: { portal_id: string; slug: string; role: string }[];
  created_at: string | null;
}

function adminUserToUser(u: AdminUser): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.top_role as User["role"],
    avatar: u.avatar_url,
    bio: "",
    createdAt: u.created_at ? new Date(u.created_at) : new Date(),
    portalAccess: u.portals.map((p) => p.slug as PortalId),
  };
}

const ROLE_EMOJI: Record<string, string> = { owner: "ðŸ‘‘", admin: "ðŸ”§", manager: "ðŸ‘¥", member: "ðŸ‘¤" };

/* â”€â”€ Users Tab â”€â”€ */
function UsersTab({ isOwner }: { isOwner: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { portal } = usePortal();
  const prefix = portal?.routePrefix ?? "";
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [goalsUser, setGoalsUser] = useState<User | null>(null);

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const auth = await getAuthHeader();
      if (!auth) { toast({ title: "Not authenticated", description: "Re-login required", variant: "destructive" }); return; }
      // cache:"no-store" bypasses SW + browser HTTP cache so we always see fresh data after a mutation.
      const res = await fetch(`${EDGE_BASE}/admin-list-users`, { headers: { Authorization: auth }, cache: "no-store" });
      const text = await res.text();
      let parsed: { users?: AdminUser[]; error?: string } = {};
      try { parsed = text ? JSON.parse(text) as { users?: AdminUser[]; error?: string } : {}; } catch { /* non-JSON */ }
      if (!res.ok) {
        console.error("[admin-list-users] HTTP", res.status, parsed.error ?? text.slice(0, 200));
        toast({ title: "Failed to load users", description: parsed.error ?? `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      setAdminUsers(parsed.users ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[admin-list-users] fetch failed:", e);
      toast({ title: "Network error", description: msg, variant: "destructive" });
    } finally {
      setLoadingUsers(false);
    }
  }, [toast]);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  const filtered = adminUsers.filter((u) =>
    !search.trim() ||
    u.display_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
          Team Members ({loadingUsers ? "…" : adminUsers.length})
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--text-quaternary)" }} />
            <input className="glass-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." style={{ fontSize: 12, padding: "6px 10px 6px 28px", borderRadius: 8, width: 180 }} />
          </div>
          {isOwner && (
            <button type="button" onClick={() => setShowInvite(true)} className="glass-btn-primary flex items-center gap-1.5" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>
              <UserPlus className="w-3.5 h-3.5" /> Create Login
            </button>
          )}
        </div>
      </div>

      {loadingUsers ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 68, background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", animation: "pulse 1.5s infinite" }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((u) => {
            const legacyUser = adminUserToUser(u);
            return (
              <div key={u.id} className="flex items-center justify-between transition-colors" style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: "14px 18px" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--glass-border-hover, var(--sosa-border))"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sosa-border)"; }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--sosa-bg-3)", fontSize: 14, fontWeight: 700, color: "var(--portal-accent)" }}>
                    {u.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{u.display_name}</span>
                      <RoleBadge role={u.top_role as Role} />
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "rgba(34,197,94,0.1)", color: "var(--color-success)" }}>Active</span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{u.email}</span>
                    {u.created_at && (
                      <span style={{ fontSize: 11, color: "var(--text-quaternary)", marginLeft: 8 }}>
                        Joined {format(new Date(u.created_at), "MMM yyyy")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => navigate(`${prefix}/profile/${u.id}`)} className="glass-btn flex items-center gap-1" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6 }}>
                    <Eye className="w-3 h-3" /> View
                  </button>
                  {isOwner && (
                    <button type="button" onClick={() => setEditUser(legacyUser)} className="glass-btn flex items-center gap-1" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6 }}>
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                  <ActionMenu
                    trigger={<MoreVertical className="w-4 h-4" />}
                    items={[
                      { id: "profile", icon: <ExternalLink className="w-3.5 h-3.5" />, label: "View Profile", onClick: () => navigate(`${prefix}/profile/${u.id}`) },
                      ...(isOwner ? [{ id: "goals", icon: <Target className="w-3.5 h-3.5" />, label: "Manage Goals", onClick: () => setGoalsUser(legacyUser) }] : []),
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showInvite && <CreateLoginModal onClose={() => setShowInvite(false)} onCreated={(name) => { setShowInvite(false); void fetchUsers(); toast({ title: `Login created for ${name}` }); }} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSave={() => { setEditUser(null); toast({ title: "User updated" }); }} onDeleted={() => setEditUser(null)} />}
      {goalsUser && <GoalsModal user={goalsUser} onClose={() => setGoalsUser(null)} />}
    </div>
  );
}

function PortalAccessCheckboxes({ value, onChange }: { value: PortalId[]; onChange: (ids: PortalId[]) => void }) {
  function toggle(id: PortalId) {
    onChange(value.includes(id) ? value.filter(p => p !== id) : [...value, id]);
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {PORTALS.map(p => {
        const checked = value.includes(p.id);
        return (
          <label key={p.id} className="flex items-center gap-2.5 cursor-pointer" style={{
            background: checked ? `${p.accent}12` : "var(--sosa-bg-2)",
            border: `0.5px solid ${checked ? p.accent + "50" : "var(--glass-border)"}`,
            borderRadius: 0, padding: "10px 14px", transition: "all 0.15s",
          }}>
            <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} style={{ display: "none" }} />
            <div style={{
              width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? p.accent : "var(--glass-border)"}`,
              background: checked ? p.accent : "transparent", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
            }}>
              {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: checked ? p.accent : "var(--text-secondary)" }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{p.subtitle}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function CreateLoginModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { user: currentUser } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"viewer" | "member" | "admin">("member");
  const [portalAccess, setPortalAccess] = useState<PortalId[]>([]);
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValid = !submitting && name.trim() && emailValid && password.length >= 6 && password === confirmPassword && portalAccess.length > 0;

  const missingFields: string[] = [];
  if (!name.trim())                  missingFields.push("Full name");
  if (!email.trim())                 missingFields.push("Email");
  else if (!emailValid)              missingFields.push("Valid email");
  if (password.length < 6)           missingFields.push("Password (min 6 chars)");
  if (password !== confirmPassword)  missingFields.push("Matching confirm password");
  if (portalAccess.length === 0)     missingFields.push("At least one portal");

  async function handleCreate() {
    setError("");
    if (!name.trim()) { setError("Full name is required."); return; }
    if (!emailValid) { setError("Enter a valid email address."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (portalAccess.length === 0) { setError("Select at least one portal."); return; }
    setSubmitting(true);
    try {
      const auth = await getAuthHeader();
      if (!auth) { setError("Not authenticated. Please log in again."); return; }
      const res = await fetch(`${EDGE_BASE}/create-member`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          displayName: name.trim(),
          role,
          portalSlugs: portalAccess,
        }),
      });
      const text = await res.text();
      let data: { error?: string } = {};
      try { data = text ? JSON.parse(text) as { error?: string } : {}; } catch { /* non-JSON response */ }
      if (!res.ok) { setError(data.error ?? `Request failed (HTTP ${res.status}): ${text.slice(0, 200)}`); return; }
      addAuditEntry({
        userId: currentUser?.id ?? "unknown",
        action: `Created login for ${name.trim()}`,
        category: "admin",
        details: `${email.trim()} — role: ${role}, portals: ${portalAccess.join(", ")}`,
        icon: "○",
      });
      onCreated(name.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Network error: ${msg}. Check Edge Function CORS or connectivity.`);
      console.error("[create-member] fetch failed:", e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="fixed z-[90] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[480px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--sosa-bg-3)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 28 }}>
        <div className="flex items-center justify-between mb-2">
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Create Login</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-quaternary)" }}><X className="w-5 h-5" /></button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 20 }}>
          Create a login directly — no signup form, no email link. The user can log in immediately.
        </p>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Full Name *</label>
            <input className="glass-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Giulia Rossi" style={{ fontSize: 14, padding: "10px 14px" }} autoFocus />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Email *</label>
            <input className="glass-input w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" style={{ fontSize: 14, padding: "10px 14px" }} />
          </div>

          {/* Role */}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Role</label>
            <select className="glass-input w-full" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "member" | "admin")} style={{ fontSize: 13, padding: "8px 12px" }}>
              <option value="viewer">Viewer — read only</option>
              <option value="member">Member — read & contribute</option>
              <option value="admin">Admin — full access except ownership</option>
            </select>
          </div>

          {/* Portal Access */}
          <div style={{ borderTop: "1px solid var(--sosa-border)", paddingTop: 16 }}>
            <div className="flex items-center justify-between mb-3">
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Portal Access</p>
              <button type="button" onClick={() => setPortalAccess(portalAccess.length === ALL_PORTAL_IDS.length ? [] : [...ALL_PORTAL_IDS])}
                style={{ fontSize: 11, color: "var(--portal-accent)", background: "none", border: "none", cursor: "pointer" }}>
                {portalAccess.length === ALL_PORTAL_IDS.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <PortalAccessCheckboxes value={portalAccess} onChange={setPortalAccess} />
          </div>

          {/* Password */}
          <div style={{ borderTop: "1px solid var(--sosa-border)", paddingTop: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Set Password</p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Password *</label>
                <div className="relative">
                  <input className="glass-input w-full" type={showPwd ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 characters" style={{ fontSize: 14, padding: "10px 40px 10px 14px" }} />
                  <button type="button" onClick={() => setShowPwd(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-quaternary)" }}>
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Confirm Password *</label>
                <input className="glass-input w-full" type={showPwd ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat password" style={{ fontSize: 14, padding: "10px 14px" }} />
              </div>
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: "var(--color-error)", background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "8px 12px" }}>{error}</p>
          )}

          {!error && missingFields.length > 0 && (
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              → Missing: {missingFields.join(", ")}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="glass-btn" style={{ fontSize: 13, padding: "8px 18px", borderRadius: 8 }}>Cancel</button>
            <button type="button" onClick={() => void handleCreate()} disabled={submitting} className="glass-btn-primary flex items-center gap-1.5"
              style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8, opacity: isValid ? 1 : 0.55, cursor: submitting ? "wait" : "pointer" }}>
              <UserPlus className="w-3.5 h-3.5" /> {submitting ? "Creating…" : "Create Login"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function EditUserModal({ user, onClose, onSave, onDeleted }: { user: User; onClose: () => void; onSave: () => void; onDeleted: () => void }) {
  const { user: currentUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  function handleResetPassword() {
    setPwdError("");
    if (newPwd !== confirmPwd) { setPwdError("Passwords do not match."); return; }
    const result = resetUserPassword(user.id, newPwd);
    if (!result.success) { setPwdError(result.error ?? "Failed."); return; }
    addAuditEntry({
      userId: currentUser?.id ?? "unknown",
      action: `Reset password for ${user.displayName}`,
      category: "admin",
      details: `Password changed for ${user.email}`,
      icon: "ðŸ”",
    });
    setPwdSuccess(true);
    setNewPwd(""); setConfirmPwd("");
    toast({ title: "Password updated" });
    setTimeout(() => { setPwdSuccess(false); setShowResetPwd(false); }, 1500);
  }

  function handleDelete() {
    const result = deleteUser(user.id);
    if (!result.success) { setDeleteError(result.error ?? "Failed to cancel login."); return; }
    addAuditEntry({
      userId: currentUser?.id ?? "unknown",
      action: `Cancelled login for ${user.displayName}`,
      category: "admin",
      details: `Account ${user.email} removed`,
      icon: "✕",
    });
    toast({ title: `Login for ${user.displayName} cancelled` });
    onDeleted();
  }

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="fixed z-[90] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[460px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--sosa-bg-3)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 24 }}>
        <div className="flex items-center justify-between mb-5">
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Edit: {user.displayName}</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-col gap-4">
          {/* Basic fields */}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Display Name</label>
            <input className="glass-input w-full" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ fontSize: 14, padding: "10px 14px" }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Email</label>
            <input className="glass-input w-full" value={email} onChange={(e) => setEmail(e.target.value)} style={{ fontSize: 14, padding: "10px 14px" }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Role</label>
            <select className="glass-input w-full" value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ fontSize: 13, padding: "8px 12px" }} disabled={user.role === "owner"}>
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="owner" disabled>Owner</option>
            </select>
          </div>

          {/* Reset Password section */}
          <div style={{ borderTop: "1px solid var(--sosa-border)", paddingTop: 14 }}>
            <div className="flex items-center justify-between mb-2">
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Password</p>
              {!showResetPwd && (
                <button type="button" onClick={() => setShowResetPwd(true)}
                  style={{ fontSize: 12, color: "var(--portal-accent)", background: "none", border: "none", cursor: "pointer" }}>
                  Reset Password
                </button>
              )}
            </div>
            {showResetPwd && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>New Password</label>
                  <div className="relative">
                    <input className="glass-input w-full" type={showPwd ? "text" : "password"} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="Min. 6 characters" style={{ fontSize: 14, padding: "10px 40px 10px 14px" }} autoFocus />
                    <button type="button" onClick={() => setShowPwd(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-quaternary)" }}>
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Confirm Password</label>
                  <input className="glass-input w-full" type={showPwd ? "text" : "password"} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="Repeat password" style={{ fontSize: 14, padding: "10px 14px" }} />
                </div>
                {pwdError && <p style={{ fontSize: 12, color: "var(--color-error)", background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "8px 12px" }}>{pwdError}</p>}
                {pwdSuccess && <p style={{ fontSize: 12, color: "var(--color-success)", background: "rgba(34,197,94,0.08)", border: "0.5px solid rgba(34,197,94,0.25)", borderRadius: 8, padding: "8px 12px" }}>Password updated successfully.</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowResetPwd(false); setNewPwd(""); setConfirmPwd(""); setPwdError(""); }} className="glass-btn" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>Cancel</button>
                  <button type="button" onClick={handleResetPassword} disabled={!newPwd || !confirmPwd} className="glass-btn-primary" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, opacity: newPwd && confirmPwd ? 1 : 0.45 }}>Update Password</button>
                </div>
              </div>
            )}
            {!showResetPwd && (
              <p style={{ fontSize: 12, color: "var(--text-quaternary)" }}>Click "Reset Password" to set a new password for this user.</p>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="glass-btn" style={{ fontSize: 13, padding: "8px 18px", borderRadius: 8 }}>Cancel</button>
            <button type="button" onClick={onSave} className="glass-btn-primary" style={{ fontSize: 13, padding: "8px 18px", borderRadius: 8 }}>Save Changes</button>
          </div>

          {/* Cancel Login section */}
          {user.role !== "owner" && (
            <div style={{ borderTop: "0.5px solid rgba(239,68,68,0.2)", paddingTop: 14, marginTop: 4 }}>
              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} style={{ fontSize: 12, color: "var(--color-error)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <Trash2 className="w-3.5 h-3.5" /> Cancel Login
                </button>
              ) : (
                <div style={{ background: "rgba(239,68,68,0.06)", border: "0.5px solid rgba(239,68,68,0.3)", borderRadius: 0, padding: "14px" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-error)", marginBottom: 6 }}>Cancel this login?</p>
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 12 }}>
                    This will permanently remove <strong>{user.displayName}</strong>'s account. They will no longer be able to log in.
                  </p>
                  {deleteError && <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 10 }}>{deleteError}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmDelete(false)} className="glass-btn" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>Keep Account</button>
                    <button type="button" onClick={handleDelete} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, background: "var(--color-error)", color: "white", border: "none", cursor: "pointer", fontWeight: 600 }}>Yes, Cancel Login</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* â”€â”€ Goals Modal â”€â”€ */
function GoalsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [goals, setGoals] = useState<Goal[]>(MOCK_GOALS.filter((g) => g.userId === user.id));
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTarget, setNewTarget] = useState("5");
  const [newCurrent, setNewCurrent] = useState("0");
  const [newDue, setNewDue] = useState("");
  const { toast } = useToast();

  const addGoal = () => {
    if (!newTitle.trim()) return;
    const t = parseInt(newTarget) || 1;
    const c = parseInt(newCurrent) || 0;
    setGoals((prev) => [...prev, {
      id: `g_${Date.now()}`, userId: user.id, title: newTitle.trim(), progress: Math.round((c / t) * 100),
      target: newTarget, current: newCurrent, dueDate: newDue ? new Date(newDue) : new Date(),
      setBy: "usr_001", quarter: "Q1 2025", completed: false,
    }]);
    setNewTitle(""); setNewTarget("5"); setNewCurrent("0"); setNewDue(""); setShowAdd(false);
    toast({ title: "Goal created" });
  };

  const deleteGoal = (id: string) => setGoals((prev) => prev.filter((g) => g.id !== id));

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="fixed z-[90] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[520px] max-h-[85vh] overflow-y-auto"
        style={{ background: "var(--sosa-bg-3)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 24 }}>
        <div className="flex items-center justify-between mb-5">
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Goals for {user.displayName}</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X className="w-5 h-5" /></button>
        </div>

        <div className="flex flex-col gap-3 mb-4">
          {goals.map((g) => (
            <div key={g.id} style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 14 }}>
              <div className="flex items-start justify-between mb-2">
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>ðŸŽ¯ {g.title}</span>
                <button type="button" onClick={() => deleteGoal(g.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)", padding: 2 }}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>Progress: {g.current || g.progress}%{g.target ? ` / ${g.target}` : ""}</span>
                  <span style={{ fontSize: 11, color: g.completed ? "var(--color-success)" : "var(--text-quaternary)" }}>{g.completed ? "âœ“ Complete" : `${g.progress}%`}</span>
                </div>
                <Progress value={g.progress} className="h-1.5" />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>Due: {format(g.dueDate, "MMM d, yyyy")}</span>
            </div>
          ))}
          {goals.length === 0 && <p style={{ fontSize: 13, color: "var(--text-quaternary)", textAlign: "center", padding: 20 }}>No goals set</p>}
        </div>

        {!showAdd ? (
          <button type="button" onClick={() => setShowAdd(true)} className="glass-btn-primary flex items-center gap-1.5 w-full justify-center" style={{ fontSize: 13, padding: "8px 14px", borderRadius: 8 }}>
            <Plus className="w-4 h-4" /> Add New Goal
          </button>
        ) : (
          <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 14 }}>
            <div className="flex flex-col gap-3">
              <input className="glass-input w-full" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Goal title" style={{ fontSize: 13, padding: "8px 12px" }} autoFocus />
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label style={{ fontSize: 11, color: "var(--text-quaternary)" }}>Target</label>
                  <input className="glass-input w-full" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }} />
                </div>
                <div className="flex flex-col gap-1">
                  <label style={{ fontSize: 11, color: "var(--text-quaternary)" }}>Current</label>
                  <input className="glass-input w-full" value={newCurrent} onChange={(e) => setNewCurrent(e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }} />
                </div>
                <div className="flex flex-col gap-1">
                  <label style={{ fontSize: 11, color: "var(--text-quaternary)" }}>Due Date</label>
                  <input type="date" className="glass-input w-full" value={newDue} onChange={(e) => setNewDue(e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowAdd(false)} className="glass-btn" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6 }}>Cancel</button>
                <button type="button" onClick={addGoal} disabled={!newTitle.trim()} className="glass-btn-primary" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, opacity: newTitle.trim() ? 1 : 0.5 }}>Create Goal</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* â”€â”€ Roles Tab â”€â”€ */
function RolesTab() {
  const resources = [
    { name: "Finance", owner: "Full", admin: "Full", manager: "View", member: "—" },
    { name: "Tasks", owner: "Full", admin: "Full", manager: "Team", member: "Own" },
    { name: "Cloud", owner: "Full", admin: "Full", manager: "Write", member: "Read" },
    { name: "Vault", owner: "Full", admin: "View", manager: "—", member: "—" },
    { name: "Notes", owner: "All users", admin: "Own only", manager: "Own", member: "Own" },
    { name: "Profiles", owner: "All users", admin: "View all", manager: "Team", member: "Own" },
    { name: "Goals", owner: "Create/Edit", admin: "View", manager: "View", member: "View own" },
    { name: "Fiscal", owner: "All users", admin: "—", manager: "—", member: "Own" },
    { name: "Admin", owner: "Full", admin: "Limited", manager: "—", member: "—" },
  ];

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Roles & Permissions</h3>
      <div className="overflow-x-auto" style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 14 }}>
        <table className="w-full" style={{ minWidth: 500 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--sosa-border)" }}>
              <th style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "12px 16px", textAlign: "left" }}>Resource</th>
              <th style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "12px 16px", textAlign: "center" }}>ðŸ‘‘ Owner</th>
              <th style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "12px 16px", textAlign: "center" }}>ðŸ”§ Admin</th>
              <th style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "12px 16px", textAlign: "center" }}>ðŸ‘¥ Manager</th>
              <th style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "12px 16px", textAlign: "center" }}>ðŸ‘¤ Member</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.name} style={{ borderBottom: "1px solid var(--sosa-border)" }}>
                <td style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", padding: "10px 16px" }}>{r.name}</td>
                {[r.owner, r.admin, r.manager, r.member].map((val, i) => (
                  <td key={i} style={{ fontSize: 12, color: val === "—" ? "var(--text-quaternary)" : val === "Full" ? "var(--color-success)" : "var(--text-tertiary)", padding: "10px 16px", textAlign: "center", fontWeight: val === "Full" ? 600 : 400 }}>
                    {val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-quaternary)", marginTop: 12 }}>
        â“˜ Only Owners can modify role assignments and permissions.
      </p>
    </div>
  );
}

/* â”€â”€ Audit Log Tab â”€â”€ */
function AuditLogTab() {
  const [log, setLog] = useState(() => getAuditLog());
  useEffect(() => subscribeAudit(() => setLog([...getAuditLog()])), []);
  const [dateFilter, setDateFilter] = useState("7");
  const [userFilter, setUserFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");

  const cutoff = subDays(new Date(), parseInt(dateFilter));

  const filtered = useMemo(() => {
    let list = log.filter((e) => e.timestamp >= cutoff);
    if (userFilter) list = list.filter((e) => e.userId === userFilter);
    if (catFilter) list = list.filter((e) => e.category === catFilter);
    return list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [log, cutoff, userFilter, catFilter]);

  // Group by day
  const grouped = useMemo(() => {
    const groups: { label: string; entries: AuditLogEntry[] }[] = [];
    let currentLabel = "";
    filtered.forEach((e) => {
      const label = isToday(e.timestamp) ? "Today" : isYesterday(e.timestamp) ? "Yesterday" : format(e.timestamp, "EEEE, MMM d");
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, entries: [] });
      }
      groups[groups.length - 1].entries.push(e);
    });
    return groups;
  }, [filtered]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Audit Log</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="glass-input" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="365">All time</option>
          </select>
          <select className="glass-input" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
            <option value="">All users</option>
            {portalUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
          <select className="glass-input" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
            <option value="">All actions</option>
            <option value="auth">Auth</option>
            <option value="vault">Vault</option>
            <option value="cloud">Cloud</option>
            <option value="tasks">Tasks</option>
            <option value="admin">Admin</option>
            <option value="profile">Profile</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {grouped.map((group) => (
          <div key={group.label}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--text-tertiary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>{group.label}</h4>
            <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, overflow: "hidden" }}>
              {group.entries.map((entry, i) => {
                const author = getUserById(entry.userId);
                return (
                  <div key={entry.id} className="flex items-center gap-3 transition-colors"
                    style={{ padding: "10px 16px", borderBottom: i < group.entries.length - 1 ? "1px solid var(--sosa-border)" : "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--nav-hover-bg)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{entry.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
                        <strong>{author?.displayName}</strong> {entry.action}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-quaternary)", flexShrink: 0 }}>{format(entry.timestamp, "HH:mm")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {grouped.length === 0 && <p style={{ fontSize: 13, color: "var(--text-quaternary)", textAlign: "center", padding: 32 }}>No log entries found</p>}
      </div>
    </div>
  );
}

/* â”€â”€ Company Tab â”€â”€ */
function CompanyTab() {
  const [settings, setSettings] = useState<CompanySettings>(INITIAL_COMPANY_SETTINGS);
  const { toast } = useToast();
  const update = (key: keyof CompanySettings, value: string) => setSettings((prev) => ({ ...prev, [key]: value }));

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Company Settings</h3>
      <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 20 }}>
        <div className="flex flex-col gap-4 max-w-md">
          {([
            { key: "name" as const, label: "Company Name", type: "text" },
          ] as const).map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{label}</label>
              <input className="glass-input w-full" value={settings[key] as string} onChange={(e) => update(key, e.target.value)} style={{ fontSize: 14, padding: "10px 14px" }} />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Timezone</label>
            <select className="glass-input w-full" value={settings.timezone} onChange={(e) => update("timezone", e.target.value)} style={{ fontSize: 13, padding: "8px 12px" }}>
              <option>Europe/Rome</option><option>Europe/London</option><option>America/New_York</option><option>Asia/Tokyo</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Language</label>
            <select className="glass-input w-full" value={settings.language} onChange={(e) => update("language", e.target.value)} style={{ fontSize: 13, padding: "8px 12px" }}>
              <option>Italiano</option><option>English</option><option>Deutsch</option><option>FranÃ§ais</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Date Format</label>
            <select className="glass-input w-full" value={settings.dateFormat} onChange={(e) => update("dateFormat", e.target.value)} style={{ fontSize: 13, padding: "8px 12px" }}>
              <option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option>
            </select>
          </div>

          <div style={{ borderTop: "1px solid var(--sosa-border)", paddingTop: 12, marginTop: 4 }}>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Storage Quota</span>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{settings.storageQuotaGb} GB</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>User Seats</span>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{portalUsers.length} of {settings.maxUsers}</span>
            </div>
          </div>

          <button type="button" onClick={() => toast({ title: "Settings saved" })} className="glass-btn-primary self-start" style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8, marginTop: 8 }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* â”€â”€ Security Tab â”€â”€ */
function SecurityTab() {
  const [settings, setSettings] = useState<SecuritySettings>(INITIAL_SECURITY_SETTINGS);
  const [vaultPassword, setVaultPassword] = useState("");
  const { toast } = useToast();

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Security Settings</h3>
      <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 20 }}>
        <div className="flex flex-col gap-6 max-w-md">
          {/* Password Policy */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10 }}>Password Policy</h4>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Minimum length</span>
                <select className="glass-input" value={settings.minPasswordLength} onChange={(e) => setSettings((p) => ({ ...p, minPasswordLength: parseInt(e.target.value) }))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
                  {[6, 8, 10, 12].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              {([
                { key: "requireUppercase" as const, label: "Require uppercase" },
                { key: "requireNumber" as const, label: "Require number" },
                { key: "requireSpecialChar" as const, label: "Require special character" },
              ]).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
                  <button type="button" onClick={() => setSettings((p) => ({ ...p, [key]: !p[key] }))}
                    style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, border: "none", cursor: "pointer", background: settings[key] ? "rgba(34,197,94,0.15)" : "var(--sosa-bg-2)", color: settings[key] ? "var(--color-success)" : "var(--text-quaternary)", fontWeight: 600, outline: "1px solid var(--sosa-border)" }}>
                    {settings[key] ? "ON" : "OFF"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Session */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10 }}>Session</h4>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Session timeout</span>
                <select className="glass-input" value={settings.sessionTimeoutMin} onChange={(e) => setSettings((p) => ({ ...p, sessionTimeoutMin: parseInt(e.target.value) }))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
                  {[15, 30, 60, 120].map((v) => <option key={v} value={v}>{v} min</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Max active sessions</span>
                <select className="glass-input" value={settings.maxActiveSessions} onChange={(e) => setSettings((p) => ({ ...p, maxActiveSessions: parseInt(e.target.value) }))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
                  {[1, 2, 3, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Vault */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10 }}>Vault Locked Folder</h4>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input type="password" className="glass-input flex-1" value={vaultPassword} onChange={(e) => setVaultPassword(e.target.value)} placeholder="New password" style={{ fontSize: 13, padding: "8px 12px" }} />
                <button type="button" onClick={() => { setVaultPassword(""); toast({ title: "Password updated" }); }} className="glass-btn" style={{ fontSize: 12, padding: "8px 14px", borderRadius: 8 }}>Change</button>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Auto-lock after</span>
                <select className="glass-input" value={settings.vaultAutoLockMin} onChange={(e) => setSettings((p) => ({ ...p, vaultAutoLockMin: parseInt(e.target.value) }))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
                  {[5, 10, 15, 30].map((v) => <option key={v} value={v}>{v} min</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Max failed attempts</span>
                <select className="glass-input" value={settings.vaultMaxFailedAttempts} onChange={(e) => setSettings((p) => ({ ...p, vaultMaxFailedAttempts: parseInt(e.target.value) }))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, width: "auto" }}>
                  {[3, 5, 10].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* MFA */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10 }}>Two-Factor Authentication</h4>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Require MFA for all users</span>
              <button type="button" onClick={() => setSettings((p) => ({ ...p, requireMfa: !p.requireMfa }))}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, border: "none", cursor: "pointer", background: settings.requireMfa ? "rgba(34,197,94,0.15)" : "var(--sosa-bg-2)", color: settings.requireMfa ? "var(--color-success)" : "var(--text-quaternary)", fontWeight: 600, outline: "1px solid var(--sosa-border)" }}>
                {settings.requireMfa ? "ON" : "OFF"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 4 }}>Future feature</p>
          </div>

          <button type="button" onClick={() => toast({ title: "Security settings saved" })} className="glass-btn-primary self-start" style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8 }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* â”€â”€ Main Page â”€â”€ */
const AdministrationPage = () => {
  const { isOwner } = usePortalDB();
  const { users: portalUsers } = usePortalUsers();
  const [tab, setTab] = useState<AdminTab>("users");

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode; ownerOnly: boolean }[] = [
    { key: "users", label: "Users", icon: <Users className="w-3.5 h-3.5" />, ownerOnly: false },
    { key: "roles", label: "Roles", icon: <Shield className="w-3.5 h-3.5" />, ownerOnly: false },
    { key: "audit", label: "Audit Log", icon: <ScrollText className="w-3.5 h-3.5" />, ownerOnly: false },
    { key: "company", label: "Company", icon: <Building2 className="w-3.5 h-3.5" />, ownerOnly: true },
    { key: "security", label: "Security", icon: <Lock className="w-3.5 h-3.5" />, ownerOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.ownerOnly || isOwner);

  return (
    <ProtectedPage permission="admin:access">
      <div className="flex flex-col gap-4">
        <h1 className="flex items-center gap-2" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
          <ShieldCheck className="w-5 h-5" /> Administration
        </h1>

        {/* Tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {visibleTabs.map((t) => (
            <button type="button" key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-1.5"
              style={{
                fontSize: 12, padding: "7px 16px", borderRadius: 99, border: "none", cursor: "pointer",
                background: tab === t.key ? "var(--sosa-bg-3)" : "var(--sosa-bg-2)",
                color: tab === t.key ? "var(--portal-accent)" : "var(--text-tertiary)",
                fontWeight: tab === t.key ? 600 : 400,
                outline: tab === t.key ? "1px solid var(--accent-color)" : "1px solid var(--sosa-border)",
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "users" && <UsersTab isOwner={isOwner} />}
        {tab === "roles" && <RolesTab />}
        {tab === "audit" && <AuditLogTab />}
        {tab === "company" && isOwner && <CompanyTab />}
        {tab === "security" && isOwner && <SecurityTab />}
      </div>
    </ProtectedPage>
  );
};

export default AdministrationPage;

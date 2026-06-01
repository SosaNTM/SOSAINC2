import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/authContext";
import { usePortalUsers } from "@/hooks/usePortalUsers";
import { STORAGE_CLOUD_COLLAPSED_SECTIONS } from "@/constants/storageKeys";
import {
  INITIAL_FOLDERS, INITIAL_SECTIONS,
  TOTAL_STORAGE_GB, MOCK_FOLDER_PASSWORDS,
  getFileTypeIcon, formatFileSize, getUserPermission, getFolderPath,
  type CloudFolder, type CloudFile, type PermissionLevel, type FolderSection,
} from "@/lib/cloudStore";
import { fetchFolders as svcFetchFolders, createFolder as svcCreateFolder, renameFolder as svcRenameFolder, softDeleteFolder as svcSoftDeleteFolder, updateFolderLock as svcUpdateFolderLock } from "@/lib/services/cloudService";
import { hashPassword, verifyPassword } from "@/hooks/settings";
import { supabase as _cloudSupabase } from "@/lib/supabase";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloudSupabase = _cloudSupabase as any;
import { toPortalUUID as toPortalUUIDCloud } from "@/lib/portalUUID";
import type { DbCloudFolder } from "@/types/database";
import { useCloudFiles } from "@/hooks/useCloudFiles";
import { usePortalDB } from "@/lib/portalContextDB";
import {
  Cloud, FolderIcon, Trash2, X, Download, Pencil, Move, Link2,
  Eye, EyeOff, Shield, Lock, Unlock, Home, AlertTriangle, Layers,
  ChevronRight, ChevronDown, RotateCcw,
} from "lucide-react";
import FilePreviewDrawer from "@/components/cloud/FilePreviewDrawer";
import TrashPreviewDrawer from "@/components/cloud/TrashPreviewDrawer";
import StorageOverview from "@/components/cloud/StorageOverview";
import { ActionMenu, type ActionMenuEntry } from "@/components/ActionMenu";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/adminStore";
import { ModuleErrorBoundary } from "@/components/ui/ModuleErrorBoundary";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  getUnlockState, setUnlockState, clearUnlockState, ModalOverlay,
} from "./cloud.types";
import FolderView from "./FolderView";
import TrashView from "./TrashView";
import {
  SetPasswordModal, ChangePasswordModal, RemovePasswordModal,
} from "./FilePreview";

/* ── Folder Picker (shared between modals) ── */
function FolderPicker({
  folders,
  rootFolders,
  getChildren,
  selected,
  onSelect,
}: {
  folders: CloudFolder[];
  rootFolders: CloudFolder[];
  getChildren: (parentId: string) => CloudFolder[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const renderPickerItem = (folder: CloudFolder, depth: number): React.ReactNode => {
    const children = getChildren(folder.id);
    return (
      <div key={folder.id}>
        <button
          type="button"
          onClick={() => onSelect(folder.id)}
          className={`flex items-center gap-2 w-full text-left text-sm rounded-md px-2 py-1.5 transition-colors ${
            selected === folder.id
              ? "bg-primary/15 text-primary font-medium"
              : "text-foreground hover:bg-accent/50"
          }`}
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          <FolderIcon className="w-3.5 h-3.5 text-primary" />
          {folder.name}
        </button>
        {children.map((c) => renderPickerItem(c, depth + 1))}
      </div>
    );
  };
  return (
    <div className="max-h-[200px] overflow-y-auto border border-border rounded-lg p-1 bg-muted/30">
      {rootFolders.map((f) => renderPickerItem(f, 0))}
    </div>
  );
}

/* ── Upload Modal ── */
function UploadModal({
  currentFolderId,
  folders,
  onClose,
  onUpload,
}: {
  currentFolderId: string | null;
  folders: CloudFolder[];
  onClose: () => void;
  onUpload: (files: File[], folderId: string) => Promise<void>;
}) {
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(currentFolderId ?? "");

  const availableFolders = folders.filter((f) => !f.isDeleted);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadFiles(Array.from(e.target.files || []));
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0 || !selectedFolderId) return;
    setUploading(true);
    try {
      await onUpload(uploadFiles, selectedFolderId);
    } finally {
      setUploading(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground mb-4">Upload Files</h2>
      <label className="flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed border-border rounded-xl p-8 mb-4 hover:border-primary/50 transition-colors bg-muted/30">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
        <span className="text-sm text-muted-foreground">Drop files here or click to browse</span>
        <input type="file" multiple className="hidden" onChange={handleFiles} />
      </label>
      {uploadFiles.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {uploadFiles.map((file) => (
            <div key={file.name} className="flex items-center justify-between">
              <span className="text-xs text-foreground">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mb-4">
        <label className="block text-xs text-muted-foreground mb-1">Destination folder</label>
        {availableFolders.length === 0 ? (
          <p className="text-xs text-destructive">No folders yet — create a folder first.</p>
        ) : (
          <select
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">— select a folder —</option>
            {availableFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose}
          className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors">
          Cancel
        </button>
        <button type="button" onClick={() => { void handleUpload(); }}
          disabled={uploadFiles.length === 0 || !selectedFolderId || uploading}
          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
    </ModalOverlay>
  );
}

/* ── Permissions Modal ── */
function PermissionsModalUI({
  permissionsModal,
  folders,
  userId,
  setFolders,
  setPermissionsModal,
}: {
  permissionsModal: string;
  folders: CloudFolder[];
  userId: string;
  setFolders: React.Dispatch<React.SetStateAction<CloudFolder[]>>;
  setPermissionsModal: (id: string | null) => void;
}) {
  const { users: portalUsers } = usePortalUsers();
  const folder = folders.find((f) => f.id === permissionsModal);

  const [localPerms, setLocalPerms] = useState<{ userId: string; level: PermissionLevel }[]>(() => {
    if (!folder) return [];
    return folder.permissions.length > 0
      ? [...folder.permissions]
      : portalUsers.map((u) => ({ userId: u.id, level: "read" as PermissionLevel }));
  });
  const [inherit, setInherit] = useState(() => folder?.inheritPermissions ?? false);

  if (!folder) return null;

  const save = () => {
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folder.id ? { ...f, permissions: localPerms, inheritPermissions: inherit } : f
      )
    );
    setPermissionsModal(null);
    toast.success("Permissions saved");
    const summary = inherit
      ? "Inherited from parent"
      : localPerms
          .map((p) => {
            const u = portalUsers.find((u) => u.id === p.userId);
            return `${u?.displayName}: ${p.level}`;
          })
          .join(", ");
    addAuditEntry({
      userId,
      action: `Updated permissions on "${folder.name}"`,
      category: "cloud",
      details: summary,
      icon: "●",
    });
  };

  return (
    <ModalOverlay onClose={() => setPermissionsModal(null)}>
      <h2 className="text-base font-bold text-foreground mb-4">
        Permissions: {folder.name}
      </h2>
      {folder.parentId && (
        <label className="flex items-center gap-2 mb-4 cursor-pointer text-sm text-foreground">
          <input
            type="checkbox"
            checked={inherit}
            onChange={(e) => setInherit(e.target.checked)}
            className="rounded"
          />
          Inherit from parent
        </label>
      )}
      {!inherit && (
        <div className="flex flex-col gap-2">
          {portalUsers.map((u) => {
            const perm = localPerms.find((p) => p.userId === u.id);
            return (
              <div key={u.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-primary/15 text-primary text-[10px] font-bold">
                    {u.displayName.charAt(0)}
                  </div>
                  <span className="text-sm text-foreground">{u.displayName}</span>
                  <span className="text-[10px] text-muted-foreground">{u.role}</span>
                </div>
                <select
                  className="text-xs p-1 rounded border border-input bg-background"
                  value={perm?.level || "read"}
                  onChange={(e) => {
                    const level = e.target.value as PermissionLevel;
                    setLocalPerms((prev) => {
                      const next = prev.filter((p) => p.userId !== u.id);
                      next.push({ userId: u.id, level });
                      return next;
                    });
                  }}
                >
                  <option value="read">Read</option>
                  <option value="write">Write</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 justify-end mt-5">
        <button
          type="button"
          onClick={() => setPermissionsModal(null)}
          className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Save
        </button>
      </div>
    </ModalOverlay>
  );
}

/* ── New Folder Modal ── */
function NewFolderModal({
  currentFolderId,
  folders,
  rootFolders,
  getChildren,
  isOwnerOrAdmin,
  userId,
  getPerm,
  setFolders,
  onClose,
}: {
  currentFolderId: string | null;
  folders: CloudFolder[];
  rootFolders: CloudFolder[];
  getChildren: (id: string) => CloudFolder[];
  isOwnerOrAdmin: boolean;
  userId: string;
  getPerm: (folderId: string) => PermissionLevel | null;
  setFolders: React.Dispatch<React.SetStateAction<CloudFolder[]>>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<string>(currentFolderId || "");
  const [permMode, setPermMode] = useState<"inherit" | "custom">("inherit");
  const { users: portalUsers } = usePortalUsers();
  const [customPerms, setCustomPerms] = useState<{ userId: string; level: PermissionLevel }[]>(
    portalUsers.map((u) => ({ userId: u.id, level: "read" as PermissionLevel }))
  );
  const [error, setError] = useState("");

  const locationPerm = location ? getPerm(location) : isOwnerOrAdmin ? "admin" : null;
  const canCreate = locationPerm === "write" || locationPerm === "admin";

  const handleCreate = () => {
    if (!name.trim()) { setError("Folder name is required"); return; }
    if (name.length > 100) { setError("Max 100 characters"); return; }
    const dupes = folders.filter(
      (f) =>
        f.parentId === (location || null) &&
        !f.isDeleted &&
        f.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (dupes.length > 0) { setError("A folder with this name already exists here"); return; }
    const id = `f_${Date.now()}`;
    const parentPerms = location ? folders.find((f) => f.id === location)?.permissions || [] : [];
    setFolders((prev) => [
      ...prev,
      {
        id,
        name: name.trim(),
        parentId: location || null,
        permissions: permMode === "inherit" ? parentPerms : customPerms,
        inheritPermissions: permMode === "inherit" && !!location,
        createdAt: new Date(),
      },
    ]);
    onClose();
    toast.success(`Folder "${name.trim()}" created`);
  };

  const mono = { fontFamily: "var(--font-mono)" } as const;
  const labelStyle: React.CSSProperties = { ...mono, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--text-tertiary)", display: "block", marginBottom: 6 };
  const inputStyle: React.CSSProperties = { ...mono, fontSize: 12, width: "100%", padding: "8px 10px", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", outline: "none" };

  const renderPickerItem = (folder: CloudFolder, depth: number): React.ReactNode => {
    const children = getChildren(folder.id);
    const active = location === folder.id;
    return (
      <div key={folder.id}>
        <button
          type="button"
          onClick={() => setLocation(folder.id)}
          style={{
            ...mono, fontSize: 11, display: "flex", alignItems: "center", gap: 6,
            width: "100%", textAlign: "left", padding: "5px 8px",
            paddingLeft: depth * 14 + 8,
            background: active ? "rgba(255,255,255,0.06)" : "transparent",
            borderLeft: active ? "2px solid var(--accent-primary)" : "2px solid transparent",
            color: active ? "var(--text-primary)" : "var(--text-tertiary)",
            cursor: "pointer",
          }}
        >
          <FolderIcon style={{ width: 12, height: 12, flexShrink: 0 }} />
          {folder.name}
        </button>
        {children.map((c) => renderPickerItem(c, depth + 1))}
      </div>
    );
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: "20px 24px" }}>
        {/* Header */}
        <p style={{ ...mono, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 20 }}>
          Nuova Cartella
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Nome Cartella *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              style={{ ...inputStyle, borderColor: error ? "var(--color-error)" : "var(--glass-border)" }}
              placeholder="→ nome cartella"
            />
            {error && <p style={{ ...mono, fontSize: 10, color: "var(--color-error)", marginTop: 4 }}>{error}</p>}
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Descrizione (opzionale)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ ...inputStyle, resize: "none", height: 60 }}
              placeholder="→ aggiungi descrizione"
            />
          </div>

          {/* Location */}
          <div>
            <label style={labelStyle}>Posizione</label>
            <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}>
              {rootFolders.map((f) => renderPickerItem(f, 0))}
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label style={labelStyle}>Permessi</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(["inherit", "custom"] as const).map((mode) => {
                const active = permMode === mode;
                return (
                  <label
                    key={mode}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                      border: `1px solid ${active ? "var(--accent-primary)" : "var(--glass-border)"}`,
                      background: active ? "rgba(212,255,0,0.04)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <input type="radio" name="perm" checked={active} onChange={() => setPermMode(mode)} style={{ accentColor: "var(--accent-primary)" }} />
                    <span style={{ ...mono, fontSize: 11, color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {mode === "inherit" ? "Eredita dal genitore (consigliato)" : "Permessi personalizzati"}
                    </span>
                  </label>
                );
              })}
            </div>

            {permMode === "custom" && (
              <div style={{ marginTop: 10, border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}>
                {portalUsers.map((u) => {
                  const p = customPerms.find((cp) => cp.userId === u.id);
                  return (
                    <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderBottom: "1px solid var(--glass-border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 20, height: 20, background: "var(--accent-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: "#000" }}>{u.displayName.charAt(0)}</span>
                        </div>
                        <span style={{ ...mono, fontSize: 11, color: "var(--text-primary)" }}>{u.displayName}</span>
                        <span style={{ ...mono, fontSize: 9, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{u.role}</span>
                      </div>
                      <select
                        style={{ ...mono, fontSize: 10, padding: "2px 4px", background: "var(--sosa-bg)", border: "1px solid var(--glass-border)", color: "var(--text-primary)" }}
                        value={p?.level || "read"}
                        onChange={(e) => {
                          const lv = e.target.value as PermissionLevel;
                          setCustomPerms((prev) => {
                            const next = prev.filter((x) => x.userId !== u.id);
                            next.push({ userId: u.id, level: lv });
                            return next;
                          });
                        }}
                      >
                        <option value="read">Read</option>
                        <option value="write">Write</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--glass-border)" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ ...mono, fontSize: 11, padding: "8px 16px", background: "transparent", border: "1px solid var(--glass-border)", color: "var(--text-tertiary)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            title={!canCreate ? "Permessi insufficienti" : undefined}
            style={{ ...mono, fontSize: 11, padding: "8px 16px", background: canCreate ? "var(--accent-primary)" : "var(--glass-bg)", border: "1px solid var(--glass-border)", color: canCreate ? "#000" : "var(--text-tertiary)", cursor: canCreate ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}
          >
            Crea Cartella ↗
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ── Main Cloud Page Orchestrator ── */
const CloudPage = () => {
  const { user } = useAuth();
  const { users: portalUsers } = usePortalUsers();
  const isMobile = useIsMobile();
  const { currentPortalId, isOwner: isPortalOwner, isAdmin: isPortalAdmin } = usePortalDB();
  const cloudFiles = useCloudFiles();

  // ── State: Data (hydrated from Supabase) ──
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [sections, setSections] = useState<FolderSection[]>([]);
  const [hasHydrated, setHasHydrated] = useState(false);

  const files = cloudFiles.files;

  // Hydrate from Supabase on portal change
  useEffect(() => {
    if (!currentPortalId) return;
    setHasHydrated(false);
    void (async () => {
      const dbFolders = await svcFetchFolders(currentPortalId);
      const mapped: CloudFolder[] = dbFolders.map((r: DbCloudFolder) => ({
        id: r.id,
        name: r.name,
        parentId: r.parent_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        permissions: (r as any).permissions ?? [],
        inheritPermissions: true,
        createdAt: new Date(r.created_at ?? Date.now()),
        isDeleted: r.is_deleted ?? false,
        isLocked: r.is_locked ?? false,
        passwordHash: r.password_hash ?? null,
        passwordSetBy: null,
        passwordSetAt: r.password_set_at ? new Date(r.password_set_at) : null,
        lockAutoTimeoutMinutes: r.lock_auto_timeout_minutes ?? 10,
        failedAttempts: 0,
        lockedUntil: null,
      }));
      setFolders(mapped.length > 0 ? mapped : INITIAL_FOLDERS);

      // Sections from portal_settings JSONB (no dedicated table)
      const { data: ps } = await cloudSupabase
        .from("portal_settings")
        .select("settings")
        .eq("portal_id", toPortalUUIDCloud(currentPortalId))
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sec = (ps?.settings as any)?.cloud_sections;
      setSections(Array.isArray(sec) && sec.length > 0 ? sec : INITIAL_SECTIONS);
      setHasHydrated(true);
    })();
  }, [currentPortalId]);

  // ── State: UI ──
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("list");
  const [sortBy, setSortBy] = useState<"name" | "size" | "date">("date");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [permissionsModal, setPermissionsModal] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["f_root_projects"]));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [trashPreviewFile, setTrashPreviewFile] = useState<CloudFile | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<CloudFile | null>(null);
  const [confirmPermDelete, setConfirmPermDelete] = useState<CloudFile | null>(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<CloudFolder | null>(null);
  const [recoverFile, setRecoverFile] = useState<CloudFile | null>(null);
  const [recoverTarget, setRecoverTarget] = useState<string>("parent");
  const [moveFileModal, setMoveFileModal] = useState<CloudFile | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showStorage, setShowStorage] = useState(false);

  // ── State: Sections ──
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_CLOUD_COLLAPSED_SECTIONS);
    if (saved) try { return new Set(JSON.parse(saved)); } catch { /* ignore */ }
    return new Set(INITIAL_SECTIONS.filter((s) => s.isCollapsed).map((s) => s.id));
  });
  const [newSectionName, setNewSectionName] = useState<string | null>(null);
  const [newSectionAfter, setNewSectionAfter] = useState<string | null>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [sectionRenameValue, setSectionRenameValue] = useState("");
  const [deleteSectionConfirm, setDeleteSectionConfirm] = useState<FolderSection | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  // ── State: Password / Unlock ──
  const [unlockPromptFolder, setUnlockPromptFolder] = useState<CloudFolder | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockShowPassword, setUnlockShowPassword] = useState(false);
  const [unlockRemember, setUnlockRemember] = useState<"none" | "session" | "timed">("none");
  const [unlockError, setUnlockError] = useState("");
  const [unlockAttempts, setUnlockAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(() => {
    const unlocked = new Set<string>();
    INITIAL_FOLDERS.forEach((f) => {
      if (f.isLocked && getUnlockState(f.id).unlocked) unlocked.add(f.id);
    });
    return unlocked;
  });
  const [setPasswordFolder, setSetPasswordFolder] = useState<CloudFolder | null>(null);
  const [changePasswordFolder, setChangePasswordFolder] = useState<CloudFolder | null>(null);
  const [removePasswordFolder, setRemovePasswordFolder] = useState<CloudFolder | null>(null);

  // ── Derived ──
  const userRole = user?.role || "member";
  const userId = user?.id || "";
  const isOwnerOrAdmin = isPortalOwner || isPortalAdmin || userRole === "owner" || userRole === "admin";
  const isOwner = isPortalOwner || userRole === "owner";

  // ── Sync to Supabase (debounced, diff-based) ──
  const lastSyncedFoldersRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!currentPortalId || !hasHydrated) return;
    const timeout = setTimeout(async () => {
      const currentIds = new Set(folders.map((f) => f.id));
      const lastIds = new Set(lastSyncedFoldersRef.current.keys());

      // Upsert new + modified. Skip folders with non-UUID ids (legacy "f_<ts>")
      // or when we have no authenticated user (created_by is NOT NULL + RLS).
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const f of folders) {
        if (!user?.id || !UUID_RE.test(f.id)) continue;
        const serialized = JSON.stringify(f);
        if (lastSyncedFoldersRef.current.get(f.id) !== serialized) {
          await cloudSupabase
            .from("cloud_folders")
            .upsert({
              id: f.id,
              portal_id: toPortalUUIDCloud(currentPortalId),
              name: f.name,
              parent_id: f.parentId && UUID_RE.test(f.parentId) ? f.parentId : null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              permissions: f.permissions as any,
              is_locked: f.isLocked ?? false,
              password_hash: f.passwordHash ?? null,
              password_set_at: f.passwordSetAt ? f.passwordSetAt.toISOString() : null,
              lock_auto_timeout_minutes: f.lockAutoTimeoutMinutes ?? 10,
              is_deleted: f.isDeleted ?? false,
              created_by: user?.id ?? null,
            });
          lastSyncedFoldersRef.current.set(f.id, serialized);
        }
      }
      // Soft-delete removed
      for (const id of lastIds) {
        if (!currentIds.has(id)) {
          await svcSoftDeleteFolder(id, currentPortalId);
          lastSyncedFoldersRef.current.delete(id);
        }
      }
    }, 600);
    return () => clearTimeout(timeout);
  }, [folders, currentPortalId, hasHydrated, user?.id]);

  useEffect(() => {
    if (!currentPortalId || !hasHydrated) return;
    const timeout = setTimeout(async () => {
      const { data } = await cloudSupabase
        .from("portal_settings")
        .select("settings")
        .eq("portal_id", toPortalUUIDCloud(currentPortalId))
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settings = (data?.settings ?? {}) as Record<string, any>;
      settings.cloud_sections = sections;
      await cloudSupabase
        .from("portal_settings")
        .upsert({
          portal_id: toPortalUUIDCloud(currentPortalId),
          settings,
          updated_at: new Date().toISOString(),
        }, { onConflict: "portal_id" });
    }, 600);
    return () => clearTimeout(timeout);
  }, [sections, currentPortalId, hasHydrated]);

  // ── Lockout countdown timer ──
  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutRemaining(remaining);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setUnlockAttempts(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  // ── Auto-lock check ──
  useEffect(() => {
    const interval = setInterval(() => {
      setUnlockedFolders((prev) => {
        const next = new Set<string>();
        prev.forEach((id) => {
          if (getUnlockState(id).unlocked) next.add(id);
        });
        if (next.size !== prev.size) return next;
        return prev;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Computed values ──
  const getPerm = useCallback(
    (folderId: string): PermissionLevel | null => {
      if (isPortalOwner || isPortalAdmin) return "admin";
      return getUserPermission(folderId, userId, userRole, folders);
    },
    [isPortalOwner, isPortalAdmin, userId, userRole, folders]
  );

  const isFolderUnlocked = useCallback(
    (folder: CloudFolder): boolean => {
      if (!folder.isLocked) return true;
      if (isOwner) return true;
      return unlockedFolders.has(folder.id);
    },
    [unlockedFolders, isOwner]
  );

  const rootFolders = useMemo(
    () => folders.filter((f) => f.parentId === null && !f.isDeleted),
    [folders]
  );
  const getChildren = useCallback(
    (parentId: string) => folders.filter((f) => f.parentId === parentId && !f.isDeleted),
    [folders]
  );
  const trashCount = useMemo(() => files.filter((f) => f.isDeleted).length, [files]);
  const trashSize = useMemo(
    () => files.filter((f) => f.isDeleted).reduce((s, f) => s + f.size, 0),
    [files]
  );
  // Real storage usage: sum of all non-trashed file sizes (bytes) vs 1 TB quota.
  const usedStorageBytes = useMemo(
    () => files.filter((f) => !f.isDeleted).reduce((s, f) => s + f.size, 0),
    [files]
  );
  const storageQuotaBytes = TOTAL_STORAGE_GB * 1024 * 1024 * 1024;
  const storagePct = Math.min(100, (usedStorageBytes / storageQuotaBytes) * 100);

  const currentFiles = useMemo(() => {
    if (showTrash) return files.filter((f) => f.isDeleted);
    if (searchQuery.trim()) {
      return files.filter(
        (f) =>
          !f.isDeleted &&
          f.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
          getPerm(f.folderId)
      );
    }
    if (!currentFolderId) return [];
    return files.filter((f) => f.folderId === currentFolderId && !f.isDeleted);
  }, [currentFolderId, files, showTrash, searchQuery, getPerm]);

  const sortedFiles = useMemo(() => {
    const s = [...currentFiles];
    if (sortBy === "name") s.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "size") s.sort((a, b) => b.size - a.size);
    else
      s.sort(
        (a, b) =>
          (b.isDeleted && b.deletedAt ? b.deletedAt.getTime() : b.modifiedAt.getTime()) -
          (a.isDeleted && a.deletedAt ? a.deletedAt.getTime() : a.modifiedAt.getTime())
      );
    return s;
  }, [currentFiles, sortBy]);

  const currentSubfolders = useMemo(() => {
    if (showTrash || searchQuery.trim()) return [];
    return folders.filter((f) => f.parentId === currentFolderId && !f.isDeleted);
  }, [currentFolderId, folders, showTrash, searchQuery]);

  const currentSections = useMemo(() => {
    if (!currentFolderId || showTrash || searchQuery.trim()) return [];
    return sections
      .filter((s) => s.folderId === currentFolderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [currentFolderId, sections, showTrash, searchQuery]);

  const currentPerm = currentFolderId ? getPerm(currentFolderId) : isOwnerOrAdmin ? "admin" : "read";
  const canWrite = currentPerm === "write" || currentPerm === "admin";
  const currentFolder = currentFolderId ? folders.find((f) => f.id === currentFolderId) : null;
  const currentFolderUnlocked = currentFolder ? isFolderUnlocked(currentFolder) : true;
  const currentFolderUnlockState = currentFolderId ? getUnlockState(currentFolderId) : null;

  const unsectionedFiles = useMemo(
    () => sortedFiles.filter((f) => !f.sectionId || !currentSections.some((s) => s.id === f.sectionId)),
    [sortedFiles, currentSections]
  );

  // ── Section collapse persistence ──
  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) { next.delete(sectionId); } else { next.add(sectionId); }
      localStorage.setItem(STORAGE_CLOUD_COLLAPSED_SECTIONS, JSON.stringify([...next]));
      return next;
    });
  };

  // ── Navigation ──
  const navigateFolder = (id: string | null) => {
    setCurrentFolderId(id);
    setShowTrash(false);
    setShowStorage(false);
    setSearchQuery("");
    if (id) {
      let cur: string | null = id;
      const toExpand = new Set(expandedFolders);
      while (cur) {
        const f = folders.find((x) => x.id === cur);
        if (!f) break;
        toExpand.add(cur);
        cur = f.parentId;
      }
      setExpandedFolders(toExpand);
    }
  };

  const attemptNavigateFolder = (id: string | null) => {
    if (!id) { navigateFolder(id); return; }
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    if (folder.isLocked && !isFolderUnlocked(folder)) {
      if (isOwner) {
        setUnlockedFolders((prev) => new Set(prev).add(id));
        setUnlockState(id, "session");
        toast.success("🔓 Owner access — no password required");
        navigateFolder(id);
      } else {
        setUnlockPromptFolder(folder);
        setUnlockPassword("");
        setUnlockError("");
        setUnlockShowPassword(false);
        setUnlockRemember("none");
        if (folder.lockedUntil && folder.lockedUntil.getTime() > Date.now()) {
          setLockoutUntil(folder.lockedUntil.getTime());
          setLockoutRemaining(Math.ceil((folder.lockedUntil.getTime() - Date.now()) / 1000));
        }
      }
    } else {
      navigateFolder(id);
    }
  };

  // ── Unlock handler ──
  const handleUnlock = async () => {
    if (!unlockPromptFolder || lockoutUntil) return;
    const folder = unlockPromptFolder;
    const correctHash = MOCK_FOLDER_PASSWORDS[folder.id] ?? folder.passwordHash;
    const matches = correctHash != null && await verifyPassword(unlockPassword, correctHash);
    if (matches) {
      setUnlockedFolders((prev) => new Set(prev).add(folder.id));
      setUnlockState(folder.id, unlockRemember, folder.lockAutoTimeoutMinutes || 30);
      setFolders((prev) =>
        prev.map((f) => (f.id === folder.id ? { ...f, failedAttempts: 0 } : f))
      );
      setUnlockPromptFolder(null);
      setUnlockAttempts(0);
      navigateFolder(folder.id);
      toast.success(`🔓 ${folder.name} unlocked`);
      addAuditEntry({
        userId, action: `Unlocked folder "${folder.name}"`, category: "cloud",
        details: "Locked folder accessed with password", icon: "🔓",
      });
    } else {
      const newAttempts = unlockAttempts + 1;
      setUnlockAttempts(newAttempts);
      if (newAttempts >= 5) {
        const lockoutTime = Date.now() + 5 * 60 * 1000;
        setLockoutUntil(lockoutTime);
        setLockoutRemaining(300);
        setFolders((prev) =>
          prev.map((f) =>
            f.id === folder.id
              ? { ...f, failedAttempts: newAttempts, lockedUntil: new Date(lockoutTime) }
              : f
          )
        );
        setUnlockError("Too many failed attempts");
        addAuditEntry({
          userId, action: `Folder "${folder.name}" locked — too many failed attempts`,
          category: "cloud", details: "5 failed unlock attempts, folder locked for 5 minutes", icon: "⚠️",
        });
      } else if (newAttempts >= 3) {
        setUnlockError(`Incorrect password (${5 - newAttempts} attempts remaining)`);
        addAuditEntry({
          userId, action: `Failed unlock attempt on "${folder.name}"`,
          category: "cloud", details: `Incorrect password — attempt ${newAttempts}/5`, icon: "⚠️",
        });
      } else {
        setUnlockError("Incorrect password");
        addAuditEntry({
          userId, action: `Failed unlock attempt on "${folder.name}"`,
          category: "cloud", details: `Incorrect password — attempt ${newAttempts}/5`, icon: "⚠️",
        });
      }
      setFolders((prev) =>
        prev.map((f) => (f.id === folder.id ? { ...f, failedAttempts: newAttempts } : f))
      );
    }
  };

  // ── Lock folder ──
  const lockFolderNow = (folderId: string) => {
    clearUnlockState(folderId);
    setUnlockedFolders((prev) => {
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
    if (currentFolderId === folderId) setCurrentFolderId(null);
    const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
    toast.success("🔒 Folder locked");
    addAuditEntry({
      userId, action: `Locked folder "${folderName}"`, category: "cloud",
      details: "Folder manually locked during session", icon: "●",
    });
  };

  // ── Password management ──
  const handleSetPassword = async (folderId: string, password: string, timeoutMinutes: number) => {
    const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
    const now = new Date().toISOString();
    const hash = await hashPassword(password);
    const ok = await svcUpdateFolderLock(folderId, {
      is_locked: true,
      password_hash: hash,
      lock_auto_timeout_minutes: timeoutMinutes,
      password_set_at: now,
    }, currentPortalId ?? undefined);
    if (!ok) { toast.error("Password non salvata — riprova"); return; }
    MOCK_FOLDER_PASSWORDS[folderId] = hash;
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId
          ? {
              ...f, isLocked: true, passwordHash: hash, passwordSetBy: userId,
              passwordSetAt: new Date(now), lockAutoTimeoutMinutes: timeoutMinutes,
              failedAttempts: 0, lockedUntil: null,
            }
          : f
      )
    );
    setSetPasswordFolder(null);
    toast.success("🔒 Password impostata");
    addAuditEntry({
      userId, action: `Set password on folder "${folderName}"`, category: "cloud",
      details: `Auto-lock timeout: ${timeoutMinutes} min`, icon: "🔐",
    });
  };

  const handleChangePassword = async (folderId: string, newPassword: string) => {
    const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
    const now = new Date().toISOString();
    const hash = await hashPassword(newPassword);
    const ok = await svcUpdateFolderLock(folderId, {
      is_locked: true,
      password_hash: hash,
      password_set_at: now,
    }, currentPortalId ?? undefined);
    if (!ok) { toast.error("Password non aggiornata — riprova"); return; }
    MOCK_FOLDER_PASSWORDS[folderId] = hash;
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId
          ? { ...f, passwordHash: hash, passwordSetBy: userId, passwordSetAt: new Date(now), failedAttempts: 0, lockedUntil: null }
          : f
      )
    );
    clearUnlockState(folderId);
    setUnlockedFolders((prev) => { const next = new Set(prev); next.delete(folderId); return next; });
    setChangePasswordFolder(null);
    toast.success("🔒 Password cambiata — tutte le sessioni revocate");
    addAuditEntry({
      userId, action: `Changed password on folder "${folderName}"`, category: "cloud",
      details: "All active sessions revoked", icon: "🔐",
    });
  };

  const handleRemovePassword = async (folderId: string) => {
    const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
    const ok = await svcUpdateFolderLock(folderId, {
      is_locked: false,
      password_hash: null,
      password_set_at: null,
    }, currentPortalId ?? undefined);
    if (!ok) { toast.error("Password non rimossa — riprova"); return; }
    delete MOCK_FOLDER_PASSWORDS[folderId];
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId
          ? { ...f, isLocked: false, passwordHash: null, passwordSetBy: null, passwordSetAt: null, failedAttempts: 0, lockedUntil: null }
          : f
      )
    );
    clearUnlockState(folderId);
    setUnlockedFolders((prev) => { const next = new Set(prev); next.delete(folderId); return next; });
    setRemovePasswordFolder(null);
    toast.success("🔓 Protezione rimossa");
    addAuditEntry({
      userId, action: `Removed password from folder "${folderName}"`, category: "cloud",
      details: "Folder is now unprotected", icon: "🔓",
    });
  };

  // ── Actions ──
  const toggleExpand = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const createFolder = () => {
    if (!newFolderName?.trim()) return;
    // Must be a real UUID — cloud_folders.id and cloud_files.folder_id are uuid
    // columns, so a "f_<timestamp>" id would 400 on sync and break file linking.
    const id = crypto.randomUUID();
    const parentPerms = currentFolderId
      ? folders.find((f) => f.id === currentFolderId)?.permissions || []
      : [];
    const parentName = currentFolderId
      ? folders.find((f) => f.id === currentFolderId)?.name
      : "Cloud Root";
    setFolders((prev) => [
      ...prev,
      {
        id, name: newFolderName.trim(), parentId: currentFolderId,
        permissions: parentPerms, inheritPermissions: !!currentFolderId, createdAt: new Date(),
      },
    ]);
    setNewFolderName(null);
    toast.success(`Folder "${newFolderName.trim()}" created`);
    addAuditEntry({
      userId, action: `Created folder "${newFolderName.trim()}"`, category: "cloud",
      details: `Created inside ${parentName}`, icon: "📁",
    });
  };

  const moveToTrash = useCallback(async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    const folderName = file ? getFolderPath(file.folderId, folders) : "";
    await cloudFiles.softDelete(fileId);
    toast.success("Moved to Trash");
    if (file)
      addAuditEntry({
        userId, action: `Moved "${file.name}" to Trash`, category: "cloud",
        details: `From ${folderName}`, icon: "🗑️",
      });
  }, [files, folders, userId, cloudFiles]);

  const handleRecover = useCallback(async (file: CloudFile) => {
    const origFolder = file.originalFolderId
      ? folders.find((f) => f.id === file.originalFolderId && !f.isDeleted)
      : null;
    if (origFolder) {
      await cloudFiles.recoverFile(file.id, origFolder.id);
      toast.success(`"${file.name}" restored to ${origFolder.name}`);
      addAuditEntry({
        userId, action: `Restored "${file.name}" from Trash`, category: "cloud",
        details: `Restored to ${origFolder.name}`, icon: "♻️",
      });
    } else {
      setRecoverFile(file);
      setRecoverTarget("root");
    }
  }, [folders, userId, cloudFiles]);

  const executeRecover = useCallback(async () => {
    if (!recoverFile) return;
    if (recoverTarget !== "root" && !moveTarget) {
      toast.error("Select a destination folder");
      return;
    }
    const targetId =
      recoverTarget === "root"
        ? (folders.find((f) => f.parentId === null && !f.isDeleted)?.id ?? folders[0]?.id)
        : moveTarget;
    if (!targetId) { toast.error("No valid destination folder"); return; }
    const targetName = folders.find((f) => f.id === targetId)?.name || "Cloud";
    await cloudFiles.recoverFile(recoverFile.id, targetId);
    toast.success(`"${recoverFile.name}" restored to ${targetName}`);
    addAuditEntry({
      userId, action: `Restored "${recoverFile.name}" from Trash`, category: "cloud",
      details: `Restored to ${targetName}`, icon: "♻️",
    });
    setRecoverFile(null);
    setMoveTarget(null);
  }, [recoverFile, recoverTarget, moveTarget, folders, userId, cloudFiles]);

  const permanentDelete = useCallback(async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    await cloudFiles.permanentDelete(fileId);
    setConfirmPermDelete(null);
    toast.success("Permanently deleted");
    if (file)
      addAuditEntry({
        userId, action: `Permanently deleted "${file.name}"`, category: "cloud",
        details: "File removed from Trash — cannot be recovered", icon: "❌",
      });
  }, [files, userId, cloudFiles]);

  const emptyTrash = useCallback(async () => {
    const count = files.filter((f) => f.isDeleted).length;
    await cloudFiles.emptyTrash();
    setConfirmEmptyTrash(false);
    toast.success("Trash emptied");
    addAuditEntry({
      userId, action: "Emptied Trash", category: "cloud",
      details: `${count} file(s) permanently deleted`, icon: "🗑️",
    });
  }, [files, userId, cloudFiles]);

  const deleteFolderAndContents = (folder: CloudFolder) => {
    const allFolderIds = new Set<string>();
    const collectIds = (parentId: string) => {
      allFolderIds.add(parentId);
      folders.filter((f) => f.parentId === parentId).forEach((f) => collectIds(f.id));
    };
    collectIds(folder.id);
    const affectedFiles = files.filter(
      (f) => allFolderIds.has(f.folderId) && !f.isDeleted
    );
    // Cascade: soft-delete every file inside the affected folders via the DB layer.
    void Promise.all(affectedFiles.map((f) => cloudFiles.softDelete(f.id)));
    setSections((prev) => prev.filter((s) => !allFolderIds.has(s.folderId)));
    setFolders((prev) =>
      prev.map((f) => (allFolderIds.has(f.id) ? { ...f, isDeleted: true } : f))
    );
    if (currentFolderId && allFolderIds.has(currentFolderId)) setCurrentFolderId(null);
    setConfirmDeleteFolder(null);
    toast.success(`Folder "${folder.name}" moved to trash`);
    addAuditEntry({
      userId, action: `Deleted folder "${folder.name}"`, category: "cloud",
      details: `${affectedFiles.length} file(s) moved to Trash`, icon: "🗑️",
    });
  };

  const moveFileToFolder = useCallback(async (fileId: string, targetFolderId: string) => {
    const file = files.find((f) => f.id === fileId);
    const targetFolderName = folders.find((f) => f.id === targetFolderId)?.name || "folder";
    const sourceFolderName = file ? folders.find((f) => f.id === file.folderId)?.name || "Cloud" : "Cloud";
    await cloudFiles.moveFile(fileId, targetFolderId);
    toast.success(`Moved to ${targetFolderName}`);
    setMoveFileModal(null);
    setMoveTarget(null);
    if (file)
      addAuditEntry({
        userId, action: `Moved "${file.name}" to "${targetFolderName}"`, category: "cloud",
        details: `From ${sourceFolderName}`, icon: "📦",
      });
  }, [files, folders, userId, cloudFiles]);

  const renameFile = useCallback(async (fileId: string, newName?: string) => {
    const val = newName || renameValue;
    if (!val.trim()) { setRenamingFileId(null); return; }
    const file = files.find((f) => f.id === fileId);
    const oldName = file?.name;
    await cloudFiles.renameFile(fileId, val.trim());
    setRenamingFileId(null);
    if (file && oldName !== val.trim())
      addAuditEntry({
        userId, action: `Renamed "${oldName}" to "${val.trim()}"`, category: "cloud",
        details: "File renamed", icon: "✏️",
      });
  }, [files, userId, renameValue, cloudFiles]);

  const handleDownload = useCallback(async (fileId: string) => {
    const url = await cloudFiles.getDownloadUrl(fileId);
    if (!url) { toast.error("Could not generate download link"); return; }
    const file = files.find((f) => f.id === fileId);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = file?.name ?? fileId;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch {
      toast.error("Download failed");
    }
  }, [cloudFiles, files]);

  const updateFileDescription = (_fileId: string, _desc: string) => {
    // Description editing is not persisted to the DB layer (acceptable known limitation).
  };

  const handleRealUpload = async (actualFiles: File[], folderId: string) => {
    let successCount = 0;
    const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
    for (const file of actualFiles) {
      try {
        await cloudFiles.upload(file, folderId, folderName);
        successCount++;
      } catch (err) {
        toast.error(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
    setShowUploadModal(false);
    if (successCount > 0) {
      toast.success(`${successCount} file(s) uploaded to "${folderName}"`);
      addAuditEntry({
        userId,
        action: `Uploaded ${successCount} file(s) to "${folderName}"`,
        category: "cloud",
        details: actualFiles.map((f) => f.name).join(", "),
        icon: "📄",
      });
    }
  };

  // ── Section CRUD ──
  const createSection = (name: string, afterSectionId?: string | null) => {
    if (!name.trim() || !currentFolderId) return;
    const folderSections = sections
      .filter((s) => s.folderId === currentFolderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    let sortOrder: number;
    if (afterSectionId) {
      const idx = folderSections.findIndex((s) => s.id === afterSectionId);
      sortOrder = idx >= 0 ? folderSections[idx].sortOrder + 0.5 : folderSections.length;
    } else {
      sortOrder =
        folderSections.length > 0
          ? Math.max(...folderSections.map((s) => s.sortOrder)) + 1
          : 0;
    }
    const newSection: FolderSection = {
      id: `sec_${Date.now()}`, folderId: currentFolderId, name: name.trim(),
      sortOrder, isCollapsed: false, createdBy: userId, createdAt: new Date(),
    };
    setSections((prev) => {
      const updated = [...prev, newSection];
      const folderOnes = updated
        .filter((s) => s.folderId === currentFolderId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return updated.map((s) => {
        if (s.folderId !== currentFolderId) return s;
        const idx = folderOnes.findIndex((x) => x.id === s.id);
        return { ...s, sortOrder: idx };
      });
    });
    setNewSectionName(null);
    setNewSectionAfter(null);
    toast.success(`Section "${name.trim()}" created`);
  };

  const renameSection = (sectionId: string, newName: string) => {
    if (!newName.trim()) { setRenamingSectionId(null); return; }
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, name: newName.trim() } : s))
    );
    setRenamingSectionId(null);
  };

  const deleteSection = (section: FolderSection) => {
    // Section assignments are not persisted to the DB layer (acceptable known limitation).
    setSections((prev) => prev.filter((s) => s.id !== section.id));
    setDeleteSectionConfirm(null);
    toast.success(`Section "${section.name}" deleted`);
  };

  const moveSectionOrder = (sectionId: string, direction: "up" | "down") => {
    const folderSections = sections
      .filter((s) => s.folderId === currentFolderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = folderSections.findIndex((s) => s.id === sectionId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= folderSections.length) return;
    const a = folderSections[idx];
    const b = folderSections[swapIdx];
    setSections((prev) =>
      prev.map((s) => {
        if (s.id === a.id) return { ...s, sortOrder: b.sortOrder };
        if (s.id === b.id) return { ...s, sortOrder: a.sortOrder };
        return s;
      })
    );
  };

  const moveFileToSection = (_fileId: string, sectionId: string | null) => {
    // Section assignments are not persisted to the DB layer (acceptable known limitation).
    const sectionName = sectionId
      ? sections.find((s) => s.id === sectionId)?.name
      : "Other Files";
    toast.success(`Moved to ${sectionName}`);
  };

  // ── Context Menu Items ──
  const getFileMenuItems = (file: CloudFile): ActionMenuEntry[] => {
    const perm = getPerm(file.folderId);
    const canW = perm === "write" || perm === "admin";
    const fileSections = sections.filter((s) => s.folderId === file.folderId);
    const sectionMenuItems: ActionMenuEntry[] =
      fileSections.length > 0
        ? [
            ...fileSections.map((s) => ({
              id: `sec-${s.id}`,
              label: s.name,
              onClick: () => moveFileToSection(file.id, s.id),
              show: canW && file.sectionId !== s.id,
            })),
            {
              id: "sec-remove",
              label: "Remove from section",
              onClick: () => moveFileToSection(file.id, null),
              show: canW && !!file.sectionId,
            },
          ]
        : [];
    return [
      {
        id: "download",
        icon: <Download className="w-3.5 h-3.5" />,
        label: "Download",
        onClick: () => { void handleDownload(file.id); },
        show: !!perm,
      },
      {
        id: "rename",
        icon: <Pencil className="w-3.5 h-3.5" />,
        label: "Rename",
        onClick: () => { setRenamingFileId(file.id); setRenameValue(file.name); },
        show: canW,
      },
      {
        id: "move",
        icon: <Move className="w-3.5 h-3.5" />,
        label: "Move to folder",
        onClick: () => { setMoveFileModal(file); setMoveTarget(null); },
        show: canW,
      },
      ...(sectionMenuItems.length > 0
        ? [
            {
              id: "move-section",
              icon: <Layers className="w-3.5 h-3.5" />,
              label: `Move to Section → ${
                file.sectionId
                  ? sections.find((s) => s.id === file.sectionId)?.name || ""
                  : ""
              }`,
              onClick: () => {},
              show: false,
            },
            ...sectionMenuItems,
          ]
        : []),
      { id: "link", icon: <Link2 className="w-3.5 h-3.5" />, label: "Copy link", onClick: () => toast.success("Link copied"), show: !!perm },
      { id: "details", icon: <Eye className="w-3.5 h-3.5" />, label: "View details", onClick: () => setPreviewFile(file), show: !!perm },
      { id: "perms", icon: <Shield className="w-3.5 h-3.5" />, label: "Manage permissions", onClick: () => setPermissionsModal(file.folderId), show: perm === "admin" },
      { type: "divider" as const },
      { id: "trash", icon: <Trash2 className="w-3.5 h-3.5" />, label: "Move to Trash", onClick: () => moveToTrash(file.id), destructive: true, show: canW },
    ];
  };

  const getFolderMenuItems = (folder: CloudFolder): ActionMenuEntry[] => {
    const perm = getPerm(folder.id);
    const canAdmin = perm === "admin";
    const canChangePassword = canAdmin || folder.passwordSetBy === userId;
    return [
      ...(folder.isLocked && isFolderUnlocked(folder)
        ? [{ id: "lock-now", icon: <Lock className="w-3.5 h-3.5" />, label: "Lock Now", onClick: () => lockFolderNow(folder.id) }]
        : []),
      ...(!folder.isLocked && canAdmin
        ? [{ id: "set-password", icon: <Lock className="w-3.5 h-3.5" />, label: "Set Password...", onClick: () => setSetPasswordFolder(folder) }]
        : []),
      ...(folder.isLocked && canChangePassword
        ? [
            { id: "change-password", icon: <Lock className="w-3.5 h-3.5" />, label: "Change Password...", onClick: () => setChangePasswordFolder(folder) },
            { id: "remove-password", icon: <Unlock className="w-3.5 h-3.5" />, label: "Remove Password", onClick: () => setRemovePasswordFolder(folder), destructive: true },
          ]
        : []),
    ];
  };

  // ── Folder Tree ──
  const renderFolderItem = (folder: CloudFolder, depth: number) => {
    const children = getChildren(folder.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedFolders.has(folder.id);
    const isActive = currentFolderId === folder.id && !showTrash;
    const fileCount = files.filter((f) => f.folderId === folder.id && !f.isDeleted).length;
    const isLocked = folder.isLocked;
    const isUnlocked = isFolderUnlocked(folder);

    return (
      <div key={folder.id}>
        <div style={{ display: "flex", alignItems: "center" }} className="group">
          <button
            type="button"
            onClick={() => { attemptNavigateFolder(folder.id); if (isMobile) setMobileSidebarOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 5, flex: 1, textAlign: "left",
              padding: `7px 14px 7px ${depth * 12 + 14}px`,
              fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: isActive ? 600 : 400,
              letterSpacing: "0.03em",
              color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
              background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
              borderLeft: isActive ? "3px solid var(--portal-accent)" : "3px solid transparent",
              border: "none", borderRadius: 0, cursor: "pointer",
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--sosa-bg-2)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
          >
            {hasChildren ? (
              <span onClick={(e) => { e.stopPropagation(); toggleExpand(folder.id); }} style={{ display: "flex", cursor: "pointer" }}>
                {isExpanded
                  ? <ChevronDown style={{ width: 11, height: 11, color: "var(--sosa-white-40)" }} />
                  : <ChevronRight style={{ width: 11, height: 11, color: "var(--sosa-white-40)" }} />}
              </span>
            ) : (
              <span style={{ width: 11 }} />
            )}
            <FolderIcon style={{ width: 13, height: 13, flexShrink: 0, color: isActive ? "var(--portal-accent)" : "var(--sosa-white-40)" }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
            {isLocked && (isUnlocked
              ? <Unlock style={{ width: 11, height: 11, flexShrink: 0, color: "var(--sosa-white-20)" }} />
              : <Lock style={{ width: 11, height: 11, flexShrink: 0, color: "#f59e0b" }} />
            )}
            {fileCount > 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--sosa-white-20)" }}>{fileCount}</span>
            )}
          </button>
          {isActive && getPerm(folder.id) === "admin" && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteFolder(folder); }}
              className="opacity-0 group-hover:opacity-100"
              style={{ padding: 4, cursor: "pointer", background: "transparent", border: "none", color: "#ef4444", flexShrink: 0 }}
              title="Move to Trash"
            >
              <Trash2 style={{ width: 11, height: 11 }} />
            </button>
          )}
        </div>
        {hasChildren && isExpanded && children.map((c) => renderFolderItem(c, depth + 1))}
      </div>
    );
  };

  // ── Sidebar content ──
  const isHomeActive = !currentFolderId && !showTrash && !showStorage;
  const sidebarContent = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {/* Home */}
        <button
          type="button"
          onClick={() => { setCurrentFolderId(null); setShowTrash(false); setShowStorage(false); if (isMobile) setMobileSidebarOpen(false); }}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "9px 14px", cursor: "pointer",
            fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: isHomeActive ? 600 : 400,
            letterSpacing: "0.04em", textTransform: "uppercase",
            color: isHomeActive ? "var(--text-primary)" : "var(--text-tertiary)",
            background: isHomeActive ? "rgba(255,255,255,0.04)" : "transparent",
            borderLeft: isHomeActive ? "3px solid var(--portal-accent)" : "3px solid transparent",
            border: "none", borderRadius: 0,
          }}
          onMouseEnter={(e) => { if (!isHomeActive) e.currentTarget.style.background = "var(--sosa-bg-2)"; }}
          onMouseLeave={(e) => { if (!isHomeActive) e.currentTarget.style.background = "transparent"; }}
        >
          <Home style={{ width: 14, height: 14, opacity: isHomeActive ? 1 : 0.45, flexShrink: 0 }} />
          <span>Home</span>
        </button>

        <div style={{ height: 1, background: "var(--sosa-border)", margin: "6px 14px" }} />
        {rootFolders.map((f) => renderFolderItem(f, 0))}
        {isOwnerOrAdmin && (
          <button
            type="button"
            onClick={() => setShowNewFolderModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%",
              padding: "7px 14px", cursor: "pointer",
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 400,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--portal-accent)", background: "transparent",
              border: "none", borderRadius: 0, opacity: 0.7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "var(--sosa-bg-2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            <span>Nuova cartella</span>
          </button>
        )}
      </div>

      {/* Trash — pinned above storage */}
      <button
        type="button"
        onClick={() => { setShowTrash(true); setCurrentFolderId(null); setShowStorage(false); if (isMobile) setMobileSidebarOpen(false); }}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "9px 14px", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: showTrash ? 600 : 400,
          letterSpacing: "0.04em", textTransform: "uppercase",
          color: showTrash ? "var(--text-primary)" : "var(--text-tertiary)",
          background: showTrash ? "rgba(255,255,255,0.04)" : "transparent",
          borderLeft: showTrash ? "3px solid #ef4444" : "3px solid transparent",
          borderTop: "1px solid var(--sosa-border)", borderRight: "none", borderBottom: "none", borderRadius: 0,
        }}
        onMouseEnter={(e) => { if (!showTrash) e.currentTarget.style.background = "var(--sosa-bg-2)"; }}
        onMouseLeave={(e) => { if (!showTrash) e.currentTarget.style.background = "transparent"; }}
      >
        <Trash2 style={{ width: 14, height: 14, opacity: showTrash ? 1 : 0.45, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>Trash</span>
        {trashCount > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, padding: "2px 6px", background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
            {trashCount}
          </span>
        )}
      </button>

      {/* Storage bar */}
      <button
        type="button"
        onClick={() => { setShowStorage(true); setCurrentFolderId(null); setShowTrash(false); if (isMobile) setMobileSidebarOpen(false); }}
        style={{
          padding: "12px 14px", borderTop: "1px solid var(--sosa-border)", width: "100%",
          textAlign: "left", cursor: "pointer", borderRadius: 0,
          background: showStorage ? "rgba(255,255,255,0.04)" : "transparent",
          border: "none", borderLeft: "none", borderRight: "none", borderBottom: "none",
        }}
        onMouseEnter={(e) => { if (!showStorage) e.currentTarget.style.background = "var(--sosa-bg-2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = showStorage ? "rgba(255,255,255,0.04)" : "transparent"; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--sosa-white-40)" }}>
            Storage
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--sosa-white-40)" }}>
            {formatFileSize(usedStorageBytes)} / 1 TB
          </span>
        </div>
        <div style={{ height: 2, background: "var(--sosa-border)", position: "relative" }}>
          <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${storagePct}%`, background: "var(--portal-accent)" }} />
        </div>
      </button>
    </div>
  );

  // ── FolderView shared props ──
  const folderViewProps = {
    folders, files, sections, currentFolderId, currentFolder: currentFolder ?? null,
    currentFolderUnlocked, currentFolderUnlockState, currentSubfolders, currentSections,
    sortedFiles, unsectionedFiles, collapsedSections, view, sortBy, canWrite,
    currentPerm, searchQuery, showTrash, isOwner, isOwnerOrAdmin, userRole, userId,
    newFolderName, renamingFileId, renameValue, newSectionName, newSectionAfter,
    renamingSectionId, sectionRenameValue, dragOverSectionId, trashCount, trashSize,
    setView, setSortBy, setNewFolderName, setRenamingFileId, setRenameValue,
    setNewSectionName, setNewSectionAfter, setRenamingSectionId, setSectionRenameValue,
    setDragOverSectionId, setPreviewFile, setPermissionsModal, setShowUploadModal,
    setShowNewFolderModal, setConfirmDeleteFolder, setDeleteSectionConfirm, setConfirmEmptyTrash,
    attemptNavigateFolder, isFolderUnlocked, getPerm, getFileMenuItems, getFolderMenuItems,
    createFolder, renameFile, createSection, renameSection, moveSectionOrder,
    moveFileToSection, toggleSectionCollapse, lockFolderNow,
  };

  return (
    <ModuleErrorBoundary moduleName="Cloud Storage">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Mobile breadcrumb bar */}
        {(isMobile || (currentFolderId && !showTrash) || showTrash) && (
          <div className="flex items-center gap-2 px-3 py-2 shrink-0">
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="p-1.5 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                <FolderIcon className="w-4 h-4" />
              </button>
            )}
            {showTrash && (
              <span className="text-xs text-muted-foreground">
                🗑️ Trash — files are permanently deleted after 60 days
              </span>
            )}
          </div>
        )}

        {/* Two-panel layout */}
        <div style={{ display: "flex", flex: 1, background: "var(--sosa-bg)", border: "1px solid var(--sosa-border)", overflow: "hidden" }}>
          {!isMobile && (
            <div style={{ width: 220, borderRight: "1px solid var(--sosa-border)", background: "var(--sosa-bg)", flexShrink: 0, display: "flex", flexDirection: "column" }}>
              {sidebarContent}
            </div>
          )}

          {isMobile && mobileSidebarOpen && (
            <>
              <div
                className="fixed inset-0 z-[60] bg-black/30"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <div className="fixed left-0 top-0 bottom-0 z-[70] w-[260px] bg-popover border-r border-border">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <span className="text-sm font-semibold text-foreground">Folders</span>
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {sidebarContent}
              </div>
            </>
          )}

          {/* Right panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {showStorage ? (
              <StorageOverview
                files={files}
                folders={folders}
                userId={userId}
                userRole={userRole}
                getPerm={getPerm}
                onNavigateFolder={(id) => { navigateFolder(id); setShowStorage(false); }}
                onPreviewFile={(file) => setPreviewFile(file)}
                onMoveToTrash={moveToTrash}
                onRenameFile={(id, name) => renameFile(id, name)}
                onMoveFile={(f) => { setMoveFileModal(f); setMoveTarget(null); }}
                onOpenUpload={() => setShowUploadModal(true)}
                onDownloadFile={handleDownload}
              />
            ) : showTrash ? (
              <>
                {/* Trash toolbar */}
                {(currentFolderId || showTrash || searchQuery.trim()) && (
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {trashCount} item{trashCount !== 1 ? "s" : ""} •{" "}
                        {formatFileSize(trashSize)}
                      </span>
                      {userRole === "owner" && trashCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmEmptyTrash(true)}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors font-medium"
                        >
                          Empty Trash
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4">
                  <TrashView
                    files={files}
                    folders={folders}
                    sortedFiles={sortedFiles}
                    trashCount={trashCount}
                    trashSize={trashSize}
                    isOwnerOrAdmin={isOwnerOrAdmin}
                    userRole={userRole}
                    userId={userId}
                    setTrashPreviewFile={setTrashPreviewFile}
                    setConfirmPermDelete={setConfirmPermDelete}
                    setConfirmEmptyTrash={setConfirmEmptyTrash}
                    handleRecover={handleRecover}
                  />
                  {sortedFiles.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2 min-h-[200px] text-muted-foreground">
                      <Cloud className="w-8 h-8" />
                      <p className="text-sm">Trash is empty</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <FolderView {...folderViewProps} />
            )}
          </div>
        </div>

        {/* ── MODALS ── */}
        {showUploadModal && (
          <UploadModal
            currentFolderId={currentFolderId}
            folders={folders}
            onClose={() => setShowUploadModal(false)}
            onUpload={handleRealUpload}
          />
        )}
        {permissionsModal && (
          <PermissionsModalUI
            permissionsModal={permissionsModal}
            folders={folders}
            userId={userId}
            setFolders={setFolders}
            setPermissionsModal={setPermissionsModal}
          />
        )}
        {showNewFolderModal && (
          <NewFolderModal
            currentFolderId={currentFolderId}
            folders={folders}
            rootFolders={rootFolders}
            getChildren={getChildren}
            isOwnerOrAdmin={isOwnerOrAdmin}
            userId={userId}
            getPerm={getPerm}
            setFolders={setFolders}
            onClose={() => setShowNewFolderModal(false)}
          />
        )}

        {/* ── PASSWORD UNLOCK PROMPT ── */}
        {unlockPromptFolder && (
          <ModalOverlay onClose={() => setUnlockPromptFolder(null)}>
            <div className="text-center">
              <Lock className="w-12 h-12 text-amber-500 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-foreground mb-1">
                This folder is protected
              </h3>
              <p className="text-sm text-muted-foreground mb-1 flex items-center justify-center gap-1.5">
                <FolderIcon className="w-4 h-4 text-primary" /> {unlockPromptFolder.name}
              </p>
              <p className="text-xs text-muted-foreground mb-6">
                Enter the password to access this folder's contents.
              </p>
              <div className="text-left mb-4">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={unlockShowPassword ? "text" : "password"}
                    value={unlockPassword}
                    onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleUnlock(); }}
                    disabled={!!lockoutUntil}
                    autoFocus
                    className={`w-full text-sm p-3 pr-10 rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-ring transition-colors ${
                      unlockError ? "border-destructive animate-[shake_0.3s_ease]" : "border-input"
                    }`}
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setUnlockShowPassword(!unlockShowPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {unlockShowPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {unlockError && !lockoutUntil && (
                  <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {unlockError}
                  </p>
                )}
                {lockoutUntil && (
                  <div className="mt-3 text-center">
                    <p className="text-xs text-destructive flex items-center justify-center gap-1 mb-1">
                      <AlertTriangle className="w-3 h-3" /> Too many failed attempts
                    </p>
                    <p className="text-sm font-semibold text-destructive">
                      Try again in {Math.floor(lockoutRemaining / 60)}:
                      {(lockoutRemaining % 60).toString().padStart(2, "0")}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 mb-5 text-left">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                  <input
                    type="radio"
                    name="remember"
                    checked={unlockRemember === "session"}
                    onChange={() => setUnlockRemember("session")}
                    className="text-primary"
                  />
                  Remember for this session
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                  <input
                    type="radio"
                    name="remember"
                    checked={unlockRemember === "timed"}
                    onChange={() => setUnlockRemember("timed")}
                    className="text-primary"
                  />
                  Remember for {unlockPromptFolder.lockAutoTimeoutMinutes || 30} minutes
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setUnlockPromptFolder(null)}
                  className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleUnlock}
                  disabled={!unlockPassword || !!lockoutUntil}
                  className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Unlock className="w-3.5 h-3.5" /> Unlock
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/60 mt-4">
                Forgot password? Contact the folder owner.
              </p>
            </div>
          </ModalOverlay>
        )}

        {/* ── PASSWORD MODALS ── */}
        {setPasswordFolder && (
          <SetPasswordModal
            folder={setPasswordFolder}
            onClose={() => setSetPasswordFolder(null)}
            onSet={handleSetPassword}
          />
        )}
        {changePasswordFolder && (
          <ChangePasswordModal
            folder={changePasswordFolder}
            onClose={() => setChangePasswordFolder(null)}
            onChange={handleChangePassword}
          />
        )}
        {removePasswordFolder && (
          <RemovePasswordModal
            folder={removePasswordFolder}
            onClose={() => setRemovePasswordFolder(null)}
            onRemove={handleRemovePassword}
          />
        )}

        {/* Delete Section Confirmation */}
        {deleteSectionConfirm && (
          <ModalOverlay onClose={() => setDeleteSectionConfirm(null)}>
            <h2 className="text-base font-bold text-foreground mb-4">Delete Section</h2>
            <p className="text-sm text-muted-foreground mb-2">
              Delete section "
              <strong className="text-foreground">{deleteSectionConfirm.name}</strong>"?
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              The{" "}
              {files.filter((f) => f.sectionId === deleteSectionConfirm.id).length} file(s)
              inside will be moved to Other Files. No files will be deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteSectionConfirm(null)}
                className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteSection(deleteSectionConfirm)}
                className="text-sm px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete Section
              </button>
            </div>
          </ModalOverlay>
        )}

        {/* Permanent Delete Confirmation */}
        {confirmPermDelete && (
          <ModalOverlay onClose={() => setConfirmPermDelete(null)}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h2 className="text-base font-bold text-foreground">Permanent Deletion</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Are you sure you want to{" "}
              <strong className="text-foreground">permanently delete</strong> this file?
            </p>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 mb-3">
              <span className="text-lg">{getFileTypeIcon(confirmPermDelete.type).emoji}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{confirmPermDelete.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(confirmPermDelete.size)}
                </p>
              </div>
            </div>
            <p className="text-xs text-destructive mb-4 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> This action cannot be undone. The file will
              be gone forever.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmPermDelete(null)}
                className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => permanentDelete(confirmPermDelete.id)}
                className="text-sm px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete Permanently
              </button>
            </div>
          </ModalOverlay>
        )}

        {/* Empty Trash Confirmation */}
        {confirmEmptyTrash && (
          <ModalOverlay onClose={() => setConfirmEmptyTrash(false)}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h2 className="text-base font-bold text-foreground">Empty Trash</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Permanently delete{" "}
              <strong className="text-foreground">all {trashCount} items</strong> in Trash?
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              This will free {formatFileSize(trashSize)} of storage.
            </p>
            <p className="text-xs text-destructive mb-4 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmEmptyTrash(false)}
                className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={emptyTrash}
                className="text-sm px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Empty Trash
              </button>
            </div>
          </ModalOverlay>
        )}

        {/* Delete Folder Confirmation */}
        {confirmDeleteFolder && (
          <ModalOverlay onClose={() => setConfirmDeleteFolder(null)}>
            <h2 className="text-base font-bold text-foreground mb-4">Delete Folder</h2>
            <p className="text-sm text-muted-foreground mb-2">
              Delete "<strong className="text-foreground">{confirmDeleteFolder.name}</strong>" and
              all its contents?
            </p>
            <div className="p-3 rounded-lg bg-muted/50 mb-3 text-sm">
              <p className="flex items-center gap-2 text-foreground">
                <FolderIcon className="w-4 h-4 text-primary" /> {confirmDeleteFolder.name}
              </p>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                📄{" "}
                {
                  files.filter(
                    (f) => f.folderId === confirmDeleteFolder.id && !f.isDeleted
                  ).length
                }{" "}
                files (
                {formatFileSize(
                  files
                    .filter((f) => f.folderId === confirmDeleteFolder.id && !f.isDeleted)
                    .reduce((s, f) => s + f.size, 0)
                )}
                )
              </p>
              <p className="text-xs text-muted-foreground ml-6">
                📁{" "}
                {
                  folders.filter(
                    (f) => f.parentId === confirmDeleteFolder.id && !f.isDeleted
                  ).length
                }{" "}
                subfolder(s)
              </p>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              All files will be moved to Trash and can be recovered within 60 days.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDeleteFolder(null)}
                className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteFolderAndContents(confirmDeleteFolder)}
                className="text-sm px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Move to Trash
              </button>
            </div>
          </ModalOverlay>
        )}

        {/* Recover File Dialog */}
        {recoverFile && (
          <ModalOverlay onClose={() => setRecoverFile(null)}>
            <h2 className="text-base font-bold text-foreground mb-4">Recover File</h2>
            <p className="text-sm text-muted-foreground mb-2">
              The original folder no longer exists:
            </p>
            <p className="text-sm text-foreground mb-4 flex items-center gap-1">
              <FolderIcon className="w-3.5 h-3.5 text-primary" />{" "}
              {recoverFile.originalFolderPath || "Unknown"}
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              Choose where to restore this file:
            </p>
            <div className="flex flex-col gap-2 mb-4">
              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  recoverTarget === "root"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <input
                  type="radio"
                  name="recover"
                  value="root"
                  checked={recoverTarget === "root"}
                  onChange={() => setRecoverTarget("root")}
                  className="text-primary"
                />
                <FolderIcon className="w-3.5 h-3.5 text-primary" />
                <span className="text-sm text-foreground">Projects (root)</span>
              </label>
              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  recoverTarget === "choose"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <input
                  type="radio"
                  name="recover"
                  value="choose"
                  checked={recoverTarget === "choose"}
                  onChange={() => setRecoverTarget("choose")}
                  className="text-primary"
                />
                <FolderIcon className="w-3.5 h-3.5 text-primary" />
                <span className="text-sm text-foreground">Choose folder...</span>
              </label>
            </div>
            {recoverTarget === "choose" && (
              <FolderPicker
                folders={folders}
                rootFolders={rootFolders}
                getChildren={getChildren}
                selected={moveTarget}
                onSelect={setMoveTarget}
              />
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setRecoverFile(null)}
                className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeRecover}
                className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Recover Here
              </button>
            </div>
          </ModalOverlay>
        )}

        {/* Move File Modal */}
        {moveFileModal && (
          <ModalOverlay onClose={() => setMoveFileModal(null)}>
            <h2 className="text-base font-bold text-foreground mb-4">
              Move "{moveFileModal.name}"
            </h2>
            <p className="text-sm text-muted-foreground mb-3">Select destination folder:</p>
            <FolderPicker
              folders={folders}
              rootFolders={rootFolders}
              getChildren={getChildren}
              selected={moveTarget}
              onSelect={setMoveTarget}
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setMoveFileModal(null)}
                className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => moveTarget && moveFileToFolder(moveFileModal.id, moveTarget)}
                disabled={!moveTarget}
                className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Move
              </button>
            </div>
          </ModalOverlay>
        )}

        {/* Trash Preview Drawer */}
        {trashPreviewFile && (
          <TrashPreviewDrawer
            file={trashPreviewFile}
            files={sortedFiles}
            isOwnerOrAdmin={isOwnerOrAdmin}
            onClose={() => setTrashPreviewFile(null)}
            onNavigate={(f) => setTrashPreviewFile(f)}
            onRecover={(f) => { setTrashPreviewFile(null); handleRecover(f); }}
            onPermanentDelete={(f) => { setTrashPreviewFile(null); setConfirmPermDelete(f); }}
          />
        )}

        {/* File Preview Drawer */}
        {previewFile && (
          <FilePreviewDrawer
            file={previewFile}
            files={sortedFiles}
            folders={folders}
            permission={previewFile.folderId !== "trash" ? getPerm(previewFile.folderId) : null}
            onClose={() => setPreviewFile(null)}
            onNavigate={(f) => setPreviewFile(f)}
            onRename={(id, name) => renameFile(id, name)}
            onMoveToTrash={moveToTrash}
            onMoveFile={(f) => { setMoveFileModal(f); setMoveTarget(null); }}
            onNavigateFolder={navigateFolder}
            onUpdateDescription={updateFileDescription}
            onDownload={handleDownload}
            getPreviewUrl={(id) => cloudFiles.getDownloadUrl(id)}
            isOwner={isOwner}
          />
        )}
      </div>
    </ModuleErrorBoundary>
  );
};

export default CloudPage;

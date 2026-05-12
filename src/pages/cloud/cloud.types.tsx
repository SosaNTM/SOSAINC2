import React from "react";
import type { CloudFolder, CloudFile, PermissionLevel, FolderSection } from "@/lib/cloudStore";
import type { ActionMenuEntry } from "@/components/ActionMenu";
import {
  SESSION_CLOUD_UNLOCK_PREFIX,
  STORAGE_CLOUD_UNLOCK_TIMED_PREFIX,
} from "@/constants/storageKeys";

/* ── Password Strength ── */
export function getPasswordStrength(pw: string): {
  level: "weak" | "fair" | "good" | "strong";
  percent: number;
  label: string;
} {
  if (pw.length < 6) return { level: "weak", percent: 25, label: "Weak" };
  const hasMixed = /[a-z]/.test(pw) && /[A-Z]/.test(pw);
  const hasNum = /\d/.test(pw);
  const hasSym = /[^a-zA-Z0-9]/.test(pw);
  if (pw.length >= 12 && hasMixed && hasNum && hasSym)
    return { level: "strong", percent: 100, label: "Strong" };
  if (pw.length >= 8 && (hasMixed || hasNum))
    return { level: "good", percent: 75, label: "Good" };
  return { level: "fair", percent: 50, label: "Fair" };
}

export const strengthColors = {
  weak: "bg-destructive",
  fair: "bg-orange-500",
  good: "bg-yellow-500",
  strong: "bg-green-500",
};

/* ── Unlock State Helpers ── */
export function getUnlockState(folderId: string): {
  unlocked: boolean;
  expiresAt: number | null;
} {
  const session = sessionStorage.getItem(
    `${SESSION_CLOUD_UNLOCK_PREFIX}${folderId}`
  );
  if (session) return { unlocked: true, expiresAt: null };
  const timed = localStorage.getItem(
    `${STORAGE_CLOUD_UNLOCK_TIMED_PREFIX}${folderId}`
  );
  if (timed) {
    try {
      const { expiresAt } = JSON.parse(timed);
      if (expiresAt && Date.now() < expiresAt) return { unlocked: true, expiresAt };
      localStorage.removeItem(`${STORAGE_CLOUD_UNLOCK_TIMED_PREFIX}${folderId}`);
    } catch {
      /* ignore */
    }
  }
  return { unlocked: false, expiresAt: null };
}

export function setUnlockState(
  folderId: string,
  remember: "none" | "session" | "timed",
  timeoutMinutes?: number
) {
  if (remember === "session") {
    sessionStorage.setItem(`${SESSION_CLOUD_UNLOCK_PREFIX}${folderId}`, "1");
  } else if (remember === "timed") {
    const expiresAt = Date.now() + (timeoutMinutes || 30) * 60 * 1000;
    localStorage.setItem(
      `${STORAGE_CLOUD_UNLOCK_TIMED_PREFIX}${folderId}`,
      JSON.stringify({ expiresAt })
    );
  }
}

export function clearUnlockState(folderId: string) {
  sessionStorage.removeItem(`${SESSION_CLOUD_UNLOCK_PREFIX}${folderId}`);
  localStorage.removeItem(`${STORAGE_CLOUD_UNLOCK_TIMED_PREFIX}${folderId}`);
}

/* ── Reusable Modal Overlay ── */
export function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.72)" }} onClick={onClose} />
      <div className="fixed z-[90] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[480px] max-h-[90vh] overflow-y-auto" style={{ background: "var(--sosa-bg)", border: "1px solid var(--glass-border)" }}>
        {children}
      </div>
    </>
  );
}


/* ── Shared prop interfaces for Cloud sub-components ── */

export interface FolderViewProps {
  folders: CloudFolder[];
  files: CloudFile[];
  sections: FolderSection[];
  currentFolderId: string | null;
  currentFolder: CloudFolder | null;
  currentFolderUnlocked: boolean;
  currentFolderUnlockState: { unlocked: boolean; expiresAt: number | null } | null;
  currentSubfolders: CloudFolder[];
  currentSections: FolderSection[];
  sortedFiles: CloudFile[];
  unsectionedFiles: CloudFile[];
  collapsedSections: Set<string>;
  view: "grid" | "list";
  sortBy: "name" | "size" | "date";
  canWrite: boolean;
  currentPerm: PermissionLevel | "read" | null;
  searchQuery: string;
  showTrash: boolean;
  isOwner: boolean;
  isOwnerOrAdmin: boolean;
  userRole: string;
  userId: string;
  newFolderName: string | null;
  renamingFileId: string | null;
  renameValue: string;
  newSectionName: string | null;
  newSectionAfter: string | null;
  renamingSectionId: string | null;
  sectionRenameValue: string;
  dragOverSectionId: string | null;
  trashCount: number;
  trashSize: number;

  // Callbacks
  setView: (v: "grid" | "list") => void;
  setSortBy: (s: "name" | "size" | "date") => void;
  setNewFolderName: (name: string | null) => void;
  setRenamingFileId: (id: string | null) => void;
  setRenameValue: (val: string) => void;
  setNewSectionName: (name: string | null) => void;
  setNewSectionAfter: (id: string | null) => void;
  setRenamingSectionId: (id: string | null) => void;
  setSectionRenameValue: (val: string) => void;
  setDragOverSectionId: (id: string | null) => void;
  setPreviewFile: (file: CloudFile | null) => void;
  setPermissionsModal: (folderId: string | null) => void;
  setShowUploadModal: (show: boolean) => void;
  setShowNewFolderModal: (show: boolean) => void;
  setConfirmDeleteFolder: (folder: CloudFolder | null) => void;
  setDeleteSectionConfirm: (section: FolderSection | null) => void;
  setConfirmEmptyTrash: (show: boolean) => void;

  // Actions
  attemptNavigateFolder: (id: string | null) => void;
  isFolderUnlocked: (folder: CloudFolder) => boolean;
  getPerm: (folderId: string) => PermissionLevel | null;
  getFileMenuItems: (file: CloudFile) => ActionMenuEntry[];
  getFolderMenuItems: (folder: CloudFolder) => ActionMenuEntry[];
  createFolder: () => void;
  renameFile: (fileId: string, newName?: string) => void;
  createSection: (name: string, afterSectionId?: string | null) => void;
  renameSection: (sectionId: string, newName: string) => void;
  moveSectionOrder: (sectionId: string, direction: "up" | "down") => void;
  moveFileToSection: (fileId: string, sectionId: string | null) => void;
  toggleSectionCollapse: (sectionId: string) => void;
  lockFolderNow: (folderId: string) => void;
}

export interface TrashViewProps {
  files: CloudFile[];
  folders: CloudFolder[];
  sortedFiles: CloudFile[];
  trashCount: number;
  trashSize: number;
  isOwnerOrAdmin: boolean;
  userRole: string;
  userId: string;

  // Callbacks
  setTrashPreviewFile: (file: CloudFile | null) => void;
  setConfirmPermDelete: (file: CloudFile | null) => void;
  setConfirmEmptyTrash: (show: boolean) => void;
  handleRecover: (file: CloudFile) => void;
}

export interface FilePreviewProps {
  file: CloudFile;
  files: CloudFile[];
  folders: CloudFolder[];
  permission: PermissionLevel | null;

  // Callbacks
  onClose: () => void;
  onNavigate: (file: CloudFile) => void;
  onRename: (id: string, name: string) => void;
  onMoveToTrash: (fileId: string) => void;
  onMoveFile: (file: CloudFile) => void;
  onNavigateFolder: (id: string | null) => void;
  onUpdateDescription: (fileId: string, desc: string) => void;
}

export type { CloudFolder, CloudFile, PermissionLevel, FolderSection };

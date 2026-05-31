export type PermissionLevel = "read" | "write" | "admin";

export interface FolderPermission {
  userId: string;
  level: PermissionLevel;
}

export interface CloudFolder {
  id: string;
  name: string;
  parentId: string | null;
  permissions: FolderPermission[];
  inheritPermissions: boolean;
  createdAt: Date;
  isDeleted?: boolean;
  // Password protection
  isLocked?: boolean;
  passwordHash?: string | null;
  passwordSetBy?: string | null;
  passwordSetAt?: Date | null;
  lockAutoTimeoutMinutes?: number;
  failedAttempts?: number;
  lockedUntil?: Date | null;
}

// Mock passwords (in real app these would be server-side hashes)
export const MOCK_FOLDER_PASSWORDS: Record<string, string> = {};

export interface CloudFile {
  id: string;
  name: string;
  folderId: string;
  size: number;
  type: "pdf" | "docx" | "xlsx" | "image" | "zip" | "pptx" | "other";
  ownerId: string;
  modifiedAt: Date;
  createdAt: Date;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: string | null;
  originalFolderId: string | null;
  originalFolderPath: string | null;
  permanentDeleteAt: Date | null;
  // Enhanced metadata
  ownerName?: string;
  description?: string | null;
  mimeType?: string;
  extension?: string;
  uploadedBy?: string;
  lastModifiedBy?: string | null;
  dimensions?: { width: number; height: number };
  duration?: number;
  sheetNames?: string[];
  pageCount?: number;
  sectionId?: string | null;
}

export interface FolderSection {
  id: string;
  folderId: string;
  name: string;
  sortOrder: number;
  isCollapsed: boolean;
  createdBy: string;
  createdAt: Date;
}

function d(daysAgo: number, h = 10): Date {
  const dt = new Date();
  dt.setDate(dt.getDate() - daysAgo);
  dt.setHours(h, 0, 0, 0);
  return dt;
}

export const INITIAL_FOLDERS: CloudFolder[] = [];

const fileBase = { isDeleted: false, deletedAt: null, deletedBy: null, originalFolderId: null, originalFolderPath: null, permanentDeleteAt: null };

export const INITIAL_FILES: CloudFile[] = [];

export const INITIAL_SECTIONS: FolderSection[] = [];

export const TOTAL_STORAGE_GB = 1024; // 1 TB
export const USED_STORAGE_GB = 0; // deprecated — used storage is now computed from real file sizes

export function getFileTypeIcon(type: CloudFile["type"]): { emoji: string; color: string } {
  switch (type) {
    case "pdf": return { emoji: "📄", color: "#ef4444" };
    case "docx": return { emoji: "📝", color: "#3b82f6" };
    case "xlsx": return { emoji: "📊", color: "#22c55e" };
    case "image": return { emoji: "🖼️", color: "#a855f7" };
    case "zip": return { emoji: "📦", color: "#f59e0b" };
    case "pptx": return { emoji: "📑", color: "#f97316" };
    default: return { emoji: "📎", color: "#6b7280" };
  }
}

export function getFileTypeLabel(type: CloudFile["type"]): string {
  switch (type) {
    case "pdf": return "PDF Document";
    case "docx": return "Word Document";
    case "xlsx": return "Spreadsheet";
    case "image": return "Image";
    case "zip": return "Archive";
    case "pptx": return "Presentation";
    default: return "File";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function getUserPermission(
  folderId: string,
  userId: string,
  userRole: string,
  folders: CloudFolder[]
): PermissionLevel | null {
  if (userRole === "owner") return "admin";

  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;

  if (!folder.inheritPermissions || !folder.parentId) {
    const perm = folder.permissions.find((p) => p.userId === userId);
    return perm?.level || null;
  }

  return getUserPermission(folder.parentId, userId, userRole, folders);
}

export function getFolderPath(folderId: string, folders: CloudFolder[]): string {
  const segments: string[] = [];
  let cur: string | null = folderId;
  while (cur) {
    const f = folders.find((x) => x.id === cur);
    if (!f) break;
    segments.unshift(f.name);
    cur = f.parentId;
  }
  return segments.join(" > ");
}

export function daysUntilPermanentDelete(file: CloudFile): number {
  if (!file.permanentDeleteAt) return 60;
  const diff = file.permanentDeleteAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function getCountdownSeverity(days: number): "normal" | "warning" | "critical" {
  if (days <= 14) return "critical";
  if (days <= 30) return "warning";
  return "normal";
}

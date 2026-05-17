import { supabase } from "@/lib/supabase";
import { toPortalUUID } from "@/lib/portalUUID";
import type { DbCloudFolder, DbCloudFile, NewDbCloudFolder, NewDbCloudFile } from "@/types/database";

// ─── Folders ─────────────────────────────────────────────────────────────────

export async function fetchFolders(
  portalId: string,
  parentId?: string | null,
): Promise<DbCloudFolder[]> {
  try {
    let query = supabase
      .from("cloud_folders")
      .select("*")
      .eq("portal_id", toPortalUUID(portalId))
      .eq("is_deleted", false)
      .order("name", { ascending: true });

    if (parentId !== undefined) {
      query = parentId === null
        ? query.is("parent_id", null)
        : query.eq("parent_id", parentId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function createFolder(
  folder: Omit<NewDbCloudFolder, "portal_id">,
  portalId: string,
): Promise<DbCloudFolder | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;
  try {
    const { data, error } = await supabase
      .from("cloud_folders")
      .insert({ ...folder, portal_id: toPortalUUID(portalId), created_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

export async function renameFolder(id: string, name: string, portalId?: string): Promise<boolean> {
  try {
    let q = supabase.from("cloud_folders").update({ name }).eq("id", id);
    if (portalId) q = q.eq("portal_id", toPortalUUID(portalId));
    const { error } = await q;
    return !error;
  } catch {
    return false;
  }
}

export async function softDeleteFolder(id: string, portalId?: string): Promise<boolean> {
  try {
    let q = supabase
      .from("cloud_folders")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (portalId) q = q.eq("portal_id", toPortalUUID(portalId));
    const { error } = await q;
    return !error;
  } catch {
    return false;
  }
}

// ─── Files ────────────────────────────────────────────────────────────────────

export async function fetchFiles(
  portalId: string,
  folderId?: string | null,
): Promise<DbCloudFile[]> {
  try {
    let query = supabase
      .from("cloud_files")
      .select("*")
      .eq("portal_id", toPortalUUID(portalId))
      .eq("is_deleted", false)
      .order("name", { ascending: true });

    if (folderId !== undefined) {
      query = folderId === null
        ? query.is("folder_id", null)
        : query.eq("folder_id", folderId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function createFileRecord(
  file: Omit<NewDbCloudFile, "portal_id">,
  portalId: string,
): Promise<DbCloudFile | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;
  try {
    const { data, error } = await supabase
      .from("cloud_files")
      .insert({ ...file, portal_id: toPortalUUID(portalId), owner_id: user.id, uploaded_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

export async function softDeleteFile(id: string, userId: string, portalId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("cloud_files")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        permanent_delete_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", id)
      .eq("portal_id", toPortalUUID(portalId));
    return !error;
  } catch {
    return false;
  }
}

export async function restoreFile(id: string, portalId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("cloud_files")
      .update({ is_deleted: false, deleted_at: null, deleted_by: null, permanent_delete_at: null })
      .eq("id", id)
      .eq("portal_id", toPortalUUID(portalId));
    return !error;
  } catch {
    return false;
  }
}

// ─── Folder lock ─────────────────────────────────────────────────────────────

export interface FolderLockUpdate {
  is_locked: boolean;
  password_hash: string | null;
  lock_auto_timeout_minutes?: number;
  password_set_at?: string | null;
}

export async function updateFolderLock(
  id: string,
  updates: FolderLockUpdate,
  portalId?: string,
): Promise<boolean> {
  try {
    let q = supabase.from("cloud_folders").update(updates).eq("id", id);
    if (portalId) q = q.eq("portal_id", toPortalUUID(portalId));
    const { error } = await q;
    return !error;
  } catch {
    return false;
  }
}

export async function fetchTrash(portalId: string): Promise<DbCloudFile[]> {
  try {
    const { data, error } = await supabase
      .from("cloud_files")
      .select("*")
      .eq("portal_id", toPortalUUID(portalId))
      .eq("is_deleted", true)
      .order("deleted_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

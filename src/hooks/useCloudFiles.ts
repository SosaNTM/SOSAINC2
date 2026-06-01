// src/hooks/useCloudFiles.ts
import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { usePortalDB } from "@/lib/portalContextDB";
import type { CloudFile } from "@/lib/cloudStore";

interface CloudFileRow {
  id: string;
  portal_id: string;
  folder_id: string;
  name: string;
  size: number;
  mime_type: string;
  s3_key: string;
  uploaded_by: string;
  created_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

function inferFileType(name: string): CloudFile["type"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx"].includes(ext)) return "docx";
  if (["xls", "xlsx"].includes(ext)) return "xlsx";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "zip") return "zip";
  if (ext === "pptx") return "pptx";
  return "other";
}

function toCloudFile(row: CloudFileRow): CloudFile {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    size: row.size,
    type: inferFileType(row.name),
    ownerId: row.uploaded_by,
    uploadedBy: row.uploaded_by,
    modifiedAt: new Date(row.created_at),
    createdAt: new Date(row.created_at),
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    deletedBy: row.deleted_by ?? null,
    originalFolderId: null,
    originalFolderPath: null,
    permanentDeleteAt: row.deleted_at
      ? new Date(new Date(row.deleted_at).getTime() + 60 * 86_400_000)
      : null,
    mimeType: row.mime_type,
  };
}

async function callPresign(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("cloud-presign", { body });
  if (error) {
    // error.context may be a Response (supabase-js v2) OR a plain object — guard before
    // calling Response methods, else ".clone is not a function" masks the real error.
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const errBody = await ctx.clone().json();
        if (errBody?.error) throw new Error(errBody.error);
      } catch {
        // body not JSON or already read — fall through to error.message
      }
    } else if (ctx && typeof ctx === "object" && "error" in ctx) {
      throw new Error(String((ctx as { error: unknown }).error));
    }
    throw new Error(error.message);
  }
  return data as Record<string, unknown>;
}

export function useCloudFiles() {
  const { currentPortalId } = usePortalDB();
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!currentPortalId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("cloud_files")
      .select("*")
      .eq("portal_id", currentPortalId)
      .order("created_at", { ascending: false });
    if (error) { setLoading(false); return; }
    setFiles((data ?? []).map((row) => toCloudFile(row as CloudFileRow)));
    setLoading(false);
  }, [currentPortalId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!currentPortalId) return;
    const channel = supabase
      .channel(`cloud-files-${currentPortalId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cloud_files", filter: `portal_id=eq.${currentPortalId}` },
        () => fetchAll()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentPortalId, fetchAll]);

  const upload = useCallback(
    async (file: File, folderId: string, folderName?: string): Promise<string | null> => {
      if (!currentPortalId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const mimeType = file.type || "application/octet-stream";

      // Proxy upload through the cloud-upload Edge Function. Browser->iDrive S3 direct
      // PUT is blocked by the bucket's missing CORS policy, so we stream bytes through
      // our function (which holds the S3 credentials) instead. The function generates
      // the file id server-side (do not trust a client-supplied id).
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/cloud-upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/octet-stream",
          "x-portal-id": currentPortalId,
          "x-folder-id": folderId,
          "x-folder-name": folderName ? encodeURIComponent(folderName) : "",
          "x-file-name": encodeURIComponent(file.name),
          "x-mime-type": mimeType,
        },
        body: file,
      });
      const text = await res.text();
      let parsed: { error?: string; folder_id?: string | null } = {};
      try { parsed = text ? JSON.parse(text) as typeof parsed : {}; } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(parsed.error ?? `Upload failed (HTTP ${res.status})`);
      await fetchAll();
      return parsed.folder_id ?? null;
    },
    [currentPortalId, fetchAll]
  );

  const getDownloadUrl = useCallback(
    async (fileId: string): Promise<string | null> => {
      if (!currentPortalId) return null;
      try {
        const { url } = await callPresign({
          operation: "download",
          portal_id: currentPortalId,
          file_id: fileId,
        });
        return url as string;
      } catch {
        return null;
      }
    },
    [currentPortalId]
  );

  const softDelete = useCallback(
    async (fileId: string): Promise<void> => {
      if (!currentPortalId) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("cloud_files")
        .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: user.id })
        .eq("id", fileId)
        .eq("portal_id", currentPortalId);
      await fetchAll();
    },
    [currentPortalId, fetchAll]
  );

  const recoverFile = useCallback(
    async (fileId: string, targetFolderId: string): Promise<void> => {
      if (!currentPortalId) return;
      await supabase
        .from("cloud_files")
        .update({ is_deleted: false, deleted_at: null, deleted_by: null, folder_id: targetFolderId })
        .eq("id", fileId)
        .eq("portal_id", currentPortalId);
      await fetchAll();
    },
    [currentPortalId, fetchAll]
  );

  const permanentDelete = useCallback(
    async (fileId: string): Promise<void> => {
      if (!currentPortalId) return;
      await callPresign({ operation: "delete", portal_id: currentPortalId, file_id: fileId });
      await fetchAll();
    },
    [currentPortalId, fetchAll]
  );

  const moveFile = useCallback(
    async (fileId: string, targetFolderId: string): Promise<void> => {
      if (!currentPortalId) return;
      await supabase
        .from("cloud_files")
        .update({ folder_id: targetFolderId })
        .eq("id", fileId)
        .eq("portal_id", currentPortalId);
      await fetchAll();
    },
    [currentPortalId, fetchAll]
  );

  const renameFile = useCallback(
    async (fileId: string, newName: string): Promise<void> => {
      if (!currentPortalId) return;
      await supabase
        .from("cloud_files")
        .update({ name: newName })
        .eq("id", fileId)
        .eq("portal_id", currentPortalId);
      await fetchAll();
    },
    [currentPortalId, fetchAll]
  );

  const emptyTrash = useCallback(async (): Promise<void> => {
    if (!currentPortalId) return;
    const trashFiles = files.filter((f) => f.isDeleted);
    await Promise.all(
      trashFiles.map(async (f) => {
        try {
          await callPresign({ operation: "delete", portal_id: currentPortalId, file_id: f.id });
        } catch {
          // best-effort: continue with remaining files
        }
      })
    );
    await fetchAll();
  }, [currentPortalId, files, fetchAll]);

  return {
    files,
    loading,
    refetch: fetchAll,
    upload,
    getDownloadUrl,
    softDelete,
    recoverFile,
    permanentDelete,
    moveFile,
    renameFile,
    emptyTrash,
  };
}

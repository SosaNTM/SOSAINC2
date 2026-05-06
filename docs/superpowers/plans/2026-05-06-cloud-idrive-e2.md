# Cloud iDrive e2 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock localStorage-based file storage in `/cloud` with real iDrive e2 (S3-compatible) storage, backed by a `cloud_files` Supabase table with proper RLS and presigned URL access via an edge function.

**Architecture:** Files are uploaded directly to iDrive e2 via presigned PUT URLs (no proxy), metadata is stored in `cloud_files` (Supabase), and downloads/deletes go through a `cloud-presign` edge function that verifies portal membership before issuing presigned URLs. Folder structure, permissions, passwords, and sections remain in localStorage — only file blobs move to real storage. The existing `CloudFile` type is reused as a display adapter (DB rows are mapped to it), so FolderView, TrashView, and FilePreviewDrawer need no changes.

**Tech Stack:** Supabase (PostgreSQL + RLS + Edge Functions), iDrive e2 (S3-compatible), AWS SDK v3 via `npm:` Deno imports, React hooks

---

## File Map

**Create:**
- `supabase/migrations/20260506000002_cloud_files.sql` — metadata table + RLS
- `supabase/functions/cloud-presign/index.ts` — presigned URL generator + S3 delete
- `src/hooks/useCloudFiles.ts` — React hook wrapping cloud_files CRUD + S3 ops

**Modify:**
- `src/pages/cloud/CloudPage.tsx` — remove localStorage file state; wire up `useCloudFiles`; change UploadModal to pass `File[]`; add download handler; async-ify mutating operations

---

## Task 1: DB Migration — cloud_files table

**Files:**
- Create: `supabase/migrations/20260506000002_cloud_files.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260506000002_cloud_files.sql
-- ============================================================================
-- cloud_files: file metadata for iDrive e2 S3-compatible storage
-- portal_id: UUID FK → portals.id (consistent with portal_members)
-- S3 key format: {portal_id}/{file_id}-{original_filename}
-- ============================================================================

CREATE TABLE IF NOT EXISTS cloud_files (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id    UUID        NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  folder_id    TEXT        NOT NULL,          -- logical folder id (from cloudStore, stored in localStorage)
  name         TEXT        NOT NULL,
  size         BIGINT      NOT NULL DEFAULT 0,
  mime_type    TEXT        NOT NULL DEFAULT 'application/octet-stream',
  s3_key       TEXT        NOT NULL UNIQUE,   -- {portal_id}/{file_id}-{name}
  uploaded_by  UUID        NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted   BOOLEAN     NOT NULL DEFAULT false,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID        REFERENCES auth.users(id)
);

ALTER TABLE cloud_files ENABLE ROW LEVEL SECURITY;

-- Portal members can read files in their portal
CREATE POLICY "cloud_files_select" ON cloud_files
  FOR SELECT TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
  );

-- Portal members can upload files to their portal
CREATE POLICY "cloud_files_insert" ON cloud_files
  FOR INSERT TO authenticated
  WITH CHECK (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
    AND uploaded_by = auth.uid()
  );

-- Portal members can soft-delete and move files
CREATE POLICY "cloud_files_update" ON cloud_files
  FOR UPDATE TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
  );

-- Hard delete (permanent) restricted to owners/admins
CREATE POLICY "cloud_files_delete" ON cloud_files
  FOR DELETE TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- Fast lookup by portal + folder + recency
CREATE INDEX IF NOT EXISTS idx_cloud_files_portal_folder
  ON cloud_files(portal_id, folder_id, created_at DESC)
  WHERE is_deleted = false;

-- Fast lookup for trash view
CREATE INDEX IF NOT EXISTS idx_cloud_files_portal_trash
  ON cloud_files(portal_id, deleted_at DESC)
  WHERE is_deleted = true;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with name `cloud_files` and the SQL above.

Expected: migration applies without error. Table `cloud_files` appears in `list_tables`.

- [ ] **Step 3: Verify table exists**

Use `mcp__claude_ai_Supabase__list_tables` to confirm `cloud_files` is present with the expected columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260506000002_cloud_files.sql
git commit -m "feat(cloud): add cloud_files table with RLS for iDrive e2 integration"
```

---

## Task 2: Edge Function — cloud-presign

**Files:**
- Create: `supabase/functions/cloud-presign/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/cloud-presign/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyJWT, checkRateLimit } from "../_shared/rateLimit.ts";

const ALLOWED_ORIGINS = [
  Deno.env.get("FRONTEND_URL") || "http://localhost:8080",
  "https://iconoff.io",
  "https://www.iconoff.io",
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const BUCKET = "sosa-cloud-prod";
const REGION = "eu-central-1";
const ENDPOINT = "https://s3.eu-central-1.idrivee2.com";
const PRESIGN_TTL_SECONDS = 300;

function getS3Client(): S3Client {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: Deno.env.get("IDRIVE_E2_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("IDRIVE_E2_SECRET_ACCESS_KEY") ?? "",
    },
    forcePathStyle: true,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  const rl = checkRateLimit(req);
  if (rl) return rl;

  const auth = await verifyJWT(req);
  if (auth instanceof Response) return auth;
  const userId = auth.sub as string;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });

  try {
    const { operation, portal_id, file_id, file_name, mime_type } =
      await req.json();

    if (!operation || !portal_id) return json({ error: "Missing operation or portal_id" }, 400);

    // Verify portal membership
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const { data: member } = await supabase
      .from("portal_members")
      .select("role")
      .eq("portal_id", portal_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!member) return json({ error: "Not a portal member" }, 403);

    const s3 = getS3Client();

    // ── Upload: generate presigned PUT URL ──────────────────────────────────
    if (operation === "upload") {
      if (!file_id || !file_name) return json({ error: "Missing file_id or file_name" }, 400);
      const s3_key = `${portal_id}/${file_id}-${file_name}`;
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3_key,
        ContentType: mime_type || "application/octet-stream",
      });
      const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });
      return json({ url, s3_key });
    }

    // ── Download: generate presigned GET URL ────────────────────────────────
    if (operation === "download") {
      if (!file_id) return json({ error: "Missing file_id" }, 400);
      const { data: fileRow } = await supabase
        .from("cloud_files")
        .select("s3_key")
        .eq("id", file_id)
        .eq("portal_id", portal_id)
        .maybeSingle();
      if (!fileRow) return json({ error: "File not found" }, 404);
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: fileRow.s3_key });
      const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });
      return json({ url });
    }

    // ── Delete: remove from S3 + delete DB row ──────────────────────────────
    if (operation === "delete") {
      if (!file_id) return json({ error: "Missing file_id" }, 400);
      const { data: fileRow } = await supabase
        .from("cloud_files")
        .select("s3_key")
        .eq("id", file_id)
        .eq("portal_id", portal_id)
        .maybeSingle();
      if (!fileRow) return json({ error: "File not found" }, 404);
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileRow.s3_key }));
      await supabase
        .from("cloud_files")
        .delete()
        .eq("id", file_id)
        .eq("portal_id", portal_id);
      return json({ ok: true });
    }

    return json({ error: "Unknown operation" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Create the function file**

Write the code above to `supabase/functions/cloud-presign/index.ts`.

- [ ] **Step 3: Set required env secrets (document only — do not execute)**

The following secrets must be set in the Supabase dashboard (Settings → Edge Functions → Secrets):
- `IDRIVE_E2_ACCESS_KEY_ID` — iDrive e2 access key
- `IDRIVE_E2_SECRET_ACCESS_KEY` — iDrive e2 secret key
- `FRONTEND_URL` — frontend origin for CORS (e.g. `https://iconoff.io`)

These are not set via code — note this in a comment at the top of the file.

- [ ] **Step 4: Deploy the edge function via MCP**

Use `mcp__claude_ai_Supabase__deploy_edge_function` with name `cloud-presign`.

- [ ] **Step 5: Run `npx tsc --noEmit` to verify no type errors introduced**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/cloud-presign/index.ts
git commit -m "feat(cloud): add cloud-presign edge function for iDrive e2 presigned URLs"
```

---

## Task 3: Hook — useCloudFiles

**Files:**
- Create: `src/hooks/useCloudFiles.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useCloudFiles.ts
import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { usePortalDB } from "@/lib/portalContextDB";
import { toast } from "sonner";
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
  if (error) throw new Error(error.message);
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
    setFiles((data ?? []).map(toCloudFile));
    setLoading(false);
  }, [currentPortalId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime: re-fetch on any change to cloud_files for this portal
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
    async (file: File, folderId: string): Promise<void> => {
      if (!currentPortalId) return;
      const fileId = crypto.randomUUID();
      const { url, s3_key } = await callPresign({
        operation: "upload",
        portal_id: currentPortalId,
        file_id: fileId,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
      });
      await fetch(url as string, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("cloud_files").insert({
        id: fileId,
        portal_id: currentPortalId,
        folder_id: folderId,
        name: file.name,
        size: file.size,
        mime_type: file.type || "application/octet-stream",
        s3_key,
        uploaded_by: user?.id,
      });
      if (error) throw new Error(error.message);
    },
    [currentPortalId]
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
    async (fileId: string, deletedBy: string): Promise<void> => {
      if (!currentPortalId) return;
      await supabase
        .from("cloud_files")
        .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: deletedBy })
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
    await Promise.all(trashFiles.map((f) => permanentDelete(f.id)));
  }, [currentPortalId, files, permanentDelete]);

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
```

- [ ] **Step 2: Write the file**

Write the code above to `src/hooks/useCloudFiles.ts`.

- [ ] **Step 3: Run `npx tsc --noEmit` to verify zero type errors**

```bash
npx tsc --noEmit
```

Expected: zero errors. If `CloudFile` fields mismatch, adjust `toCloudFile()` — the interface is in `src/lib/cloudStore.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCloudFiles.ts
git commit -m "feat(cloud): add useCloudFiles hook for iDrive e2 S3 + Supabase integration"
```

---

## Task 4: CloudPage Refactor

**Files:**
- Modify: `src/pages/cloud/CloudPage.tsx`

**What changes:**
- Remove `files` + `sections` localStorage state (lines ~532–560, ~628–630 effects)
- Add `useCloudFiles()` hook
- Add `usePortalDB()` for `currentPortalId`
- Change `UploadModal` props: `onUpload: (files: File[]) => Promise<void>` (was `(names: string[])`)
- Update `UploadModal` internals to keep actual `File[]` objects (not just names)
- Replace `mockUpload()` with async `handleRealUpload(files: File[])`
- Replace `moveToTrash()` with async version calling `cloudFiles.softDelete()`
- Replace `permanentDelete()` with async version calling `cloudFiles.permanentDelete()`
- Replace `emptyTrash()` with async version calling `cloudFiles.emptyTrash()`
- Replace `handleRecover()` / `executeRecover()` with versions calling `cloudFiles.recoverFile()`
- Replace `moveFileToFolder()` with async version calling `cloudFiles.moveFile()`
- Replace `renameFile()` with async version calling `cloudFiles.renameFile()`
- Add `handleDownload(fileId)` that calls `cloudFiles.getDownloadUrl()` → `window.open(url)`
- Add Download item to file context menu (`getFileMenuItems`)
- Remove localStorage import lines for `STORAGE_CLOUD_FILES` (keep FOLDERS, SECTIONS, COLLAPSED_SECTIONS)
- Keep: all folder state, section state, password state, permission state, UI modals, navigation

**Known limitation:** Section-to-file assignments (`sectionId`) are not persisted in DB. Files lose their section after page reload. Sections themselves (names/order) still persist in localStorage.

- [ ] **Step 1: Remove `files` localStorage state — replace with hook**

In the main `CloudPage` component (line ~509), after `const isMobile = useIsMobile();`:

Add:
```typescript
const { currentPortalId } = usePortalDB();
const cloudFiles = useCloudFiles();
```

Remove the `files` `useState` block (lines ~532–549):
```typescript
// REMOVE THIS ENTIRE BLOCK:
const [files, setFiles] = useState<CloudFile[]>(() => {
  try {
    const saved = localStorage.getItem(STORAGE_CLOUD_FILES);
    // ...
  }
  return INITIAL_FILES;
});
```

Add after `useCloudFiles()`:
```typescript
const files = cloudFiles.files;
```

Remove the localStorage persistence effect for files (line ~629):
```typescript
// REMOVE:
useEffect(() => { localStorage.setItem(STORAGE_CLOUD_FILES, JSON.stringify(files)); }, [files]);
```

Remove `STORAGE_CLOUD_FILES` from the import at the top.

- [ ] **Step 2: Update `UploadModal` to accept `File[]`**

Change the `UploadModal` component signature and internals:

```typescript
function UploadModal({
  currentFolderId,
  folders,
  onClose,
  onUpload,
}: {
  currentFolderId: string | null;
  folders: CloudFolder[];
  onClose: () => void;
  onUpload: (files: File[]) => Promise<void>;  // changed from (names: string[]) => void
}) {
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);  // changed from string[]
  const [uploading, setUploading] = useState(false);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadFiles(Array.from(e.target.files || []));  // keep File objects, not just names
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    try {
      await onUpload(uploadFiles);
    } finally {
      setUploading(false);
    }
  };

  const targetFolder = currentFolderId
    ? folders.find((f) => f.id === currentFolderId)?.name
    : "Root";

  return (
    <ModalOverlay onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground mb-4">Upload Files</h2>
      <label className="flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed border-border rounded-xl p-8 mb-4 hover:border-primary/50 transition-colors bg-muted/30">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
        <span className="text-sm text-muted-foreground">Drop files here or click to browse</span>
        <input type="file" multiple className="hidden" onChange={handleFiles} />
      </label>
      <p className="text-xs text-muted-foreground mb-3">
        Destination: <strong className="text-foreground">{targetFolder}</strong>
      </p>
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
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose}
          className="text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleUpload}
          disabled={uploadFiles.length === 0 || uploading}
          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
    </ModalOverlay>
  );
}
```

- [ ] **Step 3: Replace `mockUpload()` with `handleRealUpload()`**

Remove the entire `mockUpload` function (lines ~1148–1176).

Add in its place:

```typescript
const handleRealUpload = async (actualFiles: File[]) => {
  if (!currentFolderId) {
    toast.error("Select a folder first");
    return;
  }
  let successCount = 0;
  const folderName = folders.find((f) => f.id === currentFolderId)?.name || "Root";
  for (const file of actualFiles) {
    try {
      await cloudFiles.upload(file, currentFolderId);
      successCount++;
    } catch {
      toast.error(`Failed to upload ${file.name}`);
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
```

Update the `UploadModal` JSX usage in the return statement:
```typescript
// Find: onUpload={mockUpload}
// Replace with:
onUpload={handleRealUpload}
```

- [ ] **Step 4: Replace `moveToTrash()` with async version**

Remove the old `moveToTrash` function.

Add:
```typescript
const moveToTrash = useCallback(async (fileId: string) => {
  const file = files.find((f) => f.id === fileId);
  const folderName = file ? getFolderPath(file.folderId, folders) : "";
  await cloudFiles.softDelete(fileId, userId);
  toast.success("Moved to Trash");
  if (file)
    addAuditEntry({
      userId, action: `Moved "${file.name}" to Trash`, category: "cloud",
      details: `From ${folderName}`, icon: "🗑️",
    });
}, [files, folders, userId, cloudFiles]);
```

- [ ] **Step 5: Replace `permanentDelete()` with async version**

Remove the old `permanentDelete` function.

Add:
```typescript
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
```

- [ ] **Step 6: Replace `emptyTrash()` with async version**

Remove the old `emptyTrash` function.

Add:
```typescript
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
```

- [ ] **Step 7: Replace `handleRecover()` and `executeRecover()` with async versions**

Remove both old recover functions.

Add:
```typescript
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
  // Use first root folder as fallback target
  const targetId =
    recoverTarget === "root"
      ? (folders.find((f) => f.parentId === null && !f.isDeleted)?.id ?? folders[0]?.id)
      : moveTarget ?? folders[0]?.id;
  if (!targetId) return;
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
```

- [ ] **Step 8: Replace `moveFileToFolder()` with async version**

Remove the old `moveFileToFolder` function.

Add:
```typescript
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
```

- [ ] **Step 9: Replace `renameFile()` with async version**

Remove the old `renameFile` function.

Add:
```typescript
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
```

- [ ] **Step 10: Add download handler and wire to file context menu**

Add after `renameFile`:
```typescript
const handleDownload = useCallback(async (fileId: string) => {
  const url = await cloudFiles.getDownloadUrl(fileId);
  if (!url) { toast.error("Could not generate download link"); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}, [cloudFiles]);
```

In `getFileMenuItems`, add a Download entry before the existing items:
```typescript
const getFileMenuItems = (file: CloudFile): ActionMenuEntry[] => {
  const perm = getPerm(file.folderId);
  const canW = perm === "write" || perm === "admin";
  // ... existing section menu items ...
  return [
    {
      label: "Download",
      icon: Download,  // already imported from lucide-react
      onClick: () => handleDownload(file.id),
    },
    // ... rest of existing menu items (rename, move, delete, etc.) ...
  ];
};
```

- [ ] **Step 11: Update imports at the top of CloudPage.tsx**

Add:
```typescript
import { useCloudFiles } from "@/hooks/useCloudFiles";
import { usePortalDB } from "@/lib/portalContextDB";
```

Remove `STORAGE_CLOUD_FILES` from the storage keys import (keep `STORAGE_CLOUD_FOLDERS`, `STORAGE_CLOUD_SECTIONS`, `STORAGE_CLOUD_COLLAPSED_SECTIONS`).

Remove `INITIAL_FILES` from the cloudStore import (keep `INITIAL_FOLDERS`, `INITIAL_SECTIONS`, etc.).

- [ ] **Step 12: Run `npx tsc --noEmit`**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any remaining type mismatches (the most likely issues are `async` callbacks passed to non-async prop types — add `void` cast where needed, e.g. `onClick={() => void handleDownload(file.id)}`).

- [ ] **Step 13: Commit**

```bash
git add src/pages/cloud/CloudPage.tsx src/hooks/useCloudFiles.ts
git commit -m "feat(cloud): wire CloudPage to useCloudFiles — real upload/download/delete via iDrive e2"
```

---

## Task 5: Multi-Portal Isolation Verification

**Files:** No new files — read-only audit

- [ ] **Step 1: Verify S3 key prefix isolates by portal**

Check `useCloudFiles.ts` upload call: the `s3_key` is constructed in the edge function as `${portal_id}/${file_id}-${file_name}`. Since `portal_id` is UUID and is the first path segment, all files for a portal are under a unique prefix. Cross-portal access is impossible via presigned URLs since the edge function checks `portal_members` before issuing any URL.

Confirm: the edge function calls `portal_members` check for every operation (upload, download, delete). ✓

- [ ] **Step 2: Verify RLS blocks cross-portal DB reads**

The `cloud_files_select` policy:
```sql
USING (portal_id IN (SELECT portal_id FROM portal_members WHERE user_id = auth.uid()))
```
A user authenticated in portal A cannot read files from portal B. ✓

- [ ] **Step 3: Verify `useCloudFiles` scopes all queries by `currentPortalId`**

Every Supabase query in `useCloudFiles.ts` includes `.eq("portal_id", currentPortalId)`. The realtime subscription filter also uses `portal_id=eq.${currentPortalId}`. ✓

- [ ] **Step 4: Verify no stale files across portal switch**

`fetchAll` is in `useCallback([currentPortalId])` and triggered in `useEffect([fetchAll])`. When the user switches portal (and `currentPortalId` changes), `fetchAll` re-runs automatically, replacing `files` with the new portal's data. ✓

- [ ] **Step 5: Commit verification note**

```bash
git commit --allow-empty -m "chore(cloud): confirm multi-portal isolation for iDrive e2 file storage"
```

---

## Self-Review Checklist

- [x] Migration has proper UUID FK to `portals(id)` (consistent with `portal_members`)
- [x] Edge function verifies portal membership before any presigned URL
- [x] S3 key prefixed by `portal_id` — physical isolation at storage layer
- [x] RLS policies on all four operations (SELECT, INSERT, UPDATE, DELETE)
- [x] `useCloudFiles` scopes all queries by `currentPortalId`
- [x] Realtime subscription scoped by portal filter
- [x] UploadModal changed from `string[]` to `File[]` — real File objects reach S3
- [x] All async mutations (softDelete, permanentDelete, moveFile, renameFile, recoverFile) properly awaited
- [x] Download handler opens presigned GET URL in new tab (no file proxy)
- [x] Folder tree, permissions, password protection, sections — all untouched (remain in localStorage)
- [x] `toCloudFile()` maps DB row to `CloudFile` shape — FolderView/TrashView/FilePreviewDrawer unchanged
- [x] `crypto.randomUUID()` used for file IDs — no uuid package dependency needed
- [x] `supabase.functions.invoke()` handles auth token automatically — no manual header construction

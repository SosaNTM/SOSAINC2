# Audit Report — Cloud Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Notes |
|---|---|---|
| `/:portalId/cloud` | `CloudPage` | Root view + folder navigation |
| `/:portalId/cloud/trash` | `TrashView` | Soft-deleted files |
| `/:portalId/cloud/preview/:id` | `FilePreview` | File preview (inline) |

### Architecture

```
Cloud
├── Files/Folders UI    ← React state + localStorage (folders, sections, permissions)
├── File data           ← iDrive E2 via presigned URLs (real, edge function: cloud-presign)
├── File metadata       ← Supabase cloud_files table (real)
├── Trash               ← soft-delete via is_deleted flag (real)
└── Realtime            ← Supabase postgres_changes subscription (real)
```

### Data model

| Entity | Persistence | Table / Key |
|---|---|---|
| File metadata | Supabase | `cloud_files` |
| File binary data | iDrive E2 object storage | via `s3_key` column |
| Folder structure | **localStorage only** | `STORAGE_CLOUD_FOLDERS` |
| Folder sections | **localStorage only** | `STORAGE_CLOUD_SECTIONS` |
| Collapsed state | **localStorage only** | `STORAGE_CLOUD_COLLAPSED_SECTIONS` |
| Folder permissions | **localStorage only** | embedded in folder objects |
| Folder passwords | **in-memory only** | `MOCK_FOLDER_PASSWORDS` (reset on page load) |
| Storage usage (total/used) | **Hardcoded constants** | `cloudStore.ts` |

### What works correctly (notable)

- File upload via presigned URL (edge function) → iDrive E2 → metadata in Supabase
- Soft-delete / recovery / permanent delete with proper `user.id` via real auth
- Realtime subscription on `cloud_files` via Postgres changes
- Uses `usePortalDB()` (correct) — not the legacy slug-based `usePortal()`
- Per-file `portal_id` scoping with the actual DB UUID
- Trash: `permanentDeleteAt` computed from `deleted_at + 60 days`

---

## Findings

### 🟠 P1 — Folder structure (names, hierarchy) is localStorage-only

**File:** `src/pages/cloud/CloudPage.tsx:3–6`

```ts
import {
  STORAGE_CLOUD_FOLDERS, STORAGE_CLOUD_SECTIONS,
  STORAGE_CLOUD_COLLAPSED_SECTIONS,
} from "@/constants/storageKeys";
```

All folder data — names, parent hierarchy, creation metadata — is stored exclusively in browser localStorage. Files are correctly persisted in Supabase + iDrive E2, but their organizational structure is not.

Consequences:
- A second portal member opening Cloud on their device sees all files dumped in the root with no folder structure.
- Clearing browser data destroys the entire folder tree. Files still exist in S3+DB with their `folder_id` FK pointing to a folder that no longer exists locally.
- Creating or moving folders on one device has no effect on other devices.

**Fix required:** Create a `cloud_folders` table in Supabase (`id`, `portal_id`, `name`, `parent_id`, `created_by`, `created_at`, `is_locked`). Migrate folder CRUD to Supabase. Use the existing `usePortalData<CloudFolder>("cloud_folders")` pattern from `CLAUDE.md`.

---

### 🟠 P1 — Folder permission system is localStorage-only and uses mock user IDs

**File:** `src/pages/cloud/CloudPage.tsx:150–250`

```ts
const save = () => {
  setFolders((prev) =>
    prev.map((f) => f.id === folder.id ? { ...f, permissions: localPerms, ... } : f)
  );
  // No Supabase write anywhere
};
```

The `PermissionsModalUI` saves permission changes to React state (backed by localStorage). Key issues:

1. **No persistence:** Permission changes are lost on page reload or across devices.
2. **Mock users only:** `ALL_USERS` is the hardcoded list from `authContext.tsx`. Real Supabase users are not in this list. The permission modal renders fake users only and any permissions assigned to them are meaningless in production.
3. **No server enforcement:** Access control is entirely client-side. Any user who bypasses the UI can access any folder's contents since there is no Supabase RLS or server check on folder permissions.

**Fix required:** Create a `cloud_folder_permissions` table (`folder_id`, `user_id`, `level`, `portal_id`). Fetch real `portal_members` for the permission editor. Enforce permissions server-side via RLS.

---

### 🟠 P1 — Storage usage KPIs are hardcoded mock numbers

**File:** `src/lib/cloudStore.ts:83–84`

```ts
export const TOTAL_STORAGE_GB = 10;
export const USED_STORAGE_GB = 4.2;
```

`StorageOverview` renders a progress bar showing "4.2 GB / 10 GB used." These numbers are static constants unrelated to the actual files uploaded. A user who uploads 50 MB of files still sees 4.2 GB used. A user who uploads 8 GB of files still sees 4.2 GB used.

**Fix required:** Compute used storage from `SUM(size)` of non-deleted `cloud_files` records for the portal. Query from Supabase or derive from the already-fetched `files` array in `useCloudFiles`.

---

### 🟠 P1 — Folder password protection is in-memory — reset on every page load

**File:** `src/lib/cloudStore.ts:26–27`

```ts
// Mock passwords (in real app these would be server-side hashes)
export const MOCK_FOLDER_PASSWORDS: Record<string, string> = {};
```

The map starts empty on every browser load. Any password set on a folder persists only for the lifetime of the current page session. After refresh, the password is gone and the folder is effectively unlocked to everyone. Since folder structure itself is localStorage (see P1 above), the lock state is also lost.

**Fix required:** Store password hashes in the `cloud_folders` Supabase table. Use bcrypt/Argon2 server-side or at minimum a server-verified approach. Client-side password comparison is not secure (the hash can be extracted from the JS bundle).

---

### 🟠 P1 — `moveFile` and `renameFile` have no `user_id` ownership check

**File:** `src/hooks/useCloudFiles.ts:195–219`

```ts
const moveFile = async (fileId: string, targetFolderId: string) => {
  await supabase
    .from("cloud_files")
    .update({ folder_id: targetFolderId })
    .eq("id", fileId)
    .eq("portal_id", currentPortalId);  // no uploaded_by check
};

const renameFile = async (fileId: string, newName: string) => {
  await supabase
    .from("cloud_files")
    .update({ name: newName })
    .eq("id", fileId)
    .eq("portal_id", currentPortalId);  // no uploaded_by check
};
```

Any portal member can rename or move any other member's file — they only need the file ID and the portal context.

`softDelete` does pass `deleted_by: user.id` but also does not filter by `uploaded_by`. Any member can soft-delete any other member's file.

**Fix required:** Add `.eq("uploaded_by", user.id)` to `moveFile`, `renameFile`, `softDelete` for member-owned files. Owners/admins can override via a separate admin path. Enforce via RLS: `(uploaded_by = auth.uid()) OR (portal role >= admin)`.

---

### 🟠 P1 — `emptyTrash` permanently deletes all trash — not just own files

**File:** `src/hooks/useCloudFiles.ts:221–234`

```ts
const emptyTrash = async () => {
  const trashFiles = files.filter((f) => f.isDeleted);  // all deleted files in portal
  await Promise.all(trashFiles.map(async (f) => {
    await callPresign({ operation: "delete", ... });
  }));
};
```

Any portal member can permanently delete all files in the trash, including files deleted by others and uploaded by the owner. `emptyTrash` is not gated by any role check or ownership filter.

**Fix required:** Gate `emptyTrash` behind the `cloud:delete` permission (currently `["owner", "admin"]` in `permissions.ts`). Or at minimum, only include files where `deleted_by === user.id` in the empty-trash operation.

---

### 🟡 P2 — `getUserById` returns `undefined` for real Supabase users

**File:** `src/pages/cloud/FolderView.tsx:6`

```ts
import { getUserById } from "@/lib/authContext";
```

`getUserById` searches `ALL_USERS` — the hardcoded mock user list. In production (real auth), file `uploaded_by` fields contain real Supabase UUIDs not present in `ALL_USERS`. Any UI that calls `getUserById(file.uploadedBy)` to display uploader names returns `undefined` for real users, causing blank or "Unknown" attribution throughout the Cloud UI.

**Fix required:** Fetch actual user display names from `portal_members` joined with `user_profiles` (or a `profiles` table). Cache by user ID.

---

### 🟡 P2 — No client-side file size limit before upload attempt

**File:** `src/pages/cloud/CloudPage.tsx:94–106` (UploadModal)

The upload modal accepts any file, shows its size for reference, but has no client-side validation. If the presign edge function or iDrive E2 enforces a size limit, the user gets an error mid-upload after the PUT has already been attempted. No friendly pre-upload size guidance is shown.

**Fix required:** Define a `MAX_FILE_BYTES` constant (aligned with edge function limit). Validate in the modal and show an inline error before the upload button is enabled.

---

### 🟡 P2 — Realtime subscription triggers full re-fetch on any change

**File:** `src/hooks/useCloudFiles.ts:93–104`

```ts
.on("postgres_changes", { event: "*", table: "cloud_files", ... }, () => fetchAll())
```

Every insert, update, or delete on `cloud_files` triggers `fetchAll()` — a full `SELECT *` from the entire portal's file list. For portals with thousands of files, this generates significant read load on simultaneous uploads or deletions.

**Fix required:** For INSERT events, append the new row to state directly. For UPDATE/DELETE, patch or remove the specific row. Only fall back to `fetchAll()` for edge cases.

---

### 🔵 P3 — Folder color / icon metadata not persisted (only in localStorage)

**Observation:** Folder objects in localStorage carry no `color` or `icon` field from the type definition in `cloudStore.ts`. Any custom styling applied to folders would also be lost on browser clear. Low priority since the UI doesn't appear to expose color/icon customization yet.

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🟠 P1 | Folder structure (names, hierarchy) localStorage-only — invisible to other devices | `CloudPage.tsx`, `cloudStore.ts` |
| 2 | 🟠 P1 | Folder permissions localStorage-only + mock users only — no server enforcement | `CloudPage.tsx` |
| 3 | 🟠 P1 | Storage usage KPIs are hardcoded mock numbers | `cloudStore.ts` |
| 4 | 🟠 P1 | Folder password protection in-memory — reset on every page load | `cloudStore.ts` |
| 5 | 🟠 P1 | `moveFile` / `renameFile` / `softDelete` have no `user_id` ownership filter | `useCloudFiles.ts` |
| 6 | 🟠 P1 | `emptyTrash` permanently deletes all portal trash — not just own files | `useCloudFiles.ts` |
| 7 | 🟡 P2 | `getUserById` returns undefined for real Supabase users | `FolderView.tsx` |
| 8 | 🟡 P2 | No client-side file size validation in upload modal | `CloudPage.tsx` |
| 9 | 🟡 P2 | Realtime subscription triggers full re-fetch on every change | `useCloudFiles.ts` |
| 10 | 🔵 P3 | Folder color/icon not persisted | `cloudStore.ts` |

---

## Recommended action

Cloud has the best real infrastructure of any section in the app (iDrive E2 storage, presigned URLs, realtime). The P1 issues are concentrated in the folder/permission layer, which was clearly left as "phase 2" work after the file storage backend was implemented.

**Priority order:**
1. Migrate folders to Supabase `cloud_folders` table — this unblocks multi-device use and makes permissions meaningful.
2. Fix `emptyTrash` ownership filter — safety-critical, easy fix.
3. Fix `moveFile`/`renameFile` ownership — security gap, easy fix.
4. Compute real storage usage from the already-fetched file list.

---

## Handoff

Next audit: **Tasks** (`audit-reports/tasks.md`).

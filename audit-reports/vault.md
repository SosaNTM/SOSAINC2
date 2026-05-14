# Audit Report — Vault Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Notes |
|---|---|---|
| `/:portalId/vault` | `VaultPage` | Credentials + API Keys + Documents + Notes + Files |

### Sub-page tree

```
Vault
├── All            ← Credential / API Key / Document / Note items + Locked Folder section
├── Credentials    ← Globe icon items (type = "credential")
├── API Keys       ← Key icon items (type = "api_key")
├── Documents      ← FileText icon items (type = "document" | "note")
├── Files          ← VaultFilesTab (Supabase Storage-backed)
└── Locked         ← Password-gated subsection showing is_locked items
```

### Data model

| Entity | Persistence | Table / Path |
|---|---|---|
| Vault items (credentials, API keys, notes) | Supabase `vault_items` + localStorage cache | `SOSA INC_vault_items_${portalId}` |
| Document files (type=document) | Base64 in `encrypted_data` DB column | No separate storage |
| Vault files (Files tab) | Supabase Storage `vault-files` + metadata in `vault_files` table + localStorage cache | `SOSA INC_vault_files_${portalId}` |
| Access history | Supabase `vault_item_history` | per item insert |
| Locked folder unlock state | `sessionStorage` | `SESSION_VAULT_UNLOCKED` |

### Permission model

| Permission | Roles |
|---|---|
| `vault:view` | owner, admin, member (not manager, not viewer) |
| `vault:create` | owner, admin, member |
| `vault:manage` | owner only |

---

## Findings

### 🔴 P0 — `encrypted_data` column stores plaintext JSON — no encryption exists

**Files:** `src/lib/services/vaultService.ts:6–10`, `src/pages/VaultPage.tsx:381–392`

The column is named `encrypted_data` and the service file opens with a comment:

```ts
/**
 * SECURITY NOTE:
 * encrypted_data must be encrypted client-side before calling createVaultItem/updateVaultItem.
 * Never pass plaintext credentials to this service.
 * Recommended: encrypt with AES-256-GCM using a user-derived key before storing.
 */
```

Yet in `VaultPage.tsx`, credentials are serialised as raw JSON and passed directly:

```ts
payload = { username, password, url, notes };
// ...
const result = await createVaultItem(
  { encrypted_data: JSON.stringify(payload), ... },
  portalId,
);
```

No encryption call exists anywhere in the codebase. Every password, API key, and sensitive note stored in the Vault is readable as plaintext by:
- Any Supabase dashboard user with DB access
- Any compromised service key
- Any SQL exposure

The field name provides a false sense of security to both developers and users.

**Fix required:** Implement AES-256-GCM client-side encryption keyed by a user-derived secret (PBKDF2 from user password or a per-user key stored in a separate secure table). Encrypt `payload` before `JSON.stringify`. Store the IV alongside the ciphertext. This is a non-trivial change requiring a migration strategy for existing stored items.

---

### 🔴 P0 — Locked folder password hardcoded in JS bundle

**File:** `src/lib/vaultStore.ts:24`

```ts
export const LOCKED_FOLDER_PASSWORD = "vault2025";
```

This string is compiled into the production JavaScript bundle. Any user who opens DevTools → Sources → searches for `vault2025` or `LOCKED_FOLDER_PASSWORD` finds the password immediately. The client-side comparison at `VaultPage.tsx:691`:

```ts
if (lockPassword === LOCKED_FOLDER_PASSWORD) {
```

…is a string comparison against a constant embedded in the bundle. The locked folder provides **zero security**. Every authenticated portal member can unlock it without knowing the intended password.

**Fix required:** Remove client-side password verification entirely. Gate locked items via a server-side RLS policy that requires a separate auth factor (e.g., a re-authentication check via `supabase.auth.reauthenticate()`), or move locked-item decryption to require a user-supplied key that never leaves the client but is derived from the user's credentials.

---

### 🔴 P0 — Delete action removes item from UI only — database record persists

**File:** `src/pages/VaultPage.tsx:733`

```ts
const deleteItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
```

`VaultCard` receives `onDelete={deleteItem}` (line 765). When a user clicks Delete, this local state updater removes the item from React state. It never calls `deleteVaultItem()` from `vaultService.ts`. On page reload, all "deleted" credentials reappear from the database.

`deleteVaultItem` exists and is fully implemented in `vaultService.ts:93–105` (with optimistic local deletion + rollback), but is never invoked from the UI.

**Fix required:**
```ts
const deleteItem = async (id: string) => {
  const ok = await deleteVaultItem(id, portalId);
  if (ok) setItems((prev) => prev.filter((i) => i.id !== id));
  else toast({ title: "Delete failed", variant: "destructive" });
};
```

---

### 🔴 P0 — `PORTAL_UUID_MAP` is hardcoded for 4 portals — new portals silently fail

**File:** `src/lib/portalUUID.ts:6–11`

```ts
export const PORTAL_UUID_MAP: Record<string, string> = {
  sosa: "00000000-0000-0000-0000-000000000001",
  keylo: "00000000-0000-0000-0000-000000000002",
  redx: "00000000-0000-0000-0000-000000000003",
  trustme: "00000000-0000-0000-0000-000000000004",
};
```

Every Vault operation calls `toPortalUUID(portalSlug)` which falls back to the slug string itself if not found:

```ts
export function toPortalUUID(portalSlug: string): string {
  return PORTAL_UUID_MAP[portalSlug] ?? portalSlug;
}
```

The Hub allows creating additional portals. Any vault item created for a portal not in this map gets stored with a slug string (e.g., `"newclient"`) as `portal_id`. This cannot match a UUID-typed column in Postgres and silently fails or produces an RLS bypass depending on column type.

The same map is used throughout the app for every Supabase table that uses `portal_id`. This architectural assumption breaks multi-tenancy beyond 4 portals.

**Fix required:** Replace the static map with a dynamic lookup. `usePortalDB()` already provides `currentPortalId` as the actual DB UUID. Use it instead of converting from slug. Audit all calls to `toPortalUUID` and replace with the DB UUID from context.

---

### 🟠 P1 — Document type stores entire file as base64 in DB column (up to 10 MB)

**File:** `src/pages/VaultPage.tsx:388–390`

```ts
const base64 = await readFileAsBase64(docFile);
payload = { filename: docFile.name, size: docFile.size, mimeType: docFile.type, data: base64 };
```

A 10 MB file becomes ~13.3 MB of base64 stored in the `encrypted_data` text column. This:
1. Bloats the `vault_items` table with binary data that belongs in object storage.
2. Forces the entire file through the JSON payload on every select.
3. Is capped at 10 MB in the UI but the Files tab allows 50 MB — inconsistent UX.
4. Is never cleaned from the DB when the item is "deleted" (see P0 above).

The `VaultFilesTab` already uses Supabase Storage correctly for the Files tab. Document items should use the same path.

**Fix required:** For `type === "document"`, upload the file to Supabase Storage `vault-files` (as `VaultFilesTab` does) and store only the `file_path` in `encrypted_data`. Remove the `data` base64 field from document items.

---

### 🟠 P1 — `updateVaultItem` / `deleteVaultItem` have no `user_id` ownership filter

**File:** `src/lib/services/vaultService.ts:76–104`

```ts
.update(updates).eq("id", id).eq("portal_id", toPortalUUID(portalId))  // no user_id
.delete().eq("id", id).eq("portal_id", toPortalUUID(portalId))          // no user_id
```

The UI gates delete behind `vault:manage` (owner-only), but the service layer has no ownership enforcement. Any portal member with direct Supabase API access (or a compromised frontend) can call the mutation with any item ID and overwrite or delete another user's credentials.

RLS on `vault_items` should enforce `user_id = auth.uid()` on UPDATE and DELETE.

**Fix required:** Add `.eq("user_id", authenticatedUserId)` to all mutating queries. Verify or create RLS policies on `vault_items` enforcing `user_id = auth.uid()` for mutations.

---

### 🟠 P1 — `vault:create` permission defined but never checked

**File:** `src/pages/VaultPage.tsx:786`

```tsx
<button type="button" onClick={() => setShowNewModal(true)} ...>
  <Plus className="w-4 h-4" /> New Item
</button>
```

`usePermission("vault:create")` is defined in `permissions.ts` (roles: owner, admin, member) but is never called in `VaultPage`. The "New Item" button is shown to anyone with `vault:view`. The `create` call inside `NewItemModal` is also ungated. This means the permission config diverges from the actual enforcement.

**Fix required:** `const canCreate = usePermission("vault:create");` and conditionally render the "New Item" button.

---

### 🟠 P1 — `vaultItemTypeSchema` enum in validation schema conflicts with actual types

**File:** `src/lib/validation/schemas.ts:93`

```ts
export const vaultItemTypeSchema = z.enum(["password", "card", "note", "identity", "other"]);
```

The app uses types `"credential" | "api_key" | "document" | "note"` (defined in `vaultStore.ts:1`). The schema enum defines entirely different values (`"password"`, `"card"`, `"identity"`, `"other"`). The `newVaultItemSchema.type` field uses `z.string().min(1)` — not this enum — so validation passes, but the enum is dead code that suggests a past or future design intent mismatched with the implementation.

**Fix required:** Update `vaultItemTypeSchema` to `z.enum(["credential", "api_key", "document", "note"])` and use it in `newVaultItemSchema.type`.

---

### 🟡 P2 — localStorage fallback stores 50 MB base64 data-URLs (quota exceeded risk)

**File:** `src/lib/services/vaultFileService.ts:113–133`

When Supabase Storage is unreachable, `uploadVaultFile` reads the entire file as a base64 data-URL and stores it in localStorage under `SOSA INC_vault_files_${portalId}`. localStorage is limited to ~5–10 MB per origin. Uploading any file larger than ~3.5 MB (base64 overhead ≈ 33%) silently throws a `QuotaExceededError`, lost in the `catch` block. The user sees "saved locally" but the data was not actually saved.

**Fix required:** Catch `QuotaExceededError` explicitly and display an error toast instead of a success message. Or remove the localStorage fallback entirely for files (it is impractical for large files).

---

### 🟡 P2 — Vault localStorage cache not invalidated on logout

**Files:** `src/lib/services/vaultService.ts:39`, `src/lib/services/vaultFileService.ts:65`

Both services write a fresh copy of vault data to localStorage on every successful fetch:

```ts
writeLocal(portalId, result);  // vaultService
writeLocal(portalId, rows);    // vaultFileService
```

These keys are never cleared on logout. A second user logging in on the same browser will briefly see the previous user's vault contents (credentials, API keys) from the localStorage cache before the fresh Supabase fetch completes.

**Fix required:** Clear all `SOSA INC_vault_*` localStorage keys on logout (in `AuthProvider`'s sign-out handler).

---

### 🟡 P2 — `VaultPage` uses `usePortal()` (legacy) instead of `usePortalDB()`

**File:** `src/pages/VaultPage.tsx:605–610`

```ts
const { portal } = usePortal();
// ...
const portalId = portal?.id ?? "sosa";
```

`usePortal()` provides the portal **slug** (`"sosa"`, `"redx"`), not the DB UUID. While `vaultService.ts` calls `toPortalUUID()` to convert slugs to UUIDs, this indirection only works for the 4 hardcoded portals (see P0 above). `CLAUDE.md` explicitly states: "Always use `usePortalDB()` — not the older `usePortal()`."

**Fix required:** Replace `usePortal()` with `usePortalDB()` and use `currentPortalId` (the actual DB UUID) directly, removing the need for `toPortalUUID()` in the Vault code path.

---

### 🔵 P3 — "View details" ActionMenu item has an empty handler

**File:** `src/pages/VaultPage.tsx:183`

```ts
{ id: "details", icon: <Eye className="w-3.5 h-3.5" />, label: "View details", onClick: () => {} },
```

Clicking "View details" does nothing. This is a stub menu entry.

**Fix required:** Either implement a detail drawer/modal for the item, or remove the menu entry.

---

### 🔵 P3 — Auto-lock timer is "10 minutes since unlock" not "10 minutes of inactivity"

**File:** `src/pages/VaultPage.tsx:672–684`

```ts
const resetAutoLock = useCallback(() => {
  if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
  autoLockTimerRef.current = setTimeout(() => { setIsUnlocked(false); ... }, 10 * 60 * 1000);
}, [toast]);

useEffect(() => {
  if (isUnlocked) resetAutoLock();
  ...
}, [isUnlocked, resetAutoLock]);
```

`resetAutoLock` is called only when `isUnlocked` changes (on unlock). It does not reset on user activity (mousemove, keypress, copy actions). The UI message "Auto-locks in 10 minutes of inactivity" is inaccurate — the timer is fixed from unlock regardless of activity.

**Fix required:** Add `document.addEventListener("mousemove"/"keydown", resetAutoLock)` while the vault is unlocked, or correct the UI copy to "Auto-locks 10 minutes after unlock."

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🔴 P0 | `encrypted_data` column stores plaintext — no encryption exists | `VaultPage.tsx`, `vaultService.ts` |
| 2 | 🔴 P0 | Locked folder password `"vault2025"` hardcoded in JS bundle | `vaultStore.ts` |
| 3 | 🔴 P0 | Delete only removes from React state — DB record persists | `VaultPage.tsx` |
| 4 | 🔴 P0 | `PORTAL_UUID_MAP` hardcodes 4 portals — new portals silently fail | `portalUUID.ts` |
| 5 | 🟠 P1 | Document type stores 10 MB file as base64 in DB column | `VaultPage.tsx` |
| 6 | 🟠 P1 | `updateVaultItem`/`deleteVaultItem` have no `user_id` ownership filter | `vaultService.ts` |
| 7 | 🟠 P1 | `vault:create` permission defined but never checked | `VaultPage.tsx` |
| 8 | 🟠 P1 | `vaultItemTypeSchema` enum conflicts with actual vault item types | `schemas.ts` |
| 9 | 🟡 P2 | 50 MB base64 localStorage fallback exceeds quota silently | `vaultFileService.ts` |
| 10 | 🟡 P2 | Vault localStorage cache not cleared on logout | `vaultService.ts`, `vaultFileService.ts` |
| 11 | 🟡 P2 | Uses deprecated `usePortal()` instead of `usePortalDB()` | `VaultPage.tsx` |
| 12 | 🔵 P3 | "View details" menu item has empty handler | `VaultPage.tsx` |
| 13 | 🔵 P3 | Auto-lock timer is time-since-unlock, not inactivity | `VaultPage.tsx` |

---

## Critical security summary

The Vault section has **two fundamental security design failures**:

1. **No encryption:** The field is named `encrypted_data` and the code comment says "encrypt before storing," but zero encryption code exists. All vault secrets are plaintext in the database and in localStorage.

2. **No locked folder security:** The folder password is a compile-time constant in the JS bundle. Any user can extract it trivially. The locked folder is security theater.

Both of these require architectural changes, not simple bug fixes. Until they are addressed, the Vault should either be gated behind an "alpha" warning or disabled entirely. Storing production credentials in the current Vault is unsafe.

---

## Handoff

Next audit: **Cloud** (`audit-reports/cloud.md`).

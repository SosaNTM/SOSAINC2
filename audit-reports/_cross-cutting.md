# Cross-Cutting Audit — SOSA INC

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Scope:** Issues that span 3 or more sections — not captured cleanly in any single section audit.

---

## 1. The Split-Persistence Anti-Pattern (affects ALL sections)

Every section in the app follows the same pattern:

```
older feature          → localStorage primary, no Supabase
newer feature          → Supabase primary, localStorage fallback
newest feature (Cloud) → Supabase primary, presigned URLs, realtime
```

This creates a gradient of reliability across the product that is invisible to users. The table below summarises where each entity actually lives:

| Section | Entity | localStorage | Supabase | Real-time |
|---|---|---|---|---|
| Profile | All profile data | ✓ primary | ✗ | ✗ |
| Finance | Transactions | fallback only | ✓ | ✗ |
| Finance | Budget limits | ✓ primary | ✗ | ✗ |
| Finance | Subscriptions | ✓ primary | ✗ | ✗ |
| Finance | Goals | cache only | ✓ | ✗ |
| Social | All data | ✓ (mock constants) | ✗ | ✗ |
| Vault | Items | cache | ✓ | ✗ |
| Vault | Files | cache | ✓ | ✗ |
| Cloud | Files | cache | ✓ | ✓ |
| Cloud | Folders | ✓ primary | ✗ | ✗ |
| Tasks | Issues | ✓ primary | sync attempt | ✗ |
| Tasks | Comments | ✓ primary | ✗ | ✗ |
| Notes | All notes | ✓ primary | ✗ | ✗ |
| Lead Gen | Leads | — | ✓ | ✓ |
| Lead Gen | Settings | cache | ✓ | ✗ |

**Root cause:** Features were built incrementally. Supabase integration was added later for some entities, never for others. The app has no migration strategy to move localStorage data to Supabase.

**Recommendation:** Define a clear persistence policy: "Everything except UI preferences goes to Supabase." Migrate in priority order: Notes → Tasks comments → Cloud folders → Finance (Budget, Subscriptions) → Profile.

---

## 2. `toPortalUUID` / Static Portal Map (affects Vault, Tasks)

**File:** `src/lib/portalUUID.ts`

A static mapping of 4 portal slugs to hardcoded UUIDs permeates the codebase:

```ts
export const PORTAL_UUID_MAP: Record<string, string> = {
  sosa: "00000000-0000-0000-0000-000000000001",
  keylo: "00000000-0000-0000-0000-000000000002",
  redx: "00000000-0000-0000-0000-000000000003",
  trustme: "00000000-0000-0000-0000-000000000004",
};
```

`toPortalUUID` is called in: `vaultService.ts`, `taskSync.ts`, `loadTasksFromSupabase`, `upsertTask`, `upsertProject`, `deleteTask`. Any portal beyond these 4 silently passes a string slug as `portal_id`, which fails against UUID-typed Postgres columns.

The Hub allows creating portals dynamically. `PORTAL_UUID_MAP` is a hardcoded bottleneck that prevents the multi-tenant architecture from actually working beyond 4 portals.

**Fix:** Replace all `toPortalUUID(slug)` calls with `currentPortalId` from `usePortalDB()`, which already holds the real DB UUID. Remove `portalUUID.ts` once migration is complete.

---

## 3. `ALL_USERS` / Mock User IDs in Production Code (affects all sections)

**File:** `src/lib/authContext.tsx`

`ALL_USERS` is the hardcoded list of 5 mock development users. It is imported in:
- `VaultPage.tsx` (permission modal)
- `CloudPage.tsx` (permission modal)
- `TasksPage.tsx` (assignee display, audit log)
- `NotesPage.tsx` (`viewingUserId` switch)
- `FolderView.tsx` (uploader display)

In production with real Supabase auth, no authenticated user's UUID matches any mock ID in `ALL_USERS`. Every UI element that looks up a user name from `ALL_USERS` returns `undefined` and falls back to "Unknown" or "Unassigned."

**Fix:** Replace `ALL_USERS` references with a `usePortalMembers()` hook that fetches real `portal_members` + display names from Supabase. Remove `ALL_USERS` entirely in production paths.

---

## 4. `localStorage` Cache Not Cleared on Logout (affects Finance, Vault, Lead Gen)

Several modules cache Supabase data in localStorage:
- `vaultService.ts` → `SOSA INC_vault_items_${portalId}`
- `vaultFileService.ts` → `SOSA INC_vault_files_${portalId}`
- `useFinanceSummary.ts` → `swr_summary_${portal}_${from}_${to}`
- `useLeadgenSettings.ts` → `swr_single_leadgen_settings_${portalId}`

None of these are cleared on logout. A second user logging in on the same browser briefly sees the previous user's vault contents, finance summary, and lead generation settings.

**Fix:** In `AuthProvider`'s sign-out handler, iterate all `SOSA INC_*` and `swr_*` localStorage keys and remove them.

---

## 5. Hardcoded `Date.now()` IDs (affects Vault, Tasks, Notes, Profile)

Multiple sections generate entity IDs using `Date.now()`:

| Section | Pattern | File |
|---|---|---|
| Vault (items) | `local_${Date.now()}` | `VaultPage.tsx` |
| Tasks (projects) | `prj_${Date.now().toString(36)}` | `TasksPage.tsx` |
| Notes | `note_${Date.now()}` | `NotesPage.tsx` |
| Transactions | `local_${Date.now()}` | `personalTransactionStore.ts` |

All of these have the same collision risk in rapid succession and are harder to deconflict when merging offline edits with DB records.

**Fix:** Global replace with `crypto.randomUUID()` — already used correctly in `useCloudFiles.ts:111`.

---

## 6. localStorage Audit Log (affects Finance, Vault, Tasks)

`addAuditEntry` from `src/lib/adminStore.ts` is called throughout the app for important events (credential reveals, task deletions, transaction mutations). This function writes to localStorage — trivially cleared, invisible to other users, and not a valid compliance record.

```ts
// adminStore.ts
localStorage.setItem("SOSA INC_admin_log", JSON.stringify(entries));
```

**Fix:** Create a `audit_log` Supabase table with INSERT-only RLS (no UPDATE/DELETE). Write audit entries there. Provide an admin UI to browse them.

---

## 7. `user?.role` vs `usePortalDB().userRole` Inconsistency (affects multiple pages)

The CLAUDE.md specifies: "Always use `usePortalDB()` — not the older `usePortal()`." But several pages check permissions using `user?.role` (the JWT metadata role) instead of the portal-scoped `userRole`:

- `NotesPage.tsx:69`: `const isOwner = user?.role === "owner";`
- `ProfilePage.tsx`: IDOR check uses `useAuth()` user role
- Various permission checks across pages

`user?.role` is set at auth time (JWT metadata) and may not reflect the user's role in the current portal. A user who is "owner" of portal A but only "member" of portal B gets `owner` privileges in portal B when `user.role` is used.

**Fix:** Standardise all role checks to `const { userRole } = usePortalDB(); const isOwner = userRole === "owner";`.

---

## 8. Legacy `usePortal()` Still Used in Multiple Pages

Despite CLAUDE.md specifying `usePortalDB()` as the preferred hook, `usePortal()` (returns portal slug, not UUID) is still imported and used in:

- `VaultPage.tsx` → `const { portal } = usePortal();`
- `TasksPage.tsx` → `const { portal } = usePortal();`
- Others in settings pages

All of these then need `toPortalUUID()` to convert the slug to a DB UUID, introducing the static map dependency.

**Fix:** Global search-and-replace `usePortal()` → `usePortalDB()`. Extract `currentPortalId` directly.

---

## 9. Mock Auth Compiled Into Production Bundle (affects Auth)

**File:** `src/lib/authContext.tsx`

`USE_REAL_AUTH = import.meta.env.VITE_USE_REAL_AUTH === "true"` defaults to `false`. The full `MOCK_USERS` array with hardcoded passwords is compiled into the JS bundle even in production builds. Any user can read mock credentials from the source.

Additionally, `getUserById` only searches `ALL_USERS` — in production, it always returns `undefined` for real users.

**Fix:** Move `MOCK_USERS` behind a build-time check: `if (import.meta.env.DEV) { ... }`. Or better, remove mock auth entirely and use only Supabase auth, protecting dev seeds via `.env.local` only.

---

## 10. No Structured Error Logging

Throughout the codebase, Supabase errors are handled with `console.warn` (or silently swallowed in `catch {}`):

```ts
if (error) console.warn("Failed to sync task to Supabase:", error.message);
```

No error tracking service (Sentry, Datadog, Posthog, etc.) is integrated. Failed DB writes in Tasks, Vault, Finance, and Lead Gen are invisible in production.

**Fix:** Integrate a lightweight error tracking service. At minimum, send errors to a Supabase `error_log` table. Replace `console.warn` with a structured `logError(context, error)` utility.

---

## Cross-cutting P0 summary

| Finding | Sections affected |
|---|---|
| No encryption in Vault's `encrypted_data` | Vault |
| Locked folder password in JS bundle | Vault |
| Vault delete doesn't persist to DB | Vault |
| Static portal UUID map blocks multi-tenancy | Vault, Tasks |
| All profile data in localStorage only | Profile |
| IBAN/tax_id/vat_number in localStorage | Profile |
| Mock auth with hardcoded passwords in bundle | Auth |
| Social section 100% mock data | Social |
| Apify token exposed in browser | Lead Gen |
| Notes have zero DB persistence | Notes |
| Notes keys not portal or user scoped | Notes |

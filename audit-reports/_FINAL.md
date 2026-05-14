# SOSA INC — Full Application Audit: Final Summary

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Sections audited:** Profile · Finance · Social · Lead Generation · Vault · Cloud · Tasks · Notes  
**Total findings:** 13× P0 · 47× P1 · 33× P2 · 20× P3

---

## Executive Summary

The SOSA INC application is a multi-portal SaaS with a well-designed UI and a solid infrastructure foundation (Supabase, iDrive E2 object storage, Telegram bot, Apify integration). However, the codebase has accumulated a severe **split-persistence debt**: features were built UI-first with localStorage as the data layer, then partially migrated to Supabase as the backend matured. The result is a reliability gradient that is invisible to users:

- **Cloud files** → iDrive E2 + Supabase (fully reliable)
- **Lead Gen** → Supabase + realtime (mostly reliable)  
- **Vault items** → Supabase (but unencrypted)
- **Tasks** → Supabase best-effort sync (data loss possible)
- **Finance budget/subscriptions** → localStorage only (lost on clear)
- **Notes** → localStorage only (lost on clear)
- **Profile** → localStorage only (IBAN and tax data at risk)
- **Social** → hardcoded mock data (fiction presented as analytics)

The most critical security issues are in the **Vault** (unencrypted credentials, bundle-compiled lock password) and **Lead Gen** (Apify token visible in browser network tab). Both require architectural changes, not simple bug fixes.

---

## P0 Findings — Stop and Fix

These findings represent active data loss, security vulnerabilities, or user deception. No new feature work should proceed while these are open.

| # | Section | Finding | Fix complexity |
|---|---|---|---|
| 1 | Vault | `encrypted_data` stores plaintext JSON — no encryption exists | High — needs AES-256-GCM key management |
| 2 | Vault | `LOCKED_FOLDER_PASSWORD = "vault2025"` hardcoded in JS bundle | Medium — replace with server-side re-auth |
| 3 | Vault | Delete removes from React state only — DB record persists forever | Low — call `deleteVaultItem()` |
| 4 | Vault | `PORTAL_UUID_MAP` hardcodes 4 portals — new portals silently fail | Medium — replace with `usePortalDB().currentPortalId` |
| 5 | Lead Gen | Apify API token fetched to browser via `select("*")` | High — move Apify calls server-side to edge function |
| 6 | Profile | All profile data (IBAN, tax_id, vat_number) in localStorage only | High — needs `user_profiles` Supabase table |
| 7 | Profile | `/:portalId/profile/:userId` has no role guard — IDOR | Low — add `isOwner || userId === currentUser.id` guard |
| 8 | Profile | Mock auth with hardcoded passwords compiled into production bundle | Medium — gate behind `import.meta.env.DEV` |
| 9 | Profile | `getProfileStats()` always returns zeros — stats are fictional | Low — compute from real data or hide the widget |
| 10 | Social | Entire Social section is hardcoded mock data — users see fictional analytics | Medium — add "Demo data" label or "Coming soon" gate |
| 11 | Social | Account connection state in React `useState` — lost on reload | Medium — needs `social_accounts` Supabase table |
| 12 | Notes | Notes have zero DB persistence — entire note history in localStorage | High — needs `notes` Supabase table |
| 13 | Notes | `STORAGE_NOTES` not portal-scoped or user-scoped — cross-contamination | Low — scope the key (immediate mitigation) |

---

## P1 Findings — Fix in This Pass

These findings represent data integrity issues, security gaps, or reliability failures that affect team use.

### Vault (P1)
- Document type stores 10 MB file as base64 in DB column → use Supabase Storage
- `updateVaultItem`/`deleteVaultItem` have no `user_id` filter → add RLS + ownership check
- `vault:create` permission defined but never checked → add `canCreate` guard
- `vaultItemTypeSchema` enum conflicts with actual types → align to `"credential" | "api_key" | "document" | "note"`
- `VaultPage` uses `usePortal()` slug → switch to `usePortalDB().currentPortalId`

### Cloud (P1)
- Folder structure localStorage-only → create `cloud_folders` Supabase table
- Folder permissions localStorage-only + mock users only → create `cloud_folder_permissions` table
- Storage usage KPIs are hardcoded 4.2 GB / 10 GB → compute from `SUM(files.size)`
- Folder password protection in-memory, reset on reload → store hash in DB
- `moveFile`/`renameFile`/`softDelete` have no `user_id` ownership filter → add RLS
- `emptyTrash` deletes ALL portal trash (any member) → gate by `cloud:delete` permission

### Tasks (P1)
- `STORAGE_TASKS`/`STORAGE_PROJECTS` not portal-scoped → add `_${portalId}` suffix
- Issue comments localStorage-only, invisible to other users → create `task_comments` table
- Supabase sync errors silently swallowed → surface offline indicator
- `upsertTask`/`deleteTask` have no `user_id` ownership → add RLS + filter
- `TasksPage` uses `usePortal()` slug → switch to `usePortalDB()`
- Project IDs use `Date.now()` → `crypto.randomUUID()`
- No realtime subscription → add Postgres Changes subscription

### Notes (P1)
- "View other user's notes" broken across devices → requires DB persistence
- Note IDs use `note_${Date.now()}` → `crypto.randomUUID()`
- Telegram notes never fetched from Supabase → query `telegram_notes` table on mount
- Folder IDs likely also `Date.now()` → `crypto.randomUUID()`

### Finance (P1)
- JS floating-point for all money math → `Math.round((a+b)*100)/100` or `decimal.js`
- Budget limits / total budget localStorage-only → create `portal_budget_settings` table
- Subscriptions entirely in localStorage → create `subscriptions` table
- Any member can edit any other member's transaction → add `.eq("user_id", user.id)` filter
- Invoices page is a null stub → redirect to dashboard with "Coming soon" toast
- Transaction fetch hard-limited to 2000 rows → server-side pagination
- Hard delete removes financial history → add `deleted_at` soft-delete

### Profile (P1)
- Avatar base64 fallback stored in localStorage (exhausts quota) → remove localStorage fallback
- `profileUploadService` never deletes old avatar from Storage → cleanup on replace
- Profile data never loads from Supabase → implement `user_profiles` fetch

### Social (P1)
- `TODAY` hardcoded to `"2026-03-05"` in `SocialOverview` → `new Date()` (one-liner)
- OAuth callback has no CSRF `state` parameter validation → add state round-trip
- `portal_id` passed as user-controlled input to edge function → derive from auth session

### Lead Gen (P1)
- `useLeadgenLeads` has no `.limit()` → fetch all leads (memory risk)
- `updateLead` has no `user_id` filter → any member modifies any lead
- Apify poll interval can stack on component remount → use `useRef` guard
- `created_at` set client-side in upsert → use DB `DEFAULT now()`
- `leadgen_settings.apify_token` returned from `select("*")` → use `select("id, portal_id, max_searches, ...")`

---

## Quick Wins — Fixes Under 30 Minutes

These are P1 or lower findings that require ≤ 10 lines of code to fix:

| Fix | File | Lines |
|---|---|---|
| Fix `TODAY` frozen date in SocialOverview | `SocialOverview.tsx:23` | 1 |
| Scope `STORAGE_TASKS` by portalId | `TasksPage.tsx:29` | 1 |
| Scope `STORAGE_PROJECTS` by portalId | `TasksPage.tsx:44` | 1 |
| Scope `STORAGE_NOTES` by user+portal | `NotesPage.tsx:73` | 1 |
| Fix Vault `deleteItem` to call `deleteVaultItem()` | `VaultPage.tsx:733` | 5 |
| Add `isOwner || isAdmin` guard to profile IDOR | `ProfilePage.tsx` | 5 |
| Replace `Date.now()` IDs with `crypto.randomUUID()` | 5+ files | 1 each |
| `emptyTrash` gate by `cloud:delete` permission | `useCloudFiles.ts:221` | 5 |
| Fix `isOwner` to use `userRole` from `usePortalDB()` | `NotesPage.tsx:69` | 2 |
| Remove `apify_token` from `select("*")` | `useLeadgenSettings.ts` | 3 |

---

## Architectural Recommendations

### Priority 1 — Security (before any public launch)
1. Implement client-side encryption in Vault (AES-256-GCM)
2. Remove locked folder password from JS bundle
3. Move Apify calls to edge function (token never reaches browser)
4. Gate mock auth entirely behind `import.meta.env.DEV`

### Priority 2 — Data reliability (before team onboarding)
5. Create `user_profiles` Supabase table; migrate `profileStore.ts`
6. Create `notes` Supabase table; migrate `NotesPage`
7. Create `cloud_folders` Supabase table; migrate folder management
8. Create `subscriptions` + `portal_budget_settings` Supabase tables

### Priority 3 — Correctness and compliance
9. Scope all localStorage keys by `portalId_userId`
10. Add `deleted_at` soft-delete to `personal_transactions`
11. Replace `ALL_USERS` with real `portal_members` hook
12. Replace all `toPortalUUID` calls with `usePortalDB().currentPortalId`
13. Add Finance audit log to Supabase (INSERT-only RLS)

### Priority 4 — Product completeness
14. Social: implement `social_accounts` table + real OAuth token storage
15. Tasks: add realtime subscription on `tasks` table
16. Tasks: migrate `comments` to `task_comments` table
17. Profile: compute real profile stats (tasks completed, notes count, etc.)

---

## Audit Report Index

| Section | Report | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Profile | `audit-reports/profile.md` | 4 | 5 | 3 | 2 |
| Finance | `audit-reports/finance.md` | 0 | 7 | 6 | 2 |
| Social | `audit-reports/social.md` | 2 | 3 | 2 | 2 |
| Lead Generation | `audit-reports/lead-generation.md` | 1 | 5 | 4 | 3 |
| Vault | `audit-reports/vault.md` | 4 | 4 | 3 | 2 |
| Cloud | `audit-reports/cloud.md` | 0 | 6 | 3 | 1 |
| Tasks | `audit-reports/tasks.md` | 0 | 7 | 3 | 1 |
| Notes | `audit-reports/notes.md` | 2 | 4 | 3 | 2 |
| Cross-cutting | `audit-reports/_cross-cutting.md` | — | — | — | — |
| **Total** | | **13** | **41** | **27** | **15** |

---

## Definition of Done

The application is ready for production team use when:

- [ ] All 13 P0 findings resolved
- [ ] Encryption in Vault (or Vault disabled with clear messaging)
- [ ] `user_profiles` table exists and profile data migrated
- [ ] `notes` table exists and note data migrated
- [ ] Apify token never leaves the server
- [ ] Mock auth disabled in production build
- [ ] All `Date.now()` IDs replaced with `crypto.randomUUID()`
- [ ] All localStorage keys scoped by `portalId` + `userId`
- [ ] `ALL_USERS` references replaced with real portal members
- [ ] Finance soft-delete in place
- [ ] Social: "Demo data" watermark or "Coming soon" gate

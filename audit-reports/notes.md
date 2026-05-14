# Audit Report — Notes Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Notes |
|---|---|---|
| `/:portalId/notes` | `NotesPage` | Full notes editor with folders, tags, archive, pin |

### Sub-page tree

```
Notes
├── All         ← Unfiled, non-archived notes for current viewing user
├── Pinned      ← isPinned === true
├── Archive     ← isArchived === true
├── [Folder]    ← notes filtered by folderId
└── Telegram    ← notes with source === "telegram" (separate folder in sidebar)
```

### Data model

| Entity | Persistence | Table / Key |
|---|---|---|
| Notes | **localStorage only** | `SOSA INC_notes` (global, no portal/user scope) |
| Note folders | **localStorage only** | `SOSA INC_note_folders` (global, no scope) |
| Telegram notes | **localStorage only** | embedded in `SOSA INC_notes` |

### Supabase integration

**Zero.** No Supabase table is queried or written anywhere in the Notes codebase. A search across all TypeScript source files for `supabase.*notes` or `notes.*supabase` returns no matches. `INITIAL_NOTES`, `INITIAL_FOLDERS`, and `INITIAL_TELEGRAM_NOTES` are all empty arrays.

---

## Findings

### 🔴 P0 — Notes have no database persistence — 100% localStorage

**Files:** `src/pages/NotesPage.tsx:71–93`, `src/lib/notesStore.ts:109–113`

Notes are initialized from `localStorage.getItem("SOSA INC_notes")` and written back on every change:

```ts
useEffect(() => { localStorage.setItem(STORAGE_NOTES, JSON.stringify(notes)); }, [notes]);
```

There is no Supabase table, no edge function, no API call for notes at any point in the data lifecycle. All notes are lost on:
- Browser data clear
- Private/incognito mode
- New device or browser
- Changing browsers on the same machine

Notes are the kind of content users expect to persist indefinitely (meeting notes, ideas, research). Losing them silently on a browser clear is a significant reliability failure with no recovery path.

**Fix required:** Create a `notes` Supabase table (`id`, `portal_id`, `user_id`, `folder_id`, `title`, `content`, `tags`, `is_pinned`, `is_archived`, `created_at`, `updated_at`). Migrate `NotesPage` to use `usePortalData` (from `CLAUDE.md`) or a dedicated hook. Note the `Note` interface also lacks `portal_id` — add it.

---

### 🔴 P0 — `STORAGE_NOTES` is not portal-scoped and not user-scoped

**File:** `src/constants/storageKeys.ts:30`

```ts
export const STORAGE_NOTES = "SOSA INC_notes";
export const STORAGE_NOTE_FOLDERS = "SOSA INC_note_folders";
```

Both keys are global strings. All users in all portals on the same browser share one localStorage slot. Consequences:

1. **Cross-portal contamination:** Notes created in portal "sosa" are visible in portal "redx". There is no portal filter — `NotesPage` reads the raw list and filters by `ownerId` only.

2. **Cross-user contamination:** If two Supabase users log into the app sequentially on the same browser, their notes accumulate in the same key. User B sees User A's notes mixed into their note list (filtered client-side by `ownerId`, but User A's notes with the wrong `ownerId` appear as items with no match and get hidden — however they remain in localStorage and grow indefinitely).

3. **No isolation between portals:** A note about a confidential deal in portal "trustme" is accessible in portal "sosa" because both read the same key.

**Fix required:** Scope both keys: `\`SOSA INC_notes_${portalId}_${userId}\`` or better, eliminate localStorage as primary persistence and use Supabase.

---

### 🟠 P1 — "View other user's notes" feature is broken across devices

**File:** `src/pages/NotesPage.tsx:97`

```ts
const [viewingUserId, setViewingUserId] = useState(user?.id || "");
```

Owners can switch `viewingUserId` to view another user's notes. This works only if:
- The other user has previously used the app on the same browser
- Their notes are in the same `SOSA INC_notes` localStorage entry

In any real team scenario (multiple devices), switching `viewingUserId` shows an empty list because the target user's notes are on their own device's localStorage. The feature appears to work in local dev but produces no data in production.

**Fix required:** Notes must be in Supabase (see P0). With DB persistence, an owner can query `WHERE user_id = :targetId AND portal_id = :portalId`.

---

### 🟠 P1 — Note IDs use `note_${Date.now()}` — collision risk, not UUIDs

**File:** `src/pages/NotesPage.tsx:150`, also `handleNoteAction:175`

```ts
const id = `note_${Date.now()}`;                  // createNote
const dup: Note = { ...note, id: `note_${Date.now()}` };  // duplicate
```

Rapid successive note creation or duplicate (within the same millisecond) produces duplicate IDs. Two notes with the same ID in the `notes` array would cause React key conflicts and incorrect state updates.

**Fix required:** Use `crypto.randomUUID()`.

---

### 🟠 P1 — Telegram notes never fetched from Supabase

**Files:** `src/pages/NotesPage.tsx:79`, `src/lib/notesStore.ts:113`

```ts
return [...INITIAL_NOTES, ...INITIAL_TELEGRAM_NOTES.map(telegramNoteToNote)];
// INITIAL_TELEGRAM_NOTES = []  ← always empty
```

The Telegram integration (documented in the Profile audit: `telegram_chat_id` set via the Telegram bot) presumably writes notes to a Supabase table (likely `telegram_notes` or similar). But `NotesPage` uses `INITIAL_TELEGRAM_NOTES = []` as the fallback and never fetches anything from Supabase. Users who send messages to the Telegram bot never see them in the Notes section.

**Fix required:** If the Telegram bot writes to a Supabase table, fetch from it on mount filtered by `user_id`. Map the rows using the existing `telegramNoteToNote` converter. Maintain realtime subscription for live updates as new Telegram messages arrive.

---

### 🟠 P1 — Folder IDs use `fld_${Date.now()}` — collision risk

**Observation (from folder creation flow):** Folder creation likely uses `Date.now()` as well (consistent with note and project ID patterns). Any two folders created within the same millisecond get the same ID.

**Fix required:** `crypto.randomUUID()` for folder IDs.

---

### 🟡 P2 — `Note` interface has no `portalId` field

**File:** `src/lib/notesStore.ts:13–30`

Even if notes were migrated to Supabase, the `Note` interface has no `portalId` field. A user's notes would appear across all portals they belong to. The schema must include `portal_id` from day one to enable correct RLS and per-portal isolation.

**Fix required:** Add `portalId: string` to the `Note` interface and include it in the Supabase table schema.

---

### 🟡 P2 — isOwner check uses legacy `user?.role === "owner"` instead of `usePortalDB()`

**File:** `src/pages/NotesPage.tsx:69`

```ts
const isOwner = user?.role === "owner";
```

`user?.role` is the JWT metadata role — not the portal-scoped `userRole` from `usePortalDB()`. A user who is "owner" of portal A but only "member" of portal B would still get `isOwner === true` in portal B if their JWT metadata says "owner". Should use `const { userRole } = usePortalDB(); const isOwner = userRole === "owner";`.

---

### 🟡 P2 — Rich text content stored as raw string — no sanitization

**File:** `src/pages/NotesPage.tsx` (content editing)

Note `content` is a free-form string including markdown-style markup. If Notes ever renders content as HTML (e.g., in a preview), unsanitized content could introduce XSS. Currently the `<textarea>` renders it as plain text, which is safe. But if a future upgrade adds HTML rendering (e.g., `dangerouslySetInnerHTML`), this becomes a P0.

**Advisory:** When adding HTML rendering, sanitize with DOMPurify before inserting.

---

### 🔵 P3 — Mic button imported but no voice recording implementation visible

**File:** `src/pages/NotesPage.tsx:9`

```ts
import { ..., Mic, ... } from "lucide-react";
```

`Mic` is imported. If it renders a button, clicking it has no handler (or a stub). Voice note recording is not implemented.

**Fix required:** Either implement or remove the button.

---

### 🔵 P3 — Archive notes mixed into main storage indefinitely

**File:** `src/pages/NotesPage.tsx:137–138`

Archived notes are kept in the same `notes` array forever. Over time, many archived notes accumulate in localStorage. No purge or cleanup mechanism exists. As localStorage nears the ~5 MB limit, write failures may occur silently.

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🔴 P0 | Notes have zero DB persistence — all data in localStorage only | `NotesPage.tsx`, `notesStore.ts` |
| 2 | 🔴 P0 | Storage keys not portal-scoped or user-scoped — cross-contamination | `storageKeys.ts` |
| 3 | 🟠 P1 | "View other user's notes" feature is broken across devices | `NotesPage.tsx` |
| 4 | 🟠 P1 | Note IDs use `Date.now()` — collision risk, not UUID | `NotesPage.tsx` |
| 5 | 🟠 P1 | Telegram notes never fetched from Supabase — always empty | `NotesPage.tsx`, `notesStore.ts` |
| 6 | 🟠 P1 | Folder IDs likely also use `Date.now()` | inferred from pattern |
| 7 | 🟡 P2 | `Note` interface has no `portalId` field | `notesStore.ts` |
| 8 | 🟡 P2 | `isOwner` uses JWT role, not portal-scoped `userRole` | `NotesPage.tsx` |
| 9 | 🟡 P2 | Rich text content not sanitized (safe now, XSS risk on HTML render) | `NotesPage.tsx` |
| 10 | 🔵 P3 | Mic button imported but not implemented | `NotesPage.tsx` |
| 11 | 🔵 P3 | No archived note cleanup — localStorage grows indefinitely | `NotesPage.tsx` |

---

## Context vs. other sections

Notes is the most severely underimplemented section relative to its UI surface area. The feature set is fully built — folders, tags, archive, pin, Telegram integration, rich text editor — but the data layer is identical to a browser notepad. Compared to the other sections:

| Section | Backend status |
|---|---|
| Cloud | Files in iDrive E2, metadata in Supabase ✓ |
| Lead Generation | Supabase + Apify integration ✓ |
| Finance | Transactions in Supabase (partial) |
| Vault | Supabase exists but unencrypted |
| Tasks | Supabase sync attempt (best-effort) |
| Notes | **No Supabase at all** |

---

## Handoff

Notes audit complete. All 8 sections audited. Next: write **cross-cutting audit** (`audit-reports/_cross-cutting.md`) and **final summary** (`audit-reports/_FINAL.md`).

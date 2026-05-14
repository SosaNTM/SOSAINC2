# Audit Report — Profile Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 (stop & fix now) · 🟠 P1 (fix in this pass) · 🟡 P2 (batch) · 🔵 P3 (low / polish)

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Guard |
|---|---|---|
| `/:portalId/profile` | `ProfilePage` | Authenticated |
| `/:portalId/profile/:userId` | `ProfilePage` (other user view) | Authenticated (NO role check) |
| `/:portalId/settings/general/profile` | `PortalProfile` | AdminRoute (owner/admin only) |

### Component Tree

```
ProfilePage
├── Hero / Cover section
│   ├── Banner <img> (upload via bannerInputRef)
│   ├── Avatar <img> | initials fallback
│   ├── Name, RoleBadge, job title, location
│   └── Action buttons: Edit Profile | Download PDF
├── Main grid (3 cols desktop)
│   ├── GlassSection "Quick Info"   → QuickInfoCard
│   ├── GlassSection "Social Links" → SocialLinksCard
│   └── GlassSection "Sensitive Data" (tax_id, IBAN) — masked
├── ProfileTasksCard
├── GlassSection "Personalization" (theme + accent — own profile only)
└── Modals
    ├── EditProfileModal (full form)
    └── OnboardingModal (first-time setup)
```

### Data Layer

| Source | What it provides |
|---|---|
| `profileStore.ts` (`localStorage`) | **All profile fields** — name, address, phone, IBAN, tax_id, social links, avatar_url, etc. |
| `authContext.tsx` (in-memory + localStorage) | Identity: id, email, displayName, role, createdAt, portalAccess |
| `profileUploadService.ts` | Avatar/banner upload → Supabase Storage OR base64 localStorage fallback |
| `adminStore.ts` (localStorage) | Audit log entries for sensitive data reveals |

### User / Profile fields

| Field | Stored | Displayed | Editable | Validated | Encrypted |
|---|---|---|---|---|---|
| first_name | localStorage | ✓ | ✓ | Required | ✗ |
| last_name | localStorage | ✓ | ✓ | Required | ✗ |
| display_name | localStorage | ✓ | Auto-computed | — | ✗ |
| email | localStorage (from auth) | ✓ | ✗ | — | ✗ |
| phone | localStorage | ✓ | ✓ | Regex | ✗ |
| date_of_birth | localStorage | ✓ | ✓ | ✗ | ✗ |
| company_name / job_title / department | localStorage | ✓ | ✓ | ✗ | ✗ |
| tax_id (P.IVA / CF) | localStorage | Masked | ✓ | Regex (client-only) | ✗ |
| iban | localStorage | Masked | ✓ | Regex (client-only) | ✗ |
| vat_number | localStorage | ✓ | ✓ | Regex (client-only) | ✗ |
| bank_name / swift_bic / account_holder_name | localStorage | ✓ | ✓ | Partial | ✗ |
| avatar_url / cover_image_url | localStorage | ✓ | ✓ | Client-only MIME/size | ✗ |
| brand_color | localStorage | ✓ | ✓ | ✗ | ✗ |
| social links | localStorage | ✓ | ✓ | URL regex (client) | ✗ |
| telegram_chat_id | localStorage | ✓ | Disconnect only | ✗ | ✗ |
| created_at / updated_at | localStorage (client-set) | ✓ | ✗ | ✗ | ✗ |

### API Endpoints / Auth Checks

No dedicated REST API endpoints — all reads/writes go through `localStorage` in the client. The only network calls in Profile are:

| Operation | Endpoint | Auth Check |
|---|---|---|
| Avatar upload | `supabase.storage.from("profile-avatars").upload(...)` | Supabase session |
| Banner upload | `supabase.storage.from("profile-banners").upload(...)` | Supabase session |
| Get public URL | `supabase.storage.getPublicUrl(...)` | None (public bucket) |

---

## Findings

### 🔴 P0 — Profile data stored entirely in localStorage, not in Supabase

**File:** `src/lib/profileStore.ts:1–170`  
**Severity:** Critical — data loss, cross-device breakage, PII insecurity

`getProfile()` and `updateProfile()` read/write only to `localStorage`. There is **no Supabase table for user profiles**. Consequences:

- **Data loss:** clearing browser storage wipes name, address, IBAN, tax ID, bank details, social links, Telegram ID — everything.
- **No cross-device sync:** profile on laptop and phone are completely independent.
- **PII in plaintext localStorage:** IBAN, tax_id, vat_number, date_of_birth, phone — all stored as plain JSON, readable by any script on the page.
- **No server-side validation:** the validated-client-side fields (IBAN, tax_id, SWIFT) can be bypassed by writing directly to localStorage via DevTools.
- **`created_at` set by client:** `new Date().toISOString()` is computed client-side — easily falsified.

**Fix required:** Create a `user_profiles` table in Supabase with a `user_id` FK to `auth.users`. Migrate `profileStore` to Supabase CRUD. Add RLS: `user_id = auth.uid()` for own-data access.

---

### 🔴 P0 — Mock auth system with hardcoded passwords ships alongside real auth

**File:** `src/lib/authContext.tsx:15,36–67`  
**Severity:** Critical — hardcoded credentials in production bundle

```ts
const USE_REAL_AUTH = import.meta.env.VITE_USE_REAL_AUTH === "true";
// ...
password: import.meta.env.VITE_MOCK_PASSWORD_OWNER || "dev_only_owner",
```

If `VITE_USE_REAL_AUTH` is not explicitly set to `"true"`, the entire auth system falls back to in-memory mock users with passwords that default to `"dev_only_owner"`, `"dev_only_admin"`, etc. These string literals are **compiled into the production JS bundle** regardless of env.

Additionally: mock passwords stored in `MOCK_USERS` array are accessible as plain strings in memory — inspectable via browser DevTools.

**Fix required:** Remove the mock auth system entirely from the production bundle (use build-time code splitting or a dedicated dev-only module). Ensure `USE_REAL_AUTH=true` is enforced in the build pipeline with a build-time assertion.

---

### 🔴 P0 — IDOR: Any user can view any other user's profile

**File:** `src/pages/ProfilePage.tsx:34–35`

```ts
const isOwn = !userId || userId === currentUser?.id;
const profileUser = isOwn ? (currentUser ?? undefined) : getUserById(userId!);
```

Route `/:portalId/profile/:userId` is guarded only by authentication, not by role. Any authenticated user can navigate to `/sosa/profile/usr_001` and view the full profile including the Sensitive Data section (tax_id, IBAN) if they know or enumerate another user's ID.

The `canViewSensitive` flag only controls **revealing** the masked value:
```ts
const canViewSensitive = isOwn || viewerRole === "owner";
```
But the sensitive data card itself renders for any viewer — the toggle just shows masked vs. unmasked. The `MaskedField` component returns a read-only input that always renders the masked value, but the reveal toggle is present for non-owners visiting another user's profile.

**Fix required:** Server-side authorization check on profile access. If a `userId` param is provided and it's not the current user, require `owner` or `admin` role. Redirect non-privileged users to their own profile.

---

### 🔴 P0 — Base64 avatar fallback bloats localStorage (up to 5 MB per image)

**File:** `src/lib/profileUploadService.ts:63–67`

```ts
const remoteUrl = await uploadToStorage(AVATAR_BUCKET, userId, file);
if (remoteUrl) return { url: remoteUrl, source: "supabase" };
// Fallback: base64 data URL
const dataUrl = await readAsDataURL(file);
return { url: dataUrl, source: "local" };
```

If Supabase Storage upload fails (network error, bucket not configured, storage quota), the **full file is read as a base64 data URL and written to localStorage**. At 5 MB per image, two images (avatar + banner) can consume 10 MB+ — exceeding the typical 5–10 MB localStorage quota and throwing `QuotaExceededError`, which silently breaks ALL subsequent localStorage writes across the app, including auth session storage.

**Fix required:** Remove the base64 fallback. If upload fails, surface the error clearly and do not write to localStorage.

---

### 🟠 P1 — `getUserById()` fails for real Supabase users

**File:** `src/lib/authContext.tsx:72–74`

```ts
export function getUserById(id: string): User | undefined {
  return ALL_USERS.find((u) => u.id === id);
}
```

`ALL_USERS` is derived from `MOCK_USERS` — a hardcoded array of 5 users. When `USE_REAL_AUTH=true`, any real Supabase user (whose ID is a UUID like `c12f6654-...`) returns `undefined`. The profile page then renders "User not found" for any valid user accessed via `/:portalId/profile/:userId`.

**Fix required:** Under real auth, fetch user metadata from Supabase (`auth.users` via admin API or a `user_profiles` table) instead of the in-memory mock list.

---

### 🟠 P1 — Profile save has no Supabase persistence (simulates with setTimeout)

**File:** `src/components/profile/EditProfileModal.tsx:56–68`

```ts
const handleSave = async () => {
  if (!validate()) return;
  setSaving(true);
  await new Promise((r) => setTimeout(r, 500)); // ← simulated network call
  const updated = updateProfile(profile.id, { ... }); // ← writes to localStorage only
  setSaving(false);
  toast.success("Profile updated");
  ...
};
```

The save flow has no network call. The 500ms timeout is a UX simulation. The "saved" state does not survive a browser clear or a different device.

**Fix required:** Replace `updateProfile()` call with an actual `supabase.from("user_profiles").upsert(...)` once the table exists (see P0 above).

---

### 🟠 P1 — Old avatar not deleted from Supabase Storage on replacement

**File:** `src/lib/profileUploadService.ts:37–52`

Each upload creates a new path: `${userId}/${Date.now()}.${ext}`. The previous file is never deleted. If a user changes their avatar 10 times, 10 files accumulate in the bucket. Over many users this becomes significant storage waste with no cleanup mechanism.

**Fix required:** Before uploading, read the current avatar URL from the profile, extract the storage path, and call `supabase.storage.from(bucket).remove([oldPath])` before uploading the new file.

---

### 🟠 P1 — File type validation client-side only; storage bucket MIME enforcement unverified

**File:** `src/lib/profileUploadService.ts:18–26`

`validateFile()` checks `file.type` (client-provided, user-spoofable) and file size. The `accept=".jpg,.jpeg,.png,.webp,.gif"` on the `<input>` is also client-side. If the Supabase Storage bucket has no MIME-type policies configured, a user could upload a `.html` or `.js` file with a `.jpg` extension by manipulating the request.

**Fix required:** Verify Supabase Storage bucket policies enforce content-type restrictions. Add server-side validation in a Supabase Edge Function or bucket policy.

---

### 🟠 P1 — Audit log for sensitive data reveal is localStorage-based (tamper-trivial)

**File:** `src/pages/ProfilePage.tsx:352–360`

```ts
addAuditEntry({
  userId: currentUser?.id ?? "unknown",
  action: `Revealed Tax ID for ${profile.display_name}`,
  category: "profile",
  ...
});
```

`addAuditEntry()` writes to `adminStore` which is localStorage. This "audit log" can be cleared by any user via `localStorage.clear()`. It provides no actual compliance guarantee.

**Fix required:** For PII reveals (IBAN, Tax ID), log to a Supabase table with an immutable RLS policy (INSERT only, no UPDATE/DELETE for non-owners).

---

### 🟡 P2 — No unsaved-changes confirmation on modal Cancel

**File:** `src/components/profile/EditProfileModal.tsx:78`

Clicking the overlay or "Cancel" immediately closes the modal and discards changes without prompting. A user who accidentally clicks outside the modal loses all edits.

**Fix required:** Compare `form` state to the original `profile` prop. If they differ, show a confirmation dialog before closing.

---

### 🟡 P2 — `getLastLogin()` reads only from current device's localStorage

**File:** `src/lib/authContext.tsx:287–295`

The last-login timestamp is stored in `localStorage` of the device used to log in. Viewing profile from a different device always shows "Never logged in".

**Fix required:** Store last login timestamp in Supabase on successful auth, read from DB on profile load.

---

### 🟡 P2 — No image processing — raw files up to 5 MB stored

**File:** `src/lib/profileUploadService.ts:37–52`

No resize, crop, or compression step exists. A user uploading a 5 MB RAW photo will have that stored as-is. Avatars are displayed at 88×88px; a 5 MB source file serves no purpose.

**Fix required:** Client-side resize using `<canvas>` before upload (target: ≤ 512px wide, ≤ 150 KB JPEG). Or use a Supabase Edge Function + sharp for server-side processing.

---

### 🔵 P3 — `getProfileStats` always returns zeros

**File:** `src/lib/profileStore.ts:156–159`

```ts
export function getProfileStats(userId: string): ProfileStats {
  return MOCK_STATS[userId] || { clients: 0, invoices: 0, revenue: 0, products: 0, pending: 0 };
}
```

The stats section in `ProfilePage` always shows zeros. `MOCK_STATS` is an empty object. Either remove the stats UI or connect it to real data.

---

### 🔵 P3 — Telegram bot username fallback uses company name with spaces

**File:** `src/components/profile/EditProfileModal.tsx:326`

```ts
href={`https://t.me/${(import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME || "SOSA INC_bot"}`}
```

The fallback `"SOSA INC_bot"` contains a space, which is not a valid Telegram bot username. The link would navigate to `https://t.me/SOSA INC_bot`, which is broken.

**Fix required:** Use a valid no-space fallback or throw if the env var is not set.

---

### 🔵 P3 — `date_of_birth` has no age validation or future-date guard

**File:** `src/components/profile/EditProfileModal.tsx:174`

The date of birth input has no validation — a user can enter a date in 2099 or 1000 BC. No error is shown.

**Fix required:** Validate that `date_of_birth` is in the past and within a reasonable range (e.g. ≥ 1900, ≤ today).

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🔴 P0 | Profile data in localStorage, not Supabase | `profileStore.ts` |
| 2 | 🔴 P0 | Mock auth with hardcoded passwords in prod bundle | `authContext.tsx` |
| 3 | 🔴 P0 | IDOR: any user can view any profile via URL | `ProfilePage.tsx` |
| 4 | 🔴 P0 | Base64 fallback can exhaust localStorage quota | `profileUploadService.ts` |
| 5 | 🟠 P1 | `getUserById` fails for real Supabase users | `authContext.tsx` |
| 6 | 🟠 P1 | Profile save is setTimeout simulation, no network | `EditProfileModal.tsx` |
| 7 | 🟠 P1 | Old avatars never deleted from Storage | `profileUploadService.ts` |
| 8 | 🟠 P1 | File type enforcement is client-side only | `profileUploadService.ts` |
| 9 | 🟠 P1 | Audit log for PII reveals is localStorage (tamper-trivial) | `ProfilePage.tsx` |
| 10 | 🟡 P2 | No unsaved-changes confirmation on modal close | `EditProfileModal.tsx` |
| 11 | 🟡 P2 | Last-login timestamp is per-device only | `authContext.tsx` |
| 12 | 🟡 P2 | No image resize/compress before upload | `profileUploadService.ts` |
| 13 | 🔵 P3 | Profile stats always show zeros | `profileStore.ts` |
| 14 | 🔵 P3 | Telegram bot URL fallback has space (broken URL) | `EditProfileModal.tsx` |
| 15 | 🔵 P3 | No date_of_birth range validation | `EditProfileModal.tsx` |

---

## Fix Priority for This Pass

Per the audit protocol, fix P0 and P1 items before moving to the next section. However, items 1, 2, 5, and 6 are **architectural** — they require a Supabase migration (`user_profiles` table) and a `profileStore` rewrite. These are significant enough to warrant explicit user sign-off before executing.

**Recommended immediate action (no sign-off needed):**
- Fix #4: Remove base64 localStorage fallback — replace with a clear error toast
- Fix #3: Add role guard to `/:portalId/profile/:userId` route
- Fix #14: Fix Telegram fallback URL

**Requires user sign-off before executing:**
- Fix #1 + #6: Design + migrate `user_profiles` table in Supabase; rewrite `profileStore`
- Fix #2: Remove mock auth from production bundle

---

## Handoff

Next audit: **Finance** (`audit-reports/finance.md`) — depends on the same auth foundation. Key concern: money values storage type.

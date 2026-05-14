# Audit Report — Social Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Status |
|---|---|---|
| `/:portalId/social` | Redirect → overview | — |
| `/:portalId/social/overview` | `SocialOverview` | Mock data |
| `/:portalId/social/accounts` | `SocialAccounts` | Mock data + in-memory state |
| `/:portalId/social/analytics` | `SocialAnalytics` | Mock data |
| `/:portalId/social/content` | `SocialContent` | Mock data |
| `/:portalId/social/audience` | `SocialAudience` | Mock data |
| `/:portalId/social/competitors` | `SocialCompetitors` | Mock data |
| `/:portalId/social/oauth-callback` | `OAuthCallback` | Calls edge function (real) |

### Sub-page tree

```
Social
├── Overview        ← Aggregated KPIs, sparklines, top posts, goals progress
├── Accounts        ← Platform connect/disconnect (in-memory only, mock metrics)
├── Analytics       ← Per-platform metrics, heatmap, content performance
├── Content         ← Post feed + calendar view
├── Audience        ← Follower demographics (mock)
├── Competitors     ← Competitor benchmarking (mock)
└── OAuth Callback  ← Token exchange via Supabase Edge Function `social-oauth`
```

### Platform integration matrix

| Platform | API Integration | Token Storage | OAuth | Webhooks | Real data |
|---|---|---|---|---|---|
| Instagram | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| LinkedIn | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| Twitter / X | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| YouTube | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| TikTok | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| Facebook | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| Threads | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| Pinterest | ✗ mock only | ✗ | OAuthCallback (stub) | ✗ | ✗ |
| Telegram | `telegram_chat_id` in localStorage profile | ✗ | Bot link (manual) | ✗ | Partial |

### Data source

**All Social data is hardcoded mock data** in `src/lib/socialStore.ts`. This includes:
- `mockSocialAccounts` — fake followers, posts, engagement rates
- `mockSocialPosts` — static post list with hardcoded metrics
- `mockSocialGoals` — hardcoded goals with static progress
- Competitor data, audience demographics, heatmap data

No Supabase table, no API calls, no real scheduling or posting engine exists in the Social section.

---

## Findings

### 🔴 P0 — Entire Social section is a UI prototype with no real data or integrations

**Files:** All `src/pages/social/*.tsx`, `src/lib/socialStore.ts`

The Social module presents a fully-featured social media management interface — Overview KPIs, post calendar, analytics, audience demographics, competitor benchmarking — all backed exclusively by hardcoded static mock data in `socialStore.ts`:

```ts
export const mockSocialAccounts: SocialAccount[] = [
  { id: "acc_1", platform: "instagram", accountName: "@sosa_official", followersCount: 12450, ... },
  // ...
];
```

No Supabase table receives or stores social data. No platform APIs are called. No metrics are fetched. The numbers users see in the dashboard are fiction.

This is not a bug in the traditional sense — it's a deliberate prototype state. But it's a **P0 disclosure** because:
1. Users cannot distinguish real from mock data.
2. Any business decisions made based on these "analytics" are based on invented numbers.
3. The disconnect dialog says "Historical data will be preserved" — there is no historical data.

**Required action:** Either gate the entire Social section behind a "Coming soon" banner, or document explicitly (in-app) that all displayed metrics are demo data.

---

### 🔴 P0 — Account connection state is in-memory React state (lost on reload)

**File:** `src/pages/social/SocialAccounts.tsx:445–490`

```ts
const [connectedIds, setConnectedIds] = useState<Set<string>>(
  // initial value from... nowhere — starts empty or from mock
);
```

When a user "connects" a platform (via the UI button), the connected state is stored only in `connectedIds` React state. Reloading the page resets it to the initial state. There is no Supabase write, no localStorage write — the connection is ephemeral.

The `OAuthCallback` does make a real network call to the edge function `social-oauth?action=callback`, but `SocialAccounts.tsx` never reads this data from any persistent store. The state is managed independently in component state.

**Fix required:** After a successful OAuth token exchange, the edge function should write a record to a `social_accounts` Supabase table. `SocialAccounts.tsx` should read from this table on mount.

---

### 🟠 P1 — OAuth callback has no CSRF state parameter validation

**File:** `src/pages/social/OAuthCallback.tsx:14–17`

```ts
const code = searchParams.get("code");
const platform = searchParams.get("platform");
const oauthError = searchParams.get("error");
```

The OAuth callback does not validate a `state` parameter. Standard OAuth 2.0 requires generating a random `state` value before the redirect, storing it, and verifying it matches on callback. Without this, an attacker can perform a CSRF attack on the OAuth flow (force a victim to connect the attacker's social account to the victim's profile).

**Fix required:** Generate `state = crypto.randomUUID()` before redirecting to the platform. Store in sessionStorage. On callback, verify `searchParams.get("state") === storedState`. Reject if mismatch.

---

### 🟠 P1 — Edge function `social-oauth` passes `portal_id` as user-controlled input

**File:** `src/pages/social/OAuthCallback.tsx:46`

```ts
body: JSON.stringify({
  code,
  portal_id: portal?.id ?? "sosa",  // user-controlled slug
}),
```

The `portal_id` sent to the edge function is the portal slug from client-side state (not a verified UUID from the auth session). If the edge function trusts this without server-side verification, an attacker could associate a social account with a different portal by manipulating this value.

**Fix required:** The edge function should derive `portal_id` from the authenticated user's session (e.g., their primary portal from `portal_members`), not trust client-provided input.

---

### 🟠 P1 — `TODAY` hardcoded to `"2026-03-05"` in SocialOverview

**File:** `src/pages/social/SocialOverview.tsx:23`

```ts
const TODAY = new Date("2026-03-05");
```

All period calculations in `SocialOverview` ("last 7 days", "last 30 days", "this month") are relative to this frozen date. Users always see periods ending on March 5, 2026, regardless of the actual current date. This date is now in the past (current date: 2026-05-08), so "this month" shows February data and "last 7 days" shows late February data.

Note: `SocialAnalytics.tsx` uses `const TODAY = new Date()` (correct). The inconsistency suggests this was a development artifact that was never removed.

**Fix required:** Replace `new Date("2026-03-05")` with `new Date()`.

---

### 🟡 P2 — No error handling on OAuthCallback edge function call

**File:** `src/pages/social/OAuthCallback.tsx:51–55`

```ts
const result = (await resp.json()) as { success?: boolean; error?: string };
if (!resp.ok || result.error) {
  throw new Error(result.error ?? "Token exchange failed");
}
```

Error handling is minimal: if `resp.json()` throws (malformed JSON), the error propagates uncaught to the outer try/catch which only sets an error string. No retry logic, no user-actionable message beyond the raw error string.

**Fix required:** Parse the edge function error response more carefully; present a user-friendly message with a "Try again" button rather than showing a raw error string.

---

### 🟡 P2 — Platform logo SVGs referenced at `/platform-icons/` — likely 404

**File:** `src/lib/socialStore.ts:97–104`, `src/pages/social/SocialAccounts.tsx:154`

```ts
instagram: { logo: "/platform-icons/instagram.svg" },
```

The platform logos reference `/platform-icons/` paths which are typically under `public/`. If these files don't exist in `public/platform-icons/`, every platform logo renders as a broken image. The `<img>` has no `onError` fallback.

**Fix required:** Verify these SVG files exist in `public/platform-icons/`. Add an `onError` handler to fall back to the emoji icon.

---

### 🔵 P3 — SocialContent "Add post" button has no implementation

**File:** `src/pages/social/SocialContent.tsx` (inferred from `<Plus>` icon in toolbar)

The "+ New Post" button renders but clicking it has no handler (or opens a modal with no save action since there's no backend). The composer flow is UI-only.

**Fix required:** Either implement the post composer or disable/hide the button with a "Coming soon" state.

---

### 🔵 P3 — Analytics export button shows toast but produces no file

**File:** `src/pages/social/SocialAnalytics.tsx` (Download icon present)

The CSV/analytics export button fires a toast notification (`toast`) but no actual file download is produced. The button's click handler calls `toast` only.

**Fix required:** Either implement CSV export of the mock data, or remove the export button until real data is available.

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🔴 P0 | Entire section is mock data — users cannot distinguish from real | `socialStore.ts`, all social pages |
| 2 | 🔴 P0 | Account connection state is in-memory, lost on reload | `SocialAccounts.tsx` |
| 3 | 🟠 P1 | OAuth callback has no CSRF state parameter validation | `OAuthCallback.tsx` |
| 4 | 🟠 P1 | `portal_id` passed as user-controlled input to edge function | `OAuthCallback.tsx` |
| 5 | 🟠 P1 | `TODAY` hardcoded to past date in SocialOverview | `SocialOverview.tsx` |
| 6 | 🟡 P2 | Poor error handling on OAuth callback | `OAuthCallback.tsx` |
| 7 | 🟡 P2 | Platform logos likely 404 (no fallback) | `SocialAccounts.tsx` |
| 8 | 🔵 P3 | "+ New Post" button has no implementation | `SocialContent.tsx` |
| 9 | 🔵 P3 | Analytics export button produces no file | `SocialAnalytics.tsx` |

---

## Recommended action

The Social section in its current state is a **product prototype**, not a production feature. Recommended path:

1. **Immediately:** Fix finding #5 (wrong TODAY date) — one-line fix.
2. **Short term:** Add in-app messaging that Social is "beta / demo mode". Label all displayed metrics with a "Sample data" watermark.
3. **Long term (feature work):** Implement `social_accounts` table, real OAuth token storage, platform API adapters (Instagram Graph API, LinkedIn API, X API v2), and a scheduled post queue before removing the mock data.

---

## Handoff

Next audit: **Lead Generation** (`audit-reports/lead-generation.md`) — currently the most actively developed section.

# Audit Report — Lead Generation Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Status |
|---|---|---|
| `/:portalId/leadgen` | Redirect → dashboard | — |
| `/:portalId/leadgen/dashboard` | `LeadgenDashboard` | Real (Supabase) |
| `/:portalId/leadgen/overview` | `LeadgenOverview` | Real (Supabase) |
| `/:portalId/leadgen/leads` | `LeadgenAllLeads` | Real (Supabase, paginated) |
| `/:portalId/leadgen/lead/:id` | `LeadgenLeadDetail` | Real (Supabase) |
| `/:portalId/leadgen/search` | `LeadgenSearch` | Real (Apify + Supabase) |
| `/:portalId/leadgen/searches` | `LeadgenSearchHistory` | Real (Apify + Supabase) |
| `/:portalId/leadgen/settings` | `LeadgenSettings` | Real (Supabase) |
| Settings: `leadgen/team` | `TeamManagement` | Real (Supabase) |

### Sub-page tree

```
Lead Generation (REDX-only feature)
├── Dashboard       ← Today's stats, personal summary, quick actions
├── Overview        ← CRM-style pipeline drilldown: all/hot/cold/follow-up
├── All Leads       ← Paginated full list, filters, quick-take button
├── Lead Detail     ← Full profile, notes, outreach events, assignment
├── Search          ← Apify Google Maps run launcher
├── Search History  ← Running search status, abort, completed details
└── Settings        ← Apify token, actor config, blacklist rules, team management
```

### Data model

| Table | Primary key | Key relations | Supabase RLS |
|---|---|---|---|
| `leadgen_leads` | `id` | `portal_id`, `search_id`, `assigned_to` | Yes (portal_members check) |
| `leadgen_searches` | `id` | `portal_id`, `apify_run_id` | Yes |
| `leadgen_settings` | `portal_id` | — | Yes |
| `leadgen_blacklist` | `id` | `portal_id` | Yes |
| `leadgen_members` | `id` | `portal_id`, `user_id` | Yes |
| `leadgen_lead_notes` | `id` | `portal_id`, `lead_id`, `author_id` | Yes |
| `leadgen_outreach_events` | `id` | `portal_id`, `lead_id`, `user_id` | Yes |

### External integrations

| Service | Purpose | Token location | API calls from |
|---|---|---|---|
| Apify Google Maps Scraper | Lead discovery via Google Maps | `leadgen_settings.apify_token` (Supabase) | **Browser (client-side)** |

No email sending, no CRM sync, no sequence builder. Outreach tracking is manual.

---

## Compliance checklist

| Item | Status | Notes |
|---|---|---|
| Unsubscribe in outbound email | N/A | No email sending implemented |
| Suppression list | N/A | No email sending |
| Bounce/complaint handling | N/A | No email sending |
| GDPR acknowledgement for data scraping | ✗ | No consent/acknowledgement flow |
| Tracking of data source | ✓ | `search_id` FK on leads |
| Blacklist / exclusion rules | ✓ | `leadgen_blacklist` table |
| Reply detection stops outreach | N/A | Outreach is manual |

---

## Findings

### 🔴 P0 — Apify API token returned to browser via `select("*")`

**Files:** `src/hooks/leadgen/useLeadgenSettings.ts:24–25`, `src/pages/leadgen/LeadgenSearch.tsx:335`

The `leadgen_settings` table stores the Apify API token in the `apify_token` column. `useLeadgenSettings` fetches the entire row with `select("*")`:

```ts
const { data: row } = await supabase
  .from("leadgen_settings")
  .select("*")                 // returns apify_token to the browser
  .eq("portal_id", currentPortalId)
  .single();
```

The token is then used directly from the browser to call the Apify API:

```ts
const { runId } = await startGoogleMapsRun(settings.apify_token, { ... });
```

This means:
1. Any portal member who opens DevTools → Network can see the Apify API token in the Supabase response.
2. The Apify API call from the browser exposes the token in the Authorization header in browser network logs.
3. A compromised member account = compromised Apify token = potential runaway charges on the Apify account.

**Fix required:** Move the Apify API call server-side (Supabase Edge Function). The edge function reads the token from `leadgen_settings` server-side and never returns it to the client. The client sends only the search parameters; the edge function starts the Apify run and returns the `runId`. Change `select("*")` to `select("id, portal_id, actor_id, default_country_code, default_language, default_max_places, scrape_contacts, created_at, updated_at")` — excluding `apify_token`.

---

### 🟠 P1 — `useLeadgenLeads` fetches all leads with no server-side limit

**File:** `src/hooks/leadgen/useLeadgenLeads.ts:38–43`

```ts
const { data, error: err } = await supabase
  .from("leadgen_leads")
  .select("*")
  .eq("portal_id", currentPortalId)
  .order("created_at", { ascending: false });
  // no .limit() — fetches ALL leads
```

For a portal with 5,000+ leads (easily reachable with a few Apify runs), this loads the full dataset into browser memory and localStorage SWR cache on every mount. Response time and memory usage grow linearly with lead count.

Note: `useLeadgenAllLeads` (used by the main leads table) correctly uses server-side pagination with `.range(from, to)`. The issue is in the secondary hook `useLeadgenLeads` used by Overview/Dashboard sub-views.

**Fix required:** Add `.limit(500)` minimum to `useLeadgenLeads`, or migrate all Dashboard/Overview consumers to use `useLeadgenAllLeads` with appropriate filters.

---

### 🟠 P1 — Any portal member can update any lead (no ownership enforcement)

**File:** `src/hooks/leadgen/useLeadgenLeads.ts:91–103`

```ts
const { data: row, error: err } = await supabase
  .from("leadgen_leads")
  .update({ ...payload, updated_at: new Date().toISOString() })
  .eq("portal_id", currentPortalId)
  .eq("id", id)                    // no .eq("assigned_to", user.id)
  .select().single();
```

Any authenticated portal member can call `updateLead(anyId, { outreach_notes: "...", outreach_status: "converted" })`. The only safeguard is RLS, which needs to be verified to enforce per-user restrictions. For outreach notes this is a collaboration concern; for status changes it may be intentional but should be documented.

**Fix required:** Clarify the intended model: is outreach data shared/collaborative, or is it per-user? If per-user: add `.eq("assigned_to", user.id)` to the update query. If collaborative: document this behavior explicitly.

---

### 🟠 P1 — `has_website` not set in Apify upsert — relies on unverified DB trigger

**File:** `src/hooks/leadgen/useLeadgenSearches.ts:77–102`

The `leadsToInsert` array built from Apify results does NOT include `has_website`:

```ts
const leadsToInsert = kept.map((item) => ({
  portal_id: currentPortalId,
  website: item.website ?? null,
  // has_website is NOT set here
  ...
}));
```

The `useLeadgenLeads` type signature explicitly omits `has_website` from the upsert type. This column must be computed by a DB trigger (e.g. `has_website = (website IS NOT NULL AND website != '')`). If this trigger doesn't exist, every Apify-scraped lead gets `has_website = false` (column default), making the "senza sito" and "con sito" filters in `AllLeads` return wrong results.

**Fix required:** Verify the trigger exists: `SELECT * FROM information_schema.triggers WHERE table_name = 'leadgen_leads'`. If absent, either add a computed column (`has_website GENERATED ALWAYS AS (website IS NOT NULL) STORED`) or set `has_website: !!item.website` in the upsert payload.

---

### 🟠 P1 — Polling `setInterval` can stack on repeated `startPolling` calls

**File:** `src/hooks/leadgen/useLeadgenSearches.ts:160–163`

```ts
const startPolling = useCallback((apifyToken: string) => {
  if (pollingRef.current) clearInterval(pollingRef.current);  // ← only clears if same ref
  pollingRef.current = setInterval(() => pollRunningRef.current(apifyToken), POLL_INTERVAL_MS);
}, []);
```

The guard `if (pollingRef.current) clearInterval(...)` works correctly only if `pollingRef` is the same instance (same hook mount). If `LeadgenSearchHistory` unmounts and remounts (portal navigation), `pollingRef.current` is `null` in the new instance while the old interval continues in the old instance. The old interval becomes an orphan, calling the stale `pollRunningRef.current` with a stale token until the old component is garbage-collected.

**Fix required:** The cleanup already uses `useEffect` → `return () => clearInterval(pollingRef.current!)`. Verify this is correctly wired and that the `startPolling` call is inside a `useEffect` with proper cleanup. Consider using an `AbortController` pattern instead of `setInterval`.

---

### 🟠 P1 — Polling stops when user navigates away; `running` searches never auto-resolve

**File:** `src/hooks/leadgen/useLeadgenSearches.ts:159–163`

The polling runs only while `LeadgenSearchHistory` is mounted. If a user starts a search, then navigates to AllLeads, the poll stops. The search remains `status: "running"` in the DB forever. When the user returns, `LeadgenSearchHistory` remounts and polling restarts — but if the user never returns, the search stays stuck.

**Fix required:** Add a Supabase Edge Function (cron or triggered) that detects `leadgen_searches` rows with `status = 'running'` older than N minutes, polls Apify, and completes or marks them failed. This makes search completion server-driven rather than browser-dependent.

---

### 🟡 P2 — No GDPR acknowledgement for scraping personal contact data

**Files:** `src/pages/leadgen/LeadgenSearch.tsx`, `src/types/leadgen.ts` (emails, phone fields)

The app scrapes emails and phone numbers of business owners/employees from Google Maps listings via Apify. Under GDPR (Art. 6), processing personal contact data requires a lawful basis. For B2B outreach in the EU, "legitimate interest" can apply, but:
- The app provides no disclosure to the data subjects.
- The user has no acknowledgement flow confirming they understand their data processing obligations.
- Scraped contacts cannot opt out of being stored in the system.

**Fix required:** At minimum, add an onboarding/settings acknowledgement: "I confirm I have a lawful basis to store and process the contact data collected." Document the data retention policy. Consider adding a `gdpr_basis` field to `leadgen_leads`.

---

### 🟡 P2 — Deactivated `leadgen_members` can still take/be assigned leads

**Files:** `src/pages/leadgen/LeadgenAllLeads.tsx`, `src/pages/leadgen/LeadgenLeadDetail.tsx`

`handleTakeLead` and `handleAssignSelf` check only that `currentUserId` is set and `lead.assigned_to` is null. They do NOT verify that the user is an active `leadgen_members` record (`active: true`).

A deactivated member (e.g. someone who left the team but whose auth account remains active) can still:
- Click 🤙 to take unassigned leads
- Be assigned via the reassign modal
- View the full lead detail page

**Fix required:** In `handleTakeLead` and `handleAssignSelf`, check `currentMember?.active === true` before allowing the take. Also filter deactivated members out of the reassign dropdown.

---

### 🟡 P2 — Lead detail visible to all portal members regardless of `visibility` field

**File:** `src/types/leadgen.ts:85`, `src/pages/leadgen/LeadgenLeadDetail.tsx`

`LeadgenLead` has a `visibility: "team" | "internal_only" | "private"` field. The `LeadgenLeadDetail` page does not check this field — any portal member with the lead ID can view the full detail. The `visibility` field is stored in the DB but never enforced in the UI or RLS.

**Fix required:** Either implement visibility enforcement (redirect non-permitted viewers) or remove the `visibility` field and type to avoid false expectations.

---

### 🟡 P2 — Search escape only handles `%` and `_`, not regex metacharacters

**File:** `src/hooks/leadgen/useLeadgenAllLeads.ts:128`

```ts
const s = filters.search.trim().replace(/[%_]/g, "\\$&");
query = query.or(`name.ilike.%${s}%,address.ilike.%${s}%,category.ilike.%${s}%`);
```

The escape correctly handles `%` and `_` (SQL LIKE metacharacters). However, the `.or()` filter is assembled as a raw string. If `s` contains `,` (comma) or `.` (dot), the filter string syntax may be malformed. For example, a search for `"foo,bar"` produces `name.ilike.%foo,bar%,...` where the comma splits the OR condition.

**Fix required:** Additionally escape `,` and `.` from user input before embedding in the `.or()` string, or use `.filter()` with parameterized queries instead.

---

### 🔵 P3 — Lead creation date set by client (`created_at` in upsert payload)

**File:** `src/hooks/leadgen/useLeadgenSearches.ts:101`

```ts
created_at: new Date().toISOString(),
```

`created_at` is set by the client in the upsert payload. The Supabase column should have `DEFAULT now()` to ignore client-provided values. Verify the DB default exists; if it does, remove `created_at` from the insert payload.

---

### 🔵 P3 — `portal?.id ?? "sosa"` fallback in search submits wrong portal

**File:** `src/pages/leadgen/LeadgenSearch.tsx:9` (via `usePortal`)

Multiple places use `portal?.id ?? "sosa"` as the portal ID. `portal.id` is the portal slug (e.g. `"redx"`), while `currentPortalId` is the DB UUID. These are used interchangeably in some hooks. The leadgen section uses `currentPortalId` (correct UUID) in Supabase queries, but if `portal` is momentarily null and `"sosa"` is used as fallback, data could be written to the wrong portal.

**Fix required:** Audit all `portal?.id ?? "sosa"` fallbacks in the leadgen section and replace with `currentPortalId ?? ""` (with a guard that refuses to proceed if `currentPortalId` is null).

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🔴 P0 | Apify token returned to browser via `select("*")` | `useLeadgenSettings.ts`, `LeadgenSearch.tsx` |
| 2 | 🟠 P1 | `useLeadgenLeads` fetches all leads (no limit) | `useLeadgenLeads.ts` |
| 3 | 🟠 P1 | Any member can update any lead | `useLeadgenLeads.ts` |
| 4 | 🟠 P1 | `has_website` not set in upsert — relies on unverified trigger | `useLeadgenSearches.ts` |
| 5 | 🟠 P1 | Poll interval can stack / orphan on component remount | `useLeadgenSearches.ts` |
| 6 | 🟠 P1 | Running searches stuck forever if user navigates away | `useLeadgenSearches.ts` |
| 7 | 🟡 P2 | No GDPR acknowledgement for scraping personal contacts | `LeadgenSearch.tsx` |
| 8 | 🟡 P2 | Deactivated members can still take/be assigned leads | `LeadgenAllLeads.tsx`, `LeadgenLeadDetail.tsx` |
| 9 | 🟡 P2 | `visibility` field stored but never enforced | `LeadgenLeadDetail.tsx` |
| 10 | 🟡 P2 | Search query vulnerable to comma/dot in search string | `useLeadgenAllLeads.ts` |
| 11 | 🔵 P3 | `created_at` set by client, not DB default | `useLeadgenSearches.ts` |
| 12 | 🔵 P3 | `portal?.id ?? "sosa"` fallback could write to wrong portal | Multiple leadgen files |

---

## Fix protocol (this section)

**🔴 P0 — fix immediately before any further development:**
Move Apify calls to a Supabase Edge Function. Change `select("*")` to exclude `apify_token`. This is security-critical — an Apify token used by the app can run arbitrary actors at the account owner's expense.

**🟠 P1 — fix in this pass:**
- Add server-side lead fetch limit (finding #2)
- Verify `has_website` trigger (finding #4)
- Add interval cleanup guard (finding #5)

**Requires user sign-off before fixing:**
- GDPR acknowledgement flow (finding #7) — product decision needed on what the acknowledgement says
- Visibility enforcement (finding #9) — product decision on access control model

---

## Handoff

All four audit sections complete. See `audit-reports/` for:
- `profile.md` — 4× P0, 5× P1
- `finance.md` — 0× P0, 7× P1
- `social.md` — 2× P0, 3× P1
- `lead-generation.md` — 1× P0, 5× P1

Recommended next actions by priority:
1. Move Apify calls server-side (Lead Gen P0)
2. Remove base64 avatar localStorage fallback (Profile P0)
3. Fix Social `TODAY` frozen date (Social P1 — one-liner)
4. Add IDOR guard on profile/:userId route (Profile P0)
5. Create `user_profiles` table in Supabase — unblocks Profile P0/P1 chain

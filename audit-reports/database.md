# Database Audit Report — Phase D0: Project Map

**Date:** 2026-05-08
**Auditor:** Claude Code (senior QA + full-stack)
**Branch:** `feat/sosa-design-system`
**Tool:** Supabase MCP (live schema — source of truth)

---

## D0 — Project Map

### Infrastructure

| Field | Value |
|---|---|
| Organization | Sosa Inc. (`ozprvsbjwkkordjqqmdy`) |
| Project name | SOSA INC |
| Project ref | `ndudzfaisulnmbpnvkwo` |
| Region | `eu-west-1` (Frankfurt) |
| Status | `ACTIVE_HEALTHY` |
| PostgreSQL | 17.6.1 (GA release channel) |
| Branching | **Not enabled** — all development writes directly to production |
| API URL | `https://ndudzfaisulnmbpnvkwo.supabase.co` |
| Edge Functions | 1 (`cloud-presign`, ACTIVE, version 3) |

### API Key Usage

| Key type | Present | Used in codebase | Notes |
|---|---|---|---|
| Legacy anon JWT | ✅ | ✅ (`VITE_SUPABASE_ANON_KEY`) | Correct — anon key used client-side |
| Modern publishable key | ✅ | ❌ | `sb_publishable_4U2jpeGNoem7eBxXZxYFPw_SjvocB3i` exists but no code references it |
| Service role key | Not checked | Assumed server-only | Must NOT appear in any `VITE_*` env var |

`src/lib/supabase.ts` creates the client with `import.meta.env.VITE_SUPABASE_ANON_KEY` — correct usage.

### Multi-Portal Architecture

**Single Supabase project, multi-tenant via `portal_id` column.**

All 10 portals share one Supabase project. Portal isolation is enforced via `.eq("portal_id", currentPortalId)` in queries and RLS policies on every table.

### Portal Table — Live Data

```
SELECT id, slug, name FROM portals ORDER BY created_at;
```

| ID | Slug | Name | UUID type |
|---|---|---|---|
| `00000000-0000-0000-0000-000000000001` | `sosa` | SOSA INC. | Seeded fake UUID |
| `00000000-0000-0000-0000-000000000002` | `keylo` | KEYLOW | Seeded fake UUID |
| `00000000-0000-0000-0000-000000000003` | `redx` | REDX | Seeded fake UUID |
| `00000000-0000-0000-0000-000000000004` | `trustme` | TRUST ME | Seeded fake UUID |
| `0de70215-15d2-4eef-ad40-94b3c43c9436` | `alessandro-f936d7bb` | Alessandro's Portal | Real UUID |
| `6c82ea6c-3192-4e49-ae0f-dd35f8cd0641` | `marco-c12f6654` | Marco's Portal | Real UUID |
| `7e1bc2ba-75ae-4a3c-90be-706f995f74b8` | `sara-f029490d` | Sara's Portal | Real UUID |
| `1b1d99d2-f1ad-40e4-9003-459236014b8b` | `elena-5c5c7208` | Elena's Portal | Real UUID |
| `62f51c9c-3063-460e-a983-bac1b1a9931e` | `denis-7b51da16` | Denis's Portal | Real UUID |
| `8c9eb64b-20a2-4a80-93eb-6c07c9114d31` | `testuser-63e3fd3a` | testuser's Portal | Real UUID |

**Critical finding:** `PORTAL_UUID_MAP` in `src/lib/portalUUID.ts` maps exactly the 4 seeded portals to their matching fake UUIDs. For those 4, `toPortalUUID()` returns the correct value (the DB was seeded to match the code). For the 6 personal portals created via the Hub, `toPortalUUID(slug)` returns the slug itself (not in map), which is then passed as `portal_id` to Supabase. This fails silently on:
- All Vault operations in personal portals
- All Task sync operations in personal portals
- Any other code path using `toPortalUUID()` + `.eq("portal_id", ...)`

---

## D0 — Schema Snapshot (all 73 public tables)

### Tables with live data (rows > 0)

| Table | Rows | Section | Status |
|---|---|---|---|
| `portals` | 10 | Core | 4 fake UUIDs + 6 real UUIDs |
| `portal_members` | 42 | Core | Active data |
| `portal_settings` | 10 | Core | Active data |
| `portal_profiles` | 10 | Core | Active data |
| `appearance_settings` | 10 | Finance/UI | Active data |
| `currency_settings` | 10 | Finance | Active data |
| `social_publishing_rules` | 10 | Social | Active data |
| `expense_categories` | 112 | Finance | Active seed data |
| `finance_transaction_categories` | 60 | Finance | Active seed data |
| `income_categories` | 62 | Finance | Active seed data |
| `subscription_categories` | 87 | Finance | Active seed data |
| `payment_methods` | 30 | Finance | Active seed data |
| `tax_rates` | 40 | Finance | Active seed data |
| `content_categories` | 80 | Social | Active seed data |
| `task_labels` | 70 | Tasks | Active seed data |
| `task_priorities` | 50 | Tasks | Active seed data |
| `project_statuses` | 50 | Tasks | Active seed data |
| `notification_channels` | 40 | Cross | Active seed data |
| `departments` | 50 | Cross | Active seed data |
| `leadgen_members` | 8 | Lead Gen | Active data |
| `leadgen_settings` | 1 | Lead Gen | Active data |
| `leadgen_searches` | 4 | Lead Gen | Active data |
| `leadgen_leads` | 148 | Lead Gen | Active data |
| `leadgen_blacklist` | 55 | Lead Gen | Active data |
| `leadgen_outreach_events` | 1 | Lead Gen | Active data |
| `personal_transactions` | 3 | Finance | Live transactions |
| `audit_log` | 20 | Cross | Active (Supabase bridge working) |
| `gift_cards` | 1 | Finance | Active data |
| `gift_card_transactions` | 2 | Finance | Active data |

### Tables existing but empty — NOT connected in frontend code

These tables exist in the DB schema but the frontend code never reads from or writes to them. This is the key finding from this phase: **the "missing table" P0/P1 items from earlier audits are actually resolved at schema level — the frontend just isn't wired up.**

| Table | Section | Audit finding | Fix complexity |
|---|---|---|---|
| `notes` | Notes | P0 — "no DB persistence" | Connect existing table (not create) |
| `cloud_folders` | Cloud | P1 — "localStorage only" | Connect existing table (not create) |
| `task_comments` | Tasks | P1 — "localStorage only" | Connect existing table (not create) |
| `user_profiles` | Profile | P0 — "no DB table" | Connect existing table (not create) |
| `subscriptions` | Finance | P1 — "localStorage only" | Connect existing table (not create) |
| `budget_limits` | Finance | P1 — "localStorage only" | Connect existing table (not create) |
| `vault_items` | Vault | P0 — unencrypted, RLS gap | Table exists; encryption + RLS fix needed |
| `vault_files` | Vault | P1 — base64 in DB | Table exists; use Storage bucket instead |
| `cloud_files` | Cloud | — | Correctly used ✅ |
| `tasks` | Tasks | P1 — best-effort sync | Table exists; fix sync + add ownership RLS |
| `projects` | Tasks | P1 — localStorage primary | Table exists; fix sync |
| `financial_goals` | Finance | — | Exists; check if connected |
| `project_milestones` | Tasks | P2 — not synced | Table exists (`project_milestones`) |
| `social_connections` | Social | P1 — mock data | Table exists; needs OAuth flow |
| `social_posts` | Social | — | Exists |
| `social_analytics_snapshots` | Social | — | Exists |

### SCAFFOLD tables (created in advance, no code references yet)

These tables have a `comment` field stating they are planned features. No code references them. They are safe to leave as-is or connect when ready.

| Table | Planned use |
|---|---|
| `portal_member_roles` | Granular role-per-member override |
| `telegram_settings` | Per-portal Telegram settings |
| `notification_queue` | Async notification delivery pipeline |
| `user_activity_log` | Fine-grained user activity tracking |
| `folder_access_log` | Cloud folder access audit trail |
| `cloud_file_versions` | Version history for `cloud_files` |
| `telegram_notes` | Telegram note-sync (safe to populate when built) |

### RLS Status

All 73 tables have `rls_enabled: true`. This is correct. However, enabling RLS without verifying the actual policies is not sufficient — D1 will audit the policy definitions per table.

---

## D0 — Edge Functions

| Function | Status | Version | JWT verification |
|---|---|---|---|
| `cloud-presign` | ACTIVE | 3 | `verify_jwt: false` |

**Finding:** `verify_jwt: false` on `cloud-presign` means the function does not validate the Supabase JWT before executing. This is a security concern — any unauthenticated request can invoke the presign endpoint. The function should validate the Authorization header manually or set `verify_jwt: true`. To be confirmed in D6 (Edge Function audit).

---

## D0 — Key Findings Summary

### 🔴 D0-P0-1 — 6 personal portals broken for Vault and Tasks

`toPortalUUID()` can only resolve the 4 seeded portals. The 6 personal portals (Alessandro, Marco, Sara, Elena, Denis, testuser) get their slug passed as `portal_id` to Supabase. All Vault and Task Supabase operations in these portals either fail silently or corrupt data.

**Fix:** Replace all `toPortalUUID(portalId)` calls with `usePortalDB().currentPortalId`. Remove `portalUUID.ts`. This was identified in the static audit but confirmed live — affects real users now.

### 🟠 D0-P1-1 — Schema is ahead of frontend code

The DB already has `notes`, `cloud_folders`, `task_comments`, `user_profiles`, `subscriptions`, `budget_limits` tables. The frontend is not connected. Many audit P0/P1 items are "wire up existing table" not "create table from scratch" — significantly lower fix complexity.

### 🟠 D0-P1-2 — `cloud-presign` runs without JWT verification

`verify_jwt: false` means unauthenticated callers can hit the edge function. Full assessment in D6.

### 🟠 D0-P1-3 — No Supabase branching

All development writes directly to production. Any migration runs immediately against live data. Recommend enabling branching before any schema-level fix work begins.

### 🟡 D0-P2-1 — Modern publishable key unused

A `sb_publishable_*` key exists but the codebase uses only the legacy JWT anon key. Not a bug, but migration to the modern key format is recommended for better security properties (independent rotation).

### ⚪ D0-INFO-1 — `audit_log` has 20 rows

The `adminStore.ts` Supabase bridge is working — 20 audit entries are in the DB. The localStorage-primary concern from the static audit is partially mitigated; the bridge fires on some paths.

---

## D1 — Verbose Schema + RLS Audit

### Notes

**`notes`** — 13 columns
| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO | `uuid_generate_v4()` |
| `portal_id` | uuid | NO | — |
| `user_id` | uuid | NO | — |
| `folder_id` | uuid | YES | — |
| `title` | varchar(500) | NO | `'Untitled'` |
| `content` | text | YES | — |
| `is_pinned` | bool | YES | `false` |
| `is_archived` | bool | YES | `false` |
| `color` | varchar(7) | YES | — |
| `tags` | text[] | YES | — |
| `created_at/updated_at` | timestamptz | YES | `now()` |
| `created_by / updated_by` | uuid | YES | — |

**RLS `notes`:** `notes_all` — ALL where `user_id = auth.uid()`. Owner cannot see other users' notes. The "view other user's notes" UI feature is doubly broken: localStorage AND RLS both block it. **Design question:** should owner have read access to portal members' notes?

**Schema gaps:**
- ❌ No `source` column — frontend filters notes by `source === "telegram"`. DB has no such column. Telegram notes must be queried from separate `telegram_notes` table, not from `notes`.
- ✅ `folder_id` is uuid FK-ready — matches `note_folders.id`

**`note_folders`** — `id`, `portal_id`, `user_id`, `name`(varchar 255), `color`, `icon`, `sort_order`, `created_at/updated_at`

**RLS `note_folders`:** `nf_all` — ALL where `user_id = auth.uid()`. Correctly user-scoped.

---

### Cloud

**`cloud_files`** — 12 columns: `id`, `portal_id`, `folder_id`**(text)**, `name`, `size`(bigint), `mime_type`, `s3_key`, `uploaded_by`, `created_at`, `is_deleted`, `deleted_at`, `deleted_by`

⚠️ **Type mismatch:** `cloud_files.folder_id` is `text`, but `cloud_folders.id` is `uuid`. No FK constraint exists. Moving folders to Supabase will produce UUID strings stored as text — functional but brittle. Old localStorage folder IDs (`"fld_123"`, etc.) in existing cloud_files rows will become orphans.

**RLS `cloud_files`:**
- SELECT: portal member ✅
- INSERT: portal member + `uploaded_by = auth.uid()` ✅
- UPDATE: own file OR owner/admin ✅
- DELETE: **owner/admin only** — soft-delete (UPDATE) works for all, hard DELETE gated ✅

**`cloud_folders`** — fully featured schema: `id`, `portal_id`, `name`(varchar 255), `parent_id`(uuid), `created_by`, `permissions`(jsonb, default `[]`), `is_locked`(bool), `password_hash`(text), `password_set_at`, `lock_auto_timeout_minutes`(int, default 5), `color`(varchar 7), `icon`(varchar 50), `is_deleted`, `deleted_at`, `created_at/updated_at`

Schema supports everything that was localStorage-only: passwords (hashed), permissions (jsonb), color, icon, soft-delete.

**RLS `cloud_folders`:**
- SELECT: portal member + `is_deleted = false` ✅
- INSERT: `created_by = auth.uid()` + portal member ✅
- UPDATE: `created_by = auth.uid()` — **creator only, no admin override** ⚠️ Admins cannot rename/reorganize other users' folders
- DELETE: `created_by = auth.uid()` — same gap

---

### Tasks

**`tasks`** — 15 columns: `id`(uuid, `uuid_generate_v4()`), `portal_id`, `title`(varchar 500), `description`, `status`(varchar 50, default `'todo'`), `priority`(varchar 20, default `'medium'`), `assigned_to`(uuid), `creator_id`(uuid), `project_id`(uuid), `parent_id`(uuid), `labels`(text[]), `due_date`(date), `estimate`(int), `created_at/updated_at`(default `now()`)

`updated_at` has default `now()` — but no ON UPDATE trigger. Frontend provides it client-side. Clock drift risk remains.

**Frontend column mapping gaps:**
- Frontend sends `assigneeId` — DB column is `assigned_to` ✅ (taskSync maps it correctly, per `issueToTaskRow`)
- Frontend sends `creatorId` — DB column is `creator_id` ✅

**`projects`** — `id`(uuid, `uuid_generate_v4()`), `portal_id`, `name`, `description`, `status`(varchar 50, default `'active'`), `color`(varchar 7), `user_id`(uuid, nullable), `created_at/updated_at`

🔴 **P0 FUNCTIONAL BUG:** Frontend generates project IDs as `` `prj_${Date.now().toString(36)}` `` — not a valid UUID. PostgreSQL `uuid` column will throw `ERROR: invalid input syntax for type uuid` on every project upsert. All project syncing is **completely broken** for all portals. The error is silently swallowed by `try/catch` in `taskSync.ts`.

**RLS `tasks`:** Four PERMISSIVE policies — `tasks_all` (ALL for portal member) + `tasks_insert/update/select_member` + `tasks_delete_admin`. Since PERMISSIVE policies OR, `tasks_all` already grants DELETE to all portal members, nullifying `tasks_delete_admin`. **Any portal member can delete any task.**

**RLS `projects`:** Same pattern — `proj_all` + `projects_insert/update/select_member` + `projects_delete_admin`. `proj_all` nullifies admin-only DELETE restriction.

**`task_comments`** — `id`, `task_id`, `portal_id`, `author_id`, `content`, `created_at/updated_at`

**RLS `task_comments`:**
- SELECT: portal member can read all portal comments ✅
- ALL (write): `author_id = auth.uid()` — own comments only ✅

**`project_milestones`** — `id`, `project_id`, `portal_id`, `title`, `description`, `due_date`, `is_completed`, `completed_at`, `created_at/updated_at`. Table exists and is well-formed. Frontend never reads/writes it.

---

### Vault

**`vault_items`** — `id`, `portal_id`, `user_id`(**NOT NULL**), `type`(varchar 20), `name`(varchar 255), `category`, `encrypted_data`(text, **NOT NULL**), `is_locked`, `is_favorite`, `tags`(text[]), `created_by`(**NOT NULL**), `created_at/updated_at`, `last_accessed_at`, `expires_at`

**RLS `vault_items`:** `vi_all` — ALL where `user_id = auth.uid()`. Vault is completely personal — no user can ever see another user's items regardless of portal. The "Shared" concept in VaultPage UI is blocked by RLS. Any `createVaultItem` call must include `user_id: auth.uid()` or the insert will fail the RLS `with_check`. `vaultService.ts` must be verified for this.

**`vault_files`** — `id`, `portal_id`, `uploaded_by`, `file_name`, `file_path`, `file_type`, `file_size`(bigint), `created_at/updated_at`

**RLS `vault_files`:** `vault_files_portal_all` — ANY portal member can CRUD ALL vault files. No ownership filter. Any member can delete any other member's vault files at the DB level.

**`vault_item_history`** — `id`, `item_id`, `user_id`, `portal_id`, `action`(varchar 20), `details`(jsonb), `ip_address`, `created_at`. No RLS policy found — if RLS is enabled and no policy matches, all operations are denied by default. Vault access logging may be silently failing.

---

### Profile

**`user_profiles`** — `id`(uuid, **no default — equals auth.uid()**), `display_name`(varchar 100), `bio`, `phone`, `timezone`(default `'UTC'`), `language`(default `'en'`), `avatar_url`, `banner_url`, `social_links`(jsonb, default `{}`), `is_onboarded`(bool, default false), `created_at/updated_at`

🔴 **Schema gap:** No `iban`, `tax_id`, `vat_number` columns. Profile audit found these stored in localStorage — confirmed the DB has no home for them. `vat_number` exists in `portal_profiles` (portal-level), not user-level.

**RLS `user_profiles`:**
- ALL (modify): `id = auth.uid()` — own profile only ✅
- SELECT: own profile OR portal co-members ✅ (correct — display names visible to teammates)

**`portal_profiles`** — portal-level legal info: `legal_name`, `vat_number`, `address_line1/2`, `city`, `state`, `zip`, `country`(default `'IT'`), `phone`, `website`, `language`(default `'it'`), `timezone`(default `'Europe/Rome'`), `date_format`(default `'DD/MM/YYYY'`). Defaults confirm Italian locale assumption.

---

### Finance

**`personal_transactions`** — `id`, `portal_id`, `user_id`(**NOT NULL**), `type`(varchar 20), `amount`(**numeric** ✅ not float), `currency`(default `'EUR'`), `category`, `category_id`(uuid), `description`, `date`(date, `CURRENT_DATE`), `cost_classification`, `payment_method`, `reference`, `tags`(text[]), `created_at/updated_at`, `title`, `subcategory`, `is_recurring`(bool, default false)

**Schema gap:** No `deleted_at` column — confirmed. Hard delete removes financial history.

**RLS `personal_transactions`:** `pt_all` — portal member can CRUD ALL portal transactions. **No `user_id` filter** — any member can modify another member's transactions at the DB level.

**`subscriptions`** — all expected columns. `amount` is numeric ✅.

**RLS `subscriptions`:** `subs_all` — `user_id = auth.uid()` ✅ Correctly user-scoped.

**`budget_limits`** — `portal_id`, `user_id`(nullable), `category`, `category_id`, `monthly_limit`(numeric), `color`, `icon_name`, timestamps.

**RLS `budget_limits`:** `bl_all` — portal member can CRUD. No ownership filter. Any member can delete another member's budget limits.

**`financial_goals`** — confirmed correct columns including `target`(numeric), `saved`(numeric), `deadline`(date), `is_achieved`(bool). Connected in codebase.

---

### Social

**`social_connections`** — `id`, `portal_id`, `user_id`, `platform`(varchar 30), `account_handle`, `account_name`, `access_token`(**text — plaintext**), `refresh_token`(**text — plaintext**), `token_expires_at`, `is_active`, timestamps

🔴 **P0 Security:** OAuth `access_token` and `refresh_token` stored in plaintext in Postgres. Any Supabase dashboard access, DB backup, or RLS bypass exposes all connected social platform credentials. Tokens should be encrypted at rest (AES-256-GCM via Vault-style encryption before insert).

**RLS `social_connections`:**
- SELECT: portal member (all connections visible to all) — tokens readable by any member ⚠️
- INSERT: portal member ✅
- UPDATE/DELETE: owner/admin only ✅

**`social_posts`** + **`social_analytics_snapshots`** — well-formed schemas, exist in DB. Frontend shows mock data and never reads from them.

---

### Lead Generation

**`leadgen_settings`** — confirmed `apify_token`(text) column. Used in `select("*")` — returns token to browser.

**RLS `leadgen_leads` + `leadgen_settings`:** 🔴 **P0 — RLS effectively disabled:**

```sql
-- Policy 1 (allows everything):
leadgen_leads_all: qual = true, with_check = true

-- Policy 2 (portal-scoped, irrelevant):
leadgen_leads_member_all: qual = portal_id IN (portal_members WHERE user_id = auth.uid())
```

Two PERMISSIVE policies OR together. Policy 1 passes `qual: true` for every authenticated user. RLS is effectively disabled on both `leadgen_leads` and `leadgen_settings`. Any authenticated Supabase user can read/write all leads and all `apify_token` values from all portals.

**Fix required:** Remove the `_all` wildcard policies. Keep only the `_member_all` portal-scoped policy.

---

### Audit Log

**`audit_log`** — `id`, `portal_id`, `user_id`(nullable), `user_name`(varchar 100), `action`(varchar 100), `category`, `entity_type`, `entity_id`(text), `details`(jsonb), `severity`(varchar 10, default `'info'`), `ip_address`, `created_at`

**RLS `audit_log`:**
- INSERT: any portal member ✅
- SELECT: owner/admin/manager only ✅
- No UPDATE/DELETE policy → denied for all (RLS default) ✅ Immutable audit log — correct design.

---

## D1 — Critical Findings Summary

### 🔴 P0 Security

| ID | Table | Finding |
|---|---|---|
| D1-P0-1 | `leadgen_leads` + `leadgen_settings` | RLS disabled — wildcard `qual: true` policy overrides portal scoping |
| D1-P0-2 | `social_connections` | `access_token` + `refresh_token` stored plaintext |
| D1-P0-3 | `projects` | Frontend generates non-UUID IDs — ALL project syncing broken, errors swallowed |

### 🟠 P1 Data Integrity

| ID | Table | Finding |
|---|---|---|
| D1-P1-1 | `notes` | No `source` column — Telegram notes cannot be stored/fetched |
| D1-P1-2 | `cloud_files` | `folder_id` is `text` not `uuid` — no FK constraint, orphan risk |
| D1-P1-3 | `user_profiles` | No `iban`, `tax_id` columns — nowhere in DB to store these |
| D1-P1-4 | `personal_transactions` | No `deleted_at` — hard delete removes financial history |
| D1-P1-5 | `tasks` / `projects` | `tasks_all` + `proj_all` nullify admin-only DELETE restriction |
| D1-P1-6 | `vault_files` | No ownership filter in RLS — any member deletes anyone's files |
| D1-P1-7 | `cloud_folders` | UPDATE/DELETE only by creator — admins can't reorganize |
| D1-P1-8 | `personal_transactions` | No `user_id` filter in RLS — any member modifies anyone's transactions |
| D1-P1-9 | `vault_item_history` | No RLS policies — access log writes may be silently failing |
| D1-P1-10 | `budget_limits` | No ownership filter — any member deletes anyone's budget limits |

### 🟡 P2

| ID | Table | Finding |
|---|---|---|
| D1-P2-1 | `notes` | `notes_all` blocks owner from reading portal members' notes — "view other user's notes" feature needs RLS extension |
| D1-P2-2 | `tasks.updated_at` | No ON UPDATE trigger — relies on client clock |
| D1-P2-3 | `portal_profiles` | Default country `'IT'`, language `'it'`, timezone `'Europe/Rome'` hardcoded — localization assumption |

---

## D2 — Field Mapping Audit (Frontend ↔ DB)

### Tasks — Field Map

| Frontend field (`Issue`) | DB column (`tasks`) | Status |
|---|---|---|
| `id` | `id` (uuid) | 🔴 **New tasks use `ISS-21` format — invalid UUID, insert fails** |
| `title` | `title` | ✅ |
| `description` | `description` | ✅ |
| `status` | `status` | ✅ |
| `priority` | `priority` | ✅ |
| `assigneeId` | `assigned_to` | ✅ mapped in `issueToTaskRow` |
| `creatorId` | `creator_id` | ✅ |
| `labels` | `labels` (text[]) | ✅ |
| `projectId` | `project_id` | ✅ |
| `dueDate` (Date) | `due_date` (date) | ✅ ISO string split on `T` |
| `estimate` | `estimate` | ✅ |
| `parentId` | `parent_id` | ✅ |
| `comments` | — | ❌ Not in DB (`comments: []` hardcoded in `taskRowToIssue`) |
| `milestoneId` | — | ❌ Not mapped (`milestoneId: null` hardcoded) |
| `subIssueIds` | — | ✅ Derived client-side from `parent_id` |
| `updatedAt` | `updated_at` | ⚠️ Client-side `new Date()` — no DB trigger |
| — | `portal_id` | ⚠️ Via `toPortalUUID()` — broken for personal portals |

**`generateIssueId(prefix)`** returns `"ISS-21"`, `"ISS-22"`, etc. — a LINEAR-style display ID, not a UUID. Every `upsertTask` for a new task fails at Postgres type validation. Tasks loaded from Supabase have real UUIDs — updates on those DO sync ✅.

| Frontend field (`Project`) | DB column (`projects`) | Status |
|---|---|---|
| `id` | `id` (uuid) | 🔴 `prj_${Date.now().toString(36)}` — invalid UUID |
| `name` | `name` | ✅ |
| `description` | `description` | ✅ |
| `status` | `status` | ✅ |
| `leadId` | `user_id` | ✅ mapped in `projectToRow` |
| `color` | `color` | ✅ |
| `emoji` | — | ❌ No DB column, hardcoded `"📋"` on load |
| `targetDate` | — | ❌ Not mapped, always `null` |
| `milestones` | — | ❌ Not synced (DB has `project_milestones` table, unused) |

**Fix required (both):** Replace `generateIssueId` with `crypto.randomUUID()` for tasks. Replace `prj_${Date.now().toString(36)}` with `crypto.randomUUID()` for projects.

---

### Vault — Field Map

| Frontend field (`VaultItem`) | DB column (`vault_items`) | Status |
|---|---|---|
| `id` | `id` | ✅ DB default `uuid_generate_v4()` (VaultPage falls back to `local_${Date.now()}` on failure) |
| `type` | `type` (varchar 20) | ⚠️ Frontend uses `"credential"\|"api_key"\|"document"\|"note"` — DB col is varchar, no enum constraint |
| `name` | `name` | ✅ |
| `encrypted_data` (plaintext JSON) | `encrypted_data` (text NOT NULL) | 🔴 Plaintext — no encryption performed |
| `user_id: userId` | `user_id` (NOT NULL) | ✅ `createVaultItem` call passes `user_id` correctly |
| `created_by: userId` | `created_by` (NOT NULL) | ✅ |
| `is_locked` | `is_locked` | ✅ |
| `is_favorite` | `is_favorite` | ✅ |
| `tags` | `tags` | ✅ |
| `expires_at` | `expires_at` | ✅ |
| — | `portal_id` | ⚠️ Via `toPortalUUID()` — broken for personal portals |
| — | `last_accessed_at` | ✅ Updated via `recordVaultAccess` |
| `category` | `category` | ✅ |

**`deleteItem` in VaultPage (line 733):** `setItems(prev => prev.filter(i => i.id !== id))` — state only, never calls `deleteVaultItem()`. Items with non-`local_` IDs persist in DB forever.

**`logVaultAccess` / `vault_item_history`:** RLS enabled but no policies exist → all inserts rejected. Access log has never functioned.

---

### Finance — Field Map

**`personal_transactions` — add flow:**
```ts
supabase.from("personal_transactions")
  .insert({ ...data, user_id: user.id, portal_id: currentPortalId })
```
Uses `currentPortalId` (real UUID from `usePortalDB()`) ✅. No `local_` ID sent to Supabase — Supabase generates UUID ✅.

| Frontend field | DB column | Status |
|---|---|---|
| `type` | `type` | ✅ |
| `amount` | `amount` (numeric) | ✅ |
| `currency` | `currency` | ✅ |
| `category` | `category` | ✅ |
| `category_id` | `category_id` | ✅ |
| `description` | `description` | ✅ |
| `date` | `date` | ✅ |
| `cost_classification` | `cost_classification` | ✅ |
| `payment_method` | `payment_method` | ✅ |
| `tags` | `tags` | ✅ |
| `subcategory` | `subcategory` | ✅ |
| `is_recurring` | `is_recurring` | ✅ |
| `recurring_interval` | — | ⚪ No DB column — field mapped in `toPersonal` but always `undefined` |
| `receipt_url` | — | ⚪ No DB column — same |
| `title` | `title` | ✅ |
| — | `deleted_at` | ❌ Missing — hard delete removes financial history |

---

### Profile — Field Map (critical gap)

`profileStore.ts` is 100% localStorage. No Supabase reads or writes exist anywhere in the profile data path. The `user_profiles` table (10 columns) covers only ~25% of the `Profile` interface (40+ fields).

| Profile interface field | `user_profiles` column | Status |
|---|---|---|
| `display_name` | `display_name` | ✅ (column exists, never written) |
| `phone` | `phone` | ✅ (column exists, never written) |
| `timezone` | `timezone` | ✅ |
| `language` | `language` | ✅ |
| `avatar_url` | `avatar_url` | ✅ |
| `cover_image_url` | `banner_url` | ⚠️ Different name |
| `onboarding_completed` | `is_onboarded` | ⚠️ Different name |
| `social links (multiple)` | `social_links` (jsonb) | ⚠️ Needs JSON mapping |
| `first_name`, `last_name` | — | ❌ No DB column |
| `email` | — | ❌ In `auth.users`, not `user_profiles` |
| `date_of_birth` | — | ❌ No DB column |
| `company_name`, `job_title`, `department` | — | ❌ No DB column |
| `tax_id`, `business_type` | — | ❌ No DB column |
| `address_line_1/2`, `city`, `province`, `postal_code`, `country` | — | ❌ No DB column (address is portal-level in `portal_profiles`) |
| `brand_color` | — | ❌ No DB column |
| `currency`, `date_format` | — | ❌ Portal-level in `portal_profiles`, not user-level |
| `iban`, `bank_name`, `swift_bic`, `account_holder_name` | — | ❌ No DB column anywhere |
| `telegram_chat_id`, `telegram_notifications_*` | — | ❌ No DB column (scaffold `telegram_settings` is portal-level, not user-level) |

**The `user_profiles` table is incomplete for the profile feature.** Migrating profile to Supabase requires either adding ~25 columns to `user_profiles` or splitting into `user_profiles` (identity) + `user_banking` (IBAN/SWIFT) + `user_preferences` (currency/date_format/brand_color) + `telegram_user_settings`.

---

### Notes — Field Map

`NotesPage.tsx` has zero Supabase calls. The `notes` DB table exists and is well-structured. The `Note` interface in `notesStore.ts` lacks `portal_id` — without it, notes can't be portal-scoped when written.

| `Note` interface field | `notes` DB column | Status |
|---|---|---|
| `id` | `id` | ⚠️ Frontend uses `note_${Date.now()}` — not UUID format |
| `title` | `title` | ✅ |
| `content` | `content` | ✅ |
| `isPinned` | `is_pinned` | ⚠️ camelCase vs snake_case (needs mapping) |
| `isArchived` | `is_archived` | ⚠️ same |
| `ownerId` | `user_id` | ⚠️ Different name |
| `folderId` | `folder_id` | ✅ both uuid-compatible |
| `tags` | `tags` | ✅ |
| `color` | `color` | ✅ |
| `source` | — | ❌ No DB column — Telegram note routing impossible |
| `createdAt` | `created_at` | ✅ |
| `updatedAt` | `updated_at` | ✅ |
| — | `portal_id` | ❌ Missing from `Note` interface |

---

### Social — Field Map

Frontend stores connection state in `useState` only. `social_connections` table exists with correct schema including `access_token`/`refresh_token` — these would be stored plaintext (P0). No OAuth callback writes to DB.

---

### Lead Gen — Field Map

`leadgen_settings.apify_token` fetched via `select("*")` in `useLeadgenSettings.ts`. Column is in DB, token reaches browser in full response. Fix: use `select("id, portal_id, default_country_code, default_language, default_max_places, scrape_contacts, actor_id")` — omit `apify_token`.

`leadgen_leads`: no `.limit()` in `useLeadgenLeads` — fetches all 148 rows. Not a problem at this size; will be at 10k+.

---

## D2 — Field Mapping Findings Summary

### 🔴 P0

| ID | Section | Finding |
|---|---|---|
| D2-P0-1 | Tasks | New task IDs (`ISS-21`) fail UUID type — task creation never persists |
| D2-P0-2 | Tasks | Project IDs (`prj_*`) fail UUID type — project creation never persists |
| D2-P0-3 | Vault | `encrypted_data` stores `JSON.stringify(payload)` — plaintext |
| D2-P0-4 | Vault | `deleteItem` never calls DB — deleted items persist in `vault_items` |

### 🟠 P1

| ID | Section | Finding |
|---|---|---|
| D2-P1-1 | Profile | `user_profiles` table missing ~25 fields — banking, address, Telegram, brand |
| D2-P1-2 | Notes | `Note` interface missing `portal_id` — can't portal-scope DB writes |
| D2-P1-3 | Notes | `note_${Date.now()}` IDs — invalid UUIDs for DB insert |
| D2-P1-4 | Notes | No `source` column — Telegram note routing requires separate table |
| D2-P1-5 | Vault | `vault_item_history` RLS has no policies — all access logs silently rejected |
| D2-P1-6 | Lead Gen | `apify_token` in `select("*")` — strip from query |

### ⚪ INFO

| ID | Section | Finding |
|---|---|---|
| D2-INFO-1 | Finance | `recurring_interval`, `receipt_url` mapped in `toPersonal` but no DB columns |
| D2-INFO-2 | Tasks | Task updates on Supabase-sourced rows sync correctly (UUID IDs preserved) |
| D2-INFO-3 | Finance | `addTransaction` correctly uses `currentPortalId` — no portal UUID map issue |

---

## D0 — Phase Complete

**Confirmed:** DB schema is in significantly better shape than the static code audit implied. The P0 concern "create X table" becomes "connect to X table that already exists." Fix complexity drops for Notes, Cloud folders, Task comments, Profile, and Finance budget/subscriptions.

---

## D3 — Indexes, Foreign Keys, Missing Constraints

**Date:** 2026-05-08 (continuation)  
**Source:** Live queries against `ndudzfaisulnmbpnvkwo` via Supabase MCP

---

### D3.1 — Index Audit

#### Well-indexed tables ✅

| Table | Indexes | Notes |
|---|---|---|
| `cloud_files` | `(portal_id, folder_id, created_at)`, `(portal_id, deleted_at)`, UNIQUE `s3_key` | Excellent — trash and folder queries covered |
| `leadgen_leads` | `(portal_id, place_id)` UNIQUE, `(portal_id, created_at)`, `(portal_id, has_website, outreach_status)` | Good coverage; see duplicate issue below |
| `leadgen_settings` | UNIQUE `portal_id` | Singleton lookup — perfect |
| `personal_transactions` | `(portal_id, user_id)`, `(portal_id, date)`, `(portal_id, category)`, `(portal_id, type)`, `category_id` | Complete coverage for finance queries |
| `portal_members` | UNIQUE `(portal_id, user_id)` | Correct |
| `subscriptions` | `(portal_id, user_id)`, `next_billing_date` | Coverage OK |
| `tasks` | `portal_id`, `assigned_to`, `project_id` | Functional but missing status index (see below) |
| `vault_items` | `(portal_id, user_id)` | OK |

#### Missing indexes 🟠

| Finding | Severity | Impact |
|---|---|---|
| `tasks`: no `(portal_id, status)` index | 🟠 P1 | Status filter runs on every task view — most common query pattern |
| `tasks`: no `(portal_id, creator_id)` index | 🟡 P2 | "Created by me" filter full-scans the portal's tasks |
| `task_comments`: only `task_id` indexed; `portal_id` unindexed | 🟡 P2 | Portal-level comment queries scan all comments |
| `vault_item_history`: only `item_id`; no `(portal_id, user_id)` | 🟡 P2 | Access log queries per user are unindexed |
| `notes`: `(portal_id, user_id)` exists but no `created_at` in index | 🔵 P3 | ORDER BY created_at requires post-filter sort |

#### Duplicate indexes 🔵 (P3 — waste, no correctness issue)

| Duplicate pair | Table |
|---|---|
| `idx_leadgen_leads_portal_created` ↔ `leadgen_leads_portal_created` | `leadgen_leads` |
| `idx_leadgen_leads_portal_has_website` ↔ `leadgen_leads_portal_has_website` | `leadgen_leads` |
| `idx_leadgen_searches_portal_started` ↔ `leadgen_searches_portal_started` | `leadgen_searches` |
| `idx_pt_date` ↔ `idx_ptx_portal_date` (both `(portal_id, date)`) | `personal_transactions` |

Both members of each pair are identical. Drop the non-prefixed versions; the `idx_*` names follow the naming convention.

---

### D3.2 — Foreign Key Audit

#### FKs confirmed present ✅

| Table | Column | References | On Delete |
|---|---|---|---|
| `cloud_files` | `portal_id` | `portals.id` | CASCADE |
| `leadgen_leads` | `search_id` | `leadgen_searches.id` | SET NULL |
| `notes` | `portal_id` | `portals.id` | CASCADE |
| `notes` | `folder_id` | `note_folders.id` | SET NULL |
| `personal_transactions` | `portal_id` | `portals.id` | CASCADE |
| `personal_transactions` | `category_id` | `finance_transaction_categories.id` | SET NULL |
| `portal_members` | `portal_id` | `portals.id` | CASCADE |
| `projects` | `portal_id` | `portals.id` | CASCADE |
| `subscriptions` | `portal_id` | `portals.id` | CASCADE |
| `task_comments` | `portal_id` | `portals.id` | CASCADE |
| `task_comments` | `task_id` | `tasks.id` | CASCADE |
| `tasks` | `portal_id` | `portals.id` | CASCADE |
| `tasks` | `project_id` | `projects.id` | SET NULL |
| `tasks` | `parent_id` | `tasks.id` | SET NULL |
| `vault_files` | `portal_id` | `portals.id` | CASCADE |
| `vault_item_history` | `item_id` | `vault_items.id` | CASCADE |
| `vault_item_history` | `portal_id` | `portals.id` | CASCADE |
| `vault_items` | `portal_id` | `portals.id` | CASCADE |

#### Missing FKs 🟠

| Table | Column | Missing FK | Severity | Notes |
|---|---|---|---|---|
| `leadgen_leads` | `portal_id` | `→ portals.id` | 🟠 P1 | Has NOT NULL + RLS, but no referential integrity |
| `leadgen_searches` | `portal_id` | `→ portals.id` | 🟠 P1 | Same |
| `leadgen_settings` | `portal_id` | `→ portals.id` | 🟠 P1 | Same |

All three `leadgen_*` tables have `portal_id NOT NULL` and the correct UNIQUE constraint (leadgen_settings), but no FK to `portals`. A deleted portal would leave orphaned leadgen data with no cascade. Add `REFERENCES portals(id) ON DELETE CASCADE`.

> **Note:** `user_id`, `creator_id`, `assigned_to`, `author_id` FK references to `auth.users` are intentionally absent — Supabase restricts cross-schema FK from `public` to `auth`. This is by design.

---

### D3.3 — Nullable / Constraint Audit

#### Nullable columns that should be NOT NULL 🟡

| Table | Column | Current | Issue |
|---|---|---|---|
| `tasks` | `creator_id` | NULLABLE | Every task has an author — should be NOT NULL |
| `tasks` | `status` | NULLABLE (default `'todo'`) | DEFAULT exists but column nullable — DB can store NULL status |
| `projects` | `user_id` | NULLABLE | Project creator should be required |
| `projects` | `status` | NULLABLE (default `'active'`) | Same issue as tasks.status |
| `personal_transactions` | `title` | NULLABLE | UI always sets a title — consider NOT NULL with empty-string default |

#### CHECK constraint coverage ✅ (good)

All enum-style columns have CHECK constraints:
- `personal_transactions.type` → `IN ('income','expense','transfer')` ✅
- `personal_transactions.cost_classification` → 4 values ✅
- `subscriptions.billing_cycle` → 4 values ✅
- `subscriptions.status` → 3 values ✅
- `tasks.status` → 6 values ✅
- `tasks.priority` → 5 values ✅
- `vault_items.type` → `IN ('credential','api_key','document','note','card')` ✅

#### vault_items.type enum drift 🟡 P2

`vault_items.type` CHECK allows `'card'` — the TypeScript `VaultItemType` in `vaultStore.ts` does **not** include `'card'`. The `dbToVaultItem` adapter at [VaultPage.tsx:26](src/pages/VaultPage.tsx#L26) casts DB type directly: `type: db.type as VaultItemType`. If a `'card'` row exists in DB, the frontend silently treats it as an unknown type. Either add `'card'` to the TS type or remove it from the CHECK constraint.

---

### D3.4 — Bug Fix Status (from D0–D2)

Tracking all fixes confirmed implemented in this session:

| Fix | File | Status |
|---|---|---|
| Task IDs: `generateIssueId` → `crypto.randomUUID()` | `TasksPage.tsx:165` | ✅ Fixed |
| Project IDs: `prj_${Date.now()}` → `crypto.randomUUID()` | `TasksPage.tsx:191` | ✅ Fixed |
| `STORAGE_TASKS` scoped by `portalId` | `storageKeys.ts`, `TasksPage.tsx`, `ProfileTasksCard.tsx` | ✅ Fixed |
| `STORAGE_PROJECTS` scoped by `portalId` | `storageKeys.ts`, `TasksPage.tsx` | ✅ Fixed |
| `STORAGE_NOTES` scoped by `portalId_userId` | `storageKeys.ts`, `NotesPage.tsx` | ✅ Fixed |
| `STORAGE_NOTE_FOLDERS` scoped by `portalId_userId` | `storageKeys.ts`, `NotesPage.tsx` | ✅ Fixed |
| `NotesPage.isOwner` uses `usePortalDB().userRole` | `NotesPage.tsx:69` | ✅ Fixed |
| `VaultPage.deleteItem` calls `deleteVaultItem()` | `VaultPage.tsx:733` | ✅ Fixed |
| Drop `leadgen_leads_all` wildcard RLS (qual=true) | Supabase migration | ✅ Applied |
| Drop `leadgen_settings_all` wildcard RLS (qual=true) | Supabase migration | ✅ Applied |
| `vault_item_history` RLS policies | Supabase | ✅ Already correct (pre-existing) |
| `apify_token` removed from `select("*")` | `useLeadgenSettings.ts` | ⏸ Deferred — token actively used in browser; requires edge function migration first |

---

### D3.5 — Live Error Log Findings (discovered from postgres logs)

Two additional errors seen in the live Postgres logs during this audit session:

| Error | Severity | Finding |
|---|---|---|
| `column user_profiles.email does not exist` | 🟠 P1 | Frontend queries `user_profiles.email` — column doesn't exist in schema. The `user_profiles` table stores user metadata but `email` was never added; email lives in `auth.users.email`. Any profile query that selects `email` fails silently. |
| `column leadgen_outreach_events.user_id does not exist` | 🟠 P1 | `leadgen_outreach_events` table exists but `user_id` column is missing. Any outreach tracking query that filters/joins on `user_id` fails. |

**Fix for user_profiles.email:** Rewrite the query to join `auth.users` via a DB function or use `auth.uid()` — do not add `email` to `user_profiles` (duplicates auth data). Or query `auth.users` through a Supabase admin client call server-side.

**Fix for leadgen_outreach_events.user_id:** Add the column: `ALTER TABLE public.leadgen_outreach_events ADD COLUMN user_id uuid REFERENCES auth.users(id);` — or check if the correct column name is `created_by` and update the query.

---

### D3 Findings Summary

#### 🟠 P1

| ID | Finding | Fix |
|---|---|---|
| D3-P1-1 | `tasks` missing `(portal_id, status)` index — most common filter unindexed | `CREATE INDEX idx_tasks_portal_status ON tasks(portal_id, status)` |
| D3-P1-2 | `leadgen_leads.portal_id` has no FK → portals | Add `REFERENCES portals(id) ON DELETE CASCADE` |
| D3-P1-3 | `leadgen_searches.portal_id` has no FK → portals | Same |
| D3-P1-4 | `leadgen_settings.portal_id` has no FK → portals | Same |

#### 🟡 P2

| ID | Finding | Fix |
|---|---|---|
| D3-P2-1 | `tasks.creator_id` is nullable — should be NOT NULL | `ALTER TABLE tasks ALTER COLUMN creator_id SET NOT NULL` (after backfill) |
| D3-P2-2 | `tasks.status` has DEFAULT but is nullable | `ALTER TABLE tasks ALTER COLUMN status SET NOT NULL` |
| D3-P2-3 | `projects.user_id` is nullable | `ALTER TABLE projects ALTER COLUMN user_id SET NOT NULL` (after backfill) |
| D3-P2-4 | `vault_items.type` CHECK includes 'card' but TS enum does not — type drift | Align TS type or remove 'card' from CHECK |
| D3-P2-5 | `task_comments.portal_id` unindexed | `CREATE INDEX idx_tc_portal ON task_comments(portal_id)` |
| D3-P2-6 | `vault_item_history` no `(portal_id, user_id)` index | `CREATE INDEX idx_vih_portal_user ON vault_item_history(portal_id, user_id)` |

#### 🔵 P3

| ID | Finding | Fix |
|---|---|---|
| D3-P3-1 | 4 duplicate index pairs on leadgen + personal_transactions | Drop non-prefixed duplicates |
| D3-P3-2 | `notes` index lacks `created_at` — ORDER BY needs sort step | `CREATE INDEX idx_notes_portal_user_date ON notes(portal_id, user_id, created_at DESC)` |
| D3-P3-3 | `tasks.creator_id` and `tasks` missing `(portal_id, creator_id)` index | `CREATE INDEX idx_tasks_portal_creator ON tasks(portal_id, creator_id)` |

---

### D3.6 — Pending Migrations (DB connection pool exhausted during session)

These migrations could not be applied due to connection pool saturation. Apply manually via Supabase SQL editor or CLI:

```sql
-- 1. P1: tasks status index (most common filter unindexed)
CREATE INDEX IF NOT EXISTS idx_tasks_portal_status ON public.tasks(portal_id, status);

-- 2. P1: leadgen FK constraints (referential integrity + cascade delete)
ALTER TABLE public.leadgen_leads
  ADD CONSTRAINT leadgen_leads_portal_id_fkey
  FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.leadgen_searches
  ADD CONSTRAINT leadgen_searches_portal_id_fkey
  FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.leadgen_settings
  ADD CONSTRAINT leadgen_settings_portal_id_fkey
  FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE CASCADE NOT VALID;

-- 3. Validate constraints (separate pass, no full table lock)
ALTER TABLE public.leadgen_leads VALIDATE CONSTRAINT leadgen_leads_portal_id_fkey;
ALTER TABLE public.leadgen_searches VALIDATE CONSTRAINT leadgen_searches_portal_id_fkey;
ALTER TABLE public.leadgen_settings VALIDATE CONSTRAINT leadgen_settings_portal_id_fkey;

-- 4. P3: Drop duplicate indexes
DROP INDEX IF EXISTS public.leadgen_leads_portal_created;
DROP INDEX IF EXISTS public.leadgen_leads_portal_has_website;
DROP INDEX IF EXISTS public.leadgen_searches_portal_started;
DROP INDEX IF EXISTS public.idx_pt_date;

-- 5. P2: Additional useful indexes
CREATE INDEX IF NOT EXISTS idx_tc_portal ON public.task_comments(portal_id);
CREATE INDEX IF NOT EXISTS idx_vih_portal_user ON public.vault_item_history(portal_id, user_id);
CREATE INDEX IF NOT EXISTS idx_notes_portal_user_date ON public.notes(portal_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_portal_creator ON public.tasks(portal_id, creator_id);
```


# SOSA INC — Health Check 2026-05-16

**Operator:** Claude Opus 4.7 (1M context), Session 1 — Diagnosis
**Branch:** `feat/sosa-design-system` (HEAD `01503f7`)
**Supabase project:** `ndudzfaisulnmbpnvkwo`
**Owner UID:** `81811fcb-a587-439f-b465-5df67a5fc00a` (sosa@sosainc.com)

## Executive summary

| Layer | Verdict |
|-------|---------|
| **Codebase** | 🟢 **CLEAN** — tsc 0 errors, build 15.53s green, no dual-client divergence, localStorage usage matches whitelist. Lint baseline yellow (94 errors / 65 warnings) but unchanged historically. |
| **Database** | 🟡 **YELLOW** — internal consistency clean (0 orphans, all RLS armed). One ❌ schema bug (`cloud_files.folder_id` text vs uuid FK). One ⚠ duplicate-policy hangover on `social_connections`. |
| **Schema↔code** | 🟡 **YELLOW** — CHECK constraints match code unions on the critical paths. Two ❌ RLS findings (`subscriptions`, `vault_items` policies are `user_id`-only, not portal-scoped) — cross-portal data-leak risk if a multi-portal user is added. One ⚠ TS field over-claim (`DbSocialConnection` declares `account_avatar_url` / `last_synced_at` that the DB doesn't have). |

**The codebase compiles and runs. The database is consistent. The test bundle (Session 2) will run correctly on the current state. But there are 3 latent defects that will bite once real multi-user / real-folder data is loaded.**

## Findings, ordered by blast radius

### 🔴 Blockers (must fix before live use)

These break correctness or security but are **not blocking the Session-2 test bundle** because the test runs as a single owner user with no nested folders.

#### B1. `cloud_files.folder_id` is `text`, `cloud_folders.id` is `uuid` ❌

Migration `20260506000002_cloud_files.sql` used the wrong column type. Any join `cloud_files cf JOIN cloud_folders f ON f.id = cf.folder_id` fails with:

```
ERROR: 42883: operator does not exist: uuid = text
```

The DB will accept inserts (text accepts any UUID string) but FK constraints can't be enforced and any aggregation query on folder hierarchy will throw.

**Impact:** Cloud page is currently in pre-migration state (localStorage-backed per `PROJECT_OVERVIEW.md §22`). Once `CloudPage.tsx` is migrated to Supabase, **every parent-folder query will throw**. Blocker for cloud migration, not for the recap test.

**Fix:**
```sql
-- Run when cloud_files is empty (currently 0 rows — perfect timing)
ALTER TABLE public.cloud_files
  ALTER COLUMN folder_id TYPE uuid USING folder_id::uuid;
ALTER TABLE public.cloud_files
  ADD CONSTRAINT cloud_files_folder_id_fkey
  FOREIGN KEY (folder_id) REFERENCES public.cloud_folders(id) ON DELETE CASCADE;
```

#### B2. `subscriptions` RLS is not portal-scoped ❌

Policy: `(user_id = auth.uid())`. A user who is a member of multiple portals will see subscriptions from ALL their portals at once when querying `subscriptions` directly.

**Impact:** Subtle cross-portal leak. Currently latent because only the owner exists.

**Fix:**
```sql
DROP POLICY subs_all ON public.subscriptions;
CREATE POLICY subs_all ON public.subscriptions FOR ALL
  USING (portal_id IN (SELECT portal_id FROM public.portal_members WHERE user_id = auth.uid()));
```

#### B3. `vault_items` RLS is not portal-scoped ❌

Same shape as B2. Policy: `(user_id = auth.uid())`. Vault items leak across portals for multi-portal users.

**Fix:**
```sql
DROP POLICY vi_all ON public.vault_items;
CREATE POLICY vi_all ON public.vault_items FOR ALL
  USING (portal_id IN (SELECT portal_id FROM public.portal_members WHERE user_id = auth.uid()));
```

### 🟡 Should-fix (won't block, but pollute results)

#### S1. Duplicate RLS policies on `social_connections`

Migration `20260514000002_social_connections_portal_scoped.sql` added new portal-scoped policies but did not drop the old ones. Six policies coexist; most-permissive wins → the old un-scoped policies are still effective. Same risk profile as B2/B3 but specific to social.

**Fix:**
```sql
DROP POLICY social_connections_select ON public.social_connections;
DROP POLICY social_connections_insert ON public.social_connections;
DROP POLICY social_connections_update ON public.social_connections;
DROP POLICY social_connections_delete ON public.social_connections;
-- Keep pa_manage_social_connections + pm_select_social_connections (portal-scoped)
```

#### S2. `DbSocialConnection` TS interface over-claims fields

Commit `01503f7` added `account_avatar_url` and `last_synced_at` to the TS interface, but the DB schema doesn't have those columns. Insert payloads containing them will fail. Reads via `select("*")` will be missing the fields (silently `undefined`).

**Fix:** Either add the columns via migration, or remove from `src/types/database.ts:223-240`.

#### S3. `PROJECT_OVERVIEW.md §11.5` doc says wrong billing_cycle values

Doc claims `weekly | biweekly | monthly | quarterly | yearly`. Actual code + DB CHECK constraint: `monthly | quarterly | quadrimestral | biannual | annual`. Pure doc bug. Patch the doc.

#### S4. Lint baseline still 94 errors / 65 warnings

Mostly explicit-any, exhaustive-deps, and `require()` style imports. None block compile or runtime. Separate cleanup pass when time permits.

### 🟢 Nice-to-have / informational

- depcheck false positives on `@hookform/resolvers`, `autoprefixer`, `postcss`, etc.
- Some `dist/*` chunks > 500 KB — code-splitting opportunity.
- `cost_classification` DB CHECK allows `revenue`, `cogs`, `opex`, `other` but code uses subset `cogs | opex`. Compatible (subset of allowed values).
- `leadgen_leads.visibility` has DB CHECK (`team | internal_only | private`) but not in `src/types/database.ts`. Add for completeness.

## Items NOT to fix yet (architectural — separate concern)

- `usePortal()` (slug-based legacy) coexisting with `usePortalDB()` (live DB). Mentioned in `PROJECT_OVERVIEW.md §4` as a transition layer.
- NotesPage / CloudPage still localStorage-backed. Documented in §22 as pending; the DB-side fix B1 above is the prerequisite for the CloudPage migration.
- Lint baseline.

## Recommended next action

**Codebase clean, DB consistent, types aligned on the critical paths → PROCEED to Session 2 (CLAUDE_CODE_TEST_PROMPT.md).**

The blockers B1/B2/B3 do **not** affect the transaction-pipeline test because:
- B1 (cloud_files) — Recap doesn't query cloud_files.
- B2 (subscriptions RLS) — single user; no cross-portal leak surface.
- B3 (vault_items RLS) — same reason.

After Session 2's test bundle passes, fix B1/B2/B3 in a separate commit (3 SQL migrations) before adding any second user to any portal.

## Files in this report

- `audit-reports/tsc-output.txt`
- `audit-reports/lint-output.txt`
- `audit-reports/build-output.txt`
- `audit-reports/depcheck-output.txt`
- `audit-reports/hardcoded-uuids.txt`
- `audit-reports/raw-supabase-queries.txt`
- `audit-reports/localstorage-usage.txt`
- `audit-reports/types-drift.diff` (4500 lines — most is non-critical curated-vs-full)
- `audit-reports/stage-1-codebase.md`
- `audit-reports/stage-2-database.md`
- `audit-reports/stage-3-alignment.md`
- `audit-reports/2026-05-16-health-check.md` (this file)

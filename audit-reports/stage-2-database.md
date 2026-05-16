# Stage 2 — Database health (read-only)

## 2.1 Schema inventory

- `public` schema: **74 tables**
- `auth.users`: 1 row (`sosa@sosainc.com`)
- `storage.buckets`: 2 (`vault-files`, `inventory-files`)
- `storage.objects`: 0

## 2.2 RLS coverage

✓ **All public tables have `rowsecurity = true`.** Zero tables without RLS.

## 2.3 RLS policies

28 business tables have a single `FOR ALL` policy each. Functionally fine — a single `FOR ALL` policy covers SELECT/INSERT/UPDATE/DELETE. Catalog tables (`crypto_prices`, `gift_card_brands`) have read-only SELECT policies — intentional.

⚠ **Issue:** `social_connections` has **6 policies** (3 legacy + 3 portal-scoped). Old + new co-exist:

```
pa_manage_social_connections   (new, ALL with role check)
pm_select_social_connections   (new, SELECT)
social_connections_delete      (old, DELETE)
social_connections_insert      (old, INSERT, qual=null)
social_connections_select      (old, SELECT)
social_connections_update      (old, UPDATE)
```

Most-permissive policy wins, so the old ones are still in force. Migration `20260514000002_social_connections_portal_scoped.sql` added new ones but did not drop old ones. **Should-fix** — see Stage 4.

## 2.4–2.5 Orphan rows

✓ Every table empty after Phase 8 cleanup. Zero orphans by definition.

## 2.6 portal_members consistency

| Check | Result |
|-------|-------:|
| orphan user_id refs | 0 |
| orphan portal_id refs | 0 |
| duplicate (user, portal) pairs | 0 |
| portals without an owner | 0 |

✓ All 4 portals (sosa, keylo, redx, trust-me) have sosa@sosainc.com bound as `owner`.

## 2.7–2.14 Invariant checks

All 15 invariant queries return **0** offending rows. Tables empty after cleanup. Constraint structure intact (CHECK / UNIQUE / FK definitions verified in 3.4).

## 2.15 Storage buckets

| Bucket | Objects |
|--------|--------:|
| `vault-files` | 0 |
| `inventory-files` | 0 |

✓ Empty post-cleanup.

## 2.16 Scaffold tables

All 7 scaffold tables exist and are empty (0 rows each):

`portal_member_roles`, `telegram_settings`, `notification_queue`, `folder_access_log`, `cloud_file_versions`, `telegram_notes`, `user_activity_log` — all clean.

## 2.17 Index health

- Tables without PK: **0**
- Unused indexes (heuristic): skipped (post-cleanup `idx_scan = 0` for all because data is empty — not meaningful)

## 2.18 auth.users sanity

| Check | Result |
|-------|-------:|
| Total users | 1 |
| Users not in any portal_members | 0 |
| Email case-duplicates | 0 |

✓ Single confirmed owner row, no ghosts.

## ❌ Critical finding — broken FK type mismatch

`cloud_files.folder_id` is typed **`text`** but `cloud_folders.id` is **`uuid`**. Any join (`cloud_files cf LEFT JOIN cloud_folders f ON f.id = cf.folder_id`) fails with `ERROR 42883: operator does not exist: uuid = text`. Same for any FK constraint enforcement. The table is currently empty so no data is broken, but new inserts will:

- Succeed against the DB (text accepts any UUID string).
- Be invisible to any query that joins against `cloud_folders.id`.
- Silently lose parent-folder relationships.

Migration that created `cloud_files` (`20260506000002_cloud_files.sql`) used the wrong column type. Fix requires `ALTER TABLE cloud_files ALTER COLUMN folder_id TYPE uuid USING folder_id::uuid;`.

## Verdict

**Database health: YELLOW.**

- Internal consistency: clean.
- Schema correctness: 1 ❌ blocker (cloud_files.folder_id type), 1 ⚠ should-fix (duplicate RLS policies on social_connections).

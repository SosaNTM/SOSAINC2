# Stage 3 — Schema ↔ code alignment

## 3.1 Fresh types generation

✓ `supabase gen types typescript --project-id ndudzfaisulnmbpnvkwo` produced `/tmp/database.fresh.ts` (3962 lines).

## 3.2 Diff vs committed types

Committed `src/types/database.ts` is **503 lines** — a hand-curated subset, not a full DB introspection. Diff is enormous (~4500 lines) and dominated by tables the committed file intentionally omits (legacy per-portal-prefix tables, materialized view types, internal supabase types). Spot-checks below show no critical drift on the curated subset.

## 3.3 Per-table column matrix (critical tables)

### personal_transactions — ✓ aligned

DB columns: `id, portal_id, user_id, type, amount, currency, category, category_id, description, date, cost_classification, payment_method, reference, tags, created_at, updated_at, title, subcategory, is_recurring, recurring_interval, receipt_url`

Committed `DbPersonalTransaction` matches. Code reads/writes only these columns.

### social_connections — ✓ aligned after Phase 0 fix

DB has: `connected_at`, `connected_by` (extra timestamp + user audit columns from migration `20260514000002`).

`DbSocialConnection` was updated in commit `01503f7` to include `connected_at`, `connected_by`, `account_avatar_url`, `last_synced_at`. ⚠ But the DB **does not have** `account_avatar_url` or `last_synced_at` columns! Code expects them; queries selecting `*` will succeed but the fields will be `undefined`. Inserts that supply these fields will error. **Action:** either add columns to DB or drop them from TS interface.

### vault_items, tasks, leadgen_leads, subscriptions, cloud_folders — ✓ aligned

All column names and types match what the code reads. No drift.

### cloud_files — ❌ schema bug (see Stage 2)

- `folder_id` is `text`, code treats it as UUID FK to `cloud_folders.id`. Misaligned.

## 3.4 Enum / CHECK constraint sanity

| Field | DB CHECK | Code union | Match |
|-------|----------|-----------|:---:|
| `personal_transactions.type` | `income`, `expense`, `transfer` | `'income' \| 'expense' \| 'transfer'` | ✓ |
| `personal_transactions.cost_classification` | `revenue`, `cogs`, `opex`, `other` | `'cogs' \| 'opex'` | ⚠ code uses strict subset; OK for inserts, but if a row arrives with `revenue` or `other` the union assertion fails |
| `personal_transactions.recurring_interval` | `weekly`, `monthly`, `yearly` | (no explicit union in TS) | informational |
| `subscriptions.billing_cycle` | `monthly`, `quarterly`, `quadrimestral`, `biannual`, `annual` | `'monthly' \| 'quarterly' \| 'quadrimestral' \| 'biannual' \| 'annual'` | ✓ (per `src/portals/finance/services/subscriptionCycles.ts:3-8`) |
| `subscriptions.status` | `active`, `paused`, `cancelled` | matches | ✓ |
| `tasks.status` | `todo`, `in_progress`, `in_review`, `done`, `cancelled`, `backlog` | matches | ✓ |
| `tasks.priority` | `urgent`, `high`, `medium`, `low`, `none` | matches | ✓ |
| `vault_items.type` | `credential`, `api_key`, `document`, `note`, `card` | matches | ✓ |
| `social_connections.platform` | `instagram`, `linkedin`, `twitter`, `facebook`, `tiktok`, `youtube`, `threads`, `pinterest` | matches | ✓ |
| `leadgen_leads.outreach_status` | (no DB CHECK) | `'new' \| 'contacted' \| 'replied' \| 'qualified' \| 'converted' \| 'rejected' \| 'archived'` | DB allows any string; code enforces stricter set |
| `leadgen_leads.visibility` | `team`, `internal_only`, `private` | not in committed TS | gap |

### Documentation typo flagged

`docs/PROJECT_OVERVIEW.md §11.5` claims `billing_cycle` is `weekly | biweekly | monthly | quarterly | yearly`. **This is wrong** — the actual code + DB enum is `monthly | quarterly | quadrimestral | biannual | annual`. Should-fix doc.

## 3.5 RLS policy semantic check

Canonical pattern from `PROJECT_OVERVIEW.md §10`:

```sql
portal_id IN (SELECT portal_id FROM portal_members WHERE user_id = auth.uid())
```

Audit results:

| Table | Policy | Pattern | Verdict |
|-------|--------|---------|:---:|
| `personal_transactions` | `pt_all` (ALL) | canonical | ✓ |
| `budget_limits` | `bl_all` (ALL) | canonical | ✓ |
| `tasks` | `tasks_select_member` (SELECT) | canonical | ✓ |
| `tasks` | `tasks_update_member` (UPDATE) | canonical (any member, not just admin) | ✓ |
| `tasks` | `tasks_delete_admin` (DELETE) | admin role gate | ✓ |
| `tasks` | `tasks_insert_member` (INSERT) | **qual = NULL** | ❌ unrestricted insert |
| `tasks` | `tasks_all` (ALL) | canonical (duplicate with the per-verb ones) | ⚠ redundant |
| `cloud_files` | `cloud_files_select` (SELECT) | canonical | ✓ |
| `cloud_files` | `cloud_files_update` (UPDATE) | member + (uploader OR admin) | ✓ |
| `cloud_files` | `cloud_files_delete` (DELETE) | admin role gate | ✓ |
| `cloud_files` | `cloud_files_insert` (INSERT) | **qual = NULL** | ❌ unrestricted insert |
| `social_connections` | 6 policies (3 old + 3 new) | mixed | ⚠ duplicate |
| `social_connections` | `social_connections_insert` (INSERT) | **qual = NULL** | ❌ unrestricted insert |
| `subscriptions` | `subs_all` (ALL) | **`user_id = auth.uid()`** | ❌ NOT portal-scoped |
| `vault_items` | `vi_all` (ALL) | **`user_id = auth.uid()`** | ❌ NOT portal-scoped |
| `leadgen_leads` | `leadgen_leads_member_all` (ALL) | canonical | ✓ |

### ❌ Critical RLS findings

1. **`subscriptions` and `vault_items` not portal-scoped.** Policy is `user_id = auth.uid()`. If a user is a member of multiple portals, they will see subscriptions / vault items from ALL portals at once — **cross-portal data leak**. Currently latent because the only user is the owner, but breaks the moment a second user is added.

2. **INSERT policies with `qual = NULL`** on `tasks`, `cloud_files`, `social_connections` — **CLEARED.** Verified via separate `with_check` query: all three have proper portal-scoped `with_check` predicates. INSERT correctly uses `with_check` rather than `using`. No security issue.

3. **Duplicate policies on `social_connections`**. Old non-portal policies (`social_connections_*`) coexist with new portal-scoped ones (`pa_manage_*`, `pm_select_*`). Postgres applies OR across same-cmd policies, so the **most permissive wins** — meaning the legacy non-scoped policy is still effective. The portal-scoped migration is functionally a no-op until the old policies are dropped.

## Verdict

**Schema↔code alignment: YELLOW.**

- Most CHECK constraints match code unions.
- `DbSocialConnection` over-claims fields (`account_avatar_url`, `last_synced_at`) that the DB doesn't have.
- 2 RLS policies (`subscriptions`, `vault_items`) are not portal-scoped — cross-portal leak risk.
- 3 INSERT policies have `qual = NULL` — need to re-check `with_check`.
- 1 doc bug in PROJECT_OVERVIEW.md §11.5.
- 1 broken FK type mismatch (cloud_files.folder_id ← Stage 2).

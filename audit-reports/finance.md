# Audit Report — Finance Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Notes |
|---|---|---|
| `/:portalId/costs` | `Budget` | Budget limits + spending per category |
| `/:portalId/transactions` | `Transactions` | Full transaction list with filters |
| `/:portalId/channels` | `Subscriptions` | Recurring subscription tracker |
| `/:portalId/pl-rules` | `Goals` | Financial goals / savings targets |
| `/:portalId/invoices` | `Invoices` | **Dead stub — returns null** |
| `/:portalId/dashboard` | `Dashboard` | Headline KPIs + charts (uses finance data) |
| `/:portalId/dashboard/crypto` | `CryptoPage` | Crypto portfolio tracker |
| `/:portalId/dashboard/gift-cards` | `GiftCardsPage` | Gift card tracker |

### Sub-page tree

```
Finance
├── Transactions        ← Supabase personal_transactions (portal-scoped)
├── Budget              ← localStorage only (limits) + transactions for "spent"
├── Subscriptions       ← localStorage only (all subscription data)
├── Goals               ← Supabase financial_goals table
├── Invoices            ← null stub (removed from navigation)
├── Crypto              ← external API (CoinGecko) + Supabase holdings
└── Gift Cards          ← Supabase gift_cards table
```

### Data model

| Entity | Persistence | Table / Key |
|---|---|---|
| Transactions | Supabase + localStorage fallback | `personal_transactions` |
| Budget limits | **localStorage only** | `budget_limits_<portalId>` |
| Budget total | **localStorage only** | `budget_total_<portalId>` |
| Subscriptions | **localStorage only** | `subscriptions_<portalId>` |
| Financial goals | Supabase | `financial_goals` |
| Finance summary cache | **localStorage SWR cache** | `swr_summary_<portal>_<from>_<to>` |
| Crypto holdings | Supabase | `crypto_holdings` |
| Gift cards | Supabase | `gift_cards` |

### Money handling matrix

| Table/Store | Amount column type | Currency-coupled | Server-validated | Indexed |
|---|---|---|---|---|
| `personal_transactions` | `number` (JS float) | ✓ (`currency` field) | Partial (RLS, no constraint) | By `portal_id, date` |
| Budget limits (localStorage) | `number` (JS float) | ✗ (implicit EUR) | ✗ | N/A |
| Subscriptions (localStorage) | `number` (JS float) | ✗ (implicit EUR) | ✗ | N/A |
| `financial_goals` | `number` (JS) | ✗ (implicit EUR) | Partial | By `portal_id` |

### No external integrations

No Plaid, Stripe, bank aggregators, FX providers, or accounting software integrations exist. Finance is fully manual-entry.

---

## Findings

### 🟠 P1 — Amount arithmetic uses JS floating-point throughout

**Files:** `src/hooks/useFinanceSummary.ts:122–146`, `src/hooks/useTransactions.ts:32`

All money math in the Finance section uses plain JavaScript `number` (IEEE 754 double-precision float) with the `+` operator:

```ts
totalIncome   += amt;
totalExpenses += amt;
```

For small amounts (< €10,000) the drift is typically imperceptible in display (2 decimal places), but the accumulated error is real. `0.1 + 0.2 !== 0.3` in JavaScript. Dashboard totals may be off by fractions of a cent vs. a canonical re-sum.

`amount` is typed as `number` in `PersonalTransaction` and converted via `Number(row.amount)` from DB. The Supabase column type isn't verified here — if the column is `NUMERIC`, Supabase JS returns it as a string that gets coerced to float, causing compounding drift on large datasets.

**Fix required:** Use integer minor units (store as `bigint` cents, divide by 100 for display) or a library like `decimal.js`. At minimum: replace all `+=` on amounts with a reducer that uses `Math.round((a + b) * 100) / 100`.

---

### 🟠 P1 — Budget limits and total budget are localStorage-only

**File:** `src/portals/finance/services/budgetStorage.ts:57–128`

The budget limit per category and the total monthly budget target are stored exclusively in browser localStorage:

```ts
export function saveTotalBudget(portalId: string, amount: number): void {
  localStorage.setItem(totalKey(portalId), String(amount));
}
```

Consequences:
- Configuration lost on browser data clear, incognito sessions, or a different device.
- Two portal members set different budget limits independently — no shared budget exists.
- Budget limits are NOT in Supabase, so no RLS, no audit trail, no backup.

**Fix required:** Create a `portal_budget_settings` table (or add columns to an existing portal config table) in Supabase. Migrate `budgetStorage` to Supabase reads/writes.

---

### 🟠 P1 — Subscriptions stored entirely in localStorage

**File:** `src/pages/Subscriptions.tsx:32–50`

All subscription records (name, amount, cycle, renewal date, paused state) are stored in localStorage with key `subscriptions_<portalId>`:

```ts
const STORAGE_KEY_PREFIX = STORAGE_SUBSCRIPTIONS_PREFIX;
function subsStorageKey(portalId: string): string {
  return `${STORAGE_KEY_PREFIX}_${portalId}`;
}
```

No Supabase write anywhere in the subscription flow. Subscriptions are the most time-sensitive financial data (renewal alerts) — losing them on a browser clear is a significant reliability failure.

**Fix required:** Create a `subscriptions` table in Supabase; migrate all subscription CRUD to Supabase.

---

### 🟠 P1 — Any portal member can edit or delete another member's transaction

**File:** `src/hooks/useTransactions.ts:178–215`

`updateTransaction` and `deleteTransaction` filter only by `id` and `portal_id`:

```ts
await supabase
  .from("personal_transactions")
  .update(changes)
  .eq("id", id)
  .eq("portal_id", currentPortalId);  // no .eq("user_id", user.id)
```

Any authenticated member of the portal can call `updateTransaction("any-id", ...)` and modify a transaction belonging to another user. The only safeguard is RLS — which needs to be verified to enforce `user_id = auth.uid()` on UPDATE and DELETE.

**Fix required:** Add `.eq("user_id", user.id)` to the `updateTransaction` and `deleteTransaction` Supabase queries. Verify RLS on `personal_transactions` enforces `user_id = auth.uid()` for mutations.

---

### 🟠 P1 — Invoices route is a null stub

**File:** `src/pages/Invoices.tsx:1–2`

```ts
// Route kept for compatibility; not shown in navigation.
export default function Invoices() { return null; }
```

The route `/:portalId/invoices` renders nothing. If any code navigates to it (e.g. a deep link, a bookmark), the user sees a blank page with no error or explanation.

**Fix required:** Either implement the invoices sub-page or redirect the route to the dashboard with a toast message ("Invoices coming soon").

---

### 🟠 P1 — Transaction fetch has a hard limit of 2000 rows (no real pagination)

**File:** `src/hooks/useTransactions.ts:92`

```ts
let q = supabase
  .from("personal_transactions")
  .select("*")
  .eq("portal_id", currentPortalId)
  .limit(2000);
```

All 2000 transactions are loaded into memory at once and sliced client-side. The UI "pagination" is purely in-memory (`page * PAGE_SIZE`). For portals with thousands of transactions, this causes slow loads and high memory usage. Past 2000 transactions, data silently disappears from the view.

**Fix required:** Use server-side range pagination (`.range(from, to)`) and count-based total, consistent with the `useLeadgenAllLeads` pattern already in the codebase.

---

### 🟠 P1 — Hard deletes on transactions (no audit trail)

**File:** `src/hooks/useTransactions.ts:218–242`

```ts
await supabase.from("personal_transactions").delete().eq("id", id)...
```

Transactions are hard-deleted. Once deleted, the financial history is gone — no soft-delete, no recovery, no audit trail in the DB (only in the unreliable localStorage adminStore).

For financial data, deletion is a regulatory and operational concern. A deleted transaction affects period totals, budget calculations, and tax reporting retroactively.

**Fix required:** Add a `deleted_at timestamptz` column and soft-delete with RLS filter `deleted_at IS NULL`. Provide a "Cestino" view similar to the Cloud module.

---

### 🟡 P2 — Finance summary cached in localStorage (stale data risk)

**File:** `src/hooks/useFinanceSummary.ts:87–93`

The finance summary (totals, monthly breakdown) is cached in localStorage under keys like `swr_summary_sosa_2026-05-01_2026-05-31`. The cache is read on component mount and displayed before the Supabase fetch completes. If another user adds a transaction between cache writes, the summary will show stale totals until the next refresh.

The cache is never explicitly invalidated on logout. A user who logs into a different account on the same browser will briefly see the previous user's finance summary.

**Fix required:** Invalidate SWR cache keys on logout. Or store the cache keyed by `user_id` in addition to `portalId`.

---

### 🟡 P2 — Budget "spent" computed from all-member transactions, not just own

**File:** `src/portals/finance/hooks/useBudgetData.ts` (inferred from Budget.tsx usage)

Budget spending is computed from `personal_transactions` filtered by `portal_id` only — all members' transactions are summed into the budget. This is likely intentional for a shared team budget, but it means one user's personal spending shows in another user's budget view without clear attribution.

**Fix required:** Confirm the intended behavior. If budgets are personal, add `user_id` filter. If shared, label the UI accordingly ("Team budget — all members").

---

### 🟡 P2 — `isSupabaseConfigured()` check is fragile

**Files:** `src/hooks/useTransactions.ts:22–25`, `src/hooks/useFinanceSummary.ts:68–71`

```ts
function isSupabaseConfigured(): boolean {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
  return !!url && !url.includes("placeholder");
}
```

Any URL that doesn't contain the string `"placeholder"` is considered configured — including typos, invalid URLs, or partial configurations. If Supabase URL is wrong but doesn't contain "placeholder", the Supabase path runs, fails silently, and the app falls back to localStorage without telling the user their data isn't being persisted.

**Fix required:** Replace with a proper connectivity check or validate URL format. At minimum, log a console error when Supabase returns an auth error so the developer can diagnose the misconfiguration.

---

### 🟡 P2 — Goals: target amount has no currency association

**File:** `src/hooks/useFinancialGoals.ts:22–33`

`DashboardGoal.target` is a plain `number` with no `currency` field. The UI presumably renders it as EUR. If the app ever supports multi-currency, goals will be ambiguous.

**Fix required:** Add `currency: string` to the `financial_goals` table and `DashboardGoal` interface.

---

### 🟡 P2 — Budget limits are plain-keyed by lowercase name (fragile)

**File:** `src/portals/finance/services/budgetStorage.ts:124`

```ts
const updated = { ...limits, [categoryName.toLowerCase()]: limit };
```

Budget limits are keyed by the lowercase category name string. If a category is renamed or the user creates a category with the same name as a default, limits can silently re-map. This is fragile compared to keying by `category_id`.

**Fix required:** Key budget limits by `category_id` (a stable UUID) once categories are stored in Supabase.

---

### 🔵 P3 — `localAdd` uses `Date.now()` for ID generation

**File:** `src/lib/personalTransactionStore.ts:56`

```ts
id: `local_${Date.now()}`,
```

If two transactions are added in the same millisecond, they get the same ID. On the same device this is unlikely; across devices it's impossible since local IDs are device-scoped. But worth switching to `crypto.randomUUID()` for correctness.

---

### 🔵 P3 — Finance audit log is localStorage-based (tamper-trivial)

**File:** `src/hooks/useTransactions.ts:161,168,206,212`

```ts
addAuditEntry({ userId: user.id, action: `Added ${data.type}... €${data.amount}`, ... });
```

`addAuditEntry` writes to the localStorage adminStore — easily cleared by the user. Not a valid compliance audit trail.

**Fix required:** Write financial audit events to a Supabase table with INSERT-only RLS (no UPDATE/DELETE).

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🟠 P1 | JS float for all money arithmetic — drift risk | `useFinanceSummary.ts`, `useTransactions.ts` |
| 2 | 🟠 P1 | Budget limits / total in localStorage only | `budgetStorage.ts` |
| 3 | 🟠 P1 | Subscriptions entirely in localStorage | `Subscriptions.tsx` |
| 4 | 🟠 P1 | Any member can edit/delete any member's transaction | `useTransactions.ts` |
| 5 | 🟠 P1 | Invoices page is a null stub | `Invoices.tsx` |
| 6 | 🟠 P1 | Transaction fetch hard-limited to 2000 rows (client pagination) | `useTransactions.ts` |
| 7 | 🟠 P1 | Hard delete removes financial history permanently | `useTransactions.ts` |
| 8 | 🟡 P2 | Finance summary SWR cache not invalidated on logout | `useFinanceSummary.ts` |
| 9 | 🟡 P2 | Budget "spent" aggregates all members, not clarified in UI | `useBudgetData.ts` |
| 10 | 🟡 P2 | `isSupabaseConfigured()` check is fragile | `useTransactions.ts`, `useFinanceSummary.ts` |
| 11 | 🟡 P2 | Goals lack currency field | `useFinancialGoals.ts` |
| 12 | 🟡 P2 | Budget limits keyed by name string, not stable category_id | `budgetStorage.ts` |
| 13 | 🔵 P3 | `Date.now()` for local ID — not UUID | `personalTransactionStore.ts` |
| 14 | 🔵 P3 | Finance audit log in localStorage | `useTransactions.ts` |

---

## Handoff

No `FLOAT` for primary amounts was confirmed (no explicit DB column inspection here — recommend running `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'personal_transactions'` to confirm the DB type). If `amount` is stored as `DOUBLE PRECISION` in Postgres, upgrade to `NUMERIC(15,2)`.

Next audit: **Social** (`audit-reports/social.md`).

# Step 3 — Flusso Dati Finance

---

## 3.1 Architettura generale

```
Supabase DB (personal_transactions)
       │
       ▼
useTransactions (hook) ←── useFinanceSummary (hook)
       │                           │
       ▼                           ▼
 Recap.tsx (read)           Budget.tsx / Dashboard
       │
       ▼
AddTransactionModal ──→ Supabase INSERT ──→ broadcastFinanceUpdate ──→ re-fetch

──────────────────────────────────────────────────────────────────────────────

transactionStore.ts (in-memory)
       │
       ▼
NewTransactionModal ──→ addTransaction() ──→ in-memory array (⚠ NON persistito)
```

---

## 3.2 Due sistemi di transaction paralleli — PROBLEMA CRITICO

Il progetto ha **due sistemi transaction completamente separati** che non comunicano tra loro:

### Sistema A: Supabase-backed (`personal_transactions`)
- **Usato da:** `useTransactions` hook, `AddTransactionModal`, Recap, Budget, Dashboard
- **Persistenza:** Supabase → persiste al reload
- **Multi-portal:** sì, filtro per `portal_id`
- **Realtime:** sì, via `broadcastFinanceUpdate`

### Sistema B: In-memory (`transactionStore.ts`)
- **Usato da:** `NewTransactionModal`, Transactions page (legacy)
- **Persistenza:** ❌ NESSUNA — dati persi al reload della pagina
- **Multi-portal:** simulata in-memory con `_dataByPortal` Record
- **Realtime:** no, solo listener locali

**Conseguenza:** Un utente che aggiunge una transazione tramite `NewTransactionModal` (Transactions page) la vede nella lista transactions, ma quella transazione:
1. Non appare in Recap (che legge da Supabase)
2. Non appare in Budget / Dashboard
3. Scompare al refresh della pagina

Questa è la discrepanza più critica dell'intera codebase.

---

## 3.3 `lib/portalDb.ts` — File fantasma

**PROJECT_KNOWLEDGE.md** documenta:
> `useTransactions` uses `dynamicSupabase` from `@/lib/portalDb`

**Realtà:** Il file `src/lib/portalDb.ts` **non esiste**. Non è stato mai creato o è stato cancellato.

Tutte le operazioni Supabase usano il client globale:
```ts
// src/lib/supabase.ts
export const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);
```

Un singolo client condiviso da tutti i componenti. L'isolamento portale è gestito dal filtro `.eq("portal_id", currentPortalId)` nelle query, non da client separati.

---

## 3.4 `financeCategoryStore.ts` — Non è uno store

Il nome suggerisce un pattern store (con state management), ma il file è in realtà:
1. Tipi statici (`FinanceCategory`)
2. Costanti hardcoded (15 expense + 7 income categorie di default)
3. Una funzione `getAllCategories(portalId)` che **ignora** il `portalId` e ritorna sempre i defaults

Le categorie reali (user-customized) vivono in Supabase nella tabella `finance_transaction_categories` e si accedono tramite hook (`useCategories`).

Il nome "store" è fuorviante e potrebbe indurre in errore chi aggiunge nuove funzionalità.

---

## 3.5 Flusso categorie — Doppio sistema

```
financeCategoryStore.ts (hardcoded defaults)
    └── getAllCategories() → usato in Recap per colori/icone (catColorMap)
    └── DEFAULT_CATEGORIES → fallback quando DB è vuoto

finance_transaction_categories (Supabase)
    └── useCategories hook → categorie editabili dall'utente
    └── useExpenseCategories → con monthly_budget per Budget page
    └── useIncomeCategories → categorie entrate
```

**Problema:** Recap usa `getAllCategories()` (hardcoded) per costruire `catColorMap`. Se un utente crea una categoria custom, il suo colore non apparirà correttamente in Recap perché il catColorMap non include le categorie DB.

---

## 3.6 `useFinanceSummary` — Client e hook usati

- Client: `supabase` globale da `@/lib/supabase`
- Portal: da `usePortal()` (legacy — dovrebbe usare `usePortalDB()`)
- Query: `personal_transactions` filtrate per `portal_id` e range date
- Aggregazioni: **client-side** (in JavaScript, non SQL)
- `categoryBreakdown`: solo spese, non include entrate

```ts
// useFinanceSummary costruisce il breakdown client-side:
const catMap: Record<string, number> = {};
transactions.forEach(tx => {
  if (tx.type === "expense") catMap[tx.category] = (catMap[tx.category] ?? 0) + tx.amount;
});
```

Le entrate per categoria sono calcolate separatamente in `Recap.tsx` come `incomeBreakdown` (anche questo client-side su `allTransactions`).

---

## 3.7 Limite transazioni: 2000 record

`useTransactions` usa `limit(2000)` sulla query Supabase. Se un portale supera 2000 transazioni nel range selezionato, le aggregazioni saranno **silenziosamente incorrette** (troncamento senza errore).

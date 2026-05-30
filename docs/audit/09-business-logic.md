# Step 9 — Business Logic vs UI

---

## 9.1 Il problema fondamentale: due sistemi transaction in conflitto

Il progetto ha due implementazioni parallele e incompatibili per la gestione delle transazioni:

### Sistema Supabase (corretto, persistente)
- **Tabella:** `personal_transactions`
- **Hook:** `useTransactions`, `useFinanceSummary`
- **Modal:** `AddTransactionModal` (`src/components/finance/AddTransactionModal.tsx`)
- **Pagine:** Recap, Budget, Dashboard
- **Flusso:** UI → Supabase INSERT → `broadcastFinanceUpdate` → re-fetch → UI aggiornata

### Sistema In-Memory (legacy, non persistente)
- **Store:** `transactionStore.ts` (array JS puro)
- **Hook:** `getTransactions()`, `addTransaction()`, etc.
- **Modal:** `NewTransactionModal` (`src/components/NewTransactionModal.tsx`)
- **Pagine:** Transactions page (`src/pages/Transactions.tsx`)
- **Flusso:** UI → in-memory array → listener locali → UI aggiornata

**Conseguenza pratica:**
1. Utente apre "Transactions page" e aggiunge una transazione con `NewTransactionModal`
2. La transazione appare nella lista della Transactions page (store in-memory)
3. L'utente va su Recap → la transazione **non esiste** (Recap legge Supabase)
4. L'utente ricarica la pagina → la transazione **scompare** da Transactions page

---

## 9.2 `Transactions.tsx` — Misto Supabase e in-memory?

La pagina Transactions dovrebbe essere verificata per capire se legge da Supabase o dall'in-memory store. Dall'analisi dello store, `transactionStore.ts` esporta `getTransactions()` e usa un listener pattern (non hook React standard).

Se `Transactions.tsx` usa `useTransactions` (hook Supabase), il `NewTransactionModal` è un elemento UI che scrive nel posto sbagliato. Se usa il store in-memory, l'intera pagina è separata dall'ecosistema Supabase.

**Azione richiesta:** Verificare `src/pages/Transactions.tsx` per determinare quale fonte dati usa.

---

## 9.3 Business portal vs personal portal

Il sistema supporta due modalità:

### Personal portal (SOSA hub personale)
- Transazioni: `personal_transactions` + `AddTransactionModal`
- Categorie: `finance_transaction_categories` (income/expense)
- Analisi: Recap, Budget, Dashboard

### Business portal (KEYLO, REDX, TRUST ME)
- Transazioni: aggiungono campi extra (`cost_classification`, `category_id`)
- Categorie: `income_categories` + `expense_categories` (con budget)
- Classificazione: revenue/cogs/opex/other

**`NewTransactionModal`** gestisce **entrambi** i casi:
```tsx
// Logica business portal in NewTransactionModal
if (isBusinessPortal) {
  txData.cost_classification = costClassification;
  if (categoryId) txData.category_id = categoryId;
}
```

Ma scrive nel **sistema in-memory** (`addTransaction` da `transactionStore`), non in Supabase. Questo significa che le transazioni business classificate (COGS, OPEX, Revenue) non vengono mai persistite.

---

## 9.4 Duplicate category systems

| Sistema | Tabella Supabase | Tipo | Usato in |
|---|---|---|---|
| Finance personale | `finance_transaction_categories` | income \| expense | AddTransactionModal, Recap, Budget |
| Finance business (entrate) | `income_categories` | income | NewTransactionModal (business) |
| Finance business (uscite) | `expense_categories` | expense + budget | NewTransactionModal, Budget top list |
| Hardcoded defaults | `financeCategoryStore.ts` | income \| expense | Recap catColorMap |
| Business COGS/OPEX | `finance_categories` | CostClassification | Business analytics |

Cinque sistemi di categorie per due tipi di portale. Nessuno è il "source of truth" unico.

---

## 9.5 `useFinanceCategories` hook

**File:** Usato in `NewTransactionModal.tsx:41`

```ts
const { getCategoriesByType } = useFinanceCategories();
const filteredFinanceCategories = getCategoriesByType(costClassification);
```

Questo hook legge da `finance_categories` (business, con CostClassification). Dipende da `portal_id` ma `NewTransactionModal` scrive in `transactionStore` (in-memory). I dati mostrati nel form non corrispondono al sistema in cui vengono salvati.

---

## 9.6 `financialCalculations.ts` — Solo per business portals

**File:** `src/lib/financialCalculations.ts` (non letto, da verificare)

Importato in `NewTransactionModal.tsx` per `directCostCategories` e `indirectCostCategories`. Queste sono le categorie COGS (Direct) e OPEX (Indirect) hardcodate per i business portal.

La logica di classificazione business (Gross Margin, EBITDA) vive presumibilmente in questo file o nei portals finance specifici.

---

## 9.7 Separazione portale SOSA vs portali business

Il sistema routing usa `portal?.id !== "sosa"` per determinare se si è in un business portal:

```tsx
// NewTransactionModal.tsx:38
const isBusinessPortal = portal?.id !== "sosa";
```

**Problema:** Questo accoppia la logica al nome specifico del portale "sosa". Se in futuro viene creato un altro portale personale (es. "personal2"), non sarà riconosciuto come tale.

**Fix:** Aggiungere un campo `type: "personal" | "business"` alla tabella `portals` e usare quello.

---

## 9.8 Goals — collegamento con transazioni

I goal (`goals` table) hanno `target_amount` e `current_amount`. La `current_amount` viene aggiornata manualmente o tramite transazioni collegate? Da verificare se esiste un trigger DB o logica applicativa che aggiorna automaticamente il progresso degli obiettivi basandosi sulle transazioni.

Se il progresso è manuale, l'utente deve aggiornarlo separatamente dalle transazioni — opportunity for automation.

---

## 9.9 Subscriptions — ricorrenti non collegate a transazioni

La tabella `subscriptions` traccia abbonamenti ricorrenti (importo, ciclo, prossimo rinnovo). Non esiste (dal codice analizzato) un meccanismo che crea automaticamente una transazione expense quando un abbonamento si rinnova.

L'utente deve aggiungere manualmente la transazione. Questo causa discrepanze tra il costo teorico degli abbonamenti e le uscite effettive registrate nel Recap.

---

## 9.10 Crypto — prezzi in tempo reale?

La `CryptoWidget` nel dashboard mostra holdings. I prezzi di mercato potrebbero essere statici (inseriti manualmente) o dinamici (API esterna). Da verificare se `CryptoPage.tsx` usa un'API di prezzi o solo dati manuali.

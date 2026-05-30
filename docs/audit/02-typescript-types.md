# Step 2 — Analisi Tipi TypeScript vs Schema DB

---

## 2.1 `PersonalTransaction` — Campo `portal_id` mancante

**File:** `src/types/finance.ts:19-38`

```ts
export interface PersonalTransaction {
  id: string;
  user_id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  // ... altri campi
  // ❌ MANCA: portal_id: string;
}
```

**Problema:** Il tipo TypeScript non include `portal_id`. La tabella `personal_transactions` su Supabase ha `portal_id` come colonna NOT NULL (con RLS che filtra per portal_id). Inserire un record via TypeScript non garantisce TypeScript hint per passare `portal_id`.

**Rischio:** Se un hook crea una transazione senza `portal_id`, Supabase restituisce errore 23502 (NOT NULL violation) a runtime. Non è rilevabile at compile-time.

**Fix:** Aggiungere `portal_id: string;` a `PersonalTransaction` e `NewPersonalTransaction`.

---

## 2.2 Doppio `FinanceCategory` — Schemi incompatibili

Due interfacce `FinanceCategory` coesistono in file diversi con schemi diversi:

### Versione A — `src/types/finance.ts:40-55`
```ts
export interface FinanceCategory {
  id: string;
  portal_id: string;        // ✅ ha portal_id
  name: string;
  slug: string;
  type: CostClassification; // "revenue" | "cogs" | "opex" | "other"
  color: string;
  icon: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
```

### Versione B — `src/lib/financeCategoryStore.ts:7-17`
```ts
export interface FinanceCategory {
  id: string;
  // ❌ MANCA portal_id
  name: string;
  slug: string;
  icon: string;
  color: string;
  type: 'income' | 'expense'; // ❌ tipo diverso da Versione A
  sort_order: number;
  is_default: boolean;
  is_active: boolean;
}
```

**Problema:** `type` ha valori incompatibili:
- Versione A usa `CostClassification` ("revenue" | "cogs" | "opex" | "other")
- Versione B usa "income" | "expense"

Queste mappano a **due tabelle diverse**:
- `finance_transaction_categories` → Versione B (categorie personali income/expense)
- `finance_categories` → Versione A (categorie business con classification)

I componenti che importano da `financeCategoryStore` e quelli che importano da `types/finance` usano tipi omonimi ma incompatibili.

---

## 2.3 `NewPersonalTransaction` — Omit incompleto

**File:** `src/types/finance.ts:57`

```ts
export type NewPersonalTransaction = Omit<PersonalTransaction, "id" | "created_at" | "updated_at">;
```

Dato che `PersonalTransaction` non ha `portal_id`, `NewPersonalTransaction` non ha `portal_id`. Questo significa che tutte le operazioni di creazione non sono type-safe per `portal_id`.

---

## 2.4 `Transaction` (business) — Tipo in-memory senza `portal_id`

**File:** `src/lib/transactionStore.ts:3-11`

```ts
export interface Transaction {
  id: string;
  date: string;
  type: "income" | "expense";
  description: string;
  category: string;
  costType: CostType | null;
  amount: number;
  // ❌ NESSUN portal_id — isolamento solo in-memory
}
```

Questo tipo appartiene allo store in-memory (non Supabase). Il dato non è mai persistito al database. Vedi Step 9.

---

## 2.5 `CostClassification` — Mapping incompleto in `NewTransactionModal`

**File:** `src/components/NewTransactionModal.tsx:200-232`

Il form per i business portal usa `costClassification` con le opzioni:
`revenue | cogs | opex | other`

Ma il select renderizza le label in italiano:
```tsx
<option value="revenue">Ricavo</option>
<option value="cogs">Costo del Venduto</option>
<option value="opex">Spesa Operativa</option>
<option value="other">Altro</option>
```

Questo è allineato con `COST_CLASSIFICATION_CONFIG` in `types/finance.ts`. ✅

---

## 2.6 Riepilogo discrepanze

| Tipo | File | Problema |
|---|---|---|
| `PersonalTransaction` | `types/finance.ts` | Manca `portal_id` |
| `NewPersonalTransaction` | `types/finance.ts` | Eredita bug da PersonalTransaction |
| `FinanceCategory` (B) | `financeCategoryStore.ts` | `type` incompatibile, manca `portal_id` |
| `Transaction` | `transactionStore.ts` | Solo in-memory, nessun campo DB |

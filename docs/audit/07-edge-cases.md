# Step 7 — Edge Cases e Corner Cases

---

## 7.1 `isMobile` non reattivo

**File:** `src/pages/Recap.tsx:708`

```ts
const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
```

**Problema:** Calcolato **una volta al primo render**. Se l'utente ridimensiona la finestra (o ruota il tablet), `isMobile` resta al valore iniziale senza aggiornarsi.

**Impatto:** Il layout della heatmap e la visualizzazione dei grafici mobile potrebbero non rispondere al resize.

**Fix:**
```ts
const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
useEffect(() => {
  const handler = () => setIsMobile(window.innerWidth < 768);
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
}, []);
```

---

## 7.2 `compareOn=false` mostra delta=0 invece di "—"

**File:** `src/pages/Recap.tsx:437`

```ts
const { summary: prevSummary } = useFinanceSummary(compareOn ? prevRange : range);
```

Quando `compareOn=false`, `prevRange = range` (stesso periodo). `prevSummary ≡ summary`.
- `kpiDelta.income = round((curr - prev) / prev * 100) = 0`
- La KPI card mostra "→ 0%" invece di "—"

**Fix:** Passare `null` quando compare è disattivato:
```ts
const { summary: prevSummary } = useFinanceSummary(compareOn ? prevRange : null);
// E in kpiDelta: if (!compareOn) return tutte undefined
```

---

## 7.3 Range "oggi" — edge case timezone

**File:** `src/pages/Recap.tsx:56-59`

```ts
function todayRange(): DateRange {
  const d = new Date().toISOString().slice(0, 10);
  return { from: d, to: d };
}
```

`new Date().toISOString()` usa UTC. Se l'utente è in un fuso orario ahead of UTC (es. UTC+2, come l'Italia), alle 23:30 locali `toISOString()` ritorna già la data del giorno successivo in UTC.

**Impatto:** Il range "Oggi" filtra per la data UTC, non la data locale. Tra 22:00 e 23:59 ora italiana, le transazioni del giorno corrente potrebbero non essere incluse nel range "Oggi".

**Fix:**
```ts
function todayRange(): DateRange {
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { from: local, to: local };
}
```

Lo stesso problema esiste in altri range helpers in `useFinanceSummary.ts`.

---

## 7.4 Heatmap — date padding oltre il range

**File:** `src/components/finance/CalendarHeatmap.tsx:38-44`

La heatmap espande il range al lunedì precedente e alla domenica successiva per mostrare settimane complete. I giorni fuori range sono mostrati in grigio (`var(--glass-border)`) ma sono comunque presenti nel DOM.

**Problema:** Se il range è "Anno corrente" (365 giorni), il padding aggiunge al massimo 6 giorni in più — nessun problema.
Se il range è "Personalizzato" con `from = "2020-01-01"` e `to = "2026-12-31"` (2557 giorni), la heatmap prova a generare ~365 colonne settimanali. Nessun limite è imposto, potenzialmente causando un DOM con migliaia di elementi.

**Raccomandazione:** Limitare il range massimo visualizzabile dalla heatmap (es. max 1 anno).

---

## 7.5 Cashflow — gradient stattico

**File:** `src/pages/Recap.tsx:960-967`

Il gradient del cashflow chart è definito come:
```tsx
<stop offset="45%" stopColor="var(--color-success)" stopOpacity={0.1} />
<stop offset="55%" stopColor="var(--color-error)" stopOpacity={0.1} />
```

Il punto di transizione verde→rosso è fisso al 45-55% dell'altezza SVG, non alla posizione reale dello zero sull'asse Y. Se il cashflow è sempre positivo, la parte rossa è visibile nella metà inferiore anche se non ci sono valori negativi.

---

## 7.6 Paginazione tabella — reset mancante su cambio filtri

**File:** `src/pages/Recap.tsx`

Alcune azioni chiamano `setTablePage(0)` al cambio filtro (periodo, tipo, ricerca, filtro categoria). Ma il cambio di `sortField` e `sortDir` non resetta `tablePage`. Se l'utente è a pagina 3 e cambia ordinamento, resta a pagina 3 anche se il totale risultati è cambiato (es. page 3 di 2 = pagina vuota).

---

## 7.7 Transazione "transfer" — terzo tipo ignorato in aggregazioni

**File:** `src/types/finance.ts:22`

`PersonalTransaction.type` può essere `"income" | "expense" | "transfer"`.

In `useFinanceSummary`:
```ts
if (tx.type === "expense") totalExpenses += tx.amount;
else if (tx.type === "income") totalIncome += tx.amount;
// "transfer" viene ignorato silenziosamente
```

Un trasferimento (es. da conto corrente a savings) non appare né in entrate né in uscite. Questo è **semanticamente corretto** (non è né reddito né spesa), ma:
- Il `transactionCount` nelle KPI potrebbe includere o meno i transfer — da verificare
- Il tipo "transfer" non ha categorie dedicate in `financeCategoryStore.ts`
- Il badge colore in Recap mostra "⇄" per transfer ma il tipo non è selezionabile nel filtro (solo "tutto/entrate/uscite")

---

## 7.8 Budget map — usa nome categoria, non ID

**File:** `src/pages/Recap.tsx:472-476`

```ts
const budgetMap = useMemo(() => {
  const m: Record<string, number> = {};
  expenseCats.forEach(c => { if (c.monthly_budget) m[c.name] = c.monthly_budget; });
  return m;
}, [expenseCats]);
```

La chiave è `c.name` (stringa). Le transazioni hanno `tx.category` come stringa. Se una categoria viene rinominata in Supabase, il budget non matcherà più con le transazioni esistenti che riportano il vecchio nome.

**Fix robusto:** Usare `c.id` come chiave e `tx.category_id` come riferimento (ma `tx.category` è già una stringa, non un FK).

---

## 7.9 `deleteTransaction` nello scope errato

**File:** `src/pages/Recap.tsx:463`

```ts
const { transactions: rawTableTxs, isLoading: tableLoading, deleteTransaction, updateTransaction } = useTransactions(tableFilters as TransactionFilters);
```

`deleteTransaction` proviene dal hook con i **filtri della tabella** applicati. Se viene chiamato su una transazione che non corrisponde ai filtri correnti, Supabase riceverà comunque il DELETE corretto (filtra per `id`), ma la lista UI potrebbe non aggiornare correttamente se la transazione non era nella query corrente.

---

## 7.10 Vault password — SHA-256 client-side

**Commit recente (308c06c):** `fix(cloud): hash folder passwords with SHA-256 before storing`

L'hashing SHA-256 avviene client-side prima dello store. SHA-256 non è un algoritmo adatto per l'hashing di password (troppo veloce, no salt, rainbow table attacks). Andrebbe usato `bcrypt` o `argon2` server-side.

Questo è un problema di sicurezza nella funzionalità Cloud/Vault folder lock.

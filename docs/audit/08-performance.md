# Step 8 — Performance & Limiti

---

## 8.1 Limite di 2000 transazioni

**File:** `src/hooks/useTransactions.ts`

```ts
supabase.from("personal_transactions")
  .select("*")
  .eq("portal_id", currentPortalId)
  .gte("date", filters.dateFrom)
  .lte("date", filters.dateTo)
  .order("date", { ascending: false })
  .limit(2000)
```

**Problema:** Il limite è hardcoded a 2000. Se un portale ha più di 2000 transazioni in un range selezionato:
- La lista UI mostra solo le 2000 più recenti
- Le aggregazioni (income/expense totals, category breakdown) sono **silenziosamente errate**
- Nessun avviso all'utente
- Un portale con 3+ anni di dati + range "Anno corrente" è a rischio

**Impatto pratico:** Per uso personale, 2000 transazioni/anno = ~5.5/giorno — molto per una persona ma possibile per un business attivo.

**Fix:** Implementare aggregazioni server-side (via funzione DB o RPC) invece di caricare tutti i record e aggregare in JavaScript.

---

## 8.2 Aggregazioni client-side — O(n) per ogni re-render

**File:** `src/hooks/useFinanceSummary.ts`

Ogni aggiornamento del range o mutazione ricalcola client-side:
1. Filtra transazioni per tipo
2. Raggruppa per categoria
3. Calcola totali, percentuali, breakdown mensile

Per 2000 transazioni questo è accettabile (sub-millisecondo). Ma il calcolo viene rieseguito ad ogni dependency change tramite `useMemo`. Con molte dipendenze, potrebbe ricalcolare più del necessario.

**Alternativa scalabile:** Supabase RPC con aggregazione SQL:
```sql
SELECT category, SUM(amount), COUNT(*) FROM personal_transactions
WHERE portal_id = $1 AND date BETWEEN $2 AND $3 AND type = 'expense'
GROUP BY category ORDER BY SUM(amount) DESC;
```
Questo riduce il payload di rete di ~100x e delegeal DB l'aggregazione.

---

## 8.3 Fetch paralleli multipli in Recap

Recap esegue **5 query Supabase in parallelo**:

| Hook | Query |
|---|---|
| `useFinanceSummary(range)` | `personal_transactions` filtrate per range |
| `useFinanceSummary(prevRange)` | `personal_transactions` filtrate per prevRange |
| `useTransactions(range)` | `personal_transactions` completo range (allTransactions) |
| `useTransactions(prevRange)` | `personal_transactions` prevRange (prevAllTransactions) |
| `useTransactions(tableFilters)` | `personal_transactions` con filtri tabella |

Le prime 4 query si sovrappongono in termini di dati. Con aggregazione server-side, si potrebbero ridurre a 2 query.

---

## 8.4 FK senza indice — query lente

Dal Supabase Performance Advisor, molte FK non hanno indice. Le più critiche per i pattern di query finance:

```sql
-- Senza questi indici, ogni query con portal_id in WHERE fa full table scan:
personal_transactions.portal_id  -- ← query principale finance
vault_items.folder_id            -- ← vault folder navigation
leadgen_touchpoints.lead_id      -- ← CRM drilldown
```

**Fix:**
```sql
CREATE INDEX idx_personal_transactions_portal_id ON personal_transactions(portal_id);
CREATE INDEX idx_personal_transactions_date ON personal_transactions(date);
CREATE INDEX idx_personal_transactions_portal_date ON personal_transactions(portal_id, date);
CREATE INDEX idx_vault_items_folder ON vault_items(folder_id);
CREATE INDEX idx_leadgen_touchpoints_lead ON leadgen_touchpoints(lead_id);
```

---

## 8.5 `allTransactions` e `prevAllTransactions` — dati ridondanti

In Recap, `useFinanceSummary(range)` e `useTransactions(range)` eseguono **la stessa query** (stessa tabella, stesso portal_id, stesso range date). I dati vengono poi usati in modo diverso:
- `useFinanceSummary` → aggrega client-side (totals, category breakdown)
- `useTransactions` → usa i record individuali (dailyData, incomeBreakdown, heatmap)

Questo è **traffico di rete duplicato**. Una singola query + aggregazione locale risolverebbe entrambi i bisogni.

---

## 8.6 Realtime proliferazione canali

Come documentato in Step 6, ogni chiamata a `subscribeToFinanceUpdates` crea un nuovo canale Supabase. Se Recap monta/smonta con `compareOn` toggle o cambio portale, i canali devono essere puliti correttamente.

Ogni canale attivo mantiene una WebSocket connection aperta verso Supabase. Con 10 componenti attivi che ascoltano (Budget, Recap, Dashboard, etc.), ci sono 10+ WebSocket connections permanenti.

---

## 8.7 Framer Motion — animazioni su ogni card

Recap usa `motion.div` con `initial`, `animate`, `transition` su ogni card (delay progressivo):

```tsx
<motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
```

Con 9 widget, ogni navigazione verso Recap attiva 9 animazioni in sequenza. Su dispositivi lenti o con `prefers-reduced-motion`, questo degrada l'esperienza. La regola CSS `prefers-reduced-motion` è presente nel CLAUDE.md checklist ma non è applicata alle animazioni Framer Motion.

**Fix:**
```ts
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Usare transition={{ duration: prefersReducedMotion ? 0 : 0.4 }}
```

---

## 8.8 CloudPage — eDrive E2 esterno

Dal CLAUDE.md: "the cloud storage is on a edrive e2 external". Il cloud storage non è direttamente in Supabase Storage ma su un servizio esterno (E2 Object Storage). Le operazioni di file upload/download passano per un'edge function proxy.

**Implicazione performance:** Ogni operazione cloud ha latenza aggiuntiva rispetto a Supabase Storage diretto. In assenza di CDN, la velocità dipende dalla bandwidth del server E2.

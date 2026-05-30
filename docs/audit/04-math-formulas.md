# Step 4 — Formule Matematiche e Aggregazioni

---

## 4.1 KPI Cards (Recap.tsx)

### Entrate totali
```
totalIncome = Σ amount where type = "income" AND date IN range
```
✅ Corretto.

### Uscite totali
```
totalExpenses = Σ amount where type = "expense" AND date IN range
```
✅ Corretto.

### Saldo netto
```
netBalance = totalIncome - totalExpenses
```
✅ Corretto.

### Risparmio %
```
savingsPct = totalIncome > 0
  ? round((totalIncome - totalExpenses) / totalIncome * 100)
  : 0
```
✅ Corretto. Fallback a 0 quando income=0 (nessuna divisione per zero).

---

## 4.2 KPI Delta (confronto periodi)

```
kpiDelta.income  = prevIncome > 0  ? round((currIncome - prevIncome) / prevIncome * 100) : undefined
kpiDelta.expense = prevExpense > 0 ? round((currExpense - prevExpense) / prevExpense * 100) : undefined
kpiDelta.savings = prevSavingsPct !== 0 ? currSavingsPct - prevSavingsPct : undefined
                   (differenza in punti percentuale, non ratio)
kpiDelta.net     = undefined   ← SEMPRE undefined (bug)
```

**Bug #1 — `net` sempre undefined:**
```ts
// Recap.tsx:652
net: pI > 0 || pE > 0 ? undefined : undefined, // net delta less meaningful
```
Entrambi i branch dell'operatore ternario ritornano `undefined`. La KPI "Saldo Netto" non mostra mai il delta. Questo è probabilmente intentional (commentato "less meaningful") ma la sintassi è confusa.

**Bug #2 — compareOn=false mostra delta=0 invece di "—":**
Quando `compareOn=false`, `prevSummary` viene calcolato sullo **stesso range** del current:
```ts
const { summary: prevSummary } = useFinanceSummary(compareOn ? prevRange : range);
```
Con stesso range: `currIncome = prevIncome`, quindi `kpiDelta.income = 0`. Il badge mostra "→ 0%" invece di "—". Visivamente ingannevole.

---

## 4.3 Income Breakdown (Recap.tsx:479-491)

```
incomeBreakdown = group allTransactions by category where type="income"
  → per ogni categoria:
    pct = round(amount / (totalIncome || 1) * 100)
```

**Bug #3 — Fallback `|| 1` causa pct erronei:**
Quando `totalIncome = 0`:
- Il denominatore diventa 1
- `pct = round(amount / 1 * 100)` — se amount < 0.005, pct = 0

Ma `totalIncome = 0` implica nessuna transazione income, quindi `incomeBreakdown` sarà vuoto. Il bug è dormiente ma potrebbe manifestarsi con entrate di pochi centesimi dove la divisione per 1 inflaziona il pct.

---

## 4.4 Top 5 categorie spesa (Recap.tsx:616-626)

```
top5Expense = summary.categoryBreakdown.slice(0, 5)
  → per ogni categoria:
    delta = compareOn && prev[category] > 0
      ? round((curr - prev) / prev * 100)
      : undefined
```
✅ Formula corretta per il delta percentuale.

**Nota:** `categoryBreakdown` viene da `useFinanceSummary` che ordina per amount DESC. Le top 5 sono per spesa, non per variazione.

---

## 4.5 Daily Aggregation (Recap.tsx:546-562)

```
Per ogni giorno in range:
  dailyIncome[date] = Σ amount where type="income" AND date=d
  dailyExpenses[date] = Σ amount where type="expense" AND date=d

Tutti i giorni nel range vengono generati (zero-fill per i giorni senza transazioni).
```
✅ Corretto. Zero-fill garantisce continuità nel grafico.

---

## 4.6 Cashflow Cumulativo (Recap.tsx:566-573)

```
running = 0
per ogni giorno in dailyData (ordinato cronologicamente):
  running += dailyIncome - dailyExpenses
  cumulative[d] = running
```
✅ Corretto. Cumula il net giornaliero dall'inizio del range.

Il grafico usa un gradient bicolore (verde sopra 0, rosso sotto 0) ma il colore della linea è determinato solo dall'ultimo punto:
```ts
stroke={cashflowData[cashflowData.length - 1]?.cumulative >= 0 ? "var(--color-success)" : "var(--color-error)"}
```
Se il cashflow finale è positivo, l'intera linea è verde anche se ha attraversato il negativo. Visivamente corretto solo per l'andamento finale, non per quelli intermedi.

---

## 4.7 Trend Data (Recap.tsx:590-612)

```
se rangeDays <= 31 AND hasDailyData:
  → modalità giornaliera: filtra dailyData per giorni con dati
else:
  → modalità mensile: usa summary.monthlyBreakdown
```

**Nota:** `hasDailyData` è true solo se `allTransactions` è popolato. Se `useTransactions` è ancora in loading, si usa la modalità mensile anche per range ≤31 giorni. Passaggio da mensile a giornaliero avviene con un "salto" visivo al completamento del fetch.

---

## 4.8 Calendar Heatmap — p95 (CalendarHeatmap.tsx:77-82)

```
amounts = [importi spese > 0, ordinati ascending]
p95 = amounts[floor(amounts.length * 0.95)]
maxAmount = max(p95, 1)
```

**Bug #4 — Indice p95 errato per dataset piccoli:**

| n (num giorni con spese) | `floor(n * 0.95)` | Elemento |
|---|---|---|
| 1 | 0 | Il massimo (100° percentile) |
| 10 | 9 | Il massimo (100° percentile) |
| 20 | 19 | Il massimo (100° percentile) |
| 100 | 95 | Corretto (95° percentile) |

Per dataset < 21 elementi, `floor(n * 0.95)` restituisce l'ultimo elemento (il massimo), quindi il clamping al p95 non funziona. Outliers non vengono compressi per dataset piccoli.

**Formula corretta:**
```ts
const p95 = amounts[Math.floor((amounts.length - 1) * 0.95)];
```
Con questa formula: n=20 → index = `floor(19 * 0.95)` = `floor(18.05)` = 18 (corretto).

---

## 4.9 Heatmap — Cell Opacity

```
opacity = min(1, 0.15 + (amount / maxAmount) * 0.85)
```

- Giorni con amount=0 → opacity=0 (nessun colore)
- Giorni con amount=maxAmount → opacity=1 (colore pieno)
- Giorni con importo tra 0 e max → scala lineare tra 0.15 e 1.0

✅ Scala corretta. Il minimo 0.15 garantisce visibilità anche per piccoli importi.

---

## 4.10 Savings Rate nella TopList — progress bar

```
progressPct = budget[category] > 0
  ? min(100, round(amount / budget * 100))
  : item.pct   ← usa il % sul totale spese
```

Se non c'è budget definito, la progress bar mostra la % sul totale spese (non sul budget). Il colore:
- `>= 100%` → rosso (budget sforato)
- `>= 80%` → arancio (vicino al limite)
- `< 80%` → verde (nei limiti)

✅ Logica corretta. Il `min(100, ...)` evita barre overflow.

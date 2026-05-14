# Finance Module — Documentazione Tecnica Completa

> **Portali business:** KEYLO, REDX, TRUST ME  
> **Portale personale:** SOSA  
> **Stack:** React + TypeScript + Supabase + localStorage (dual-persistence)

---

## Indice

1. [Architettura Generale](#1-architettura-generale)
2. [Conto Economico (P&L) — Business Portals](#2-conto-economico-pl--business-portals)
3. [Sistema Transazioni](#3-sistema-transazioni)
4. [Cost Classification: COGS vs OPEX vs Revenue](#4-cost-classification-cogs-vs-opex-vs-revenue)
5. [Budget System](#5-budget-system)
6. [Subscriptions (Abbonamenti Ricorrenti)](#6-subscriptions-abbonamenti-ricorrenti)
7. [Invoices](#7-invoices)
8. [Dashboard & KPI](#8-dashboard--kpi)
9. [Crypto Portfolio](#9-crypto-portfolio)
10. [Gift Cards](#10-gift-cards)
11. [Strategia Persistenza Dati](#11-strategia-persistenza-dati)
12. [Tabelle Supabase](#12-tabelle-supabase)
13. [Realtime & Broadcasting](#13-realtime--broadcasting)
14. [File Structure Completa](#14-file-structure-completa)
15. [Aggiungere una Nuova Feature Finance](#15-aggiungere-una-nuova-feature-finance)

---

## 1. Architettura Generale

```
                    ┌─────────────────────────────────┐
                    │         PORTAL CONTEXT          │
                    │   portal.id = "keylo" | "sosa"  │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
    ┌─────────▼──────────┐ ┌───────▼────────┐ ┌────────▼───────────┐
    │  PERSONAL FINANCE   │ │ BUSINESS P&L   │ │  ASSET TRACKING    │
    │  (tutti i portali)  │ │ (business only) │ │  (tutti i portali) │
    │                     │ │                │ │                    │
    │ - Transactions       │ │ - Revenue       │ │ - Crypto Portfolio │
    │ - Budget            │ │ - COGS          │ │ - Gift Cards       │
    │ - Goals             │ │ - OPEX          │ │ - Investments      │
    │ - Subscriptions      │ │ - P&L / EBITDA  │ │                    │
    └─────────────────────┘ └────────────────┘ └────────────────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │    DUAL PERSISTENCE LAYER        │
                    │  localStorage (primary, instant) │
                    │  Supabase (secondary, sync)      │
                    └─────────────────────────────────┘
```

### Portale Business vs Personale

| Caratteristica | SOSA (personale) | KEYLO / REDX / TRUST ME (business) |
|----------------|------------------|-------------------------------------|
| P&L Statement | ✗ | ✓ Revenue → COGS → OPEX → EBITDA |
| WaterfallChart | ✗ | ✓ |
| COGS / OPEX categories | Expense generico | Classificazione specifica |
| `business_revenue` table | ✗ | ✓ |
| `business_cogs` table | ✗ | ✓ |
| `business_opex` table | ✗ | ✓ |
| Personal Transactions | ✓ | ✓ (anche spese personali) |
| Budget per categoria | ✓ | ✓ (include COGS/OPEX) |

---

## 2. Conto Economico (P&L) — Business Portals

### Formula P&L

```
Gross Revenue
  − Discounts & Returns
= Net Revenue                  ← base per tutti i margini

  − COGS (Cost of Goods Sold)
= Gross Profit
  Gross Margin % = Gross Profit / Net Revenue × 100

  − OPEX (Operating Expenses)
= EBITDA
  EBITDA Margin % = EBITDA / Net Revenue × 100
```

### Hook principale: `useBusinessSummary()`

**File:** `src/portals/finance/hooks/useBusinessFinance.ts`

```typescript
// Ritorna i valori aggregati del periodo selezionato
const {
  netRevenue,          // number — ricavi netti
  totalCOGS,           // number — costo del venduto totale
  grossProfit,         // number — margine lordo
  grossMarginPercent,  // number — % margine lordo
  totalOPEX,           // number — spese operative totali
  ebitda,              // number — EBITDA
  ebitdaMarginPercent, // number — % EBITDA
  revenueByCategory,   // Record<RevenueCategory, number>
  cogsByCategory,      // Record<COGSCategory, number>
  opexByCategory,      // Record<OPEXCategory, number>
} = useBusinessSummary(portalId, period);
```

### Hook P&L Statement: `usePLStatement()`

Genera struttura dati per rendere una tabella P&L completa:

```typescript
interface PLStatement {
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
  revenueBreakdown: { category: RevenueCategory; amount: number; label: string }[];
  totalCOGS: number;
  cogsBreakdown:    { category: COGSCategory; amount: number; label: string }[];
  grossProfit: number;
  grossMarginPercent: number;
  totalOPEX: number;
  opexBreakdown:    { category: OPEXCategory; amount: number; label: string }[];
  ebitda: number;
  ebitdaMarginPercent: number;
}
```

### WaterfallChart

**File:** `src/portals/finance/components/WaterfallChart.tsx`

Visualizza la cascata da Gross Revenue fino a EBITDA:

```
Gross Revenue ████████████████████  100k
  − COGS      ████████              −30k
Gross Profit  ████████████████      70k
  − OPEX      ██████                −20k
EBITDA        ██████████████        50k
```

Ogni barra è un `WaterfallDataPoint`:
```typescript
interface WaterfallDataPoint {
  label: string;
  value: number;
  cumulative: number;
  isTotal: boolean;    // true per Gross Profit, EBITDA
  isNegative: boolean; // true per COGS, OPEX
}
```

---

## 3. Sistema Transazioni

### Tipo Principale: `PersonalTransaction`

**File:** `src/types/finance.ts`

```typescript
interface PersonalTransaction {
  id: string;
  portal_id: string;
  user_id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;               // default "EUR"
  category: string;               // slug categoria (es. "salary", "food")
  category_id?: string;           // FK a finance_transaction_categories
  description: string;
  date: string;                   // YYYY-MM-DD
  cost_classification?:           // solo per expense
    | "cogs"
    | "opex"
    | null;
  payment_method?: string;        // cash, card, bank_transfer, crypto...
  is_recurring?: boolean;
  recurring_interval?: string;
  tags?: string[];
  receipt_url?: string;
  created_at: string;
  updated_at: string;
}
```

### Regole di Validazione

| Tipo transazione | `cost_classification` consentita |
|------------------|----------------------------------|
| `income` | Nessuna (campo svuotato automaticamente) |
| `expense` | `"cogs"` oppure `"opex"` (o null se non classificata) |
| `transfer` | Nessuna |

### Hook: `useTransactions()`

**File:** `src/hooks/useTransactions.ts`

```typescript
const {
  transactions,        // PersonalTransaction[] — paginated (20/page)
  allTransactions,     // PersonalTransaction[] — non paginated
  loading,
  totalCount,
  page, setPage,
  filters, setFilters,
  add,                 // (tx: Partial<PersonalTransaction>) => Promise<void>
  update,              // (id: string, changes: Partial<PersonalTransaction>) => Promise<void>
  remove,              // (id: string) => Promise<void>
} = useTransactions();
```

**Filtri disponibili:**

```typescript
interface TransactionFilters {
  type?: "income" | "expense" | "transfer";
  category?: string;
  cost_classification?: "cogs" | "opex" | null;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}
```

### Categorie Transazioni

**File:** `src/lib/financeCategoryStore.ts`

Categorie **personali** predefinite (localStorage):

| Tipo | Categorie default |
|------|-------------------|
| Income | salary, freelance, investments, sales, refunds, rental, other |
| Expense | food, transport, housing, utilities, healthcare, entertainment, education, personal, taxes, insurance, subscriptions, other |

Categorie **business** (Supabase `finance_transaction_categories`):

| Tipo | Vedere sezione §4 |
|------|-------------------|
| Revenue | product_sales, services, subscriptions... |
| COGS | raw_materials, production, packaging... |
| OPEX | marketing, software_tools, salaries... |

---

## 4. Cost Classification: COGS vs OPEX vs Revenue

### Definizioni

| Classificazione | Label IT | Colore | Quando usare |
|-----------------|----------|--------|--------------|
| `revenue` | Ricavo | `#4ade80` verde | Entrate da vendita, servizi, licenze |
| `cogs` | Costo del Venduto | `#fb923c` arancio | Costi diretti per produrre/consegnare il prodotto |
| `opex` | Spesa Operativa | `#f87171` rosso | Costi fissi/strutturali non legati al singolo prodotto |
| `other` | Altro | `#94a3b8` grigio | Non classificabile |

### Categorie REVENUE

```typescript
type RevenueCategory =
  | "product_sales"      // Vendita Prodotti
  | "services"           // Servizi
  | "subscriptions"      // Abbonamenti
  | "consulting"         // Consulenza
  | "licensing"          // Licenze
  | "commissions"        // Commissioni
  | "other";             // Altro
```

**Esempio KEYLO:**
- Vendita sneakers → `product_sales`
- Autenticazione scarpe come servizio → `services`
- Membership club → `subscriptions`

### Categorie COGS

```typescript
type COGSCategory =
  | "raw_materials"          // Materie Prime
  | "production"             // Produzione
  | "packaging"              // Packaging
  | "shipping"               // Spedizione
  | "platform_fees"          // Commissioni Piattaforma (es. StockX 9%)
  | "payment_processing"     // Elaborazione Pagamenti (Stripe 1.4%)
  | "authentication_costs"   // Costi Autenticazione (GOAT, legit-check)
  | "other";                 // Altro
```

**Esempio KEYLO:**
- Costo acquisto sneaker per rivendita → `raw_materials`
- Spedizione al cliente → `shipping`
- Commissione GOAT/StockX → `platform_fees`
- Costo autenticazione legit → `authentication_costs`

### Categorie OPEX

```typescript
type OPEXCategory =
  | "marketing"         // Marketing (ads, influencer)
  | "software_tools"    // Software & Strumenti (Shopify, Adobe, Linear)
  | "salaries"          // Stipendi
  | "rent"              // Affitto magazzino/ufficio
  | "utilities"         // Utenze
  | "legal"             // Legale (brevetti, contratti)
  | "accounting"        // Contabilità
  | "travel"            // Viaggi
  | "insurance"         // Assicurazioni
  | "subscriptions"     // Abbonamenti SaaS
  | "misc";             // Varie
```

**Esempio KEYLO:**
- Canone Shopify mensile → `software_tools`
- Advertising Instagram → `marketing`
- Consulente legale marchio → `legal`

### Tabelle Supabase Business

```sql
-- business_revenue
CREATE TABLE business_revenue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id       uuid REFERENCES portals(id),
  date            date NOT NULL,
  amount          numeric(15,2) NOT NULL,
  gross_amount    numeric(15,2),
  discounts       numeric(15,2) DEFAULT 0,
  category        revenue_category NOT NULL,
  description     text,
  status          text DEFAULT 'confirmed', -- confirmed | projected
  created_at      timestamptz DEFAULT now()
);

-- business_cogs
CREATE TABLE business_cogs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id       uuid REFERENCES portals(id),
  date            date NOT NULL,
  amount          numeric(15,2) NOT NULL,
  category        cogs_category NOT NULL,
  description     text,
  created_at      timestamptz DEFAULT now()
);

-- business_opex
CREATE TABLE business_opex (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id       uuid REFERENCES portals(id),
  date            date NOT NULL,
  amount          numeric(15,2) NOT NULL,
  category        opex_category NOT NULL,
  description     text,
  created_at      timestamptz DEFAULT now()
);
```

---

## 5. Budget System

### Come Funziona

Il budget system confronta **quanto hai speso** (da `personal_transactions`) con **quanto vuoi spendere** (budget limits) per ogni categoria in un dato mese.

```
Budget Mensile Totale: €3,000
├── Food:       limit €400  / spent €320  → 80% 🟡
├── Transport:  limit €150  / spent €80   → 53% 🟢
├── Housing:    limit €800  / spent €800  → 100% 🔴
└── Marketing:  limit €500  / spent €620  → 124% 🔴 OVER BUDGET
```

### Hook: `useBudgetData()`

**File:** `src/portals/finance/hooks/useBudgetData.tsx`

```typescript
const {
  categories,           // BudgetCategoryData[] — categoria + spent + limit + percentage
  totalBudget,          // number — budget mensile totale
  totalSpent,           // number — speso nel mese corrente
  remaining,            // number — totalBudget - totalSpent
  selectedMonth,        // { year: number; month: number }
  setSelectedMonth,
  updateLimit,          // (categorySlug: string, limit: number) => void
  setTotalBudget,       // (amount: number) => void
  loading,
} = useBudgetData();

interface BudgetCategoryData {
  slug: string;
  name: string;
  color: string;
  icon: string;
  monthlyLimit: number;
  spent: number;
  percentage: number;       // spent / limit × 100
  isOverBudget: boolean;    // percentage > 100
  transactions: PersonalTransaction[];
}
```

### Navigazione Mensile

Pagina Budget ha `prev/next month` navigation. Ogni cambio mese ri-fetcha le transazioni per quel periodo e ri-calcola spending vs limits.

### BudgetCategoryPanel

Componente expandable per ogni categoria:
- Barra progresso (verde → giallo → rosso al 100%)
- Lista transazioni del mese in quella categoria
- Click su transazione → dettaglio

### BudgetManagerModal

Modal per admin:
- Imposta `totalBudget` globale mensile
- Per ogni categoria: slider o input per `monthlyLimit`
- Persistenza: localStorage (`budgetStorage.ts`) + Supabase (`budget_limits`)

---

## 6. Subscriptions (Abbonamenti Ricorrenti)

### Struttura Dati

```typescript
interface Subscription {
  id: string;
  user_id?: string;
  name: string;                    // es. "Adobe Creative Cloud"
  description?: string;
  amount: number;                  // es. 59.99
  currency: string;                // "EUR"
  category: string;                // es. "software"
  billing_cycle: BillingCycle;
  billing_day: number;             // 1-31 — giorno del mese in cui viene addebitato
  start_date: string;              // YYYY-MM-DD — data primo utilizzo
  next_billing_date: string;       // YYYY-MM-DD — prossima scadenza prevista
  is_active: boolean;
  color?: string;
  icon?: string;                   // emoji: es. "🎨"
  deleted_at?: string;
  created_at?: string;
  updated_at?: string;
}
```

### Cicli di Fatturazione

| `BillingCycle` | Mesi | `toMonthlyAmount()` |
|----------------|------|---------------------|
| `monthly` | 1 | amount × 1 |
| `quarterly` | 3 | amount / 3 |
| `quadrimestral` | 4 | amount / 4 |
| `biannual` | 6 | amount / 6 |
| `annual` | 12 | amount / 12 |

**File:** `src/portals/finance/services/subscriptionCycles.ts`

### Status Calcolati (dinamici)

```typescript
type SubscriptionStatus =
  | "active"      // is_active=true, next_billing_date > oggi
  | "due_soon"    // is_active=true, 0 < days_until_billing <= 3
  | "overdue"     // is_active=true, days_until_billing < 0
  | "inactive";   // is_active=false
```

### Auto-Processor: `useSubscriptionProcessor()`

**File:** `src/portals/finance/hooks/useSubscriptionProcessor.ts`

Si attiva **al mount** dell'app. Processa catch-up automatico:

```
For each subscription where next_billing_date <= today:
  While next_billing_date <= today:
    Check current balance (from transactions)
    If balance >= amount:
      → Create personal_transaction (expense)
      → Insert in subscription_transactions (audit trail)
      → Advance next_billing_date by billing_cycle
      → Show toast "Addebitato €59.99 — Adobe CC"
    Else:
      → Log "Insufficient funds, skipping cycle"
      → Advance date anyway (evita loop infinito)
  Save updated next_billing_date to Supabase
```

**Perché è utile:** Se l'utente era offline per 3 mesi, al riconnesso vengono processati automaticamente tutti i cicli persi.

### NewSubscriptionModal

Campi:
- Nome abbonamento
- Importo + valuta
- Ciclo fatturazione (`billing_cycle`)
- Giorno del mese (`billing_day`: 1-31)
- Data inizio (`start_date`)
- Categoria
- Colore + Icona (emoji)

**Calcolo `next_billing_date` alla creazione:**

```typescript
// Dalla data di start, trova la prima data di billing futura
const nextDate = getFirstBillingDateFromStart(startDate, billingDay, billingCycle);
```

---

## 7. Invoices

**Stato attuale: NON IMPLEMENTATO.**

`src/pages/Invoices.tsx` è uno stub che restituisce `null`. Route `/invoices` mantenuta per compatibilità futura.

**Per implementarlo servirebbero:**

```typescript
interface Invoice {
  id: string;
  portal_id: string;
  number: string;            // es. "INV-2026-001"
  issued_date: string;
  due_date: string;
  client_name: string;
  client_email?: string;
  items: InvoiceItem[];
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  notes?: string;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}
```

---

## 8. Dashboard & KPI

### Dashboard Principale

**File:** `src/pages/dashboard/Dashboard.tsx`

```
Period Selector: [1D] [7D] [1M] [3M] [1Y] [ALL] [Custom 📅]
                                                              
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Income     │ │  Expenses   │ │  Net Balance│
│  +€8,420    │ │  −€5,130    │ │  +€3,290    │
│  ▲ +12%     │ │  ▲ +3%      │ │  ▲ +28%     │
└─────────────┘ └─────────────┘ └─────────────┘

┌──────────────────────────────┐ ┌──────────────┐
│        Revenue Chart          │ │   Goals      │
│  Income ──── Expenses ─────   │ │  🏠 Casa 72% │
│  ╭──╮          ╭──╮           │ │  🚗 Auto 45% │
│──╯  ╰──────────╯  ╰─────────  │ │  ✈️ Vac 23%  │
└──────────────────────────────┘ └──────────────┘

┌──────────────┐ ┌──────────────────────────────┐
│ Subscriptions│ │     Recent Transactions       │
│ 7 attivi     │ │  Cena → −€45    12 mag        │
│ €280/mese    │ │  Stipendio +€2k  1 mag        │
└──────────────┘ └──────────────────────────────┘
```

### Periodi Disponibili

| Selezione | Filtro date |
|-----------|-------------|
| `1d` | today |
| `7d` | last 7 days |
| `1m` | last 30 days |
| `3m` | last 90 days |
| `1y` | last 365 days |
| `all` | nessun filtro |
| `custom` | date range picker (dateFrom, dateTo) |

### Hook: `useFinanceSummary()`

**File:** `src/hooks/useFinanceSummary.ts`

```typescript
const {
  totalIncome,           // number
  totalExpenses,         // number
  netBalance,            // number — income − expenses
  transactionCount,      // number
  monthlyBreakdown,      // { month: string; income: number; expenses: number }[]
  categoryBreakdown,     // { category: string; amount: number; percentage: number }[]
  loading,
} = useFinanceSummary(period);
```

Cached in localStorage (SWR-style): riusa cache se <5 min e portal non è cambiato.

---

## 9. Crypto Portfolio

### Architettura

```
useCryptoPortfolio()
├── useCryptoHoldings()     → crypto_holdings table (CRUD)
└── useCryptoPrices()       → crypto_prices table (live, refresh ogni 60s)
                            → EnrichedHolding[] (holding + price + P&L)
                            → CryptoPortfolioSummary
```

### Tipi Principali

```typescript
// Posizione utente
interface CryptoHolding {
  id: string;
  coin_id: string;          // es. "bitcoin"
  symbol: string;           // es. "BTC"
  quantity: number;         // es. 0.5
  avg_buy_price_eur: number; // prezzo medio di carico
  notes?: string;
}

// Dati mercato (da API esterna sincronizzati in DB)
interface CryptoPrice {
  coin_id: string;
  price_eur: number;
  price_change_24h: number;     // percentuale
  market_cap_eur: number;
  ath_eur: number;              // all-time high
  last_updated: string;
}

// Holding arricchito con P&L calcolato
interface EnrichedHolding extends CryptoHolding {
  currentPrice: number;
  totalValue: number;            // quantity × currentPrice
  priceChange24h: number;
  profitLoss: number;            // (currentPrice − avgBuyPrice) × quantity
  profitLossPercent: number;
}

// Sommario portafoglio
interface CryptoPortfolioSummary {
  totalValueEur: number;
  totalInvestedEur: number;
  totalProfitLoss: number;
  totalProfitLossPercent: number;
  change24hEur: number;
  change24hPercent: number;
  holdingsCount: number;
}
```

### Aggiungere una Holding

```typescript
const { add } = useCryptoHoldings();
await add({
  coin_id: "ethereum",
  symbol: "ETH",
  quantity: 2.5,
  avg_buy_price_eur: 2400,
});
```

### CoinSelector

Dropdown per scegliere moneta da aggiungere:
- Lista da `crypto_prices` (ordinata per market cap)
- Search: filtra per symbol o name
- Mostra prezzo live + variazione 24h

---

## 10. Gift Cards

### Struttura

```typescript
interface GiftCard {
  id: string;
  brand: string;                 // es. "Amazon"
  brand_key: string;             // es. "amazon" (slug)
  card_code?: string;            // codice della gift card
  pin?: string;
  initial_value: number;         // valore iniziale
  remaining_value: number;       // valore residuo
  currency: string;              // "EUR"
  purchase_date: string;
  expiry_date?: string;
  status: GiftCardStatus;
  notes?: string;
  is_favorite: boolean;
}

type GiftCardStatus =
  | "active"
  | "partially_used"
  | "fully_used"
  | "expired"
  | "archived";
```

### Computed Fields (EnrichedGiftCard)

```typescript
interface EnrichedGiftCard extends GiftCard {
  usedValue: number;                    // initial − remaining
  usedPercent: number;                  // usedValue / initial × 100
  daysUntilExpiry: number | null;
  isExpiringSoon: boolean;              // 0 < days <= 30
  isExpired: boolean;
  transactions: GiftCardTransaction[];  // storico utilizzi
}
```

### Summary Aggregata

```typescript
interface GiftCardsSummary {
  totalRemainingEur: number;            // valore totale residuo in EUR
  totalCards: number;
  activeCards: number;
  expiringSoonCount: number;            // scadono entro 30 giorni
  byBrand: Record<string, number>;      // brand → valore residuo
  byCategory: Record<string, number>;   // categoria → valore residuo
}
```

### Catalogo Brand (100+)

**File:** `src/portals/finance/services/giftCardService.ts`

Categorie brand:
- `shopping`: Amazon, Zalando, IKEA, H&M, MediaWorld, Decathlon...
- `entertainment`: Netflix, Spotify, Apple, Google Play, Disney+...
- `gaming`: PlayStation, Xbox, Nintendo eShop, Steam...
- `food`: Uber Eats, Just Eat, Amazon Fresh...
- `travel`: Booking.com, Airbnb, Ryanair, Trenitalia...
- `payment`: Paysafecard, PayPal...

---

## 11. Strategia Persistenza Dati

### Gerarchia per Feature

| Feature | Primary (istantaneo) | Secondary (sync) | Note |
|---------|----------------------|-------------------|------|
| Transazioni personali | localStorage | Supabase `personal_transactions` | merge su load |
| Budget limits | localStorage | Supabase `budget_limits` | localStorage vince su conflitti |
| Categorie business | Supabase | localStorage cache | Realtime subscription attiva |
| Goals | Supabase | localStorage cache | Realtime subscription attiva |
| Subscriptions | localStorage only | — | No Supabase sync |
| Crypto holdings | Supabase | localStorage cache | Offline graceful |
| Crypto prices | Supabase | — | Aggiornati da Edge Function |
| Gift cards | Supabase | localStorage cache | Offline graceful |

### Keys localStorage (portal-scoped)

```typescript
// Ogni key è scoped per portal — nessun cross-portal leakage
`personal_transactions_local_${portalId}`  // STORAGE_PERSONAL_TX_PREFIX
`finance_categories_${portalId}`
`finance_budget_limits_${portalId}`
`finance_goals_${portalId}`
`finance_subscriptions_${portalId}`
`crypto_holdings_${portalId}`
`gift_cards_${portalId}`
```

### Guard: `isSupabaseConfigured()`

```typescript
// Usato in tutti gli hook che fanno fetch Supabase
function isSupabaseConfigured(): boolean {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
  return !!url && !url.includes("placeholder");
}

// Se false → solo localStorage, nessuna network call
```

---

## 12. Tabelle Supabase

### Schema Completo Finance

```sql
-- Transazioni personali (income/expense/transfer)
personal_transactions (
  id uuid PK,
  portal_id uuid FK portals,
  user_id uuid FK auth.users,
  type text CHECK (income|expense|transfer),
  amount numeric(15,2),
  currency text DEFAULT 'EUR',
  category text,
  category_id uuid FK finance_transaction_categories,
  description text,
  date date,
  cost_classification text CHECK (cogs|opex|null),
  payment_method text,
  is_recurring bool DEFAULT false,
  tags text[],
  receipt_url text,
  created_at timestamptz,
  updated_at timestamptz
)

-- Categorie business (COGS/OPEX/Revenue)
finance_transaction_categories (
  id uuid PK,
  portal_id uuid FK portals,
  name text,
  slug text,
  type text CHECK (revenue|cogs|opex|other),
  color text,
  icon text,
  is_default bool,
  is_active bool,
  sort_order int
)

-- Budget mensile per categoria
budget_limits (
  id uuid PK,
  portal_id uuid FK portals,
  user_id uuid FK auth.users,
  category text,
  category_id uuid FK finance_transaction_categories,
  monthly_limit numeric(15,2),
  color text,
  icon_name text
)

-- Obiettivi di risparmio
financial_goals (
  id uuid PK,
  portal_id uuid FK portals,
  user_id uuid FK auth.users,
  name text,
  target numeric(15,2),
  saved numeric(15,2),
  deadline date,
  category text,
  color text,
  emoji text,
  is_achieved bool DEFAULT false
)

-- Business P&L tables
business_revenue (id, portal_id, date, amount, gross_amount, discounts, category revenue_category, status, description)
business_cogs    (id, portal_id, date, amount, category cogs_category, description)
business_opex    (id, portal_id, date, amount, category opex_category, description)

-- Crypto
crypto_holdings  (id, portal_id, user_id, coin_id, symbol, name, quantity, avg_buy_price_eur, notes)
crypto_prices    (coin_id PK, symbol, name, price_eur, price_usd, price_change_24h, market_cap_eur, ath_eur, last_updated)
crypto_transactions (id, portal_id, user_id, coin_id, type buy|sell, quantity, price_eur, fee_eur, date, notes)

-- Gift Cards
gift_cards (id, portal_id, user_id, brand, brand_key, card_code, pin, initial_value, remaining_value, currency, purchase_date, expiry_date, status, is_favorite, notes)
gift_card_transactions (id, portal_id, user_id, gift_card_id, amount, description, transaction_date)
gift_card_brands (brand_key PK, name, logo_url, color, category, default_currency, has_expiry, is_popular)

-- Subscription automation
subscription_transactions (id, subscription_id, user_id, portal_id, amount, billing_date, status)
```

### RLS Policies (standard per tutte le tabelle)

```sql
-- Tutti i portali: isolamento per portal_id
SELECT: portal_id = current_portal_id()  -- funzione Supabase custom
INSERT: portal_id = current_portal_id()
UPDATE: portal_id = current_portal_id()
DELETE: portal_id = current_portal_id()
```

---

## 13. Realtime & Broadcasting

### Sistema Ibrido

**File:** `src/lib/financeRealtime.ts`

```
Mutazione dati (add/update/delete)
        │
        ├─→ DOM CustomEvent "finance-local-update"
        │         (same-tab, istantaneo)
        │
        └─→ Supabase Broadcast channel "finance"
                  (cross-tab/device, ~100ms latency)
```

### Broadcast Events

```typescript
type FinanceEvent =
  | "transaction_added"
  | "transaction_updated"
  | "transaction_deleted"
  | "subscription_processed"
  | "budget_updated"
  | "goal_updated";
```

### Utilizzo nei Componenti

```typescript
// Inviare broadcast (nei hook di mutazione)
broadcastFinanceUpdate("transaction_added", { id: newTx.id });

// Ricevere (nei componenti che mostrano dati)
useEffect(() => {
  const unsub = subscribeToFinanceUpdates((event) => {
    if (event === "transaction_added") refetch();
  });
  return unsub;
}, []);
```

---

## 14. File Structure Completa

```
src/
├── pages/
│   ├── Transactions.tsx          # Ledger 20/page, filtri, CRUD
│   ├── Budget.tsx                # Budget vs speso, nav mensile
│   ├── Goals.tsx                 # Obiettivi risparmio CRUD
│   ├── Subscriptions.tsx         # Lista abbonamenti, auto-process
│   ├── Invoices.tsx              # ⚠️ STUB — non implementato
│   └── dashboard/
│       ├── Dashboard.tsx         # Orchestratore, period selector
│       ├── KpiCards.tsx
│       ├── RevenueChart.tsx
│       ├── GoalsWidget.tsx
│       ├── SubscriptionsWidget.tsx
│       └── RecentTransactions.tsx
│
├── hooks/
│   ├── useTransactions.ts        # CRUD + filtri + paginazione
│   ├── useFinanceSummary.ts      # KPI aggregati con caching
│   ├── useFinanceCategories.ts   # CRUD finance_transaction_categories
│   ├── useFinancialGoals.ts      # Goals fetch + realtime
│   ├── useDashboardTransactions.ts
│   ├── useDashboardSubscriptions.ts
│   └── useNetWorth.ts
│
├── portals/finance/
│   ├── hooks/
│   │   ├── useBusinessFinance.ts  # Revenue/COGS/OPEX/Summary/P&L/Waterfall
│   │   ├── useBudgetData.tsx      # Aggregazione budget + spending
│   │   ├── useBudgetState.ts      # UI state (selected month, panel)
│   │   ├── useBudgetCategoryTransactions.ts
│   │   ├── useSubscriptionProcessor.ts   # Auto catch-up billing
│   │   ├── useCryptoHoldings.ts
│   │   ├── useCryptoPrices.ts
│   │   ├── useCryptoPortfolio.ts
│   │   ├── useCryptoChart.ts
│   │   ├── useCoinSelector.ts
│   │   ├── useGiftCards.ts
│   │   ├── useGiftCardDetail.ts
│   │   └── useGiftCardsSummary.ts
│   │
│   ├── services/
│   │   ├── budgetStorage.ts       # localStorage persistence per budget
│   │   ├── subscriptionCycles.ts  # Date/billing utilities
│   │   ├── subscriptionProcessor.ts # Batch process overdue subscriptions
│   │   ├── cryptoService.ts       # Supabase CRUD crypto
│   │   └── giftCardService.ts     # Supabase CRUD + brand catalog
│   │
│   ├── components/
│   │   ├── BudgetCategoryPanel.tsx
│   │   ├── BudgetManagerModal.tsx
│   │   ├── WaterfallChart.tsx
│   │   └── NewSubscriptionModal.tsx
│   │
│   ├── types/
│   │   ├── businessFinance.ts     # Revenue/COGS/OPEX types, P&L, Waterfall
│   │   ├── crypto.ts
│   │   └── giftCards.ts
│   │
│   └── utils/
│       ├── budgetIcons.tsx
│       ├── currency.ts            # EUR conversion utilities
│       └── giftCardUtils.ts
│
├── lib/
│   ├── financeCategoryStore.ts    # Personal income/expense categories
│   ├── financeRealtime.ts         # Broadcast + subscribe
│   ├── personalTransactionStore.ts # localStorage CRUD
│   └── services/
│       ├── budgetService.ts       # Supabase CRUD budget_limits
│       ├── goalsService.ts        # Supabase CRUD financial_goals
│       └── categoryService.ts
│
└── types/
    ├── finance.ts                 # PersonalTransaction, FinanceCategory, CostClassification
    └── database.ts                # Supabase table interfaces
```

---

## 15. Aggiungere una Nuova Feature Finance

### Checklist

1. **Definisci il tipo** in `src/types/finance.ts` o `src/portals/finance/types/`
2. **Crea la migration Supabase** con RLS policy (portal_id scoped)
3. **Crea il service** in `src/lib/services/` o `src/portals/finance/services/` per CRUD Supabase + localStorage fallback
4. **Crea l'hook** usando `useSingleton` o `usePortalData` da `src/hooks/usePortalData.ts` (già portal-scoped e auto-fetching)
5. **Esporta l'hook** da `src/hooks/settings/index.ts` se è un singleton setting
6. **Aggiungi broadcast** in `financeRealtime.ts` se la feature modifica stato condiviso
7. **Aggiungi route** in `src/App.tsx` + lazy import
8. **Aggiorna Dashboard** se la feature ha un KPI rilevante

### Pattern Hook Standard (usePortalData)

```typescript
// Per tabelle lista (molte righe per portal)
const { data, loading, error, create, update, remove } = usePortalData<MyType>(
  "my_table",
  { orderBy: "created_at", ascending: false }
);

// Per tabelle singleton (una riga per portal)
const { data, loading, upsert } = useSingleton<MyType>("my_settings_table");
```

### Dove aggiungere una nuova categoria COGS/OPEX

1. Aggiungi il valore all'enum in `src/portals/finance/types/businessFinance.ts`
2. Aggiungi l'etichetta italiana all'array `COGS_CATEGORY_OPTIONS` o `OPEX_CATEGORY_OPTIONS`
3. Aggiungi l'icona in `src/portals/finance/utils/budgetIcons.tsx`
4. La migration Supabase per aggiornare il CHECK constraint (se usato)

---

*Ultimo aggiornamento: 2026-05-10*  
*Branch: feat/sosa-design-system*

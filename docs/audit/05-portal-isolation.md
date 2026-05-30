# Step 5 — Isolamento Multi-Portale

---

## 5.1 Meccanismo di isolamento

L'isolamento portale si basa su tre livelli:

### Livello 1: Filtro applicativo
```ts
// usePortalData hook — automatico
supabase.from("table").select("*").eq("portal_id", currentPortalId)

// Chiamate manuali — manuale
supabase.from("table").select("*")
  .eq("portal_id", currentPortalId)  // ← richiesto esplicitamente
```

### Livello 2: Row Level Security (RLS)
Ogni tabella portale-scoped ha policy RLS:
```sql
CREATE POLICY "portal_isolation" ON table_name
  USING (portal_id = (SELECT portal_id FROM portal_members 
                      WHERE user_id = auth.uid() 
                      AND portal_id = table_name.portal_id));
```

### Livello 3: Frontend route guard
`PortalLayout` verifica che il portal_id nella URL corrisponda ai portali dell'utente.

---

## 5.2 Tabelle senza isolamento — CRITICO

Le seguenti 6 tabelle hanno RLS `USING (true)`:

| Tabella | Dati esposti |
|---|---|
| `leadgen_leads` | Nome, email, telefono di tutti i lead di tutti i portali |
| `leadgen_touchpoints` | Storico interazioni con i lead |
| `leadgen_pipelines` | Pipeline di vendita private |
| `leadgen_stages` | Stadi delle pipeline |
| `leadgen_pipeline_leads` | Associazione lead↔pipeline |
| `leadgen_activities` | Attività CRM (note, chiamate, email) |

**Scenario di attacco:**
1. Utente S. si registra e crea un portale personale
2. Ottiene un `anon_key` (è pubblico nel frontend)
3. Chiama `GET /rest/v1/leadgen_leads?select=*` con il suo JWT
4. Riceve tutti i lead di tutti i portali del sistema

**Fix urgente:**
```sql
-- Per ogni tabella leadgen:
DROP POLICY IF EXISTS "enable_all" ON leadgen_leads;
CREATE POLICY "portal_isolation" ON leadgen_leads
  USING (portal_id IN (
    SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
  ));
```

---

## 5.3 `transactionStore.ts` — Isolamento simulato in-memory

```ts
// lib/transactionStore.ts
const _dataByPortal: Record<string, Transaction[]> = {};
let _portal = "sosa";

export function setActivePortal(id: string) {
  _dataByPortal[_portal] = transactions;  // salva stato corrente
  _portal = id;
  transactions = _dataByPortal[id];       // carica stato nuovo portale
}
```

**Problema:** Questa simulazione è in memoria. Se due tab del browser sono aperte su portali diversi, condividono la stessa memoria JavaScript — non c'è isolamento. Ricaricando la pagina, i dati scompaiono.

Questo sistema non dovrebbe essere usato per dati business reali.

---

## 5.4 Verifica `portal_id` negli hook

### `usePortalData` (generico) — ✅ Automatico
```ts
// src/hooks/usePortalData.ts
const { currentPortalId } = usePortalDB();
supabase.from(tableName).select("*").eq("portal_id", currentPortalId)
```

### `useTransactions` — ✅ Filtro manuale corretto
```ts
// src/hooks/useTransactions.ts
supabase.from("personal_transactions")
  .select("*")
  .eq("portal_id", currentPortalId)
```

### `useFinanceSummary` — ✅ Filtro manuale corretto
```ts
supabase.from("personal_transactions")
  .select("*")
  .eq("portal_id", currentPortalId)
```

### `AddTransactionModal` — ⚠️ Da verificare
Il componente chiama `createTransaction` dall'hook `useTransactions`. Verificare che l'INSERT includa `portal_id`.

### `NewTransactionModal` — ❌ Usa store in-memory
Chiama `addTransaction` da `transactionStore.ts` (in-memory, nessun Supabase).

---

## 5.5 Provider tree e `currentPortalId`

```
AuthProvider
  └── PortalDBProvider        ← currentPortalId, isOwner, isAdmin
        └── PortalProvider    ← legacy, usa usePortal()
              └── Routes
```

**Regola (CLAUDE.md):** Usare sempre `usePortalDB()` per `currentPortalId`. Recap usa `usePortal()` (legacy) in `getAllCategories(portal?.id)` — questo è un refactoring incompleto.

---

## 5.6 Funzioni SECURITY DEFINER anon-callable

Due funzioni DB sono eseguibili senza autenticazione:

**Rischio:** Un attaccante non autenticato può chiamare queste funzioni tramite API REST Supabase. A seconda di cosa fanno, potrebbero leggere dati o eseguire operazioni privilegiate.

**Fix:** Revocare il grant `anon` dalle funzioni:
```sql
REVOKE EXECUTE ON FUNCTION nome_funzione() FROM anon;
```

---

## 5.7 Riepilogo livello di isolamento

| Area | Isolato? | Meccanismo |
|---|---|---|
| `personal_transactions` | ✅ Sì | RLS + filtro query |
| `vault_items` | ✅ Sì | RLS + filtro query |
| `goals` | ✅ Sì | RLS + filtro query |
| `leadgen_*` | ❌ No | RLS `USING (true)` |
| `transactionStore` | ⚠️ Parziale | In-memory per sessione |
| Funzioni SECURITY DEFINER | ❌ No | Callable da anon |

# Step 6 — Realtime & Invalidazione Cache

---

## 6.1 Architettura realtime

Il sistema usa un pattern ibrido per propagare le mutazioni finance:

```
Mutazione (add/update/delete transaction)
    │
    ├──► window.dispatchEvent(CustomEvent) ← stesso tab, sincrono
    │         "finance-local-update"
    │
    └──► supabase.channel("finance-updates").send() ← cross-tab, async
              type: "broadcast"
              event: "transaction_added"|"transaction_updated"|"transaction_deleted"
```

---

## 6.2 `broadcastFinanceUpdate` — funzionamento

**File:** `src/lib/financeRealtime.ts`

```ts
export function broadcastFinanceUpdate(event: FinanceEvent, payload?: Record<string, unknown>) {
  // 1. Same-tab: DOM CustomEvent (sempre funziona)
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT_NAME, { detail: { event, ...payload } }));

  // 2. Cross-tab: Supabase Realtime
  try {
    ensureSubscribed();
    _channel.send({ type: "broadcast", event, payload: { ...payload, timestamp: Date.now() } });
  } catch {
    // Supabase non configurato — local event già dispatchato
  }
}
```

**Nota:** Il broadcast Supabase usa un singleton channel `"finance-updates"` condiviso da tutti i sender. Il subscriber crea un canale **separato** per ogni componente che ascolta, con nome `"finance-updates-{Math.random()}"`.

---

## 6.3 `subscribeToFinanceUpdates` — problema di proliferazione canali

```ts
export function subscribeToFinanceUpdates(callback) {
  // ...
  sub = supabase
    .channel(`${CHANNEL_NAME}-${Math.random()}`)  // ← NUOVO canale ogni volta
    .on("broadcast", { event: "transaction_added" }, ...)
    // ...
    .subscribe();
  // ...
}
```

**Problema:** Ogni componente che chiama `subscribeToFinanceUpdates` crea un **nuovo canale Supabase Realtime** con un nome casuale. Se un componente si monta/smonta frequentemente (es. filtri, modali), i vecchi canali potrebbero non essere rimossi correttamente.

**Mitigazione:** La funzione ritorna un cleanup che chiama `supabase.removeChannel(sub)`. Se i componenti usano correttamente `useEffect(() => { return unsubscribe; }, [])`, il problema non si manifesta. Da verificare in tutti i punti di utilizzo.

---

## 6.4 Canali Supabase vs DOM Events — Doppio firing

Quando un evento viene emesso:
1. `window.dispatchEvent` → tutti i listener `addEventListener("finance-local-update")` nello stesso tab **ricevono immediatamente**
2. Supabase broadcast → arriva al subscriber con latenza network (anche nello stesso tab)

**Problema:** Nello stesso tab, il callback viene chiamato **due volte** per ogni mutazione:
- Una volta dal DOM CustomEvent (sincrono)
- Una volta dal canale Supabase (che riceve il proprio broadcast)

Se i subscriber eseguono un re-fetch, questo causa **due re-fetch per ogni mutazione** nello stesso tab. I re-fetch sono idempotenti (stessa query), quindi non causano dati errati, ma sprecano bandwidth.

**Fix possibile:** Deduplicate usando un timestamp o flag "locale":
```ts
// Nel subscriber: ignorare eventi con timestamp recente già processato
```

---

## 6.5 Aggiornamento cache `useFinanceSummary` e `useTransactions`

I hook ascoltano l'evento `finance-local-update` e invalidano la cache:

```ts
// Pseudocodice (da useFinanceSummary/useTransactions)
useEffect(() => {
  const unsubscribe = subscribeToFinanceUpdates(() => {
    refetch();  // o setState trigger
  });
  return unsubscribe;
}, []);
```

L'invalidazione è eager (immediata all'evento), non lazy (basata su stale-time). Questo garantisce coerenza ma può causare flash di loading state dopo ogni mutazione.

---

## 6.6 Cross-tab realtime — funziona solo con Supabase configurato

Se `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` non sono configurati, il try/catch in `broadcastFinanceUpdate` silenzia l'errore. In questo caso:
- Stesso tab: funziona (DOM CustomEvent)
- Cross-tab: non funziona (nessun broadcast)

---

## 6.7 Supabase Postgres Changes — NOT USED

Il sistema NON usa Supabase Realtime Postgres Changes (che ascolta direttamente le modifiche al DB). Usa solo Broadcast (messaggi client-to-client).

**Implicazione:** Se un altro client modifica il DB (es. admin tramite Supabase Studio, migration script, backend job), i client frontend non vengono notificati. La cache resta stale finché l'utente non naviga o ricarica.

---

## 6.8 `getCategoryUpdateEvent` — inutilizzato?

**File:** `src/lib/financeCategoryStore.ts:20-23`
```ts
export function getCategoryUpdateEvent(portalId: string): string {
  return `finance-category-update-${portalId}`;
}
export const CATEGORY_UPDATE_EVENT = "finance-category-update-sosa";
```

`CATEGORY_UPDATE_EVENT` è hardcoded per `"sosa"` — non cambia per portale. `getCategoryUpdateEvent` genera l'evento corretto per portale ma va verificato se è usato ovunque.

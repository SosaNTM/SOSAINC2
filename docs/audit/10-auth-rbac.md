# Step 10 — Auth & RBAC

---

## 10.1 Sistema di autenticazione

**Provider:** Supabase Auth (JWT-based)
**Metodi:** Email + password (verificato dal codice)
**Sessione:** JWT access token + refresh token gestiti da Supabase client SDK

```
AuthProvider (src/lib/authContext.tsx)
  ├── user: User | null
  ├── session: Session | null
  └── isLoading: boolean
```

---

## 10.2 Ruoli portale

**Tabella:** `portal_members` con colonna `role`

```ts
type Role = "owner" | "admin" | "member"
```

### Permessi per ruolo:

| Azione | owner | admin | member |
|---|---|---|---|
| Accedere al portale | ✅ | ✅ | ✅ |
| Leggere dati | ✅ | ✅ | ✅ |
| Creare transazioni | ✅ | ✅ | ✅ |
| Accedere a Settings | ✅ | ✅ | ❌ |
| Gestire membri | ✅ | ✅ | ❌ |
| DangerZone (reset/delete) | ✅ | ❌ | ❌ |

### Frontend guard:

```ts
// AdminRoute — protegge /settings/*
if (role !== "admin" && role !== "owner") redirect to dashboard

// DangerZone — solo owner
if (!isOwner) return null;
```

### Backend guard (RLS):
Da verificare se RLS distingue i ruoli o si basa solo sull'autenticazione. Se RLS controlla solo `auth.uid()` senza verificare `role`, un member potrebbe scrivere nel DB bypassando il frontend guard.

---

## 10.3 `usePortalDB` vs `usePortal` — Legacy context

**Regola in CLAUDE.md:**
> Always use `usePortalDB()` — not the older `usePortal()` — when you need `currentPortalId`, `isOwner`, `isAdmin`.

**Violazioni trovate:**
- `Recap.tsx` usa `usePortal()` per `portal?.id` (in `getAllCategories` e `accentColor`)
- `useFinanceSummary.ts` usa `usePortal()` per `portalId`
- Altri componenti potrebbero usare il legacy context

**Rischio:** `usePortal()` e `usePortalDB()` potrebbero essere out of sync se il portale attivo cambia (es. navigazione rapida tra portali). `usePortalDB()` è la fonte autoritativa.

---

## 10.4 Protezione route — `PortalLayout`

```tsx
// PortalLayout.tsx
const { portals: dbPortals, loadingPortals, setCurrentPortalBySlug } = usePortalDB();

// Se portal_id nella URL non è nei portali dell'utente → redirect a /hub
useEffect(() => {
  if (!loadingPortals && portalSlug) {
    const found = dbPortals.find(p => p.slug === portalSlug);
    if (!found) navigate("/hub");
    else setCurrentPortalBySlug(portalSlug);
  }
}, [portalSlug, loadingPortals, dbPortals]);
```

Questo previene l'accesso a portali non appartenenti all'utente navigando direttamente all'URL. ✅

---

## 10.5 `usePortalSecurity` — Lock screen

**File:** `src/hooks/settings/index.ts` (security_settings)

Il portale può avere un PIN di sicurezza. `PortalLockScreen` blocca l'accesso se la sessione non è "unlocked":

```ts
const [unlocked, setUnlocked] = useState(() =>
  !!sessionStorage.getItem(`portal_unlocked_${portalId ?? ""}`)
);
```

Il PIN è verificato client-side con un hash. Il flag `unlocked` vive in `sessionStorage` — persiste per la sessione del tab ma non tra tab.

**Considerazione:** Se il PIN è verificato solo client-side (confronto hash in JS), un attaccante con DevTools può impostare `sessionStorage.setItem("portal_unlocked_...", "true")` e bypassare il lock screen. Questo è security-theater, non vera protezione. Il lock screen protegge da accessi casuali, non da attaccanti determinati.

---

## 10.6 Password cloud/vault — SHA-256 client-side

Già documentato in Step 7.10:

```ts
// commit 308c06c
const hash = await crypto.subtle.digest("SHA-256", encoded);
```

SHA-256 è un hash generale, non un KDF (Key Derivation Function). Per password utente servono:
- `bcrypt` (costo adattabile)
- `argon2id` (resistente a GPU attacks)
- `scrypt`

SHA-256 senza salt è vulnerabile a rainbow table attacks. Due utenti con la stessa password avranno lo stesso hash, rendendo il pre-computation efficace.

**Fix urgente:** Usare `bcrypt` server-side via Supabase Edge Function per il password check.

---

## 10.7 Anon functions — accesso non autenticato

Come documentato in Step 1.4 e Step 5.6:

Almeno 2 funzioni DB hanno `EXECUTE` concesso al ruolo `anon`. Queste sono eseguibili senza JWT:

```bash
# Chiunque può chiamare:
POST https://ndudzfaisulnmbpnvkwo.supabase.co/rest/v1/rpc/nome_funzione
# Senza Authorization header
```

Se queste funzioni accedono a dati utente tramite `SECURITY DEFINER`, eseguono la query come il superuser DB e bypassano RLS.

---

## 10.8 Inviti portale — flow

La tabella `portal_invites` gestisce gli inviti. Verificare che:
1. L'invite link abbia un token casuale (non prevedibile)
2. Il token abbia una scadenza (`expires_at`)
3. L'invite sia consumato (invalidato) dopo l'accettazione
4. Solo owner/admin possano inviare inviti

Questi aspetti non sono stati verificati nel codice frontend ma sono criteri standard di sicurezza per invite flow.

---

## 10.9 Password leak protection

Supabase offre "Leaked Password Protection" (confronto con HaveIBeenPwned). È disabilitato (da Security Advisor). Per applicazioni con dati business sensibili, questa protezione è raccomandata.

---

## 10.10 Session management

Supabase gestisce automaticamente il refresh del JWT access token (scade di default ogni 3600s). Il logout pulisce la sessione Supabase. Non è stato rilevato un meccanismo di session timeout applicativo (es. auto-logout dopo X minuti di inattività).

`security_settings` ha un campo `session_timeout` — verificare se è implementato nel frontend o solo definito nel DB.

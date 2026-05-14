# SECURITY AUDIT — SOSA INC Frontend
**Data:** 2026-05-10  
**Scope:** Repository source (`src/`), build artifacts (`dist/`), Edge Functions (`supabase/functions/`), git history, environment configuration  
**Metodo:** Static analysis, bundle inspection, pattern scan, DB migration review

---

## EXECUTIVE SUMMARY

Il codebase segue pratiche di sicurezza generalmente solide. Nessun service role key o private key è presente nel frontend. Tuttavia sono stati identificati **3 problemi significativi** che richiedono azione prima del deploy in produzione.

| Severità | N° | Stato |
|----------|----|-------|
| 🔴 CRITICO | 1 | Da correggere prima del deploy |
| 🟠 ALTO | 2 | Correggere entro release |
| 🟡 MEDIO | 3 | Pianificare entro 30 giorni |
| 🟢 BASSO | 2 | Monitorare |

---

## 🔴 CRITICO

### SEC-001 — Mock Auth baked nel dist bundle

**File:** `dist/assets/index-BM_r5B8x.js`  
**Valore trovato nel bundle:**
```
VITE_USE_REAL_AUTH:"false"
```

**Problema:** Vite inietta i valori `import.meta.env.VITE_*` come stringhe letterali al momento della build. Il bundle attuale è stato compilato con `.env.local` che contiene `VITE_USE_REAL_AUTH=false`. Se questo dist viene deployato, l'app usa il sistema di mock auth invece di Supabase Auth reale.

**Impatto:** Chiunque conosca le credenziali mock (`dev_only_owner`, `dev_only_admin`, ecc.) — visibili nel bundle stesso — può accedere all'app come owner con permessi completi, bypassando completamente Supabase Auth.

**Prova (bundle):**
```js
// src/lib/authContext.tsx compilato nel bundle:
password: import.meta.env.VITE_MOCK_PASSWORD_OWNER || "dev_only_owner"
// → diventa nel bundle:
password: void 0 || "dev_only_owner"
// = "dev_only_owner" in chiaro nel JS pubblicato
```

**Remediation:**
1. Non deployare mai il `dist/` corrente
2. Prima di ogni build di produzione: impostare `VITE_USE_REAL_AUTH=true` nell'env di CI/CD
3. Aggiungere check in CI: `grep -r '"false"' dist/ | grep USE_REAL_AUTH && exit 1`
4. Considerare di eliminare il sistema mock auth oppure incapsularlo in `if (import.meta.env.DEV)` — le stringhe fallback non vengono tree-shaken

---

## 🟠 ALTO

### SEC-002 — Hardcoded Vault Fallback Password nel bundle

**File:** `src/lib/vaultStore.ts:24`
```typescript
export const LOCKED_FOLDER_PASSWORD = "vault2025";
```

**Trovato nel bundle:** `dist/assets/index-BM_r5B8x.js` — la stringa `vault2025` è presente in chiaro.

**Problema:** Anche se `VaultPage` ora preferisce l'hash da `portal_security` Supabase, la password hardcoded è visibile a chiunque apra DevTools → Sources. Se `is_enabled=false` o `password_hash=null`, il fallback `"vault2025"` è attivo.

**Remediation:**
- Rimuovere il fallback hardcoded. Se nessuna password è configurata in Supabase, la cartella locked dovrebbe essere semplicemente bloccata senza modo di sbloccarla (forza l'admin a impostare una password via Settings).
- Oppure: far fallire silenziosamente con messaggio "Configura una password nelle Impostazioni".

```typescript
// vaultStore.ts — rimuovere questa riga:
export const LOCKED_FOLDER_PASSWORD = "vault2025";

// VaultPage.tsx — rimuovere il fallback:
const correct = (security?.is_enabled && security?.password_hash)
  ? hash === security.password_hash
  : lockPassword === LOCKED_FOLDER_PASSWORD; // ← RIMUOVERE

// Sostituire con:
const correct = (security?.is_enabled && security?.password_hash)
  && hash === security.password_hash;
```

### SEC-003 — OAuth Tokens in chiaro in `social_connections`

**Tabella:** `social_connections` (Supabase)  
**Colonne:** `access_token`, `refresh_token`

**Problema:** I token OAuth delle piattaforme social (Instagram, TikTok, YouTube, ecc.) sono salvati in chiaro nel database. Un accesso non autorizzato al DB (es. SQL injection, compromissione service role) espone tutti i token di tutti i portali.

**Remediation (priorità ordine):**
1. **Breve termine:** Abilitare RLS restrittivo sulla tabella (già fatto in questo ciclo di audit, solo owner/admin possono leggere i propri token)
2. **Medio termine:** Usare [Supabase Vault (pgsodium)](https://supabase.com/docs/guides/database/vault) per encrypt at rest:
   ```sql
   -- Migrare access_token/refresh_token a colonne vault.secrets
   SELECT vault.create_secret('token_value', 'social_token_portal123_instagram');
   ```
3. **Lungo termine:** Proxy OAuth via Edge Function — il frontend non riceve mai il token grezzo, usa solo un `session_id` opaco

---

## 🟡 MEDIO

### SEC-004 — `VITE_USE_REAL_AUTH=false` nel `.env.local` commitato

**Non è nei git commits** (`.env.local` è correttamente gitignored), ma il rischio è che ogni sviluppatore che clona il repo e riceve un `.env.local` di esempio potrebbe deployare accidentalmente in staging con mock auth.

**Remediation:**
- Aggiungere a `.env.example`:
  ```
  # IMPORTANTE: impostare a "true" in produzione e staging
  VITE_USE_REAL_AUTH=true
  ```
- Aggiungere warning in `authContext.tsx`:
  ```typescript
  if (!USE_REAL_AUTH && !import.meta.env.DEV) {
    console.error("⚠️ MOCK AUTH attivo in ambiente non-development!");
  }
  ```

### SEC-005 — 7 funzioni SECURITY DEFINER chiamabili da `anon`

**Stato:** ✅ **RISOLTO** — Migration `revoke_anon_execute_security_definer_functions` applicata in questo ciclo di audit.

Funzioni fixate:
- `match_documents`, `binary_quantize`, `halfvec_avg`, `sparsevec_out`, `array_to_tsvector`, `ts_stat`, `get_current_portal_member_role`

Azione: `REVOKE EXECUTE ON FUNCTION ... FROM anon;` + fixed mutable `search_path`.

### SEC-006 — Leadgen RLS aperto (USING true)

**Stato:** ✅ **RISOLTO** — Migration `fix_leadgen_rls_portal_scoped` applicata.

Tabelle fixate: `leadgen_searches`, `leadgen_members`, `leadgen_all_leads` — policy `USING(true)` sostituita con `USING(portal_id = current_portal_id())`.

---

## 🟢 BASSO

### SEC-007 — Supabase URL + Anon Key nel dist bundle

**Trovato in:** `dist/assets/index-BM_r5B8x.js`
```
CP="https://ndudzfaisulnmbpnvkwo.supabase.co"
AP="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Valutazione: ACCETTABILE** — Per architettura Supabase SPA questo è by design:
- L'anon key è una chiave pubblica (equivalente a una API key read-only pubblica)
- Le RLS policy Supabase applicano i permessi server-side
- Supabase documenta esplicitamente che l'anon key può essere esposta nel frontend

**Azione richiesta:** Nessuna immediata. Verificare che RLS sia abilitato su tutte le tabelle (✅ 75/75 tabelle hanno RLS abilitato).

### SEC-008 — `VITE_TELEGRAM_BOT_USERNAME` in `.env.example`

**File:** `.env.example`
```
VITE_TELEGRAM_BOT_USERNAME=iconoff_bot
```

**Valutazione: ACCETTABILE** — Username Telegram è dato pubblico (visibile nella URL `t.me/iconoff_bot`). Non è un secret. Nessuna azione richiesta.

---

## RISULTATI SCAN AUTOMATICO

| Categoria | Risultato | Note |
|-----------|-----------|------|
| `service_role` key in src/ | ✅ PASS | Non trovato |
| `sk_live_` / Stripe keys | ✅ PASS | Solo placeholder UI (`<input placeholder="sk_live_...">`) |
| AWS `AKIA...` keys | ✅ PASS | Non trovato |
| Google `AIza...` keys | ✅ PASS | Non trovato |
| Anthropic `sk-ant-` | ✅ PASS | Non trovato |
| GitHub PAT `ghp_` | ✅ PASS | Non trovato |
| JWT hardcoded in src/ | ✅ PASS | Solo via env vars |
| Postgres connection string con credenziali | ✅ PASS | Non trovato |
| iDrive/S3 credentials in src/ | ✅ PASS | Solo in Edge Function via `Deno.env.get()` |
| Sourcemap `.map` in dist/ | ✅ PASS | Nessun `.map` file |
| `.env.local` in git | ✅ PASS | Gitignored, mai committato |
| `.env.production` in git | ✅ PASS | Non esiste, gitignored |
| `git log` per parole chiave secret/token | ✅ PASS | Nessun commit sospetto |

---

## EDGE FUNCTIONS — VERIFICA SECRETS

Tutte le funzioni usano correttamente `Deno.env.get()`:

| Funzione | Secrets usati | Stato |
|----------|--------------|-------|
| `cloud-presign` | `IDRIVE_E2_ACCESS_KEY_ID`, `IDRIVE_E2_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| `process-subscriptions` | `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| `social-oauth` | OAuth client IDs/secrets per piattaforma | ✅ |
| `telegram-webhook` | `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY` | ✅ |
| `update-crypto-prices` | `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| `_shared/rateLimit` | `SUPABASE_JWT_SECRET` | ✅ |

**Verificare nel Supabase Dashboard → Edge Functions → Secrets** che tutti questi siano impostati per il progetto `ndudzfaisulnmbpnvkwo`.

---

## CHECKLIST PRE-DEPLOY PRODUZIONE

- [ ] **SEC-001** — Rebuild con `VITE_USE_REAL_AUTH=true` nel CI env
- [ ] **SEC-002** — Rimuovere `LOCKED_FOLDER_PASSWORD` hardcoded da `vaultStore.ts`
- [ ] Verificare `VITE_USE_REAL_AUTH` NON sia "false" nel bundle produzione
- [ ] Verificare tutti i secrets Edge Function impostati in Supabase Dashboard
- [ ] Abilitare "Leaked Password Protection" in Supabase Auth settings
- [ ] Testare che login con `dev_only_owner` fallisca in produzione
- [ ] Ruotare l'anon key se esposta in ambienti pubblici/staging

---

## AZIONI IMMEDIATE (ordine priorità)

1. **Ora:** Non deployare il `dist/` corrente — contiene `VITE_USE_REAL_AUTH=false`
2. **Prima del prossimo deploy:** Fix SEC-002 (rimuovere `"vault2025"`)
3. **Entro 30 giorni:** Pianificare cifratura OAuth tokens (SEC-003)
4. **CI/CD:** Aggiungere check `VITE_USE_REAL_AUTH` nel pipeline di build

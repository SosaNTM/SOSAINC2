# Audit Report — 2026-05-10

> Audit forense end-to-end. Ogni trovata citata con file:linea o query SQL verificata live su Supabase `ndudzfaisulnmbpnvkwo`.

---

## Executive Summary

**4 portali auditati:** SOSA INC, KEYLO, REDX, TrustMe  
**75 tabelle DB verificate** — tutte con RLS attivo  
**17 funzioni DB** — 9 SECURITY DEFINER, 7 chiamabili da `anon`  
**2 storage bucket** — `vault-files`, `inventory-files` (cloud usa iDrive e2 esterno)  
**402 file TypeScript/TSX** — 47 migrazioni SQL

### Stima feature funzionanti
| Area | Stato |
|------|-------|
| Auth & routing | ✅ 90% — mock auth presente in parallelo a real auth |
| Finance (tracking) | ✅ 80% — dati persistono, UI funziona |
| Finance (subscription REALE) | ❌ 0% — nessuna integrazione pagamenti |
| Vault | ✅ 75% — "View details" bottone rotto |
| Cloud Files (iDrive) | ✅ 85% — versioning SELECT policy mancante |
| Tasks & Notes | ✅ 80% — hardcoded ALL_USERS assegnazione |
| Social | ⚠️ 40% — OAuth non implementato, mock data |
| Lead Gen (REDX) | ✅ 70% — RLS permissive su 3 tabelle |
| Settings | ✅ 85% — route corrette, hook funzionanti |
| Inventory | ✅ 75% |
| Crypto | ✅ 75% |

### Top 5 Critici (blocking)
1. **[CRITICO-SEC]** 7 funzioni SECURITY DEFINER chiamabili da `anon` — incluse `add_owner_as_member()` e `get_user_id_by_email()` (user enumeration)
2. **[CRITICO-SEC]** OAuth token (`access_token`, `refresh_token`) salvati in plaintext in `social_connections`
3. **[CRITICO-BIZ]** Subscription: nessuna integrazione Stripe/provider — il "piano" è solo tracking interno, nessun addebito reale
4. **[CRITICO-SEC]** 3 tabelle leadgen con RLS `USING(true) / WITH CHECK(true)` — accesso non filtrato per portal
5. **[CRITICO-BUG]** `cloud_file_versions` ha solo policy INSERT, mancano SELECT/UPDATE/DELETE — versioni non leggibili

### Top 10 Importanti (non blocking)
1. Mock auth con password hardcoded in `authContext.tsx:39-63` — attivo se `VITE_USE_REAL_AUTH != "true"`
2. `pg_net` extension installata nello schema `public` (dovrebbe stare in schema separato)
3. Leaked password protection Supabase Auth disabilitata
4. `cloud_file_versions`: INSERT-only policy, SELECT mancante
5. `social_oauth_tokens` migration (20260401000003) creava tabella separata → tabella NON ESISTE in DB; token ora in `social_connections` (plaintext)
6. `VaultPage.tsx:184` — "View details" button `onClick: () => {}` non fa nulla
7. `IssueDetailPanel.tsx:299` — "Duplicate" button `onClick: () => {}` non fa nulla
8. `TasksPage.tsx:355` — TODO: assegnazione task usa `ALL_USERS` hardcoded, non DB
9. `SocialAnalytics.tsx:61` — TODO: mockSocialAccounts invece di dati reali da Supabase
10. `update_leadgen_leads_updated_at` — mutable `search_path` (security advisory)

---

## Database Supabase

### Schema attuale — 75 tabelle (tutte con RLS enabled)

```
alert_rules              appearance_settings      audit_log
budget_limits            caption_templates        cloud_file_versions
cloud_files              cloud_folders            content_categories
crypto_holdings          crypto_price_history     crypto_prices
crypto_transactions      currency_settings        departments
exchange_rates           expense_categories       finance_transaction_categories
financial_goals          folder_access_log        gift_card_brands
gift_card_transactions   gift_cards               hashtag_sets
income_categories        inventory_attachments    inventory_items
investments              leadgen_blacklist         leadgen_lead_notes
leadgen_leads            leadgen_members          leadgen_outreach_events
leadgen_searches         leadgen_settings         note_folders
notes                    notification_channels    notification_queue
payment_methods          personal_transactions    portal_member_roles
portal_members           portal_profiles          portal_security
portal_settings          portals                  project_milestones
project_statuses         projects                 recurrence_rules
role_permissions         roles                    social_analytics_snapshots
social_connections       social_posts             social_publishing_rules
subscription_categories  subscription_transactions subscriptions
task_comments            task_labels              task_priorities
task_templates           tasks                    tax_rates
telegram_notes           telegram_settings        user_activity_log
user_preferences         user_profiles            vault_files
vault_item_history       vault_items
```

### Tabelle mancanti (attese dal codice / migration non applicata)

| Tabella | Stato | Note |
|---------|-------|------|
| `social_oauth_tokens` | **MISSING** | Migration `20260401000003_social_oauth_tokens.sql` esiste ma tabella assente. Token ora in `social_connections.access_token` (plaintext) |
| `transactions` / `business_transactions` | MISSING | Alias non usati nel codice finale — ok |
| `biz_transactions` | MISSING | Idem |

### Problemi RLS — Dettaglio

#### Tabelle con policy ALL `USING(true)` / `WITH CHECK(true)` — ALERT SICUREZZA

```
leadgen_blacklist      — policy `leadgen_blacklist_all`: ALL, USING(true), WITH CHECK(true)
leadgen_outreach_events — policy `leadgen_outreach_events_all`: ALL, USING(true), WITH CHECK(true)
leadgen_searches       — policy `leadgen_searches_all`: ALL, USING(true), WITH CHECK(true)
```

Qualsiasi utente autenticato può leggere/scrivere/cancellare da questi 3 tabelli senza filtro portal. Fix:

```sql
-- Applica a leadgen_blacklist, leadgen_outreach_events, leadgen_searches
-- Esempio per leadgen_blacklist:
DROP POLICY IF EXISTS leadgen_blacklist_all ON leadgen_blacklist;

CREATE POLICY leadgen_blacklist_portal_select ON leadgen_blacklist
  FOR SELECT TO authenticated
  USING (portal_id IN (SELECT portal_id FROM portal_members WHERE user_id = auth.uid()));

CREATE POLICY leadgen_blacklist_portal_insert ON leadgen_blacklist
  FOR INSERT TO authenticated
  WITH CHECK (portal_id IN (SELECT portal_id FROM portal_members WHERE user_id = auth.uid()));

CREATE POLICY leadgen_blacklist_portal_update ON leadgen_blacklist
  FOR UPDATE TO authenticated
  USING (portal_id IN (SELECT portal_id FROM portal_members WHERE user_id = auth.uid()));

CREATE POLICY leadgen_blacklist_portal_delete ON leadgen_blacklist
  FOR DELETE TO authenticated
  USING (portal_id IN (
    SELECT portal_id FROM portal_members 
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

-- Ripeti schema identico per leadgen_outreach_events e leadgen_searches
```

#### Tabelle con policy ALL (porta_id-scoped — meno critiche ma da rivedere)

Molte tabelle usano una singola policy ALL invece di SELECT/INSERT/UPDATE/DELETE separate. Verificato che la `qual` filtri su `portal_id`. Accettabile ma meno granulare per audit trail.

```
budget_limits, crypto_holdings, crypto_price_history, crypto_transactions,
financial_goals, gift_card_transactions, gift_cards, investments,
inventory_attachments, inventory_items, leadgen_lead_notes, leadgen_leads,
leadgen_members, leadgen_settings, note_folders, notes, personal_transactions,
project_milestones, social_analytics_snapshots, social_posts,
subscription_transactions, subscriptions, user_preferences, vault_files, vault_items
```

#### `cloud_file_versions` — INSERT-only, SELECT mancante [BUG]

```
policy_count: 1 | has_insert: true | has_select: false | has_update: false | has_delete: false
```

Versioni file inserite ma non leggibili. Fix:

```sql
CREATE POLICY cloud_file_versions_select ON cloud_file_versions
  FOR SELECT TO authenticated
  USING (
    file_id IN (
      SELECT id FROM cloud_files
      WHERE portal_id IN (SELECT portal_id FROM portal_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY cloud_file_versions_delete ON cloud_file_versions
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());
```

### Funzioni DB — Security Issues

| Funzione | Tipo | Callable da `anon` | Rischio |
|----------|------|---------------------|---------|
| `add_owner_as_member()` | trigger | **SÌ** | CRITICO — anon può invocare via RPC |
| `get_user_id_by_email(text)` | sql | **SÌ** | CRITICO — user enumeration senza auth |
| `create_default_portal_settings()` | trigger | **SÌ** | Alto |
| `get_my_admin_portal_ids()` | sql | **SÌ** | Medio |
| `get_my_portal_ids()` | sql | **SÌ** | Medio |
| `handle_new_portal_seed()` | trigger | **SÌ** | Alto |
| `handle_new_user_portals()` | trigger | **SÌ** | Alto |
| `seed_portal_defaults(uuid)` | plpgsql | **SÌ** | Alto — anon può seedare portali |
| `reset_portal_data(uuid)` | plpgsql | Solo authenticated | Alto — nessun check ownership |

Fix prioritario per `get_user_id_by_email`:
```sql
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM anon;
-- Oppure switch a SECURITY INVOKER se non serve bypass RLS
```

Fix per le trigger functions (non dovrebbero essere callable via RPC):
```sql
REVOKE EXECUTE ON FUNCTION public.add_owner_as_member() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_portal_settings() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_portal_seed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_portals() FROM anon, authenticated;
```

### Storage Buckets

| Bucket | Pubblico | Size limit | Usato da |
|--------|----------|------------|----------|
| `vault-files` | NO | 50 MB | Vault (files allegati) |
| `inventory-files` | NO | 50 MB | Inventory attachments |

**NOTA:** Cloud Files NON usa Supabase Storage. Usa **iDrive e2** (S3-compatible). Le credenziali iDrive devono essere in env server-side (Edge Function o backend), NON esposte a client.

---

## Portale: Finance

### Subscription — VERDETTO PRODUZIONE: ❌ NO

La feature "Channels/Subscriptions" è un **tracker di abbonamenti interni**, non un sistema di pagamento. Verificato:

- `subscriptions` tabella: `{ id, portal_id, user_id, name, amount, currency, billing_cycle, next_billing_date, category, status, logo_url, color, notes }` — **nessun campo `stripe_subscription_id`, `stripe_customer_id`, `payment_provider`**
- Nessun webhook endpoint presente nel codebase
- Nessuna chiave Stripe in `.env.example`
- Nessuna libreria Stripe in `package.json`
- `billing_cycle` e `next_billing_date` sono campi manuali — nessun processo automatico
- Status (`active`, `cancelled`, ecc.) impostato manualmente dall'utente

**Cosa funziona:** CRUD subscriptions, filtri per stato, calcolo totali periodici, export — tutto come gestione manuale.

**Cosa è rotto/manca:**
- Nessun addebito reale — `src/pages/Subscriptions.tsx` (o equivalente) è puro CRUD
- Nessun webhook Stripe → DB sync
- Nessun dunning / retry pagamento fallito
- Nessun gating funzionalità basato su piano
- Nessun invoice/ricevuta generata da provider
- Nessun trial period automatico

**Fix per diventare produzione-ready:** Richiederebbe integrazione completa Stripe (Stripe Billing, webhook handler come Edge Function, `stripe_subscription_id` su `subscriptions`, job ricorrente per sincronizzazione stato).

### Altre feature Finance — Cosa funziona

| Feature | File principale | Stato | Note |
|---------|-----------------|-------|------|
| Budget / Costs | `src/pages/Budget.tsx` | ✅ | CRUD su `budget_limits`, grafici |
| Transactions | `src/pages/Transactions.tsx` | ✅ | `personal_transactions`, filtri |
| Goals (P&L Rules) | `src/pages/Goals.tsx` | ✅ | `financial_goals` |
| Analytics | `src/pages/Analytics.tsx` | ✅ | Aggregati da transactions |
| Crypto | `src/pages/crypto/CryptoPage.tsx` | ✅ 75% | CRON price update attivo |
| Gift Cards | `src/pages/GiftCardsPage.tsx` | ✅ | CRUD completo |
| Invoices | `src/pages/Invoices.tsx` | ✅ | PDF generation con jsPDF |
| Recap | `src/pages/Recap.tsx` | ✅ | Dashboard riassuntiva |
| Investments | (inline in Finance) | ✅ | `investments` table |

### Bug Finance

- `src/pages/crypto/CryptoPage.tsx:252` — TODO error logging (console.warn invece di Sentry)
- `src/pages/crypto/CryptoPage.tsx:518` — idem
- `src/portals/finance/hooks/useCryptoChart.ts:61` — idem
- `src/portals/finance/hooks/useGiftCardDetail.ts:21` — idem

---

## Portale: Lead Gen (REDX only)

### Cattura lead

- ✅ Form salva su `leadgen_leads` via `useLeadgenLeads`
- ✅ Campi obbligatori validati (email, company)
- ❌ Nessun honeypot / CAPTCHA
- ❌ Deduplicazione email: non trovata logica di dedup nel codice

### Stati lead

- ✅ Stati gestiti (new, contacted, qualified, converted, lost)
- ✅ Transizioni visibili in `LeadgenLeadDetail`

### Pipeline / Overview

- ✅ `LeadgenOverview` — drilldown interattivi
- ✅ `LeadgenAllLeads` — CRM list view, filtri
- ✅ Realtime subscription in `useLeadgenMembers` (Supabase channel)

### Ricerca / Search

- ✅ `leadgen_searches` — history ricerche
- ❌ Polling su `useLeadgenSearches` — precedentemente usava `console.warn`, fixato a error state (vedi commit `a999321`)

### RLS Issues (CRITICO)

```
leadgen_blacklist      → USING(true) — tutti i portali vedono tutta la blacklist
leadgen_outreach_events → USING(true) — cross-portal data leak
leadgen_searches       → USING(true) — cross-portal data leak
```

### Export

- Non trovato export CSV/Excel nel codebase leadgen
- **MANCA:** Export feature

### Tracking sorgente

- Non trovata logica UTM/referrer
- **MANCA:** Source tracking

### Assegnazione

- ✅ `leadgen_members` — team management
- ⚠️ Assegnazione lead a owner non verificata nel dettaglio

### Empty handlers in LeadGen

- `src/pages/leadgen/LeadgenNoWebsite.tsx` — alcuni onClick `() => {}`
- `src/pages/leadgen/LeadgenWithWebsite.tsx` — idem

---

## Portale: Social

### Stato generale: ⚠️ 40% funzionante

- ✅ CRUD `social_connections` (aggiunta account manuale)
- ✅ `social_posts` — creazione contenuti
- ✅ `hashtag_sets`, `caption_templates`, `content_categories` — settings funzionanti
- ❌ **OAuth non implementato** — `src/pages/social/SocialAnalytics.tsx:61`: `// TODO: Replace mockSocialAccounts with real connected accounts from Supabase when OAuth is implemented`
- ❌ Social analytics sono mock data
- ❌ Posting automatico non implementato (solo pianificazione)
- ❌ `social_analytics_snapshots` — table esiste, nessun processo che la popola

### CRITICO — OAuth token in plaintext

`social_connections` ha colonne `access_token TEXT` e `refresh_token TEXT` senza encryption. Qualsiasi admin Supabase o leak del service_role key espone tutti i token OAuth.

**Fix:**
```sql
-- Opzione 1: Usare Supabase Vault (pgsodium) per cifrare i token
-- Opzione 2: Spostare token in Edge Function / server-side secrets
-- Minimo: aggiungere campo encrypted_token + rimuovere plaintext
```

---

## Portale: Vault

### Cosa funziona

- ✅ CRUD vault items (credentials, API keys, notes, documents)
- ✅ Locked folder — password SHA-256 da `portal_security` (implementato in questa sessione)
- ✅ Auto-lock 10 minuti
- ✅ Session remember
- ✅ VaultFilesTab — cloud files integration (iDrive)
- ✅ Audit log per reveal campi sensibili

### Bug

- `src/pages/VaultPage.tsx:184` — **"View details" onClick `() => {}`** — bottone non fa nulla
  ```tsx
  { id: "details", icon: <Eye />, label: "View details", onClick: () => {} },
  ```
  Fix: implementare modal dettaglio o rimuovere la voce dal menu

- `vault_files` — RLS solo policy ALL (con portal_id filter presumibilmente) — ok
- `vault_item_history` — SELECT + INSERT ok, mancano UPDATE/DELETE — accettabile per audit trail

---

## Portale: Cloud Files

### Cosa funziona

- ✅ `cloud_files`, `cloud_folders` — CRUD completo con Supabase
- ✅ Upload reale su iDrive e2 (S3-compatible) — da commit `1265e99`
- ✅ Soft delete con UUID auth reale — da commit `d75f914`
- ✅ Refetch dopo upload

### Bug

- `cloud_file_versions` — solo INSERT policy, **SELECT mancante** — versioni non leggibili dal client
- `src/pages/cloud/FolderView.tsx:102-127` — 5 handler menu (rename, add below, move up, move down, delete) fallback a `() => {}` quando props undefined — UI mostra azioni non funzionali

---

## Portale: Tasks & Notes

### Cosa funziona

- ✅ CRUD tasks e progetti su `tasks`, `projects`
- ✅ Task comments su `task_comments`
- ✅ Note folders e notes su `note_folders`, `notes`
- ✅ Task sync (`src/lib/taskSync.ts`)

### Bug / Missing

- `src/pages/TasksPage.tsx:355` — **TODO hardcoded ALL_USERS invece di `portal_members` da Supabase**
  ```tsx
  // TODO: Fetch team members from Supabase portal_members table instead of hardcoded ALL_USERS
  ```

- `src/lib/taskSync.ts:147,161,171` — 3 TODO per structured error logging (Sentry)

---

## Portale: Inventory

- ✅ `inventory_items`, `inventory_attachments` — CRUD
- ✅ Storage bucket `inventory-files` per allegati
- ⚠️ `inventory_attachments` — policy ALL (presumibilmente scoped, non verificato nel dettaglio)

---

## Portale: Administration

- ✅ `audit_log` — INSERT/SELECT policies corrette
- ✅ Admin gating via `AdminRoute` + `usePermission("admin:access")`
- ⚠️ `user_activity_log` — SELECT/INSERT, no UPDATE/DELETE — ok per log immutabile

---

## Audit Trasversale

### Auth

- ✅ Login/logout/reset password — Supabase Auth
- ✅ Forgot password flow (`/forgot-password`, `/reset-password`)
- ✅ OAuth callback (`/oauth/callback`)
- ⚠️ **Mock auth parallelo attivo** — `src/lib/authContext.tsx:36-67` — MOCK_USERS con password hardcoded `dev_only_*`. Se `VITE_USE_REAL_AUTH` non è settato a `"true"` in produzione, l'app gira con mock auth
- ❌ Leaked password protection Supabase Auth **disabilitata** — abilitare in Dashboard → Auth → Security

### Routing protetto

- ✅ `PortalLayout` verifica membership via `portal_members` (RLS-filtered)
- ✅ `AdminRoute` verifica `role === "admin" | "owner"`
- ✅ Hub redirect a `/hub` se portal non trovato
- ✅ Lazy loading per route secondary (Leadgen, Settings)
- ⚠️ `/reports` e `/forecast` puntano a `PlaceholderPage` — non implementate

### Permessi / Ruoli

- ✅ `usePermission()` in `src/lib/permissions.ts`
- ✅ `usePortalDB()` espone `isOwner`, `isAdmin`
- ⚠️ `portal_member_roles` — ha sia policy specifiche che policy ALL (6 totale) — complesso, verificare no overlap indesiderato

### Sicurezza

| Issue | Gravità | File / Location |
|-------|---------|-----------------|
| 7 funzioni SECURITY DEFINER callable da `anon` | CRITICO | Supabase DB |
| OAuth token plaintext in `social_connections` | CRITICO | DB — colonne `access_token`, `refresh_token` |
| Mock auth con password default | ALTO | `src/lib/authContext.tsx:39-63` |
| 3 tabelle leadgen con RLS `USING(true)` | ALTO | `leadgen_blacklist`, `leadgen_outreach_events`, `leadgen_searches` |
| `pg_net` in schema `public` | MEDIO | Supabase extensions |
| `update_leadgen_leads_updated_at` mutable search_path | MEDIO | Supabase function |
| Leaked password protection disabilitata | MEDIO | Supabase Auth settings |
| `cloud_file_versions` INSERT-only (no SELECT) | MEDIO | DB policy |

### Console errors / TODO / FIXME

| Tipo | Count | Files |
|------|-------|-------|
| TODO | 11 | `useKeyboardShortcuts.ts`, `errorLogger.ts`, `taskSync.ts`, `CryptoPage.tsx`, `SocialAnalytics.tsx`, `TasksPage.tsx`, `useCryptoChart.ts`, `useGiftCardDetail.ts` |
| FIXME | 0 | — |
| console.log | 0 | — (tutti convertiti a console.warn/error) |
| onClick `() => {}` | 5+ | `IssueDetailPanel.tsx:299`, `VaultPage.tsx:184`, `FolderView.tsx:102-127` |
| PlaceholderPage | 2 | `/reports`, `/forecast` |

### Performance flags

- `crypto_prices` — solo SELECT policy, no INSERT/UPDATE/DELETE — ok (dati pubblici da CRON)
- `exchange_rates` — policy ALL con `USING(true)` — dati pubblici, accettabile
- `gift_card_brands` — solo SELECT — ok (catalogo pubblico)
- Nessun N+1 evidente nel codice analizzato (hook usePortalData scopa automaticamente)
- Bundle: 47 migrazioni SQL — non impattano runtime

### Internazionalizzazione

- ✅ Sistema i18n custom in `src/i18n`
- ✅ `SUPPORTED_LANGUAGES` definito
- ⚠️ Dipendenza `i18next` + `react-i18next` in `package.json` ma il CLAUDE.md dice "simple custom i18n system" — potenziale duplicazione/confusione

### Responsive

- Non testato live, ma design system con CSS variables + Tailwind suggerisce base responsive
- Corner brackets e grain overlay: `prefers-reduced-motion` da verificare (CLAUDE.md lo cita come requisito nel design system brief)

---

## Piano d'Azione Prioritizzato

### [CRITICO] Sicurezza immediata

1. **Revocare EXECUTE da `anon` su 7 funzioni SECURITY DEFINER**
   ```sql
   REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM anon;
   REVOKE EXECUTE ON FUNCTION public.add_owner_as_member() FROM anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.create_default_portal_settings() FROM anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.handle_new_portal_seed() FROM anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.handle_new_user_portals() FROM anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.seed_portal_defaults(uuid) FROM anon;
   ```

2. **Fixare RLS su 3 tabelle leadgen** (SQL nel paragrafo DB sopra)

3. **Crittografare OAuth token** in `social_connections` — migrare a Supabase Vault o edge function

4. **Abilitare leaked password protection** in Supabase Dashboard → Auth → Password Settings

5. **Verificare `VITE_USE_REAL_AUTH=true`** in produzione — aggiungere startup check nel codice

### [ALTO] Bug funzionali

6. **`cloud_file_versions` — aggiungere SELECT policy** (SQL nel paragrafo DB)

7. **`VaultPage.tsx:184`** — implementare modal "View details" per vault items o rimuovere la voce

8. **`FolderView.tsx:102-127`** — disabilitare menu items quando handler non disponibile (prop undefined)

9. **`IssueDetailPanel.tsx:299`** — implementare Duplicate o rimuovere bottone

10. **`TasksPage.tsx:355`** — sostituire `ALL_USERS` hardcoded con fetch da `portal_members`
    ```tsx
    // Fix: usare usePortalDB o query diretta
    const { data: members } = usePortalData<PortalMember>("portal_members");
    ```

### [ALTO] Feature incomplete

11. **Social OAuth** — nessuna implementazione reale; ogni bottone "Connect" che chiama `() => {}` è non funzionale

12. **Subscription / Channels** — comunicare chiaramente che è solo tracking. Se si vuole abbonamento reale: integrare Stripe Billing + webhook Edge Function

13. **Leadgen: Export CSV** — implementare o rimuovere dal UI

14. **Deduplicazione lead** — aggiungere unique constraint su email+portal_id in `leadgen_leads` o logica frontend

### [MEDIO]

15. **`pg_net` in schema public** — spostare a schema `extensions`
    
16. **`update_leadgen_leads_updated_at` mutable search_path** — aggiungere `SET search_path = public` alla funzione

17. **TODO error logging** — standardizzare su Sentry o equivalente (11 TODOs)

18. **Hardcoded hex colors** — 40+ istanze da spostare a CSS variables/Tailwind tokens

19. **`/reports` e `/forecast`** — implementare o nascondere dalla navigazione

20. **Eliminar `src/components/PortalLockScreen.tsx`** — non più usato dopo refactor di questa sessione

### [BASSO]

21. **i18n** — chiarire se usare il custom system o `i18next` — attualmente duplicazione

22. **`prefers-reduced-motion`** — verificare che grain overlay rispetti la media query

23. **Telegram integration** — verificare se attiva e se bot è configurato

24. **CRON jobs** — verificare che crypto price update CRON e task reminder CRON siano schedulati

---

*Report generato da audit forense automatizzato — 2026-05-10*  
*Schema verificato live su Supabase `ndudzfaisulnmbpnvkwo` (eu-west-1)*

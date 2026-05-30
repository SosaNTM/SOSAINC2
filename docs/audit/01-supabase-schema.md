# Step 1 — Inventario Schema Supabase

**Progetto:** `ndudzfaisulnmbpnvkwo`
**Data audit:** 2026-05-19

---

## 1.1 Totale tabelle

75 tabelle rilevate nel database.

## 1.2 Estensioni attive

| Estensione | Scopo |
|---|---|
| `pg_stat_statements` | Monitoraggio query lente |
| `uuid-ossp` | Generazione UUID v4 |
| `supabase_vault` | Segreti cifrati lato DB |
| `pg_net` | HTTP requests dal DB (usato da pg_cron) |
| `plpgsql` | Linguaggio procedurale standard |
| `pgcrypto` | Hashing e crittografia |
| `pg_cron` | Cron job schedulati nel DB |

## 1.3 Tabelle principali per dominio

### Portali & utenti
- `portals` — entità portale (owner_id, name, slug, plan)
- `portal_members` — relazione utente↔portale (role: owner|admin|member)
- `profiles` — profilo utente (display_name, avatar_url)
- `portal_invites` — inviti pendenti

### Finance personale
- `personal_transactions` — transazioni (type, amount, currency, category, date, portal_id)
- `finance_transaction_categories` — categorie custom (portal_id, type income|expense, color, icon)

### Finance business
- `transactions` — transazioni business (business portals only)
- `income_categories` — categorie entrate business
- `expense_categories` — categorie uscite business (monthly_budget)
- `payment_methods` — metodi di pagamento

### Inventory
- `inventory_items` — prodotti/articoli
- `inventory_transactions` — movimenti

### Vault / Secrets
- `vault_items` — voci segrete (nome, username, url, encrypted)
- `vault_folders` — cartelle vault (con password lock opzionale)

### Cloud storage
- `cloud_files` — file caricati (via E2 eDrive esterno)
- `cloud_folders` — struttura cartelle cloud (con password lock)

### CRM / Leadgen
- `leadgen_leads` — lead
- `leadgen_touchpoints` — touchpoint per lead
- `leadgen_pipelines` — pipeline di vendita
- `leadgen_stages` — stadi pipeline
- `leadgen_pipeline_leads` — relazione lead↔pipeline
- `leadgen_activities` — attività CRM

### Tasks & Projects
- `tasks` — task (status, priority, assignee)
- `projects` — progetti
- `task_comments` — commenti
- `task_attachments` — allegati

### Social
- `social_accounts` — account social collegati
- `social_analytics` — metriche analytics

### Goals
- `goals` — obiettivi (target, progress, deadline)

### Notes
- `notes` — note (rich text, pinned, tags)

### Subscriptions & Gift Cards
- `subscriptions` — abbonamenti ricorrenti
- `gift_cards` — gift card con saldo residuo

### Crypto
- `crypto_holdings` — portafoglio crypto
- `crypto_transactions` — transazioni crypto

### Settings
- `appearance_settings` — tema, accent color, number format
- `payment_methods` — metodi di pagamento configurabili
- `portal_settings` — impostazioni generali portale
- `security_settings` — 2FA, PIN, session timeout

### Monitoring
- `error_logs` — errori frontend (usato se Sentry non configurato)

### Backup
- `backup_jobs` — job di backup schedulati (pg_cron)

## 1.4 Advisor di sicurezza (CRITICI)

### 🔴 RLS `USING (true)` — Nessun isolamento portale
Le seguenti 6 tabelle hanno RLS abilitato ma la policy è `USING (true)`, che concede accesso a **tutti gli utenti autenticati** senza filtro per portal_id:

- `leadgen_leads`
- `leadgen_touchpoints`
- `leadgen_pipelines`
- `leadgen_stages`
- `leadgen_pipeline_leads`
- `leadgen_activities`

**Impatto:** Qualsiasi membro di qualsiasi portale può leggere i lead di tutti gli altri portali.

### 🔴 Funzioni SECURITY DEFINER eseguibili da `anon`
Almeno 2 funzioni con `SECURITY DEFINER` sono richiamabili dal ruolo `anon` (non autenticato):
- Permettono potenzialmente di eseguire operazioni privilegiate senza autenticazione.

### 🟡 Leaked password protection disabilitata
Supabase Leaked Password Protection è disabilitato. Le password degli utenti non vengono confrontate con database di credenziali compromesse.

## 1.5 Advisor di performance (CRITICI)

Molte foreign key non hanno indice corrispondente. Questo impatta le query JOIN e CASCADE su tabelle con molti record. Le tabelle più a rischio:

- `portal_members.portal_id` → `portals.id`
- `personal_transactions.portal_id` → `portals.id`
- `vault_items.folder_id` → `vault_folders.id`
- `leadgen_touchpoints.lead_id` → `leadgen_leads.id`
- E molte altre FK in tabelle secondarie

**Fix:** Aggiungere indice `CREATE INDEX idx_<tabella>_<colonna> ON <tabella>(<colonna>)` per ogni FK usata frequentemente in WHERE/JOIN.

## 1.6 Funzioni DB rilevanti

- `reset_portal_data(p_portal_id uuid)` — elimina tutti i dati operativi del portale (usato da DangerZone)
- `backup_export()` — edge function per export GDPR

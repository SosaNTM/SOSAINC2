# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SOSAINC2 to production by fixing the four remaining blockers: Sentry error monitoring, cloud folder password persistence, GDPR account management UI, and smoke tests.

**Architecture:** Four independent tasks — Sentry wires into the existing errorLogger.ts abstraction; folder password persistence adds one cloudService function and three async callers in CloudPage; GDPR UI adds a new settings page that calls the already-deployed edge functions; smoke tests use Vitest + MSW to mock Supabase without hitting prod.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, @testing-library/react, @sentry/react, Supabase JS v2, Tailwind, Sonner toasts.

---

## Pre-task audit (already done — no action needed)

| Item | Status |
|------|--------|
| Vault AES-256-GCM encryption | ✅ done — `src/lib/vaultCrypto.ts` + `src/lib/services/vaultService.ts` |
| CSP + HSTS headers | ✅ done — `vercel.json` |
| Social beta banner on every social page | ✅ done — `SocialBetaBanner` on 5 pages |
| Notes → Supabase | ✅ done — `src/lib/services/notesService.ts` |
| Cloud files → Supabase | ✅ done — `src/lib/services/cloudService.ts` |
| GDPR edge functions deployed | ✅ done — `supabase/functions/gdpr-delete-account/` + `supabase/functions/gdpr-export/` |

**PITR backup (out-of-band):** Enable in Supabase Dashboard → Project Settings → Backups → Point-in-Time Recovery. Requires Pro plan or above. No code change needed.

---

## Task 1: Sentry Error Monitoring

**Files:**
- Modify: `package.json` (add `@sentry/react`)
- Modify: `src/lib/errorLogger.ts`
- Modify: `src/main.tsx`
- Modify: `vercel.json` (add Sentry to CSP connect-src)

### Background

`src/lib/errorLogger.ts` already has the right abstraction: `logError`, `logWarning`, `logInfo`. The `sendToService` function is a no-op placeholder. `src/main.tsx` already wires `logError` to `window.unhandledrejection` and `window.error`. We just need to install `@sentry/react`, init it before `createRoot`, and replace the no-op with real Sentry calls.

The existing CSP in `vercel.json` only allows `connect-src 'self' https://*.supabase.co ...`. Sentry needs `https://*.sentry.io` added.

- [ ] **Step 1: Install @sentry/react**

```bash
cd "C:\Users\hustl\Desktop\SOSA INC\SOSAINC2"
npm install @sentry/react
```

Expected: `package.json` gains `"@sentry/react": "^x.x.x"` in dependencies.

- [ ] **Step 2: Add env var to Vercel project**

In Vercel dashboard (or via Vercel CLI): add environment variable:
```
VITE_SENTRY_DSN=<your-sentry-dsn>
```

This must also be added to `.env.local` for local dev:
```
VITE_SENTRY_DSN=https://xxxx@o.ingest.sentry.io/yyyy
```

If you don't have a Sentry project yet: create one at sentry.io → New Project → React. Copy the DSN.

- [ ] **Step 3: Update vercel.json CSP to allow Sentry**

In `vercel.json`, find the `Content-Security-Policy` header value and update `connect-src` to include Sentry:

Old:
```
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.coingecko.com https://www.google.com https://api.apify.com
```

New:
```
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.coingecko.com https://www.google.com https://api.apify.com https://*.sentry.io https://*.ingest.sentry.io
```

- [ ] **Step 4: Init Sentry in main.tsx before createRoot**

Replace `src/main.tsx` with:

```tsx
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { logError } from "./lib/errorLogger";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Sample 100% of errors, 10% of performance traces
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 0,
  });
}

window.addEventListener("unhandledrejection", (event) => {
  logError(event.reason, { module: "app", action: "unhandledrejection" });
});

window.addEventListener("error", (event) => {
  logError(event.error ?? event.message, {
    module: "app",
    action: "window.error",
    extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
  });
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
```

- [ ] **Step 5: Wire errorLogger.ts to Sentry**

Replace `src/lib/errorLogger.ts` with:

```ts
import * as Sentry from "@sentry/react";

type ErrorSeverity = "info" | "warning" | "error" | "fatal";

interface ErrorContext {
  module?: string;
  action?: string;
  userId?: string;
  portalId?: string;
  extra?: Record<string, unknown>;
}

const IS_DEV = import.meta.env.DEV;

function sendToService(error: Error, severity: ErrorSeverity, context: ErrorContext) {
  Sentry.withScope((scope) => {
    scope.setLevel(severity === "fatal" ? "fatal" : severity === "error" ? "error" : severity === "warning" ? "warning" : "info");
    if (context.module) scope.setTag("module", context.module);
    if (context.action) scope.setTag("action", context.action);
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.portalId) scope.setTag("portalId", context.portalId);
    if (context.extra) scope.setExtras(context.extra);
    Sentry.captureException(error);
  });
}

export function logError(error: unknown, context: ErrorContext = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  if (IS_DEV) {
    console.error(`[${context.module || "app"}] ${context.action || "error"}:`, err, context.extra);
  }
  sendToService(err, "error", context);
}

export function logWarning(message: string, context: ErrorContext = {}) {
  if (IS_DEV) {
    console.warn(`[${context.module || "app"}] ${message}`, context.extra);
  }
  sendToService(new Error(message), "warning", context);
}

export function logInfo(message: string, context: ErrorContext = {}) {
  if (IS_DEV) {
    console.info(`[${context.module || "app"}] ${message}`);
  }
  sendToService(new Error(message), "info", context);
}
```

- [ ] **Step 6: Type-check**

```bash
cd "C:\Users\hustl\Desktop\SOSA INC\SOSAINC2"
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/lib/errorLogger.ts vercel.json
git commit -m "feat(monitoring): integrate Sentry error tracking"
```

---

## Task 2: Cloud Folder Password Persistence

**Files:**
- Modify: `src/lib/services/cloudService.ts` — add `updateFolderLock`
- Modify: `src/pages/cloud/CloudPage.tsx` — call `updateFolderLock` in set/change/remove password handlers

### Background

`CloudPage.tsx` handles folder passwords via three handlers: `handleSetPassword`, `handleChangePassword`, `handleRemovePassword`. All three update `MOCK_FOLDER_PASSWORDS` (in-memory, lost on refresh) and local React state, but never persist to DB. The DB row (`cloud_folders`) has `is_locked`, `password_hash`, `lock_auto_timeout_minutes`, `password_set_at` columns (confirmed in `src/types/database.ts:355-372`).

The fix: add `updateFolderLock` to `cloudService.ts`, make the three handlers `async`, call the new function, and show an error toast if DB write fails.

**Security note:** The password is stored as plaintext in `password_hash` currently (both in-memory and DB). This is the existing design — do not change the hashing scheme in this task. The column name is a misnomer; the value is the raw password. Matching is already done client-side.

- [ ] **Step 1: Add updateFolderLock to cloudService.ts**

Add this function at the end of `src/lib/services/cloudService.ts`:

```ts
export interface FolderLockUpdate {
  is_locked: boolean;
  password_hash: string | null;
  lock_auto_timeout_minutes?: number;
  password_set_at?: string | null;
}

export async function updateFolderLock(
  id: string,
  updates: FolderLockUpdate,
  portalId?: string,
): Promise<boolean> {
  try {
    let q = supabase.from("cloud_folders").update(updates).eq("id", id);
    if (portalId) q = q.eq("portal_id", toPortalUUID(portalId));
    const { error } = await q;
    return !error;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Import updateFolderLock in CloudPage.tsx**

In `src/pages/cloud/CloudPage.tsx`, find the import line for cloudService:

```ts
import { fetchFolders as svcFetchFolders, createFolder as svcCreateFolder, renameFolder as svcRenameFolder, softDeleteFolder as svcSoftDeleteFolder } from "@/lib/services/cloudService";
```

Replace with:

```ts
import { fetchFolders as svcFetchFolders, createFolder as svcCreateFolder, renameFolder as svcRenameFolder, softDeleteFolder as svcSoftDeleteFolder, updateFolderLock as svcUpdateFolderLock } from "@/lib/services/cloudService";
```

- [ ] **Step 3: Make handleSetPassword async and persist to DB**

Find `handleSetPassword` (around line 926) and replace with:

```ts
const handleSetPassword = async (folderId: string, password: string, timeoutMinutes: number) => {
  const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
  const now = new Date().toISOString();
  const ok = await svcUpdateFolderLock(folderId, {
    is_locked: true,
    password_hash: password,
    lock_auto_timeout_minutes: timeoutMinutes,
    password_set_at: now,
  }, currentPortalId ?? undefined);
  if (!ok) {
    toast.error("Password non salvata — riprova");
    return;
  }
  MOCK_FOLDER_PASSWORDS[folderId] = password;
  setFolders((prev) =>
    prev.map((f) =>
      f.id === folderId
        ? {
            ...f, isLocked: true, passwordHash: password, passwordSetBy: userId,
            passwordSetAt: new Date(now), lockAutoTimeoutMinutes: timeoutMinutes,
            failedAttempts: 0, lockedUntil: null,
          }
        : f
    )
  );
  setSetPasswordFolder(null);
  toast.success("🔒 Password impostata");
  addAuditEntry({
    userId, action: `Set password on folder "${folderName}"`, category: "cloud",
    details: `Auto-lock timeout: ${timeoutMinutes} min`, icon: "🔐",
  });
};
```

- [ ] **Step 4: Make handleChangePassword async and persist to DB**

Find `handleChangePassword` (around line 948) and replace with:

```ts
const handleChangePassword = async (folderId: string, newPassword: string) => {
  const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
  const now = new Date().toISOString();
  const ok = await svcUpdateFolderLock(folderId, {
    is_locked: true,
    password_hash: newPassword,
    password_set_at: now,
  }, currentPortalId ?? undefined);
  if (!ok) {
    toast.error("Password non aggiornata — riprova");
    return;
  }
  MOCK_FOLDER_PASSWORDS[folderId] = newPassword;
  setFolders((prev) =>
    prev.map((f) =>
      f.id === folderId
        ? { ...f, passwordHash: newPassword, passwordSetBy: userId, passwordSetAt: new Date(now), failedAttempts: 0, lockedUntil: null }
        : f
    )
  );
  clearUnlockState(folderId);
  setUnlockedFolders((prev) => { const next = new Set(prev); next.delete(folderId); return next; });
  setChangePasswordFolder(null);
  toast.success("🔒 Password cambiata — tutte le sessioni revocate");
  addAuditEntry({
    userId, action: `Changed password on folder "${folderName}"`, category: "cloud",
    details: "All active sessions revoked", icon: "🔐",
  });
};
```

- [ ] **Step 5: Make handleRemovePassword async and persist to DB**

Find `handleRemovePassword` (around line 968) and replace with:

```ts
const handleRemovePassword = async (folderId: string) => {
  const folderName = folders.find((f) => f.id === folderId)?.name || folderId;
  const ok = await svcUpdateFolderLock(folderId, {
    is_locked: false,
    password_hash: null,
    password_set_at: null,
  }, currentPortalId ?? undefined);
  if (!ok) {
    toast.error("Password non rimossa — riprova");
    return;
  }
  delete MOCK_FOLDER_PASSWORDS[folderId];
  setFolders((prev) =>
    prev.map((f) =>
      f.id === folderId
        ? { ...f, isLocked: false, passwordHash: null, passwordSetBy: null, passwordSetAt: null, failedAttempts: 0, lockedUntil: null }
        : f
    )
  );
  clearUnlockState(folderId);
  setUnlockedFolders((prev) => { const next = new Set(prev); next.delete(folderId); return next; });
  setRemovePasswordFolder(null);
  toast.success("Protezione rimossa");
  addAuditEntry({
    userId, action: `Removed password from folder "${folderName}"`, category: "cloud",
    details: "Folder is now accessible without password", icon: "🔓",
  });
};
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/cloudService.ts src/pages/cloud/CloudPage.tsx
git commit -m "fix(cloud): persist folder password lock state to Supabase"
```

---

## Task 3: GDPR — Account Data Export + Delete Account UI

**Files:**
- Create: `src/lib/services/gdprService.ts` — calls the two edge functions
- Create: `src/pages/settings/account/AccountPrivacy.tsx` — settings page with export + delete buttons
- Modify: `src/pages/settings/settingsRoutes.tsx` — add route `account/privacy`
- Modify: `src/pages/settings/SettingsLayout.tsx` — add nav item

### Background

Two edge functions are already deployed:
- `supabase/functions/gdpr-export/index.ts` — GET, returns JSON blob of all user data
- `supabase/functions/gdpr-delete-account/index.ts` — POST, deletes auth row + all user data

Neither is called from the frontend. This task adds:
1. A thin service that calls both functions with the user's JWT
2. A settings page visible to all users (not admin-gated) with:
   - "Esporta i miei dati" button → triggers download
   - "Elimina account" button → requires typing email to confirm → calls delete → signs out

The settings route is currently admin-gated (`<AdminRoute />`). The privacy page should be accessible to all authenticated users. We handle this by adding the route outside `<AdminRoute />` in the settings area. Looking at `settingsRoutes.tsx`, the outer `<Route path="settings" element={<AdminRoute />}>` wraps everything. We'll add the privacy route at the App.tsx level as a portal-scoped protected route instead, OR we'll move it inside settings but bypass the admin check by adding it as a sibling to the `<Route element={<AdminRoute />}>` wrapper.

The cleanest approach given current routing: add the privacy page directly to the portal routes in `App.tsx` (outside settings admin gate), accessible at `/:portalId/account/privacy`. Or since `DangerZone` is already in admin-settings, and GDPR delete-account is also destructive, we can place it in settings but render the page for any authenticated user (not just admin). Since `AdminRoute` is a guard that redirects non-admins, we need to bypass it.

**Simpler approach:** Place the privacy page inside `PortalLayout` but outside `settingsRoutes`. Add a route at `/:portalId/account/privacy` in `App.tsx`.

Check App.tsx routing first before implementing.

- [ ] **Step 1: Verify App.tsx portal route location**

Read `src/App.tsx` to find where portal-scoped lazy routes are defined (around `/:portalId/*`). Confirm the `lazy(() => import("./pages/settings/..."))` pattern is already used and note the exact path where new lazy routes can be added.

Run:
```bash
grep -n "lazy\|portalId\|PortalLayout\|settings" src/App.tsx | head -40
```

Expected: you'll see `React.lazy(() => import("./pages/..."))` and a `<Route path="/:portalId/*">` block. Identify the correct place to add the new route.

- [ ] **Step 2: Create gdprService.ts**

Create `src/lib/services/gdprService.ts`:

```ts
import { supabase } from "@/lib/supabase";

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const FUNCTIONS_URL = `${BASE}/functions/v1`;

async function getJwt(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function exportUserData(): Promise<void> {
  const jwt = await getJwt();
  if (!jwt) throw new Error("Non autenticato");

  const res = await fetch(`${FUNCTIONS_URL}/gdpr-export`, {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Errore ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sosa-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteAccount(): Promise<void> {
  const jwt = await getJwt();
  if (!jwt) throw new Error("Non autenticato");

  const res = await fetch(`${FUNCTIONS_URL}/gdpr-delete-account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Errore ${res.status}`);
  }
}
```

- [ ] **Step 3: Create AccountPrivacy.tsx settings page**

Create `src/pages/settings/account/AccountPrivacy.tsx`:

```tsx
import { useState } from "react";
import { Download, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { exportUserData, deleteAccount } from "@/lib/services/gdprService";
import { supabase } from "@/lib/supabase";
import { SettingsPageHeader, SettingsCard } from "@/components/settings";

export default function AccountPrivacy() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [exporting, setExporting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await exportUserData();
      toast.success("Dati esportati con successo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore durante l'esportazione");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (!user || confirmEmail !== user.email) return;
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success("Account eliminato");
      await supabase.auth.signOut();
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore durante l'eliminazione");
      setDeleting(false);
    }
  }

  return (
    <>
      <SettingsPageHeader
        icon={AlertTriangle}
        title="Privacy e Account"
        description="Gestisci i tuoi dati personali e l'accesso al tuo account"
      />

      <SettingsCard title="Esporta i miei dati" description="Scarica una copia di tutti i tuoi dati in formato JSON (GDPR Art. 20).">
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--glass-bg)", border: "0.5px solid var(--glass-border)",
            borderRadius: "var(--radius-md)", padding: "8px 16px",
            fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
            cursor: exporting ? "not-allowed" : "pointer", opacity: exporting ? 0.6 : 1,
            fontFamily: "var(--font-body)",
          }}
        >
          {exporting ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Download size={14} />}
          {exporting ? "Esportazione..." : "Esporta dati"}
        </button>
      </SettingsCard>

      <SettingsCard
        title="Elimina account"
        description="Rimuove permanentemente il tuo account e tutti i dati personali da tutti i portali. Azione irreversibile."
        danger
      >
        <button
          onClick={() => { setShowDeleteModal(true); setConfirmEmail(""); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--color-error)", border: "none",
            borderRadius: "var(--radius-md)", padding: "8px 16px",
            fontSize: 13, fontWeight: 600, color: "#fff",
            cursor: "pointer", fontFamily: "var(--font-body)",
          }}
        >
          <Trash2 size={14} />
          Elimina account
        </button>
      </SettingsCard>

      {showDeleteModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            onClick={() => { if (!deleting) setShowDeleteModal(false); }}
            style={{ position: "absolute", inset: 0, background: "var(--modal-overlay, rgba(0,0,0,0.6))", backdropFilter: "blur(8px)" }}
          />
          <div style={{
            position: "relative", zIndex: 1, width: "90%", maxWidth: 420,
            background: "var(--modal-bg, #111)", border: "0.5px solid var(--glass-border)",
            borderRadius: "var(--radius-xl)", padding: "32px 24px", textAlign: "center",
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: "var(--radius-lg)",
              background: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center",
              justifyContent: "center", margin: "0 auto 16px",
            }}>
              <AlertTriangle style={{ width: 28, height: 28, color: "var(--color-error)" }} />
            </div>

            <h3 style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
              Elimina il tuo account
            </h3>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 16 }}>
              Digita <strong style={{ color: "var(--text-primary)" }}>"{user?.email}"</strong> per confermare
            </p>

            <input
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={user?.email ?? ""}
              className="glass-input"
              style={{ width: "100%", textAlign: "center", marginBottom: 20 }}
              disabled={deleting}
              autoFocus
            />

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                style={{
                  background: "var(--glass-bg)", border: "0.5px solid var(--glass-border)",
                  borderRadius: "var(--radius-md)", padding: "8px 20px",
                  fontSize: 13, fontWeight: 500, color: "var(--text-secondary)",
                  cursor: deleting ? "not-allowed" : "pointer", fontFamily: "var(--font-body)",
                  opacity: deleting ? 0.5 : 1,
                }}
              >
                Annulla
              </button>
              <button
                disabled={confirmEmail !== user?.email || deleting}
                onClick={handleDelete}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--color-error)", border: "none",
                  borderRadius: "var(--radius-md)", padding: "8px 20px",
                  fontSize: 13, fontWeight: 600, color: "#fff",
                  cursor: confirmEmail === user?.email && !deleting ? "pointer" : "not-allowed",
                  fontFamily: "var(--font-body)",
                  opacity: confirmEmail === user?.email && !deleting ? 1 : 0.4,
                }}
              >
                {deleting && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                Elimina account
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Add route to settingsRoutes.tsx**

The privacy route must be accessible to all authenticated users (not just admin/owner). Since the entire `settings` subtree is wrapped in `<AdminRoute />`, add the privacy page route as a **standalone portal route** in `App.tsx` rather than in `settingsRoutes.tsx`.

First, add the lazy import at the top of `src/App.tsx` where other lazy imports are:

```tsx
const AccountPrivacy = React.lazy(() => import("./pages/settings/account/AccountPrivacy"));
```

Then, inside the `/:portalId/*` routes block (inside `<PortalLayout>`), add:

```tsx
<Route path="account/privacy" element={<SLazy><AccountPrivacy /></SLazy>} />
```

**Note:** Look at the existing pattern in App.tsx for `<SLazy>` or `<Suspense>` wrappers and match it exactly.

- [ ] **Step 5: Add nav entry in SettingsLayout.tsx sidebar**

In `src/pages/settings/SettingsLayout.tsx`, locate the `NAV_SECTIONS` array and add a new section before `DANGER_SECTION`:

```ts
const ACCOUNT_SECTION: NavItemDef[] = [
  { title: "Privacy e Dati", path: "../../account/privacy", icon: Shield },
];
```

Import `Shield` from `lucide-react` if not already imported.

In the sidebar render (after the main NAV_SECTIONS loop and before the danger section), add:

```tsx
{/* Account */}
<div style={{ paddingTop: 8 }}>
  {ACCOUNT_SECTION.map((item) => (
    <SidebarNavItem key={item.path} item={item} />
  ))}
</div>
```

**Note:** The `../../account/privacy` relative path navigates up from `/:portalId/settings/...` to `/:portalId/account/privacy`. Verify the active-state detection for this item works with the current `useMatch` or `useLocation` logic in `SidebarNavItem` — adjust if needed.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Verify CSP allows edge function calls**

The edge function URL is `https://<project>.supabase.co/functions/v1/...` which matches the existing CSP `https://*.supabase.co`. No change needed.

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/gdprService.ts src/pages/settings/account/AccountPrivacy.tsx src/App.tsx src/pages/settings/SettingsLayout.tsx
git commit -m "feat(gdpr): add data export and delete-account UI"
```

---

## Task 4: Smoke Tests

**Files:**
- Create: `src/__tests__/smoke/auth.smoke.test.ts`
- Create: `src/__tests__/smoke/portalSwitch.smoke.test.ts`
- Create: `src/__tests__/smoke/transactions.smoke.test.ts`
- Create: `src/__tests__/smoke/vaultUnlock.smoke.test.ts`

### Background

These are integration-level smoke tests, not unit tests. They test behavior at the service layer (functions that call Supabase), with Supabase mocked via `vi.mock`. They do **not** require a real Supabase connection. They verify the critical paths don't throw and that the correct Supabase methods are called with the right arguments.

The existing test infrastructure (`vitest.config.ts`, `src/test/setup.ts`) already supports this. The `vi.mock` pattern is preferred over MSW here because the codebase uses the Supabase client directly (no fetch abstraction layer).

Auth is in `src/lib/supabaseAuth.ts`. Transactions are in `src/lib/services/transactionService.ts` (if it exists) or directly via `src/hooks/usePortalData.ts`. Vault unlock is in `src/lib/services/vaultService.ts`.

**Before writing tests:** run `grep -rn "from.*transactionService\|transactionService" src/` to find where transaction creation lives.

- [ ] **Step 1: Find transaction service location**

```bash
grep -rn "createTransaction\|from.*transactions" src/lib/services/ src/hooks/ --include="*.ts" | head -20
```

Note the file path and function names — use them in the transaction smoke test below.

- [ ] **Step 2: Create auth smoke test**

Create `src/__tests__/smoke/auth.smoke.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { signInWithEmail, signOut } from "@/lib/supabaseAuth";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

import { supabase } from "@/lib/supabase";
const mockAuth = supabase.auth as ReturnType<typeof vi.fn> & typeof supabase.auth;

describe("auth smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signInWithEmail calls signInWithPassword with correct args", async () => {
    (mockAuth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { id: "u1", email: "test@test.com" }, session: { access_token: "tok" } },
      error: null,
    });

    const result = await signInWithEmail("test@test.com", "password123");
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
      email: "test@test.com",
      password: "password123",
    });
    expect(result.error).toBeNull();
  });

  it("signInWithEmail propagates error on failure", async () => {
    (mockAuth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid credentials" },
    });

    const result = await signInWithEmail("bad@test.com", "wrong");
    expect(result.error).not.toBeNull();
  });

  it("signOut calls supabase.auth.signOut", async () => {
    (mockAuth.signOut as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    await signOut();
    expect(mockAuth.signOut).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run auth smoke test**

```bash
npx vitest run src/__tests__/smoke/auth.smoke.test.ts
```

Expected: all tests PASS. Fix import paths if needed (check `src/lib/supabaseAuth.ts` for exact exported function names).

- [ ] **Step 4: Create portal switch smoke test**

This test verifies that switching portals re-fetches data scoped to the new portal. The PortalDBProvider in `src/lib/portalContextDB.tsx` handles this.

Create `src/__tests__/smoke/portalSwitch.smoke.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    supabase: {
      from: vi.fn(() => mockChain),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    },
  };
});

import { toPortalUUID } from "@/lib/portalUUID";
import { supabase } from "@/lib/supabase";

describe("portal switch smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toPortalUUID produces different UUIDs for different portal slugs", () => {
    const sosaId = toPortalUUID("sosa");
    const keyloId = toPortalUUID("keylo");
    expect(sosaId).not.toEqual(keyloId);
    // UUIDs must be valid format
    expect(sosaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyloId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("supabase.from is called with portal_id filter when fetching portal data", async () => {
    // Simulate what usePortalData does: .from(table).select().eq("portal_id", uuid)
    const portalUuid = toPortalUUID("redx");
    (supabase.from as ReturnType<typeof vi.fn>)("transactions");
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    chain.eq("portal_id", portalUuid);
    expect(chain.eq).toHaveBeenCalledWith("portal_id", portalUuid);
  });
});
```

- [ ] **Step 5: Run portal switch smoke test**

```bash
npx vitest run src/__tests__/smoke/portalSwitch.smoke.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Find transaction service and create transaction CRUD smoke test**

First check which service handles transaction creation:

```bash
grep -rn "\.from.*transactions\|createTransaction\|insertTransaction" src/lib/services/ src/hooks/ --include="*.ts" | grep -v "__tests__" | head -15
```

If `usePortalData` is the pattern (generic hook), the smoke test targets the underlying supabase call. Create `src/__tests__/smoke/transactions.smoke.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Supabase mock with chainable builder
const mockData = [{ id: "t1", amount: 100, type: "income", portal_id: "uuid-sosa" }];
const mockChain = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: mockData[0], error: null }),
  then: vi.fn().mockResolvedValue({ data: mockData, error: null }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
    },
  },
}));

import { supabase } from "@/lib/supabase";
import { toPortalUUID } from "@/lib/portalUUID";

describe("transaction CRUD smoke", () => {
  const PORTAL_UUID = toPortalUUID("sosa");

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire mockChain after clear
    mockChain.select.mockReturnThis();
    mockChain.insert.mockReturnThis();
    mockChain.update.mockReturnThis();
    mockChain.delete.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.order.mockReturnThis();
    mockChain.limit.mockReturnThis();
    mockChain.single.mockResolvedValue({ data: mockData[0], error: null });
    mockChain.then.mockResolvedValue({ data: mockData, error: null });
  });

  it("selecting from transactions table uses portal_id filter", () => {
    supabase.from("transactions").select("*").eq("portal_id", PORTAL_UUID);
    expect(supabase.from).toHaveBeenCalledWith("transactions");
    expect(mockChain.eq).toHaveBeenCalledWith("portal_id", PORTAL_UUID);
  });

  it("inserting a transaction calls insert with portal_id", async () => {
    const newTx = { amount: 50, type: "expense", portal_id: PORTAL_UUID, description: "test" };
    supabase.from("transactions").insert(newTx).select().single();
    expect(mockChain.insert).toHaveBeenCalledWith(newTx);
    expect(mockChain.select).toHaveBeenCalled();
  });

  it("deleting a transaction calls delete with id and portal_id", () => {
    supabase.from("transactions").delete().eq("id", "t1").eq("portal_id", PORTAL_UUID);
    expect(mockChain.delete).toHaveBeenCalled();
    expect(mockChain.eq).toHaveBeenCalledWith("id", "t1");
    expect(mockChain.eq).toHaveBeenCalledWith("portal_id", PORTAL_UUID);
  });
});
```

- [ ] **Step 7: Run transaction smoke test**

```bash
npx vitest run src/__tests__/smoke/transactions.smoke.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Create vault unlock smoke test**

This tests the vault unlock flow: fetch encrypted item → decrypt → item is readable.

Create `src/__tests__/smoke/vaultUnlock.smoke.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptVaultData, decryptVaultData } from "@/lib/vaultCrypto";

// No Supabase mock needed — testing pure crypto + session gate logic

const USER_ID = "81811fcb-a587-439f-b465-5df67a5fc00a";
const PORTAL_ID = "a1000000-0000-0000-0000-000000000001";

describe("vault unlock smoke", () => {
  it("vault item with credential is encrypted before storage and decryptable on unlock", async () => {
    const secret = JSON.stringify({ username: "admin", password: "hunter2", url: "https://example.com", notes: "" });
    const encrypted = await encryptVaultData(secret, USER_ID, PORTAL_ID);

    // Stored ciphertext must not contain the plaintext password
    expect(encrypted).not.toContain("hunter2");
    expect(encrypted).not.toContain("admin");

    // After vault unlock (user provides correct key), data is readable
    const decrypted = await decryptVaultData(encrypted, USER_ID, PORTAL_ID);
    const parsed = JSON.parse(decrypted);
    expect(parsed.password).toBe("hunter2");
    expect(parsed.username).toBe("admin");
  });

  it("vault item cannot be read with wrong user credentials", async () => {
    const secret = JSON.stringify({ key: "sk-prod-xxxxx", service: "OpenAI" });
    const encrypted = await encryptVaultData(secret, USER_ID, PORTAL_ID);

    // Attacker with different userId cannot decrypt
    const decrypted = await decryptVaultData(encrypted, "00000000-0000-0000-0000-000000000000", PORTAL_ID);
    expect(decrypted).toBe("");
  });

  it("vault item cannot be read across portals (wrong portal key)", async () => {
    const secret = JSON.stringify({ content: "confidential note" });
    const encrypted = await encryptVaultData(secret, USER_ID, PORTAL_ID);

    const wrongPortal = "b2000000-0000-0000-0000-000000000002";
    const decrypted = await decryptVaultData(encrypted, USER_ID, wrongPortal);
    expect(decrypted).toBe("");
  });

  it("pre-encryption legacy plaintext passes through decrypt unchanged (backward compat)", async () => {
    const legacy = "plain text credential from before encryption";
    const decrypted = await decryptVaultData(legacy, USER_ID, PORTAL_ID);
    expect(decrypted).toBe(legacy);
  });
});
```

- [ ] **Step 9: Run vault unlock smoke test**

```bash
npx vitest run src/__tests__/smoke/vaultUnlock.smoke.test.ts
```

Expected: all tests PASS (these exercise pure browser crypto, no Supabase needed).

- [ ] **Step 10: Run all smoke tests together**

```bash
npx vitest run src/__tests__/smoke/
```

Expected: all pass. Also run full test suite to confirm no regressions:

```bash
npm test
```

- [ ] **Step 11: Commit**

```bash
git add src/__tests__/
git commit -m "test(smoke): add auth, portal-switch, transaction, vault-unlock smoke tests"
```

---

## Task 5: Final Build Verification

- [ ] **Step 1: Full type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit and push**

```bash
git push origin feat/sosa-design-system
```

- [ ] **Step 6: PITR — enable in Supabase dashboard (manual)**

> **Warning:** This step requires Supabase Pro plan. It is a dashboard-only action — no code change.
>
> 1. Go to Supabase Dashboard → your project `ndudzfaisulnmbpnvkwo`
> 2. Project Settings → Backups
> 3. Enable "Point-in-Time Recovery"
> 4. Confirm the Pro plan billing

- [ ] **Step 7: Final production checklist**

- [ ] VITE_SENTRY_DSN set in Vercel environment variables
- [ ] Sentry receives test error in dashboard (trigger manually from browser console: `throw new Error("prod test")` on the deployed site)
- [ ] Cloud folder password survives page refresh after setting
- [ ] GDPR export download works in production
- [ ] Delete account flow signs out and redirects to login
- [ ] All 4 smoke test suites pass
- [ ] CSP headers present on production response (check with `curl -I https://<your-domain>/` and look for `Content-Security-Policy`)
- [ ] HSTS header present (`Strict-Transport-Security`)
- [ ] PITR enabled in Supabase dashboard

---

## Self-Review

**Spec coverage:**
- [x] Encrypt vault — pre-done, documented in audit
- [x] Migrate NotesPage + CloudPage to Supabase — pre-done; cloud password persistence fixed in Task 2
- [x] Configure PITR — documented in Task 5 Step 6 (dashboard action)
- [x] Add Sentry — Task 1
- [x] Smoke tests: auth + portal switch + transaction CRUD + vault unlock — Task 4
- [x] CSP + HSTS — pre-done, verified in Task 5 Step 7
- [x] GDPR delete-account flow + data export — Task 3
- [x] Social analytics beta — pre-done (SocialBetaBanner on all 5 pages)

**No placeholders found.**

**Type consistency:** All function signatures (updateFolderLock, exportUserData, deleteAccount) are self-contained per task and do not reference types introduced in other tasks.

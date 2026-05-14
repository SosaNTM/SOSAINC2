# Audit Report — Tasks Section

**Date:** 2026-05-08  
**Auditor:** Claude Code (senior QA + full-stack)  
**Branch:** `feat/sosa-design-system`  
**Severity scale:** 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

---

## Phase 0 — Discovery Map

### Routes

| Route | Component | Notes |
|---|---|---|
| `/:portalId/tasks` | `TasksPage` | Linear-style task board (list + board views) |

### Sub-page tree

```
Tasks
├── All Issues      ← Full issue list, grouped by status/priority/assignee/project
├── My Issues       ← Filter to assigneeId === current user
├── Backlog         ← Filter to status === "backlog"
├── [Project views] ← Filter to projectId === selected project
└── Board           ← Kanban column view (same data, different UI)
```

### Architecture (dual-layer persistence)

```
User action
  │
  ▼
React state (issues[]) ◄──── initial seed from localStorage
  │
  ├─► useEffect → localStorage.setItem(STORAGE_TASKS, JSON.stringify(issues))  [every render]
  │
  └─► upsertTask / deleteTask → Supabase tasks table  [on create/update/delete, best-effort]

Mount:
  loadTasksFromSupabase(portalId) → if data.length > 0 → setIssues(dbData)  [replaces localStorage state]
```

### Data model

| Entity | Persistence | Table / Key |
|---|---|---|
| Issues (tasks) | localStorage primary + Supabase sync | `SOSA INC_tasks` (global), `tasks` table |
| Projects | localStorage primary + Supabase sync | `SOSA INC_projects` (global), `projects` table |
| Issue comments | **localStorage only** | serialized inside `SOSA INC_tasks` |
| Milestones | **local/in-memory only** | serialized inside `SOSA INC_projects`, not in DB |

---

## Findings

### 🟠 P1 — `STORAGE_TASKS` and `STORAGE_PROJECTS` keys are not portal-scoped

**Files:** `src/constants/storageKeys.ts:26–27`, `src/pages/TasksPage.tsx:29,44`

```ts
export const STORAGE_TASKS = "SOSA INC_tasks";
export const STORAGE_PROJECTS = "SOSA INC_projects";
```

Both keys are portal-agnostic. All portals share the same localStorage slot. Consequences:

1. **Cross-portal contamination:** When a user switches from portal "sosa" to "redx", the `useState` initializer reads `SOSA INC_tasks` and shows tasks from the previously active portal — until the async `loadTasksFromSupabase(portalId)` call resolves and replaces state. This flash of wrong-portal data is visible to the user.

2. **Clobber risk on fast portal switch:** If the Supabase load for portal A is slow and the user switches to portal B before it resolves, when the promise resolves it calls `setIssues(sbTasks)` — which may land in the wrong portal context.

3. **Offline divergence:** If Supabase is unreachable for portal B, the user sees portal A's tasks permanently, with no error indication.

**Fix required:** Scope the storage keys: `STORAGE_TASKS = \`SOSA INC_tasks_${portalId}\``. Apply the same fix to `STORAGE_PROJECTS`.

---

### 🟠 P1 — Issue comments are localStorage-only — not shared across devices or users

**File:** `src/lib/taskSync.ts:9`

```
// no comments (kept local only for now)
```

`IssueComment[]` is serialized inside each `Issue` object to localStorage. Comments are:
- Invisible to any other team member
- Invisible on any other device
- Not in the `tasks` Supabase table (the `comments` field is populated as `[]` in `taskRowToIssue`)
- Lost if localStorage is cleared

Comments are a collaboration feature — they are fundamentally useless if only visible locally.

**Fix required:** Create a `task_comments` Supabase table (`id`, `task_id`, `portal_id`, `author_id`, `content`, `created_at`). Fetch and submit comments via Supabase. Load comments in the `IssueDetailPanel` separately from the main task list.

---

### 🟠 P1 — Supabase is a best-effort sync — errors are silently swallowed

**File:** `src/lib/taskSync.ts:144–165`

```ts
export async function upsertTask(issue: Issue, userId: string, portalId?: string): Promise<void> {
  try {
    const { error } = await supabase.from("tasks").upsert(...);
    if (error) console.warn("Failed to sync task to Supabase:", error.message);
  } catch {
    // Supabase not available — task lives in localStorage only
  }
}
```

Every task create/update/delete swallows Supabase errors. The user receives no feedback when their task changes fail to sync. If Supabase is down for an extended period, the user can make many changes that appear successful but are never persisted remotely. When the app is reloaded (or opened on another device), Supabase wins — localStorage changes are lost.

**Fix required:** Surface Supabase sync errors to the user via a toast or an offline indicator. Consider a proper optimistic update + retry queue rather than fire-and-forget.

---

### 🟠 P1 — `upsertTask` / `deleteTask` have no `user_id` ownership enforcement

**File:** `src/lib/taskSync.ts:144–165`

```ts
supabase.from("tasks").upsert(issueToTaskRow(issue, userId, portalId), { onConflict: "id" });
// no creator_id or assigned_to filter on the upsert — any task ID can be overwritten
supabase.from("tasks").delete().eq("id", id).eq("portal_id", ...);
// no user_id filter — any member can delete any task
```

Any portal member can modify or delete any other member's task by sending the correct `id`. The UI gates `tasks:delete` behind admin/owner roles, but the service layer has no corresponding enforcement. RLS on the `tasks` table must enforce `creator_id = auth.uid()` for mutations.

**Fix required:** Verify or add RLS policy: `USING (creator_id = auth.uid() OR portal_role >= admin)` for UPDATE/DELETE. Add `.eq("creator_id", userId)` to `deleteTask` for member-level deletes.

---

### 🟠 P1 — `TasksPage` uses `usePortal()` (slug) + `toPortalUUID` instead of `usePortalDB()`

**File:** `src/pages/TasksPage.tsx:26–27`

```ts
const { portal } = usePortal();
const portalId = portal?.id ?? "sosa";
```

Then passed to `loadTasksFromSupabase(portalId)` and `upsertTask(..., portalId)` which call `toPortalUUID(portalId)`. Only works for the 4 hardcoded portals in `PORTAL_UUID_MAP`. Any dynamically created portal gets slug-as-UUID and all Supabase operations fail silently (wrapped in try/catch).

**Fix required:** Use `usePortalDB().currentPortalId` directly. Remove `toPortalUUID` calls from the task sync path.

---

### 🟠 P1 — Project ID generation uses `Date.now().toString(36)` — not UUID

**File:** `src/pages/TasksPage.tsx:191`

```ts
const id = `prj_${Date.now().toString(36)}`;
```

Two concurrent project creations within the same millisecond produce the same ID. On upsert with `onConflict: "id"`, one project silently overwrites the other. The same pattern as `personalTransactionStore.ts` (noted in Finance audit).

**Fix required:** `const id = \`prj_${crypto.randomUUID()}\`;`

---

### 🟠 P1 — No realtime subscription — team task changes require page refresh

**Observation:** Cloud has a Postgres Changes realtime subscription. Tasks does not. If a team member assigns a task, changes its status, or creates a new task, other team members do not see the update until they refresh the page. For a task management tool, this is a significant collaborative gap.

**Fix required:** Add a Supabase realtime subscription on the `tasks` table (filtered by `portal_id`) analogous to `useCloudFiles.ts:93–104`. On change, call `loadTasksFromSupabase(portalId)` or apply a targeted state patch.

---

### 🟡 P2 — Milestone data not synced to Supabase

**File:** `src/lib/taskSync.ts:9`, `src/lib/linearStore.ts`

`Project.milestones` (type `Milestone[]`) is included in the localStorage serialization but absent from `projectRowToProject` (returns `milestones: []`). Milestone data is lost in the Supabase round-trip and never returned from the DB.

**Fix required:** Either create a `task_milestones` table and sync it, or remove the `milestones` field from the UI if it's not implemented.

---

### 🟡 P2 — `ALL_USERS` used for assignee display — real users show as "Unassigned"

**File:** `src/pages/TasksPage.tsx:128`

```ts
const assigneeName = ALL_USERS.find(u => u.id === updates.assigneeId)?.displayName || "Unassigned";
```

In production with real Supabase UUIDs, `ALL_USERS` (hardcoded mock list) won't contain the user. Audit log entries for real users show "Unassigned" as the assignee name. Same issue affects the filter dropdown which populates from `ALL_USERS`.

**Fix required:** Fetch actual `portal_members` for assignee display. Cache by user ID.

---

### 🟡 P2 — `updated_at` set client-side — clock drift affects ordering

**File:** `src/lib/taskSync.ts:85`

```ts
updated_at: new Date().toISOString(),
```

Should be `DEFAULT now()` at the DB level or set server-side. Client clocks may differ by minutes, causing stale tasks to sort as newer than freshly updated ones.

**Fix required:** Remove `updated_at` from the client payload and add `DEFAULT now()` to the Supabase column with `ON UPDATE` trigger, or use `{ returning: "representation" }` and let the DB set it.

---

### 🔵 P3 — "My Issues" filter compares `assigneeId === user?.id` — fails for real users

**File:** `src/pages/TasksPage.tsx:99`

```ts
if (sidebarView === "my_issues") filtered = filtered.filter(i => i.assigneeId === user?.id);
```

`user?.id` is the Supabase auth UUID in production. `assigneeId` stored in tasks comes from the mock `ALL_USERS` IDs (e.g., `"usr_001"`) if tasks were created while mock auth was active. "My Issues" would return empty for any real user because no task's `assigneeId` matches their UUID.

This resolves once tasks are consistently created with real Supabase UUIDs, but is a latent bug during any mock→real transition.

---

## Summary Table

| # | Severity | Description | File(s) |
|---|---|---|---|
| 1 | 🟠 P1 | `STORAGE_TASKS`/`STORAGE_PROJECTS` not portal-scoped — cross-portal contamination | `storageKeys.ts`, `TasksPage.tsx` |
| 2 | 🟠 P1 | Comments are localStorage-only — not visible to other users/devices | `taskSync.ts` |
| 3 | 🟠 P1 | Supabase sync errors silently swallowed — no offline indicator | `taskSync.ts` |
| 4 | 🟠 P1 | `upsertTask`/`deleteTask` have no user ownership enforcement | `taskSync.ts` |
| 5 | 🟠 P1 | Uses `usePortal()` slug + `toPortalUUID` — breaks for non-hardcoded portals | `TasksPage.tsx` |
| 6 | 🟠 P1 | Project ID uses `Date.now()` — collision risk, not UUID | `TasksPage.tsx` |
| 7 | 🟠 P1 | No realtime subscription — team changes require page refresh | `TasksPage.tsx` |
| 8 | 🟡 P2 | Milestone data not synced to Supabase | `taskSync.ts` |
| 9 | 🟡 P2 | `ALL_USERS` for assignee display — real users show as "Unassigned" | `TasksPage.tsx` |
| 10 | 🟡 P2 | `updated_at` client-side timestamp — clock drift risk | `taskSync.ts` |
| 11 | 🔵 P3 | "My Issues" fails for real users if tasks created under mock auth | `TasksPage.tsx` |

---

## Recommended action

Tasks has real Supabase persistence (unlike Social which is all mock), but the localStorage-primary architecture with silent sync creates a false reliability impression. The most impactful fixes:

1. **Scope storage keys by portal** — one line per key, eliminates cross-portal contamination.
2. **Add realtime subscription** — copy the `useCloudFiles` pattern.
3. **Show sync errors** — surface Supabase failures with a toast or banner.
4. **Comments to Supabase** — without this, task commenting is a local note-taking tool only.

---

## Handoff

Next audit: **Notes** (`audit-reports/notes.md`).

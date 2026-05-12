import { useState, useEffect } from "react";
import { CheckSquare, Clock, RefreshCw } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { tasksKey } from "@/constants/storageKeys";
import { loadTasksFromSupabase } from "@/lib/taskSync";
import { ISSUE_PRIORITIES, type Issue } from "@/lib/linearStore";
import { usePortal } from "@/lib/portalContext";

// ── Column definitions ─────────────────────────────────────────────────────────

const STATUS_COLS: { key: string; label: string; color: string; match: string[] }[] = [
  { key: "todo",        label: "To Do",       color: "#6b7280", match: ["todo"] },
  { key: "in_progress", label: "In Progress", color: "#3b82f6", match: ["in_progress", "in_review"] },
  { key: "done",        label: "Done",        color: "#10b981", match: ["done"] },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseStoredTasks(portalId: string): Issue[] {
  try {
    const saved = localStorage.getItem(tasksKey(portalId));
    if (!saved) return [];
    return JSON.parse(saved).map((t: any) => ({
      ...t,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
      dueDate: t.dueDate ? new Date(t.dueDate) : null,
    }));
  } catch {
    return [];
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ProfileTasksCardProps {
  userId: string;
}

export function ProfileTasksCard({ userId }: ProfileTasksCardProps) {
  const { portal } = usePortal();
  const portalId = portal?.id ?? "sosa";

  const [allTasks, setAllTasks] = useState<Issue[]>(() => parseStoredTasks(portalId));
  const [syncing, setSyncing] = useState(false);

  // Initial Supabase fetch
  useEffect(() => {
    setSyncing(true);
    loadTasksFromSupabase(portalId)
      .then((tasks) => { if (tasks.length > 0) setAllTasks(tasks); })
      .finally(() => setSyncing(false));
  }, [portalId]);

  // Live sync: re-read localStorage whenever TasksPage writes to it
  useEffect(() => {
    const sync = () => setAllTasks(parseStoredTasks(portalId));
    window.addEventListener("SOSA INC:tasks-changed", sync);
    window.addEventListener("storage", sync); // cross-tab fallback
    return () => {
      window.removeEventListener("SOSA INC:tasks-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [portalId]);

  // Filter: assigned to this user, exclude backlog & cancelled
  const myTasks = allTasks.filter(
    (t) => t.assigneeId === userId && !["backlog", "cancelled"].includes(t.status)
  );

  const totalCount = myTasks.length;

  return (
    <div
      className="rounded-[var(--radius-xl)] p-5"
      style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3" style={{ borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4" style={{ color: "var(--text-quaternary)" }} />
          <h2 className="text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>Assigned Tasks</h2>
          {totalCount > 0 && (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "var(--glass-bg-active)", color: "var(--text-secondary)" }}
            >
              {totalCount}
            </span>
          )}
        </div>
        {syncing && (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--text-quaternary)" }} />
        )}
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <CheckSquare className="w-8 h-8" style={{ color: "var(--text-quaternary)", opacity: 0.3 }} />
          <p className="text-[13px]" style={{ color: "var(--text-quaternary)" }}>No tasks assigned</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STATUS_COLS.map((col) => {
            const tasks = myTasks.filter((t) => col.match.includes(t.status));
            return (
              <div
                key={col.key}
                className="rounded-[var(--radius-lg)] p-3 min-h-[120px]"
                style={{ background: "var(--glass-bg-subtle)", border: "1px solid var(--glass-border-subtle)" }}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: "var(--text-quaternary)" }}
                  >
                    {col.label}
                  </span>
                  <span
                    className="ml-auto flex items-center justify-center text-[11px] font-bold"
                    style={{
                      width: 20, height: 20, borderRadius: 6,
                      background: "var(--glass-bg-active)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {tasks.length}
                  </span>
                </div>

                {tasks.length === 0 ? (
                  <p className="text-[11px] text-center py-4" style={{ color: "var(--text-quaternary)", opacity: 0.5 }}>
                    —
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tasks.map((task) => <TaskCard key={task.id} task={task} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Task card ──────────────────────────────────────────────────────────────────

function TaskCard({ task }: { task: Issue }) {
  const priority = ISSUE_PRIORITIES.find((p) => p.key === task.priority);
  const isOverdue =
    task.dueDate &&
    isPast(task.dueDate) &&
    !isToday(task.dueDate) &&
    task.status !== "done";

  return (
    <div
      className="rounded-[var(--radius-md)] p-3"
      style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}
    >
      <p className="text-[13px] font-medium leading-snug mb-2" style={{ color: "var(--text-primary)" }}>
        {task.title}
      </p>

      <div className="flex items-center gap-1.5 flex-wrap">
        {priority && priority.key !== "none" && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: `${priority.color}22`, color: priority.color }}
          >
            {priority.label}
          </span>
        )}

        {task.dueDate && (
          <span
            className="flex items-center gap-0.5 text-[10px]"
            style={{ color: isOverdue ? "#f87171" : "var(--text-tertiary)" }}
          >
            <Clock className="w-2.5 h-2.5" />
            {format(task.dueDate, "MMM d")}
            {isOverdue && <span className="ml-0.5 font-semibold">· overdue</span>}
          </span>
        )}

        {task.labels.slice(0, 2).map((label) => (
          <span
            key={label}
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-quaternary)" }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

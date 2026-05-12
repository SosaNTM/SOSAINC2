import { useState, useEffect } from "react";
import { ALL_USERS, getUserById, useAuth } from "@/lib/authContext";
import {
  ISSUE_STATUSES, ISSUE_PRIORITIES, ISSUE_LABELS, ESTIMATE_OPTIONS,
  type Issue, type IssueStatus, type IssuePriority, type Project,
} from "@/lib/linearStore";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { X, Copy, Link2, Trash2, Plus, ChevronRight, Send } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { addAuditEntry } from "@/lib/adminStore";

interface Props {
  issue: Issue;
  allIssues: Issue[];
  projects: Project[];
  onUpdate: (id: string, updates: Partial<Issue>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onSelectIssue: (id: string) => void;
  onCreateSubIssue: (parentId: string, title: string) => void;
  breadcrumb?: { id: string; title: string }[];
}

export function IssueDetailPanel({
  issue, allIssues, projects, onUpdate, onDelete, onClose, onSelectIssue, onCreateSubIssue, breadcrumb = [],
}: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description);
  const [comment, setComment] = useState("");
  const [newSubTitle, setNewSubTitle] = useState("");
  const [showSubInput, setShowSubInput] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => { setTitle(issue.title); setDescription(issue.description); setShowDeleteConfirm(false); }, [issue.id]);

  const project = projects.find(p => p.id === issue.projectId);
  const subIssues = allIssues.filter(i => i.parentId === issue.id);
  const subDone = subIssues.filter(i => i.status === "done").length;
  const creator = getUserById(issue.creatorId);

  // Depth check for sub-issues (max 2 levels)
  const depth = breadcrumb.length;
  const canAddSub = depth < 2;

  const handleAddComment = () => {
    if (!comment.trim() || !user) return;
    const c = { id: `ic_${Date.now()}`, authorId: user.id, content: comment.trim(), createdAt: new Date() };
    onUpdate(issue.id, { comments: [...issue.comments, c] });
    addAuditEntry({ userId: user.id, action: `Commented on "${issue.title}"`, category: "tasks", details: comment.trim().slice(0, 80), icon: "💬" });
    setComment("");
  };

  const handleCreateSub = () => {
    if (!newSubTitle.trim()) return;
    onCreateSubIssue(issue.id, newSubTitle.trim());
    setNewSubTitle("");
    setShowSubInput(false);
  };

  const toggleLabel = (l: string) => {
    onUpdate(issue.id, { labels: issue.labels.includes(l) ? issue.labels.filter(x => x !== l) : [...issue.labels, l] });
  };

  const propertyRow = (label: string, children: React.ReactNode) => (
    <div className="flex items-center gap-3" style={{ minHeight: 32 }}>
      <span style={{ fontSize: 12, color: "#9ca3af", width: 80, flexShrink: 0 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );

  return (
    <div
      className="fixed top-0 right-0 h-full z-[70] flex flex-col animate-slide-in-right"
      style={{
        width: "min(420px, 100vw)",
        background: "#ffffff",
        borderLeft: "0.5px solid #e5e7eb",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: "0.5px solid #e5e7eb" }}>
        <div className="flex items-center gap-1 min-w-0">
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              <button type="button" onClick={() => onSelectIssue(b.id)} style={{ fontSize: 12, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }} className="hover:underline truncate max-w-[100px]">
                {b.title}
              </button>
              <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "#9ca3af" }} />
            </span>
          ))}
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>{issue.id}</span>
        </div>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: 4 }}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {/* Title */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== issue.title) onUpdate(issue.id, { title }); }}
          style={{ fontSize: 18, fontWeight: 700, color: "#111827", background: "transparent", border: "none", outline: "none", width: "100%", padding: 0 }}
        />

        {/* Properties */}
        <div className="flex flex-col gap-1" style={{ background: "#f9fafb", borderRadius: 10, padding: 12, border: "0.5px solid #e5e7eb" }}>
          {propertyRow("Status", (
            <div className="flex items-center gap-1.5">
              <StatusIcon status={issue.status} size={12} />
              <select value={issue.status} onChange={e => onUpdate(issue.id, { status: e.target.value as IssueStatus })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }}>
                {ISSUE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          ))}
          {propertyRow("Priority", (
            <div className="flex items-center gap-1.5">
              <PriorityIcon priority={issue.priority} size={12} />
              <select value={issue.priority} onChange={e => onUpdate(issue.id, { priority: e.target.value as IssuePriority })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }}>
                {ISSUE_PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
          ))}
          {propertyRow("Assignee", (
            <select value={issue.assigneeId || ""} onChange={e => onUpdate(issue.id, { assigneeId: e.target.value || null })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }}>
              <option value="">Unassigned</option>
              {ALL_USERS.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          ))}
          {propertyRow("Labels", (
            <div className="flex flex-wrap gap-1">
              {ISSUE_LABELS.map(l => (
                <button type="button" key={l.name} onClick={() => toggleLabel(l.name)} style={{
                  fontSize: 10, padding: "1px 7px", borderRadius: 99, cursor: "pointer", border: "none",
                  background: issue.labels.includes(l.name) ? `${l.color}20` : "transparent",
                  color: issue.labels.includes(l.name) ? l.color : "#9ca3af",
                  outline: issue.labels.includes(l.name) ? `1px solid ${l.color}40` : "none",
                }}>
                  <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: l.color, marginRight: 3, verticalAlign: "middle" }} />
                  {l.name}
                </button>
              ))}
            </div>
          ))}
          {propertyRow("Project", (
            <select value={issue.projectId || ""} onChange={e => onUpdate(issue.id, { projectId: e.target.value || null, milestoneId: null })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }}>
              <option value="">None</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
            </select>
          ))}
          {project && propertyRow("Milestone", (
            <select value={issue.milestoneId || ""} onChange={e => onUpdate(issue.id, { milestoneId: e.target.value || null })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }}>
              <option value="">None</option>
              {project.milestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          ))}
          {propertyRow("Due Date", (
            <input type="date" value={issue.dueDate ? format(issue.dueDate, "yyyy-MM-dd") : ""} onChange={e => onUpdate(issue.id, { dueDate: e.target.value ? new Date(e.target.value) : null })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }} />
          ))}
          {propertyRow("Estimate", (
            <select value={issue.estimate ?? ""} onChange={e => onUpdate(issue.id, { estimate: e.target.value ? Number(e.target.value) : null })} style={{ fontSize: 12, background: "transparent", border: "none", color: "#374151", cursor: "pointer", outline: "none" }}>
              <option value="">None</option>
              {ESTIMATE_OPTIONS.map(e => <option key={e} value={e}>{e} pts</option>)}
            </select>
          ))}
          {propertyRow("Created", (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>{format(issue.createdAt, "MMM dd, yyyy")}</span>
          ))}
          {propertyRow("Updated", (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>{formatDistanceToNow(issue.updatedAt, { addSuffix: true })}</span>
          ))}
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Description</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => { if (description !== issue.description) onUpdate(issue.id, { description }); }}
            placeholder="Add a description..."
            rows={4}
            className="glass-input w-full"
            style={{ fontSize: 13, padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }}
          />
        </div>

        {/* Sub-issues */}
        {(subIssues.length > 0 || canAddSub) && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                Sub-issues {subIssues.length > 0 && <span style={{ color: "#9ca3af", fontWeight: 400 }}>({subDone}/{subIssues.length})</span>}
              </span>
              {canAddSub && (
                <button type="button" onClick={() => setShowSubInput(true)} style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}>
                  <Plus className="w-3 h-3" /> Add
                </button>
              )}
            </div>
            {/* Progress */}
            {subIssues.length > 0 && (
              <div style={{ height: 3, borderRadius: 2, background: "#e5e7eb" }}>
                <div style={{ width: `${subIssues.length > 0 ? (subDone / subIssues.length) * 100 : 0}%`, height: "100%", borderRadius: 2, background: "#22c55e", transition: "width 0.3s" }} />
              </div>
            )}
            {subIssues.map(sub => (
              <button type="button"
                key={sub.id}
                onClick={() => onSelectIssue(sub.id)}
                className="flex items-center gap-2 w-full text-left transition-colors"
                style={{ padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", background: "#f3f4f6" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#e5e7eb"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#f3f4f6"; }}
              >
                <StatusIcon status={sub.status} size={12} />
                <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>{sub.id}</span>
                <span className="flex-1 truncate" style={{ fontSize: 12, color: "#374151" }}>{sub.title}</span>
                {sub.assigneeId && (
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--glass-bg-hover)", fontSize: 8, fontWeight: 700, color: "var(--text-tertiary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {getUserById(sub.assigneeId)?.displayName.charAt(0)}
                  </div>
                )}
              </button>
            ))}
            {showSubInput && (
              <div className="flex gap-2">
                <input
                  className="glass-input flex-1"
                  value={newSubTitle}
                  onChange={e => setNewSubTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateSub(); if (e.key === "Escape") setShowSubInput(false); }}
                  placeholder="Sub-issue title..."
                  autoFocus
                  style={{ fontSize: 12, padding: "6px 10px" }}
                />
                <button type="button" onClick={handleCreateSub} className="glass-btn-primary" style={{ fontSize: 11, padding: "6px 10px", borderRadius: 6 }}>Add</button>
              </div>
            )}
          </div>
        )}

        {/* Activity */}
        <div style={{ borderTop: "0.5px solid #e5e7eb", paddingTop: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 10, display: "block" }}>Activity</span>

          <div className="flex flex-col gap-3 mb-4">
            {/* Created entry */}
            <div className="flex gap-2.5">
              <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#e5e7eb", fontSize: 8, fontWeight: 700, color: "#6b7280" }}>
                {creator?.displayName.charAt(0) || "?"}
              </div>
              <div>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>{creator?.displayName} created this issue {formatDistanceToNow(issue.createdAt, { addSuffix: true })}</span>
              </div>
            </div>

            {issue.comments.map(c => {
              const author = getUserById(c.authorId);
              return (
                <div key={c.id} className="flex gap-2.5">
                  <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#e5e7eb", fontSize: 8, fontWeight: 700, color: "#374151" }}>
                    {author?.displayName.charAt(0) || "?"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{author?.displayName}</span>
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>{formatDistanceToNow(c.createdAt, { addSuffix: true })}</span>
                    </div>
                    <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2, lineHeight: 1.5 }}>{c.content}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <input
              className="glass-input flex-1"
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAddComment(); }}
              placeholder="Write a comment..."
              style={{ fontSize: 12, padding: "8px 10px" }}
            />
            <button type="button" onClick={handleAddComment} className="glass-btn-primary" style={{ padding: "8px 10px", borderRadius: 6 }}>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2" style={{ borderTop: "0.5px solid #e5e7eb", paddingTop: 12 }}>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(issue.id); }} style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <Link2 className="w-3 h-3" /> Copy ID
          </button>
          <div className="ml-auto">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 11, color: "#ef4444" }}>Delete?</span>
                <button type="button" onClick={() => { onDelete(issue.id); onClose(); }} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: "#ef4444", color: "white", border: "none", cursor: "pointer" }}>Yes</button>
                <button type="button" onClick={() => setShowDeleteConfirm(false)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: "#f3f4f6", color: "#6b7280", border: "0.5px solid #e5e7eb", cursor: "pointer" }}>No</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowDeleteConfirm(true)} style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

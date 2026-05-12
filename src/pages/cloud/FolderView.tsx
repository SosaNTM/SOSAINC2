import { useState, useMemo, useCallback } from "react";
import { SearchBar, type SearchResult } from "@/components/ui/SearchBar";
import {
  formatFileSize, getFileTypeIcon, getFolderPath, getUserPermission,
} from "@/lib/cloudStore";
import { getUserById } from "@/lib/authContext";
import {
  Cloud, Plus, Upload, LayoutGrid, List, ChevronRight, ChevronDown,
  FolderIcon, FolderOpen, Trash2, MoreVertical, Pencil,
  Shield, Lock, Unlock, FolderPlus, Layers,
} from "lucide-react";
import { ActionMenu, type ActionMenuEntry } from "@/components/ActionMenu";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import type { FolderViewProps, CloudFolder, CloudFile, FolderSection, PermissionLevel } from "./cloud.types";

/* ── Breadcrumb ── */
function Breadcrumb({
  folderId,
  folders,
  onNavigate,
}: {
  folderId: string | null;
  folders: CloudFolder[];
  onNavigate: (id: string | null) => void;
}) {
  const path: { id: string | null; name: string; isLocked?: boolean }[] = [
    { id: null, name: "Cloud" },
  ];
  let cur = folderId;
  const segments: { id: string; name: string; isLocked?: boolean }[] = [];
  while (cur) {
    const f = folders.find((x) => x.id === cur);
    if (!f) break;
    segments.unshift({ id: f.id, name: f.name, isLocked: f.isLocked });
    cur = f.parentId;
  }
  path.push(...segments);

  return (
    <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
      {path.map((seg, i) => (
        <span key={seg.id || "root"} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-3 h-3" />}
          <button
            type="button"
            onClick={() => onNavigate(seg.id)}
            className={`bg-transparent border-none cursor-pointer px-1 py-0.5 rounded text-xs hover:bg-accent/50 flex items-center gap-1 ${
              i === path.length - 1
                ? "text-foreground font-semibold"
                : "text-muted-foreground"
            }`}
          >
            {seg.name}
            {seg.isLocked && <Lock className="w-3 h-3 text-amber-500" />}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ── Section Header ── */
function SectionHeader({
  section,
  fileCount,
  isCollapsed,
  canWrite,
  onToggle,
  onRename,
  onAddBelow,
  onMoveUp,
  onMoveDown,
  onDelete,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  section: FolderSection | null;
  fileCount: number;
  isCollapsed: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onRename?: () => void;
  onAddBelow?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete?: () => void;
  dragOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const isOther = !section;
  const menuItems: ActionMenuEntry[] = section
    ? [
        ...(onRename ? [{ id: "rename", icon: <Pencil className="w-3.5 h-3.5" />, label: "Rename", onClick: onRename }] : []),
        ...(onAddBelow ? [{ id: "add-below", icon: <Plus className="w-3.5 h-3.5" />, label: "Add Section Below", onClick: onAddBelow }] : []),
        ...(onMoveUp ? [{ id: "move-up", icon: <ChevronRight className="w-3.5 h-3.5 -rotate-90" />, label: "Move Up", onClick: onMoveUp }] : []),
        ...(onMoveDown ? [{ id: "move-down", icon: <ChevronRight className="w-3.5 h-3.5 rotate-90" />, label: "Move Down", onClick: onMoveDown }] : []),
        ...(onDelete ? [{ type: "divider" as const }, { id: "delete", icon: <Trash2 className="w-3.5 h-3.5" />, label: "Delete Section", onClick: onDelete, destructive: true }] : []),
      ]
    : [];

  return (
    <div
      className={`flex items-center gap-2 select-none cursor-pointer group transition-colors rounded-lg ${
        dragOver ? "ring-2 ring-dashed ring-primary bg-primary/5" : ""
      }`}
      style={{ padding: "10px 16px 6px" }}
      onClick={onToggle}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {!isOther && (
        <ChevronRight
          className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 ${
            isCollapsed ? "" : "rotate-90"
          }`}
        />
      )}
      <Layers className="w-3 h-3 text-muted-foreground/50" />
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {section?.name || "Other Files"}
      </span>
      <span className="text-[10px] text-muted-foreground/50">({fileCount})</span>
      <div className="flex-1" />
      {section && canWrite && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ActionMenu
            trigger={<MoreVertical className="w-3.5 h-3.5" />}
            items={menuItems}
          />
        </span>
      )}
    </div>
  );
}

/* ── Empty State Search ── */
function EmptyStateSearch({
  files,
  folders,
  getPerm,
  onNavigateFolder,
  onSelectFile,
}: {
  files: CloudFile[];
  folders: CloudFolder[];
  getPerm: (folderId: string) => PermissionLevel | null;
  onNavigateFolder: (id: string | null) => void;
  onSelectFile: (file: CloudFile) => void;
}) {
  const [query, setQuery] = useState("");

  const results: SearchResult[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: SearchResult[] = [];

    folders
      .filter((f) => !f.isDeleted && f.name.toLowerCase().includes(q))
      .forEach((f) => {
        out.push({
          id: f.id,
          name: f.name,
          type: "folder",
          path: getFolderPath(f.id, folders),
        });
      });

    files
      .filter(
        (f) =>
          !f.isDeleted &&
          f.name.toLowerCase().includes(q) &&
          getPerm(f.folderId)
      )
      .forEach((f) => {
        out.push({
          id: f.id,
          name: f.name,
          type: "file",
          fileType: f.type,
          path: getFolderPath(f.folderId, folders),
        });
      });

    return out.slice(0, 6);
  }, [query, files, folders, getPerm]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.type === "folder") {
        onNavigateFolder(result.id);
      } else {
        const file = files.find((f) => f.id === result.id);
        if (file) onSelectFile(file);
      }
    },
    [files, onNavigateFolder, onSelectFile]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", overflow: "hidden", gap: 24 }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sosa-white-20)", marginBottom: 10 }}>
          CLOUD STORAGE
        </p>
        <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 26, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.02em" }}>
          Cosa stai cercando?
        </h2>
      </div>
      <SearchBar
        placeholder="→ search all files..."
        results={results}
        onQueryChange={setQuery}
        onSelectResult={handleSelect}
      />
    </div>
  );
}

/* ── FolderView ── */
export default function FolderView(props: FolderViewProps) {
  const {
    folders,
    files,
    currentFolderId,
    currentFolder,
    currentFolderUnlocked,
    currentFolderUnlockState,
    currentSubfolders,
    currentSections,
    sortedFiles,
    unsectionedFiles,
    collapsedSections,
    view,
    sortBy,
    canWrite,
    currentPerm,
    searchQuery,
    showTrash,
    isOwner,
    isOwnerOrAdmin,
    userRole,
    userId,
    newFolderName,
    renamingFileId,
    renameValue,
    newSectionName,
    newSectionAfter,
    renamingSectionId,
    sectionRenameValue,
    dragOverSectionId,
    trashCount,
    trashSize,
    setView,
    setSortBy,
    setNewFolderName,
    setRenamingFileId,
    setRenameValue,
    setNewSectionName,
    setNewSectionAfter,
    setRenamingSectionId,
    setSectionRenameValue,
    setDragOverSectionId,
    setPreviewFile,
    setPermissionsModal,
    setShowUploadModal,
    setShowNewFolderModal,
    setConfirmDeleteFolder,
    setDeleteSectionConfirm,
    setConfirmEmptyTrash,
    attemptNavigateFolder,
    isFolderUnlocked,
    getPerm,
    getFileMenuItems,
    getFolderMenuItems,
    createFolder,
    renameFile,
    createSection,
    renameSection,
    moveSectionOrder,
    moveFileToSection,
    toggleSectionCollapse,
    lockFolderNow,
  } = props;

  const hasSections = currentSections.length > 0;

  const handleSectionDrop = (e: React.DragEvent, sectionId: string | null) => {
    e.preventDefault();
    setDragOverSectionId(null);
    const fileId = e.dataTransfer.getData("fileId");
    if (fileId) moveFileToSection(fileId, sectionId);
  };

  /* ── File Card (Grid) ── */
  const renderFileCard = (file: CloudFile) => {
    const icon = getFileTypeIcon(file.type);
    return (
      <div
        key={file.id}
        draggable={canWrite}
        onDragStart={(e) => e.dataTransfer.setData("fileId", file.id)}
        onClick={() => setPreviewFile(file)}
        onDoubleClick={() => toast.info("Download started")}
        style={{ position: "relative", background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", borderRadius: 0, padding: 14, cursor: "pointer" }}
      >
        <div className="flex items-start justify-between mb-3">
          <span className="text-[28px]">{icon.emoji}</span>
          <ActionMenu
            trigger={<MoreVertical className="w-4 h-4" />}
            items={getFileMenuItems(file)}
          />
        </div>
        {renamingFileId === file.id ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") renameFile(file.id);
              if (e.key === "Escape") setRenamingFileId(null);
            }}
            onBlur={() => renameFile(file.id)}
            className="w-full text-xs p-1.5 rounded border border-input bg-background"
          />
        ) : (
          <p className="truncate text-[13px] font-semibold text-foreground mb-1">
            {file.name}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {formatFileSize(file.size)}
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          {formatDistanceToNow(file.modifiedAt, { addSuffix: true })}
        </p>
      </div>
    );
  };

  /* ── File Row (List) ── */
  const renderFileRow = (file: CloudFile) => {
    const icon = getFileTypeIcon(file.type);
    const ownerName = file.ownerName || getUserById(file.ownerId)?.displayName || null;
    return (
      <tr
        key={file.id}
        draggable={canWrite}
        onDragStart={(e) => e.dataTransfer.setData("fileId", file.id)}
        onClick={() => setPreviewFile(file)}
        onDoubleClick={() => toast.info("Download started")}
        className="border-b border-border hover:bg-accent/30 transition-colors relative cursor-pointer"
      >
        <td className="p-2.5">
          <span className="text-lg">{icon.emoji}</span>
        </td>
        <td className="p-2.5 text-[13px] font-medium text-foreground">
          {renamingFileId === file.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renameFile(file.id);
                if (e.key === "Escape") setRenamingFileId(null);
              }}
              onBlur={() => renameFile(file.id)}
              className="text-xs p-1 rounded border border-input bg-background w-full"
            />
          ) : (
            <span className="truncate block max-w-[250px]">{file.name}</span>
          )}
        </td>
        <td className="p-2.5 text-xs text-muted-foreground">
          {formatFileSize(file.size)}
        </td>
        <td className="p-2.5 text-xs text-muted-foreground">
          {formatDistanceToNow(file.modifiedAt, { addSuffix: true })}
        </td>
        <td className="p-2.5 text-xs text-muted-foreground">
          {ownerName || "\u2014"}
        </td>
        <td className="p-2.5">
          <ActionMenu
            trigger={<MoreVertical className="w-4 h-4" />}
            items={getFileMenuItems(file)}
          />
        </td>
      </tr>
    );
  };

  /* ── Sectioned content rendering ── */
  const renderSectionedContent = () => {
    if (!hasSections) return null;

    const renderInlineRenameSection = (section: FolderSection) => {
      if (renamingSectionId !== section.id) return null;
      return (
        <div
          className="flex items-center gap-2 px-4 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={sectionRenameValue}
            onChange={(e) => setSectionRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                renameSection(section.id, sectionRenameValue);
              if (e.key === "Escape") setRenamingSectionId(null);
            }}
            onBlur={() => renameSection(section.id, sectionRenameValue)}
            className="text-xs p-1.5 rounded border border-input bg-background flex-1 max-w-[200px]"
            placeholder="Section name"
          />
          <button
            type="button"
            onClick={() => renameSection(section.id, sectionRenameValue)}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
          >
            &#x2713;
          </button>
          <button
            type="button"
            onClick={() => setRenamingSectionId(null)}
            className="text-xs px-2 py-1 rounded border border-border"
          >
            &#x2715;
          </button>
        </div>
      );
    };

    const sectionFiles = (sectionId: string) =>
      sortedFiles.filter((f) => f.sectionId === sectionId);

    return (
      <>
        {/* New section inline input (top) */}
        {newSectionName !== null && !newSectionAfter && (
          <div className="flex items-center gap-2 mb-3 px-4">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createSection(newSectionName);
                if (e.key === "Escape") {
                  setNewSectionName(null);
                  setNewSectionAfter(null);
                }
              }}
              className="text-xs p-1.5 rounded border border-input bg-background flex-1 max-w-[200px]"
              placeholder="New section name"
            />
            <button
              type="button"
              onClick={() => createSection(newSectionName)}
              className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
            >
              &#x2713;
            </button>
            <button
              type="button"
              onClick={() => {
                setNewSectionName(null);
                setNewSectionAfter(null);
              }}
              className="text-xs px-2 py-1 rounded border border-border"
            >
              &#x2715;
            </button>
          </div>
        )}

        {currentSections.map((section) => {
          const sFiles = sectionFiles(section.id);
          const isCollapsed = collapsedSections.has(section.id);

          return (
            <div key={section.id} className="mb-2">
              {renamingSectionId === section.id ? (
                renderInlineRenameSection(section)
              ) : (
                <SectionHeader
                  section={section}
                  fileCount={sFiles.length}
                  isCollapsed={isCollapsed}
                  canWrite={canWrite}
                  onToggle={() => toggleSectionCollapse(section.id)}
                  onRename={() => {
                    setRenamingSectionId(section.id);
                    setSectionRenameValue(section.name);
                  }}
                  onAddBelow={() => {
                    setNewSectionName("");
                    setNewSectionAfter(section.id);
                  }}
                  onMoveUp={() => moveSectionOrder(section.id, "up")}
                  onMoveDown={() => moveSectionOrder(section.id, "down")}
                  onDelete={() => setDeleteSectionConfirm(section)}
                  dragOver={dragOverSectionId === section.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverSectionId(section.id);
                  }}
                  onDragLeave={() => setDragOverSectionId(null)}
                  onDrop={(e) => handleSectionDrop(e, section.id)}
                />
              )}
              <div className="h-px bg-border mx-4" />
              {!isCollapsed && (
                <div className="transition-all duration-200">
                  {sFiles.length === 0 && (
                    <p className="text-xs text-muted-foreground/50 px-10 py-3 italic">
                      No files in this section
                    </p>
                  )}
                  {view === "grid" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 px-4 py-2">
                      {sFiles.map(renderFileCard)}
                    </div>
                  ) : sFiles.length > 0 ? (
                    <div className="overflow-x-auto px-4 py-1">
                      <table className="w-full min-w-[500px]">
                        <tbody>{sFiles.map(renderFileRow)}</tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Inline "add section after" input */}
              {newSectionName !== null && newSectionAfter === section.id && (
                <div className="flex items-center gap-2 my-2 px-4">
                  <Layers className="w-4 h-4 text-muted-foreground" />
                  <input
                    autoFocus
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        createSection(newSectionName, newSectionAfter);
                      if (e.key === "Escape") {
                        setNewSectionName(null);
                        setNewSectionAfter(null);
                      }
                    }}
                    className="text-xs p-1.5 rounded border border-input bg-background flex-1 max-w-[200px]"
                    placeholder="New section name"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      createSection(newSectionName, newSectionAfter)
                    }
                    className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
                  >
                    &#x2713;
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewSectionName(null);
                      setNewSectionAfter(null);
                    }}
                    className="text-xs px-2 py-1 rounded border border-border"
                  >
                    &#x2715;
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Other Files section */}
        {unsectionedFiles.length > 0 && (
          <div className="mb-2">
            <SectionHeader
              section={null}
              fileCount={unsectionedFiles.length}
              isCollapsed={collapsedSections.has("__other__")}
              canWrite={false}
              onToggle={() => toggleSectionCollapse("__other__")}
              dragOver={dragOverSectionId === "__other__"}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverSectionId("__other__");
              }}
              onDragLeave={() => setDragOverSectionId(null)}
              onDrop={(e) => handleSectionDrop(e, null)}
            />
            <div className="h-px bg-border mx-4" />
            {!collapsedSections.has("__other__") &&
              (view === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 px-4 py-2">
                  {unsectionedFiles.map(renderFileCard)}
                </div>
              ) : (
                <div className="overflow-x-auto px-4 py-1">
                  <table className="w-full min-w-[500px]">
                    <tbody>{unsectionedFiles.map(renderFileRow)}</tbody>
                  </table>
                </div>
              ))}
          </div>
        )}
      </>
    );
  };

  return (
    <>
      {/* Breadcrumb bar */}
      {!showTrash && currentFolderId && (
        <Breadcrumb
          folderId={currentFolderId}
          folders={folders}
          onNavigate={attemptNavigateFolder}
        />
      )}

      {/* Empty state / search home */}
      {!currentFolderId && !showTrash && !searchQuery.trim() && (
        <div className="flex-1 overflow-hidden p-4">
          <EmptyStateSearch
            files={files}
            folders={folders}
            getPerm={getPerm}
            onNavigateFolder={attemptNavigateFolder}
            onSelectFile={(file) => {
              // Delegate to parent via callbacks - navigate to the file's folder, expand tree, open preview
              attemptNavigateFolder(file.folderId);
              setPreviewFile(file);
            }}
          />
        </div>
      )}

      {/* Toolbar */}
      {(currentFolderId || showTrash || searchQuery.trim()) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid var(--sosa-border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {showTrash && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>
                {trashCount} item{trashCount !== 1 ? "s" : ""} · {formatFileSize(trashSize)}
              </span>
            )}
            {showTrash && userRole === "owner" && trashCount > 0 && (
              <button type="button" onClick={() => setConfirmEmptyTrash(true)}
                style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 10, padding: "4px 10px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "none", borderRadius: 0, cursor: "pointer", fontWeight: 600 }}>
                Empty Trash
              </button>
            )}
            {currentPerm === "admin" && currentFolderId && !showTrash && (
              <button type="button" onClick={() => setPermissionsModal(currentFolderId)}
                style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 10, padding: "4px 10px", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, cursor: "pointer" }}>
                <Shield style={{ width: 11, height: 11 }} /> Permissions
              </button>
            )}
            {currentFolder?.isLocked && currentFolderUnlocked && !showTrash && (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>
                  <Unlock style={{ width: 11, height: 11, opacity: 0.5 }} /> Unlocked
                  {currentFolderUnlockState?.expiresAt && (
                    <span style={{ opacity: 0.5 }}>· {Math.max(1, Math.ceil((currentFolderUnlockState.expiresAt - Date.now()) / 60000))} min</span>
                  )}
                </span>
                {!isOwner && (
                  <button type="button" onClick={() => lockFolderNow(currentFolderId!)}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 10, padding: "4px 10px", background: "transparent", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 0, cursor: "pointer" }}>
                    <Lock style={{ width: 11, height: 11 }} /> Lock Now
                  </button>
                )}
              </>
            )}
            {currentFolder && !showTrash && getPerm(currentFolderId!) === "admin" && (
              <span onClick={(e) => e.stopPropagation()}>
                {getFolderMenuItems(currentFolder).length > 0 && (
                  <ActionMenu trigger={<Lock style={{ width: 13, height: 13, color: "var(--text-tertiary)" }} />} items={getFolderMenuItems(currentFolder)} />
                )}
              </span>
            )}
          </div>
          {!showTrash && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {canWrite && (
                <>
                  <button type="button" onClick={() => setShowUploadModal(true)}
                    style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, padding: "5px 12px", background: "var(--portal-accent)", color: "#000", border: "none", borderRadius: 0, cursor: "pointer", letterSpacing: "0.04em" }}>
                    <Upload style={{ width: 12, height: 12 }} /> Upload ↑
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setShowNewFolderModal(true); }}
                    style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 12px", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, cursor: "pointer" }}>
                    <FolderPlus style={{ width: 12, height: 12 }} /> Folder
                  </button>
                </>
              )}
              <div style={{ display: "flex", border: "1px solid var(--sosa-border)" }}>
                <button type="button" onClick={() => setView("grid")}
                  style={{ padding: "5px 7px", background: view === "grid" ? "var(--sosa-bg-2)" : "transparent", border: "none", cursor: "pointer", color: view === "grid" ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                  <LayoutGrid style={{ width: 13, height: 13 }} />
                </button>
                <button type="button" onClick={() => setView("list")}
                  style={{ padding: "5px 7px", background: view === "list" ? "var(--sosa-bg-2)" : "transparent", border: "none", borderLeft: "1px solid var(--sosa-border)", cursor: "pointer", color: view === "list" ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                  <List style={{ width: 13, height: 13 }} />
                </button>
              </div>
              <select
                style={{ fontFamily: "var(--font-mono)", fontSize: 10, padding: "4px 8px", background: "var(--sosa-bg-2)", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0 }}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="date">Date</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      <div
        className={`flex-1 ${
          !currentFolderId && !showTrash && !searchQuery.trim()
            ? "overflow-hidden"
            : "overflow-y-auto p-4"
        }`}
      >
        {/* New folder inline (legacy fallback) */}
        {newFolderName !== null && (
          <div className="flex items-center gap-2 mb-3">
            <FolderIcon className="w-5 h-5 shrink-0 text-primary" />
            <input
              autoFocus
              className="text-sm p-1.5 rounded-lg border border-input bg-background max-w-[250px]"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFolder();
                if (e.key === "Escape") setNewFolderName(null);
              }}
              placeholder="Folder name"
            />
            <button
              type="button"
              onClick={createFolder}
              className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground"
            >
              &#x2713;
            </button>
            <button
              type="button"
              onClick={() => setNewFolderName(null)}
              className="text-xs px-2.5 py-1 rounded-md border border-border"
            >
              &#x2715;
            </button>
          </div>
        )}

        {/* Subfolders */}
        {currentFolderId && currentSubfolders.length > 0 && (
          <div className="mb-4">
            <div
              className={`grid gap-2 ${
                view === "grid"
                  ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
                  : "grid-cols-1"
              }`}
            >
              {currentSubfolders.map((sf) => (
                <button
                  type="button"
                  key={sf.id}
                  onClick={() => attemptNavigateFolder(sf.id)}
                  className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-card text-left hover:bg-accent/50 transition-colors"
                >
                  <FolderIcon className="w-5 h-5 shrink-0 text-primary" />
                  <span className="text-[13px] font-medium text-foreground">
                    {sf.name}
                  </span>
                  {sf.isLocked &&
                    (isFolderUnlocked(sf) ? (
                      <Unlock className="w-3.5 h-3.5 text-muted-foreground/40" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-500" />
                    ))}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {
                      files.filter(
                        (f) => f.folderId === sf.id && !f.isDeleted
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sectioned content */}
        {!showTrash &&
          (currentFolderId || searchQuery.trim()) &&
          hasSections &&
          !searchQuery.trim() &&
          renderSectionedContent()}

        {/* Non-sectioned: Files - grid */}
        {!showTrash &&
          (currentFolderId || searchQuery.trim()) &&
          (!hasSections || searchQuery.trim()) &&
          view === "grid" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {sortedFiles.map(renderFileCard)}
            </div>
          )}

        {/* Non-sectioned: Files - list */}
        {!showTrash &&
          (currentFolderId || searchQuery.trim()) &&
          (!hasSections || searchQuery.trim()) &&
          view === "list" &&
          sortedFiles.length > 0 && (
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full min-w-[500px]">
                <thead>
                  <tr className="border-b border-border">
                    {["", "Name", "Size", "Modified", "Owner", ""].map((h) => (
                      <th
                        key={h}
                        className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5 text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{sortedFiles.map(renderFileRow)}</tbody>
              </table>
            </div>
          )}

        {/* Empty state */}
        {(currentFolderId || showTrash || searchQuery.trim()) &&
          sortedFiles.length === 0 &&
          currentSubfolders.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 min-h-[200px] text-muted-foreground">
              <Cloud className="w-8 h-8" />
              <p className="text-sm">
                {showTrash
                  ? "Trash is empty"
                  : searchQuery
                    ? "No files found"
                    : "This folder is empty"}
              </p>
            </div>
          )}
      </div>
    </>
  );
}

export { Breadcrumb, SectionHeader, EmptyStateSearch };

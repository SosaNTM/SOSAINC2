import { useState, useMemo, useCallback } from "react";
import {
  type CloudFile, type CloudFolder, type PermissionLevel,
  getFileTypeIcon, formatFileSize, getFolderPath, getUserPermission,
  TOTAL_STORAGE_GB,
} from "@/lib/cloudStore";
import { getUserById } from "@/lib/authContext";
import { ActionMenu, type ActionMenuEntry } from "@/components/ActionMenu";
import { formatDistanceToNow, format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import {
  Download, Pencil, Move, Trash2, Link2, FolderIcon, MoreVertical,
  Upload, X, Search, ChevronDown, HardDrive, Eye,
} from "lucide-react";
import { PieChart, Pie, Cell, Sector, ResponsiveContainer } from "recharts";

/* ── Types ── */
type FileCategory = "all" | "video" | "image" | "pdf" | "spreadsheet" | "document" | "other";
type ViewFilter = "all" | "files" | "folders";
type SortOption = "size_desc" | "size_asc" | "name_asc" | "name_desc" | "date";

interface StorageOverviewProps {
  files: CloudFile[];
  folders: CloudFolder[];
  userId: string;
  userRole: string;
  getPerm: (folderId: string) => PermissionLevel | null;
  onNavigateFolder: (id: string | null) => void;
  onPreviewFile: (file: CloudFile) => void;
  onMoveToTrash: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onMoveFile: (file: CloudFile) => void;
  onOpenUpload?: () => void;
  onDownloadFile: (fileId: string) => Promise<void>;
}

/* ── Helpers ── */
const FILE_TYPE_MAP: Record<string, { category: FileCategory; label: string; color: string; icon: string }> = {
  video: { category: "video", label: "Videos", color: "#8b5cf6", icon: "▶" },
  image: { category: "image", label: "Images", color: "#ec4899", icon: "◆" },
  pdf: { category: "pdf", label: "PDFs", color: "#ef4444", icon: "●" },
  xlsx: { category: "spreadsheet", label: "Spreadsheets", color: "#22c55e", icon: "◆" },
  docx: { category: "document", label: "Documents", color: "#3b82f6", icon: "○" },
  pptx: { category: "other", label: "Other", color: "#6b7280", icon: "→" },
  zip: { category: "other", label: "Other", color: "#6b7280", icon: "→" },
  other: { category: "other", label: "Other", color: "#6b7280", icon: "→" },
};

function getFileCategory(type: CloudFile["type"]): FileCategory {
  return FILE_TYPE_MAP[type]?.category || "other";
}

function getCategoryColor(cat: FileCategory): string {
  const map: Record<FileCategory, string> = {
    all: "#6b7280", video: "#8b5cf6", image: "#ec4899", pdf: "#ef4444",
    spreadsheet: "#22c55e", document: "#3b82f6", other: "#6b7280",
  };
  return map[cat];
}

function formatExactBytes(bytes: number): string {
  return bytes.toLocaleString() + " bytes";
}

/* ── Component ── */
export default function StorageOverview({
  files, folders, userId, userRole, getPerm,
  onNavigateFolder, onPreviewFile, onMoveToTrash, onRenameFile, onMoveFile, onOpenUpload, onDownloadFile,
}: StorageOverviewProps) {
  const isMobile = useIsMobile();
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [typeFilter, setTypeFilter] = useState<FileCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("size_desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [folderDrillDown, setFolderDrillDown] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [hoveredType, setHoveredType] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);

  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";

  // All active (non-deleted) files
  const activeFiles = useMemo(() => files.filter((f) => !f.isDeleted), [files]);

  // Total bytes
  const totalUsed = useMemo(() => activeFiles.reduce((s, f) => s + f.size, 0), [activeFiles]);
  const totalQuota = TOTAL_STORAGE_GB * 1024 * 1024 * 1024;
  const usedPercent = (totalUsed / totalQuota) * 100;

  // By type analytics
  const byType = useMemo(() => {
    const map: Record<string, { size: number; count: number }> = {};
    activeFiles.forEach((f) => {
      const cat = getFileCategory(f.type);
      if (!map[cat]) map[cat] = { size: 0, count: 0 };
      map[cat].size += f.size;
      map[cat].count++;
    });
    const total = Object.values(map).reduce((s, v) => s + v.size, 0) || 1;
    return Object.entries(map)
      .map(([type, data]) => ({
        type: type as FileCategory,
        ...data,
        percentage: Math.round((data.size / total) * 100),
      }))
      .sort((a, b) => b.size - a.size);
  }, [activeFiles]);

  // By folder analytics
  const byFolder = useMemo(() => {
    const map: Record<string, { name: string; size: number }> = {};
    activeFiles.forEach((f) => {
      const folder = folders.find((fo) => fo.id === f.folderId);
      // Get root folder
      let rootId = f.folderId;
      let cur: string | null = f.folderId;
      while (cur) {
        const fo = folders.find((x) => x.id === cur);
        if (!fo) break;
        if (!fo.parentId) { rootId = fo.id; break; }
        cur = fo.parentId;
      }
      const rootFolder = folders.find((fo) => fo.id === rootId);
      if (!rootFolder) return;
      if (!map[rootId]) map[rootId] = { name: rootFolder.name, size: 0 };
      map[rootId].size += f.size;
    });
    const total = Object.values(map).reduce((s, v) => s + v.size, 0) || 1;
    return Object.entries(map)
      .map(([id, data]) => ({
        folderId: id,
        folderName: data.name,
        size: data.size,
        percentage: Math.round((data.size / total) * 100),
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 6);
  }, [activeFiles, folders]);

  // Filtered + sorted items list
  const filteredItems = useMemo(() => {
    let items = [...activeFiles];

    // Folder drill-down
    if (folderDrillDown) {
      const allIds = new Set<string>();
      const collect = (id: string) => {
        allIds.add(id);
        folders.filter((f) => f.parentId === id && !f.isDeleted).forEach((f) => collect(f.id));
      };
      collect(folderDrillDown);
      items = items.filter((f) => allIds.has(f.folderId));
    }

    // Type filter from dropdown
    if (typeFilter !== "all") {
      items = items.filter((f) => getFileCategory(f.type) === typeFilter);
    }

    // Type filter from donut chart click
    if (activeType) {
      items = items.filter((f) => getFileCategory(f.type) === activeType);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((f) => f.name.toLowerCase().includes(q));
    }

    // Sort
    switch (sortBy) {
      case "size_desc": items.sort((a, b) => b.size - a.size); break;
      case "size_asc": items.sort((a, b) => a.size - b.size); break;
      case "name_asc": items.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name_desc": items.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "date": items.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()); break;
    }

    return items;
  }, [activeFiles, folderDrillDown, typeFilter, activeType, searchQuery, sortBy, folders]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  // Selection
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === visibleItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleItems.map((f) => f.id)));
    }
  }, [selectedIds.size, visibleItems]);

  const selectedFiles = useMemo(() => activeFiles.filter((f) => selectedIds.has(f.id)), [activeFiles, selectedIds]);
  const selectedTotalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  const handleBulkDelete = () => {
    selectedIds.forEach((id) => onMoveToTrash(id));
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
    toast.success(`${selectedIds.size} items moved to Trash`);
  };

  // Progress bar color
  const barColor = usedPercent > 85 ? "bg-red-500" : usedPercent > 70 ? "bg-amber-500" : "bg-emerald-500";

  // Row menu
  const getRowMenuItems = (file: CloudFile): ActionMenuEntry[] => {
    const perm = getPerm(file.folderId);
    const canW = perm === "write" || perm === "admin";
    return [
      { id: "download", icon: <Download className="w-3.5 h-3.5" />, label: "Download", onClick: () => { void onDownloadFile(file.id); } },
      { id: "view-folder", icon: <FolderIcon className="w-3.5 h-3.5" />, label: "View in folder", onClick: () => onNavigateFolder(file.folderId) },
      { id: "rename", icon: <Pencil className="w-3.5 h-3.5" />, label: "Rename", onClick: () => {
        const newName = prompt("New name:", file.name);
        if (newName?.trim()) onRenameFile(file.id, newName.trim());
      }, show: canW },
      { id: "move", icon: <Move className="w-3.5 h-3.5" />, label: "Move", onClick: () => onMoveFile(file), show: canW },
      { id: "link", icon: <Link2 className="w-3.5 h-3.5" />, label: "Copy link", onClick: () => { navigator.clipboard.writeText(`cloud://files/${file.id}`); toast.success("Link copied"); } },
      { type: "divider" },
      { id: "trash", icon: <Trash2 className="w-3.5 h-3.5" />, label: "Move to Trash", onClick: () => onMoveToTrash(file.id), destructive: true, show: canW },
    ];
  };

  // Donut chart data
  const donutData = byType.map((t) => ({
    name: t.type,
    label: FILE_TYPE_MAP[t.type]?.label || t.type,
    value: t.size,
    color: getCategoryColor(t.type),
    icon: FILE_TYPE_MAP[t.type]?.icon || "📦",
    count: t.count,
    percentage: t.percentage,
  }));

  // Click effect state
  const [clickEffect, setClickEffect] = useState<{ active: boolean; color: string; index: number } | null>(null);
  const [centerBounce, setCenterBounce] = useState(false);

  const handleSliceClick = useCallback((index: number) => {
    const type = donutData[index];
    if (!type) return;
    setActiveType((prev) => (prev === type.name ? null : type.name));
    setClickEffect({ active: true, color: type.color, index });
    setCenterBounce(true);
    setTimeout(() => setClickEffect(null), 600);
    setTimeout(() => setCenterBounce(false), 400);
  }, [donutData]);

  // Custom active shape renderer for donut hover/click expand
  const renderActiveShape = (props: { cx: number; cy: number; innerRadius: number; outerRadius: number; startAngle: number; endAngle: number; fill: string; index: number }) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    const entryName = donutData[props.index]?.name;
    const isHighlighted = hoveredType === entryName || activeType === entryName;
    const isDimmed = (hoveredType && hoveredType !== entryName) || (activeType && activeType !== entryName);
    const isJustClicked = clickEffect?.active && clickEffect.index === props.index;

    let radius = outerRadius;
    if (isJustClicked) {
      radius = outerRadius + 14;
    } else if (isHighlighted) {
      radius = outerRadius + 8;
    }

    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={radius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={isDimmed ? 0.35 : 1}
        stroke={activeType === entryName ? "hsl(var(--foreground))" : "transparent"}
        strokeWidth={activeType === entryName ? 2 : 0}
        style={{ transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)", cursor: "pointer", filter: activeType === entryName ? `drop-shadow(0 0 8px ${fill})` : "none" }}
      />
    );
  };

  // Hovered type data for center text
  const hoveredTypeData = hoveredType ? donutData.find((d) => d.name === hoveredType) : null;

  const drillDownFolder = folderDrillDown ? folders.find((f) => f.id === folderDrillDown) : null;
  const drillDownSize = folderDrillDown ? byFolder.find((f) => f.folderId === folderDrillDown)?.size || 0 : 0;
  const activeTypeData = activeType ? donutData.find((d) => d.name === activeType) : null;

  const monoSm = { fontFamily: "var(--font-mono)", fontSize: 10 } as const;
  const monoXs = { fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", background: "var(--sosa-bg)" }}>
      {/* ── HEADER ── */}
      <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--sosa-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HardDrive style={{ width: 13, height: 13, color: "var(--sosa-yellow)" }} />
            <span style={{ ...monoXs, fontWeight: 700, color: "var(--text-primary)" }}>Storage Overview</span>
          </div>
          <span style={{ ...monoSm, color: "var(--text-tertiary)" }}>
            {formatFileSize(totalUsed)} / 1 TB
          </span>
        </div>
        <div style={{ height: 2, background: "var(--sosa-border)", position: "relative" }}>
          <div style={{
            position: "absolute", top: 0, left: 0, height: "100%",
            width: `${Math.min(usedPercent, 100)}%`,
            background: usedPercent > 85 ? "#ef4444" : usedPercent > 70 ? "#f59e0b" : "var(--sosa-yellow)",
            transition: "width 0.5s",
          }} />
        </div>
        <p style={{ ...monoXs, color: "var(--text-tertiary)", marginTop: 6 }}>{usedPercent.toFixed(1)}% used</p>
      </div>

      {/* ── ANALYTICS CARDS ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, padding: 16 }}>
        {/* Usage by File Type - Donut */}
        <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", padding: "16px 16px 12px" }}>
          <p style={{ ...monoXs, color: "var(--text-tertiary)", fontWeight: 700, marginBottom: 16 }}>Usage by File Type</p>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <div className="relative" style={{ width: 180, height: 180 }}>
              <ResponsiveContainer width="100%" height="100%" style={{ outline: "none" }}>
                <PieChart style={{ outline: "none" }}>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={72}
                    dataKey="value"
                    strokeWidth={0}
                    paddingAngle={2}
                    activeIndex={donutData.map((_, i) => i)}
                    activeShape={renderActiveShape}
                    onMouseEnter={(_, index) => setHoveredType(donutData[index].name)}
                    onMouseLeave={() => setHoveredType(null)}
                    onClick={(_, index) => handleSliceClick(index)}
                    style={{ cursor: "pointer", outline: "none" }}
                    tabIndex={-1}
                    isAnimationActive={true}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {clickEffect?.active && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="absolute rounded-full border-2 animate-[ripple-ring_0.5s_ease-out_forwards]" style={{ borderColor: clickEffect.color }} />
                  <div className="absolute w-24 h-24 animate-[glow-flash_0.4s_ease-out_forwards]" style={{ background: `radial-gradient(circle, ${clickEffect.color}40 0%, transparent 70%)` }} />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`text-center transition-all duration-200 ${centerBounce ? "animate-[center-bounce_0.35s_cubic-bezier(0.34,1.56,0.64,1)]" : ""}`}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                    {hoveredTypeData ? formatFileSize(hoveredTypeData.value) : activeTypeData ? formatFileSize(activeTypeData.value) : formatFileSize(totalUsed)}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {hoveredTypeData ? hoveredTypeData.label : activeTypeData ? activeTypeData.label : "Total"}
                  </div>
                </div>
              </div>
            </div>
            {/* Legend */}
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
              {donutData.map((t) => {
                const isDimmed = (hoveredType && hoveredType !== t.name && !activeType) || (activeType && activeType !== t.name);
                return (
                  <div
                    key={t.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                      cursor: "pointer", opacity: isDimmed ? 0.35 : 1, transition: "opacity 0.2s",
                      background: activeType === t.name ? "rgba(255,255,255,0.04)" : "transparent",
                      borderLeft: activeType === t.name ? `2px solid ${t.color}` : "2px solid transparent",
                    }}
                    onMouseEnter={() => setHoveredType(t.name)}
                    onMouseLeave={() => setHoveredType(null)}
                    onClick={() => { const idx = donutData.findIndex((d) => d.name === t.name); if (idx >= 0) handleSliceClick(idx); }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
                    <span style={{ ...monoSm, color: "var(--text-tertiary)", flex: 1 }}>{t.icon} {t.label}</span>
                    <span style={{ ...monoSm, fontWeight: 700, color: "var(--text-primary)" }}>{formatFileSize(t.value)}</span>
                    <span style={{ ...monoSm, color: "var(--text-tertiary)", width: 32, textAlign: "right" }}>{t.percentage}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Top Folders by Size */}
        <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", padding: "16px 16px 12px" }}>
          <p style={{ ...monoXs, color: "var(--text-tertiary)", fontWeight: 700, marginBottom: 16 }}>Top Folders by Size</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {byFolder.length === 0 && (
              <p style={{ ...monoSm, color: "var(--text-tertiary)", textAlign: "center", padding: "24px 0" }}>No folders with files</p>
            )}
            {byFolder.map((f) => {
              const isActive = folderDrillDown === f.folderId;
              const isDimmed = hoveredFolder && hoveredFolder !== f.folderId && !folderDrillDown;
              return (
                <button type="button"
                  key={f.folderId}
                  onClick={() => setFolderDrillDown(folderDrillDown === f.folderId ? null : f.folderId)}
                  onMouseEnter={() => setHoveredFolder(f.folderId)}
                  onMouseLeave={() => setHoveredFolder(null)}
                  style={{
                    padding: "8px", textAlign: "left", background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                    borderLeft: isActive ? "2px solid var(--sosa-yellow)" : "2px solid transparent",
                    opacity: isDimmed ? 0.4 : 1, cursor: "pointer", transition: "opacity 0.2s, background 0.15s", border: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FolderIcon style={{ width: 12, height: 12, color: isActive ? "var(--sosa-yellow)" : "var(--text-tertiary)" }} />
                      <span style={{ ...monoSm, fontWeight: 600, color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>{f.folderName}</span>
                    </span>
                    <span style={{ ...monoSm, color: "var(--text-tertiary)" }}>{formatFileSize(f.size)}</span>
                  </div>
                  <div style={{ height: 2, background: "var(--sosa-border)", position: "relative" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${f.percentage}%`, background: isActive ? "var(--sosa-yellow)" : "var(--text-tertiary)", transition: "width 0.4s" }} />
                  </div>
                  <span style={{ ...monoXs, color: "var(--text-tertiary)", marginTop: 4, display: "block" }}>{f.percentage}%</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── DRILL-DOWN FILTER BADGES ── */}
      {(folderDrillDown || activeType) && (
        <div style={{ padding: "0 16px 8px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {folderDrillDown && drillDownFolder && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...monoSm, padding: "3px 10px", background: "rgba(212,255,0,0.08)", color: "var(--sosa-yellow)", border: "1px solid rgba(212,255,0,0.2)" }}>
              <FolderIcon style={{ width: 11, height: 11 }} />
              {drillDownFolder.name} ({formatFileSize(drillDownSize)})
              <button type="button" onClick={() => setFolderDrillDown(null)} style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}>
                <X style={{ width: 11, height: 11 }} />
              </button>
            </span>
          )}
          {activeType && activeTypeData && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...monoSm, padding: "3px 10px", background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid var(--sosa-border)" }}>
              {activeTypeData.icon} {activeTypeData.label} ({formatFileSize(activeTypeData.value)} · {activeTypeData.count} files)
              <button type="button" onClick={() => setActiveType(null)} style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}>
                <X style={{ width: 11, height: 11 }} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* ── LARGEST ITEMS HEADER ── */}
      <div style={{ padding: "4px 16px 2px", borderTop: "1px solid var(--sosa-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ ...monoXs, color: "var(--text-tertiary)", fontWeight: 700, padding: "8px 0 4px" }}>Largest Items</p>
        {onOpenUpload && (
          <button type="button" onClick={onOpenUpload}
            style={{ display: "flex", alignItems: "center", gap: 5, ...monoXs, fontWeight: 700, padding: "4px 10px", background: "var(--portal-accent)", color: "#000", border: "none", borderRadius: 0, cursor: "pointer" }}
          >
            <Upload style={{ width: 10, height: 10 }} /> Upload ↑
          </button>
        )}
      </div>

      {/* ── FILTER BAR ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", flexWrap: "wrap", borderBottom: "1px solid var(--sosa-border)" }}>
        {/* View toggle */}
        <div style={{ display: "flex", border: "1px solid var(--sosa-border)" }}>
          {(["all", "files", "folders"] as ViewFilter[]).map((v, i) => (
            <button type="button"
              key={v}
              onClick={() => setViewFilter(v)}
              style={{
                ...monoSm, fontWeight: 600, textTransform: "capitalize", padding: "4px 10px",
                background: viewFilter === v ? "var(--sosa-yellow)" : "transparent",
                color: viewFilter === v ? "#000" : "var(--text-tertiary)",
                border: "none", borderLeft: i > 0 ? "1px solid var(--sosa-border)" : "none", cursor: "pointer",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Type dropdown */}
        <div style={{ position: "relative" }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FileCategory)}
            style={{ ...monoSm, padding: "4px 22px 4px 8px", background: "var(--sosa-bg-2)", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, appearance: "none", cursor: "pointer" }}
          >
            <option value="all">All Types</option>
            <option value="video">Videos</option>
            <option value="image">Images</option>
            <option value="pdf">PDFs</option>
            <option value="spreadsheet">Spreadsheets</option>
            <option value="document">Documents</option>
            <option value="other">Other</option>
          </select>
          <ChevronDown style={{ width: 11, height: 11, position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-tertiary)" }} />
        </div>

        {/* Search */}
        <div style={{ position: "relative", flex: 1, minWidth: 120, maxWidth: 220 }}>
          <Search style={{ width: 11, height: 11, position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
          <input
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            style={{ ...monoSm, width: "100%", padding: "4px 8px 4px 26px", background: "var(--sosa-bg-2)", color: "var(--text-primary)", border: "1px solid var(--sosa-border)", borderRadius: 0, outline: "none" }}
          />
        </div>

        {/* Sort */}
        <div style={{ position: "relative", marginLeft: "auto" }}>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            style={{ ...monoSm, padding: "4px 22px 4px 8px", background: "var(--sosa-bg-2)", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, appearance: "none", cursor: "pointer" }}
          >
            <option value="size_desc">Size ↓</option>
            <option value="size_asc">Size ↑</option>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
            <option value="date">Last modified</option>
          </select>
          <ChevronDown style={{ width: 11, height: 11, position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-tertiary)" }} />
        </div>
      </div>

      {/* ── ITEMS TABLE ── */}
      <div style={{ flex: 1, padding: "0 16px", overflowX: "auto" }}>
        {filteredItems.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "48px 0" }}>
            <FolderIcon style={{ width: 32, height: 32, color: "var(--text-tertiary)", opacity: 0.3 }} />
            <p style={{ ...monoSm, color: "var(--text-tertiary)" }}>
              {activeFiles.length === 0 ? "No files in your Cloud yet" : "No files match your filters"}
            </p>
            {activeFiles.length === 0 && (
              <button type="button"
                onClick={() => onOpenUpload?.()}
                style={{ display: "flex", alignItems: "center", gap: 6, ...monoSm, fontWeight: 700, padding: "6px 16px", background: "var(--portal-accent)", color: "#000", border: "none", borderRadius: 0, cursor: "pointer" }}
              >
                <Upload style={{ width: 12, height: 12 }} /> Upload ↑
              </button>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", minWidth: 700, fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--sosa-border)" }}>
                <th style={{ width: 32, padding: "8px 10px", textAlign: "left" }}>
                  <input type="checkbox" checked={selectedIds.size === visibleItems.length && visibleItems.length > 0} onChange={toggleSelectAll} />
                </th>
                <th style={{ width: 32, padding: "8px 0" }} />
                {(["NAME", "SIZE", "LOCATION", "MODIFIED", "OWNER"] as const).map((h, i) => (
                  <th key={h} style={{ ...monoXs, padding: "8px 10px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 700, width: i === 0 ? undefined : [100, 140, 110, 90][i - 1] }}>
                    {h}
                  </th>
                ))}
                <th style={{ width: 32, padding: "8px 10px" }} />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((file) => {
                const icon = getFileTypeIcon(file.type);
                const ownerName = file.ownerName || getUserById(file.ownerId)?.displayName || null;
                const folderPath = getFolderPath(file.folderId, folders);
                const isSelected = selectedIds.has(file.id);

                return (
                  <tr
                    key={file.id}
                    onClick={() => onPreviewFile(file)}
                    style={{
                      borderBottom: "1px solid var(--sosa-border)", cursor: "pointer",
                      background: isSelected ? "rgba(212,255,0,0.04)" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = "rgba(255,255,255,0.02)"; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                  >
                    <td style={{ padding: "8px 10px" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(file.id)} />
                    </td>
                    <td style={{ padding: "8px 0" }}>
                      <span style={{ fontSize: 16 }}>{icon.emoji}</span>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-primary)", display: "block", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                    </td>
                    <td style={{ padding: "8px 10px" }} title={formatExactBytes(file.size)}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{formatFileSize(file.size)}</span>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); onNavigateFolder(file.folderId); }}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "block", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {folderPath}
                      </button>
                    </td>
                    <td style={{ padding: "8px 10px" }} title={format(file.modifiedAt, "PPpp")}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>{formatDistanceToNow(file.modifiedAt, { addSuffix: true })}</span>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>{ownerName || "—"}</span>
                    </td>
                    <td style={{ padding: "8px 10px" }} onClick={(e) => e.stopPropagation()}>
                      <ActionMenu trigger={<MoreVertical style={{ width: 14, height: 14, color: "var(--text-tertiary)" }} />} items={getRowMenuItems(file)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Show more */}
        {visibleCount < filteredItems.length && (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
            <button type="button"
              onClick={() => setVisibleCount((v) => v + 20)}
              style={{ ...monoSm, padding: "5px 16px", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, cursor: "pointer" }}
            >
              Show more ({filteredItems.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>

      {/* ── BULK ACTION BAR ── */}
      {selectedIds.size > 0 && (
        <div style={{ position: "sticky", bottom: 0, borderTop: "1px solid var(--sosa-border)", background: "var(--sosa-bg-2)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 10 }}>
          <span style={{ ...monoSm, color: "var(--text-secondary)", fontWeight: 600 }}>
            {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected · {formatFileSize(selectedTotalSize)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button"
              onClick={() => {
                const ids = Array.from(selectedIds);
                ids.forEach((id, i) => { setTimeout(() => { void onDownloadFile(id); }, i * 300); });
              }}
              style={{ display: "flex", alignItems: "center", gap: 5, ...monoSm, padding: "4px 12px", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, cursor: "pointer" }}
            >
              <Download style={{ width: 11, height: 11 }} /> Download
            </button>
            <button type="button"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ display: "flex", alignItems: "center", gap: 5, ...monoSm, fontWeight: 700, padding: "4px 12px", background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 0, cursor: "pointer" }}
            >
              <Trash2 style={{ width: 11, height: 11 }} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/70" onClick={() => setShowDeleteConfirm(false)} />
          <div style={{ position: "fixed", zIndex: 90, top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(95vw, 460px)", maxHeight: "90vh", overflowY: "auto", background: "var(--sosa-bg-2)", border: "1px solid var(--sosa-border)", padding: 24 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>
              Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}?
            </p>
            <p style={{ ...monoSm, color: "var(--text-tertiary)", marginBottom: 12 }}>
              Items will be moved to Trash (recoverable for 60 days):
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, maxHeight: 200, overflowY: "auto" }}>
              {selectedFiles.map((f) => {
                const icon = getFileTypeIcon(f.type);
                return (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "var(--sosa-bg-3)", border: "1px solid var(--sosa-border)" }}>
                    <span style={{ fontSize: 14 }}>{icon.emoji}</span>
                    <span style={{ ...monoSm, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span style={{ ...monoSm, color: "var(--text-tertiary)" }}>{formatFileSize(f.size)}</span>
                  </div>
                );
              })}
            </div>
            <p style={{ ...monoSm, color: "var(--text-tertiary)", marginBottom: 16 }}>
              Total: <strong style={{ color: "var(--text-primary)" }}>{formatFileSize(selectedTotalSize)}</strong> freed
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button"
                onClick={() => setShowDeleteConfirm(false)}
                style={{ ...monoSm, padding: "6px 16px", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--sosa-border)", borderRadius: 0, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button type="button"
                onClick={handleBulkDelete}
                style={{ display: "flex", alignItems: "center", gap: 5, ...monoSm, fontWeight: 700, padding: "6px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 0, cursor: "pointer" }}
              >
                <Trash2 style={{ width: 11, height: 11 }} /> Move to Trash
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

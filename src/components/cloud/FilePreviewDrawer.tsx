import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { X, Download, Pencil, Move, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { getUserById } from "@/lib/authContext";
import {
  type CloudFile, type CloudFolder, type PermissionLevel,
  getFileTypeIcon, getFileTypeLabel, formatFileSize, getFolderPath,
} from "@/lib/cloudStore";

/* ── Style tokens ── */
const mono: CSSProperties = { fontFamily: "var(--font-mono)" };

const monoLabel: CSSProperties = {
  ...mono,
  fontSize: 9,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--text-tertiary)",
};

const monoSm: CSSProperties = { ...mono, fontSize: 11, letterSpacing: "0.03em" };
const monoMd: CSSProperties = { ...mono, fontSize: 13, letterSpacing: "0.01em" };

/* ── Helpers ── */
function Unavailable({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <span style={{ fontSize: 48 }}>{icon}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.14em", color: "var(--text-tertiary)" }}>{label}</span>
    </div>
  );
}

function isVideo(f: CloudFile): boolean {
  const ext = (f.extension || f.name.split(".").pop() || "").toLowerCase();
  const mime = (f.mimeType || "").toLowerCase();
  return mime.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(ext);
}

function isAudio(f: CloudFile): boolean {
  const ext = (f.extension || f.name.split(".").pop() || "").toLowerCase();
  const mime = (f.mimeType || "").toLowerCase();
  return mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext);
}

function isTextLike(f: CloudFile): boolean {
  const ext = (f.extension || f.name.split(".").pop() || "").toLowerCase();
  const mime = (f.mimeType || "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    ["txt", "md", "csv", "json", "xml", "yaml", "yml", "log", "js", "ts", "jsx", "tsx", "html", "css", "sh", "py"].includes(ext)
  );
}

function needsPresignedUrl(f: CloudFile): boolean {
  return (
    f.type === "image" || f.type === "pdf" ||
    f.type === "docx" || f.type === "xlsx" || f.type === "pptx" ||
    isVideo(f) || isAudio(f) || isTextLike(f)
  );
}

/* ── Props ── */
interface FilePreviewDrawerProps {
  file: CloudFile;
  files: CloudFile[];
  folders: CloudFolder[];
  permission: PermissionLevel | null;
  onClose: () => void;
  onNavigate: (file: CloudFile) => void;
  onRename: (fileId: string, newName: string) => void;
  onMoveToTrash: (fileId: string) => void;
  onMoveFile: (file: CloudFile) => void;
  onNavigateFolder: (folderId: string) => void;
  onUpdateDescription: (fileId: string, desc: string) => void;
  onDownload: (fileId: string) => Promise<void>;
  getPreviewUrl?: (fileId: string) => Promise<string | null>;
  isOwner?: boolean;
}

export default function FilePreviewDrawer({
  file, files, folders, permission,
  onClose, onNavigate, onRename, onMoveToTrash, onMoveFile,
  onNavigateFolder, onUpdateDescription, onDownload, getPreviewUrl, isOwner = false,
}: FilePreviewDrawerProps) {
  const [loading, setLoading]             = useState(true);
  const [editingTitle, setEditingTitle]   = useState(false);
  const [titleValue, setTitleValue]       = useState(file.name);
  const [editingDesc, setEditingDesc]     = useState(false);
  const [descValue, setDescValue]         = useState(file.description || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewUrl, setPreviewUrl]       = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [textContent, setTextContent]     = useState<string | null>(null);

  const canWrite = true;

  // Brief loading shimmer on file change
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(t);
  }, [file.id]);

  // Reset editing state on file change
  useEffect(() => {
    setEditingTitle(false);
    setTitleValue(file.name);
    setEditingDesc(false);
    setDescValue(file.description || "");
    setPreviewUrl(null);
    setTextContent(null);
  }, [file.id, file.name, file.description]);

  // Fetch presigned URL for previewable file types
  useEffect(() => {
    if (!getPreviewUrl || !needsPresignedUrl(file)) return;
    let cancelled = false;
    setPreviewLoading(true);
    getPreviewUrl(file.id).then(async (url) => {
      if (cancelled || !url) {
        if (!cancelled) setPreviewLoading(false);
        return;
      }
      if (isTextLike(file)) {
        try {
          const res = await fetch(url);
          const text = await res.text();
          if (!cancelled) { setTextContent(text.slice(0, 50_000)); setPreviewUrl(url); }
        } catch {
          if (!cancelled) setPreviewUrl(url);
        }
      } else {
        if (!cancelled) setPreviewUrl(url);
      }
      if (!cancelled) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [file.id, file.type, getPreviewUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentIndex = useMemo(
    () => files.findIndex((f) => f.id === file.id),
    [files, file.id]
  );

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(files[currentIndex - 1]);
  }, [currentIndex, files, onNavigate]);

  const goNext = useCallback(() => {
    if (currentIndex < files.length - 1) onNavigate(files[currentIndex + 1]);
  }, [currentIndex, files, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingTitle || editingDesc) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, goPrev, goNext, editingTitle, editingDesc]);

  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== file.name) onRename(file.id, titleValue.trim());
    setEditingTitle(false);
  };

  const saveDesc = () => {
    onUpdateDescription(file.id, descValue);
    setEditingDesc(false);
  };

  const icon      = getFileTypeIcon(file.type);
  const typeLabel = getFileTypeLabel(file.type);
  const folderPath = file.folderId !== "trash"
    ? getFolderPath(file.folderId, folders)
    : file.originalFolderPath || "Unknown";
  const uploaderName = file.ownerName
    || getUserById(file.uploadedBy || file.ownerId)?.displayName
    || "Unknown";

  /* ── Preview render function (not a component — avoids remount on each render) ── */
  const renderPreview = () => {
    if (loading || previewLoading) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={monoLabel}>Loading preview...</span>
        </div>
      );
    }

    if (file.type === "image") {
      if (previewUrl) {
        return (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
            <img src={previewUrl} alt={file.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
          </div>
        );
      }
      return <Unavailable icon={icon.emoji} label={file.name} />;
    }

    if (file.type === "pdf") {
      if (previewUrl) {
        return <iframe src={previewUrl} title={file.name} style={{ width: "100%", height: "100%", border: "none" }} />;
      }
      return <Unavailable icon="📄" label="PDF · preview unavailable" />;
    }

    if (file.type === "docx" || file.type === "xlsx" || file.type === "pptx") {
      if (previewUrl) {
        const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`;
        return <iframe src={viewerUrl} title={file.name} style={{ width: "100%", height: "100%", border: "none" }} />;
      }
      return <Unavailable icon={icon.emoji} label={`${typeLabel} · preview unavailable`} />;
    }

    if (previewUrl && isVideo(file)) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={previewUrl} controls style={{ maxWidth: "100%", maxHeight: "100%" }} />
        </div>
      );
    }

    if (previewUrl && isAudio(file)) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <span style={{ fontSize: 48 }}>🎵</span>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={previewUrl} controls style={{ width: "80%" }} />
        </div>
      );
    }

    if (textContent !== null) {
      const ext = (file.extension || file.name.split(".").pop() || "").toLowerCase();
      return (
        <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "12px 16px", boxSizing: "border-box" }}>
          <div style={{ marginBottom: 8 }}>
            <span style={monoLabel}>.{ext}</span>
          </div>
          <pre style={{ ...monoSm, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, lineHeight: 1.6 }}>
            {textContent}
          </pre>
        </div>
      );
    }

    return <Unavailable icon={icon.emoji} label={`.${file.name.split(".").pop()} · preview unavailable`} />;
  };

  /* ── Info row ── */
  const InfoRow = ({
    label, value, clickable, onClick,
  }: { label: string; value: React.ReactNode; clickable?: boolean; onClick?: () => void }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--sosa-border-dim)" }}>
      <span style={{ ...monoLabel, fontSize: 9 }}>{label}</span>
      {clickable ? (
        <button type="button" onClick={onClick}
          style={{ ...monoSm, background: "none", border: "none", cursor: "pointer", color: "var(--portal-accent)", fontWeight: 600 }}>
          {value}
        </button>
      ) : (
        <span style={{ ...monoSm, color: "var(--text-primary)", fontWeight: 600 }}>{value}</span>
      )}
    </div>
  );

  /* ── Layout ── */
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.7)" }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 201,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        pointerEvents: "none",
      }}>
        <div style={{
          pointerEvents: "all",
          width: "100%",
          maxWidth: 860,
          maxHeight: "calc(100dvh - 48px)",
          background: "var(--sosa-bg-2)",
          border: "1px solid var(--sosa-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>

          {/* ── Header ── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderBottom: "1px solid var(--sosa-border)",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{icon.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <p style={{ ...monoMd, fontWeight: 700, color: "var(--text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 500 }}>
                  {file.name}
                </p>
                <p style={{ ...monoLabel, marginTop: 2 }}>
                  {typeLabel} · {formatFileSize(file.size)} · {folderPath}
                </p>
              </div>
            </div>

            {files.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 12 }}>
                <button type="button" onClick={goPrev} disabled={currentIndex <= 0}
                  style={{ ...monoSm, background: "none", border: "1px solid var(--sosa-border)", cursor: "pointer", padding: "3px 8px", color: "var(--text-tertiary)", opacity: currentIndex <= 0 ? 0.3 : 1 }}>
                  <ChevronLeft style={{ width: 13, height: 13 }} />
                </button>
                <span style={{ ...monoLabel, fontSize: 9 }}>{currentIndex + 1} / {files.length}</span>
                <button type="button" onClick={goNext} disabled={currentIndex >= files.length - 1}
                  style={{ ...monoSm, background: "none", border: "1px solid var(--sosa-border)", cursor: "pointer", padding: "3px 8px", color: "var(--text-tertiary)", opacity: currentIndex >= files.length - 1 ? 0.3 : 1 }}>
                  <ChevronRight style={{ width: 13, height: 13 }} />
                </button>
              </div>
            )}

            <button type="button" onClick={onClose}
              style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "1px solid var(--sosa-border)", cursor: "pointer", color: "var(--text-tertiary)", flexShrink: 0 }}>
              <X style={{ width: 13, height: 13 }} />
            </button>
          </div>

          {/* ── Body ── */}
          <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

            {/* LEFT — info */}
            <div style={{
              width: 260,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              borderRight: "1px solid var(--sosa-border)",
              overflowY: "auto",
            }}>
              <div style={{ padding: "14px 16px", flex: 1 }}>

                {/* Title */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={monoLabel}>Title</span>
                    {canWrite && !editingTitle && (
                      <button type="button" onClick={() => setEditingTitle(true)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 0 }}>
                        <Pencil style={{ width: 10, height: 10 }} />
                      </button>
                    )}
                  </div>
                  {editingTitle ? (
                    <input autoFocus value={titleValue}
                      onChange={(e) => setTitleValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setEditingTitle(false); setTitleValue(file.name); } }}
                      onBlur={saveTitle}
                      style={{ ...monoSm, width: "100%", padding: "5px 7px", background: "var(--sosa-bg-3)", border: "1px solid var(--sosa-border)", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                    />
                  ) : (
                    <p style={{ ...monoSm, fontWeight: 700, color: "var(--text-primary)", margin: 0, wordBreak: "break-word" }}>{file.name}</p>
                  )}
                </div>

                {/* Description */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={monoLabel}>Description</span>
                    {canWrite && !editingDesc && (
                      <button type="button" onClick={() => setEditingDesc(true)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 0 }}>
                        <Pencil style={{ width: 10, height: 10 }} />
                      </button>
                    )}
                  </div>
                  {editingDesc ? (
                    <div>
                      <textarea autoFocus value={descValue}
                        onChange={(e) => setDescValue(e.target.value.slice(0, 500))}
                        onKeyDown={(e) => { if (e.key === "Escape") { setEditingDesc(false); setDescValue(file.description || ""); } }}
                        placeholder="Add a description..."
                        style={{ ...monoSm, width: "100%", padding: "5px 7px", background: "var(--sosa-bg-3)", border: "1px solid var(--sosa-border)", color: "var(--text-primary)", outline: "none", minHeight: 56, resize: "none", boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span style={{ ...monoLabel, fontSize: 9 }}>{descValue.length}/500</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" onClick={() => { setEditingDesc(false); setDescValue(file.description || ""); }}
                            style={{ ...monoSm, padding: "2px 8px", background: "none", border: "1px solid var(--sosa-border)", cursor: "pointer", color: "var(--text-tertiary)" }}>
                            Cancel
                          </button>
                          <button type="button" onClick={saveDesc}
                            style={{ ...monoSm, padding: "2px 8px", background: "var(--portal-accent)", border: "none", cursor: "pointer", color: "#000", fontWeight: 700 }}>
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p style={{ ...monoSm, color: "var(--text-tertiary)", margin: 0 }}>
                      {file.description || (canWrite ? "Click edit to add a description..." : "No description")}
                    </p>
                  )}
                </div>

                {/* Metadata */}
                <div style={{ borderTop: "1px solid var(--sosa-border)", paddingTop: 8 }}>
                  <InfoRow label="Type" value={typeLabel} />
                  <InfoRow label="Size" value={formatFileSize(file.size)} />
                  {file.dimensions && (
                    <InfoRow label="Dimensions" value={`${file.dimensions.width} × ${file.dimensions.height}`} />
                  )}
                  {file.pageCount ? <InfoRow label="Pages" value={String(file.pageCount)} /> : null}
                  {file.sheetNames ? <InfoRow label="Sheets" value={file.sheetNames.join(", ")} /> : null}
                  <InfoRow label="Uploaded" value={format(file.createdAt, "MMM d, yyyy")} />
                  <InfoRow label="Uploaded by" value={uploaderName} />
                  <InfoRow label="Modified" value={format(file.modifiedAt, "MMM d, yyyy")} />
                  <InfoRow
                    label="Location"
                    value={folderPath}
                    clickable={file.folderId !== "trash"}
                    onClick={() => { onNavigateFolder(file.folderId); onClose(); }}
                  />
                </div>
              </div>
            </div>

            {/* RIGHT — preview */}
            <div style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              background: "var(--sosa-bg-3)",
              minWidth: 0,
            }}>
              <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--sosa-border)", flexShrink: 0 }}>
                <span style={monoLabel}>Preview</span>
              </div>
              <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
                {renderPreview()}
              </div>
            </div>
          </div>

          {/* ── Actions footer ── */}
          {!file.isDeleted && (
            <div style={{ display: "flex", gap: 1, borderTop: "1px solid var(--sosa-border)", flexShrink: 0 }}>
              <button type="button" onClick={() => { void onDownload(file.id); }}
                style={{ ...monoSm, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", background: "var(--color-success)", color: "#000", border: "none", cursor: "pointer", fontWeight: 700 }}>
                <Download style={{ width: 12, height: 12 }} /> Download
              </button>
              {canWrite && (
                <button type="button" onClick={() => setEditingTitle(true)}
                  style={{ ...monoSm, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", background: "none", color: "var(--text-secondary)", border: "none", borderLeft: "1px solid var(--sosa-border)", cursor: "pointer" }}>
                  <Pencil style={{ width: 12, height: 12 }} /> Rename
                </button>
              )}
              {canWrite && (
                <button type="button" onClick={() => { onMoveFile(file); onClose(); }}
                  style={{ ...monoSm, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", background: "none", color: "var(--text-secondary)", border: "none", borderLeft: "1px solid var(--sosa-border)", cursor: "pointer" }}>
                  <Move style={{ width: 12, height: 12 }} /> Move
                </button>
              )}
              {isOwner && !confirmDelete && (
                <button type="button" onClick={() => setConfirmDelete(true)}
                  style={{ ...monoSm, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", background: "rgba(255,45,85,0.07)", color: "var(--color-error)", border: "none", borderLeft: "1px solid var(--sosa-border)", cursor: "pointer" }}>
                  <Trash2 style={{ width: 12, height: 12 }} /> Trash
                </button>
              )}
              {isOwner && confirmDelete && (
                <>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    style={{ ...monoSm, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 0", background: "none", color: "var(--text-tertiary)", border: "none", borderLeft: "1px solid var(--sosa-border)", cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => { onMoveToTrash(file.id); onClose(); }}
                    style={{ ...monoSm, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", background: "var(--color-error)", color: "#fff", border: "none", borderLeft: "1px solid var(--sosa-border)", cursor: "pointer", fontWeight: 700 }}>
                    <Trash2 style={{ width: 12, height: 12 }} /> Confirm delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { usePortalDB } from "@/lib/portalContextDB";
import { supabase } from "@/lib/supabase";
import { broadcastLeadgenUpdate } from "@/lib/leadgenRealtime";
import { useLeadgenAllLeads, PAGE_SIZE, type AllLeadsFilters } from "@/hooks/leadgen/useLeadgenAllLeads";
import { useLeadgenMembers } from "@/hooks/leadgen/useLeadgenMembers";
// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFilters(p: URLSearchParams): AllLeadsFilters {
  return {
    search:           p.get("q") ?? "",
    websiteFilter:    (p.get("website") as AllLeadsFilters["websiteFilter"]) ?? "all",
    hasEmail:         p.get("email") === "1",
    hasPhone:         p.get("phone") === "1",
    reviewsFilter:    (p.get("reviews") as AllLeadsFilters["reviewsFilter"]) ?? "all",
    ratingFilter:     (p.get("rating")  as AllLeadsFilters["ratingFilter"])  ?? "all",
    statusFilter:     (p.get("status")  as AllLeadsFilters["statusFilter"])  ?? "all",
    assignmentFilter: (p.get("assign")  as AllLeadsFilters["assignmentFilter"]) ?? "all",
    categories:       p.get("cat") ? p.get("cat")!.split(",").filter(Boolean) : [],
    sortBy:           (p.get("sort") as AllLeadsFilters["sortBy"]) ?? "created_at",
    sortDir:          (p.get("dir")  as AllLeadsFilters["sortDir"])  ?? "desc",
    page:             parseInt(p.get("page") ?? "1", 10) || 1,
  };
}

const STATUS_LABELS: Record<string, string> = {
  new:       "Non contattato",
  contacted: "Contattato",
  replied:   "In trattativa",
  qualified: "In trattativa",
  converted: "Convertito",
  rejected:  "Rifiutato",
};

const STATUS_COLORS: Record<string, string> = {
  new:       "var(--text-tertiary)",
  contacted: "var(--color-info)",
  replied:   "var(--accent-primary)",
  qualified: "var(--accent-primary)",
  converted: "var(--color-success)",
  rejected:  "var(--color-error)",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ── Filter sub-components ─────────────────────────────────────────────────────

const selStyle: React.CSSProperties = {
  background: "var(--glass-bg)", border: "0.5px solid var(--glass-border)",
  color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 11,
  padding: "6px 10px", cursor: "pointer", outline: "none",
};

function CategoryDropdown({ categories, selected, onChange }: {
  categories: string[]; selected: string[]; onChange: (c: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = selected.length === 0
    ? "Categoria: tutte"
    : selected.length === 1 ? selected[0] : `Categorie (${selected.length})`;
  const toggle = (cat: string) =>
    onChange(selected.includes(cat) ? selected.filter((c) => c !== cat) : [...selected, cat]);
  if (categories.length === 0) return null;
  return (
    <div style={{ position: "relative" }}>
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />}
      <button onClick={() => setOpen((p) => !p)} style={{ ...selStyle, display: "flex", alignItems: "center", gap: 6 }}>
        {label} {open ? "↑" : "↓"}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 100, background: "var(--sosa-bg)", border: "0.5px solid var(--glass-border)", maxHeight: 220, overflowY: "auto", minWidth: 200 }}>
          {selected.length > 0 && (
            <div onClick={() => onChange([])} style={{ padding: "6px 12px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-error)", borderBottom: "1px solid var(--glass-border)" }}>
              ✕ Deseleziona tutto
            </div>
          )}
          {categories.map((cat) => {
            const active = selected.includes(cat);
            return (
              <div key={cat} onClick={() => toggle(cat)} style={{ padding: "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--font-mono)", fontSize: 11, color: active ? "var(--accent-primary)" : "var(--text-secondary)", background: active ? "rgba(255,255,255,0.04)" : "transparent" }}>
                <span style={{ fontSize: 8 }}>{active ? "◆" : "●"}</span>
                {cat}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortTh({ col, label, active, dir, onSort }: { col: string; label: string; active: boolean; dir: "asc" | "desc"; onSort: () => void }) {
  return (
    <th onClick={onSort} style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", padding: "9px 12px", textAlign: "left", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", borderBottom: "1px solid var(--glass-border)", color: active ? "var(--accent-primary)" : "var(--text-tertiary)" }}>
      {label}{active ? (dir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function StaticTh({ label }: { label: string }) {
  return (
    <th style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", padding: "9px 12px", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--glass-border)", color: "var(--text-tertiary)" }}>
      {label}
    </th>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeadgenAllLeads() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentPortal, currentPortalId } = usePortalDB();
  const navigate = useNavigate();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [takingLeadId, setTakingLeadId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
  }, []);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const { leads, total, categories, loading, refetch } = useLeadgenAllLeads(filters);
  const { members } = useLeadgenMembers();

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.display_name ?? m.email])),
    [members]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const prefix = `/${currentPortal?.slug ?? ""}`;

  const setParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === "all" || value === "") next.delete(key);
      else next.set(key, value);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSort = useCallback((col: AllLeadsFilters["sortBy"]) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const cur = next.get("sort") ?? "created_at";
      const curDir = next.get("dir") ?? "desc";
      if (cur === col) next.set("dir", curDir === "asc" ? "desc" : "asc");
      else { next.set("sort", col); next.set("dir", "asc"); }
      next.delete("page");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleTakeLead = useCallback(async (leadId: string) => {
    if (!currentUserId || !currentPortalId) return;
    setTakingLeadId(leadId);
    const now = new Date().toISOString();
    const { error } = await supabase.from("leadgen_leads").update({
      assigned_to: currentUserId,
      assigned_at: now,
      assigned_by: currentUserId,
      last_activity_at: now,
      updated_at: now,
    }).eq("id", leadId).eq("portal_id", currentPortalId);
    setTakingLeadId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Lead preso in carico");
    broadcastLeadgenUpdate("lead_updated", { leadId });
    refetch();
  }, [currentUserId, currentPortalId, refetch]);

  const hasActive = [...searchParams.keys()].some((k) => k !== "page");
  const sortProps = (col: AllLeadsFilters["sortBy"]) => ({ col, active: filters.sortBy === col, dir: filters.sortDir, onSort: () => setSort(col) });

  return (
    <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Tutti i Lead
        </h1>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
          {loading ? "..." : `${total.toLocaleString("it-IT")} lead trovati`}
        </span>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <input type="text" placeholder="→ Cerca nome, indirizzo, categoria..." value={filters.search} onChange={(e) => setParam("q", e.target.value)} style={{ ...selStyle, flex: "1 1 220px", minWidth: 180 }} />

        <select value={filters.websiteFilter} onChange={(e) => setParam("website", e.target.value)} style={selStyle}>
          <option value="all">Sito: tutti</option>
          <option value="with">Con sito</option>
          <option value="without">Senza sito</option>
        </select>

        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={filters.hasEmail} onChange={(e) => setParam("email", e.target.checked ? "1" : null)} />
          Con email
        </label>

        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={filters.hasPhone} onChange={(e) => setParam("phone", e.target.checked ? "1" : null)} />
          Con telefono
        </label>

        <select value={filters.statusFilter} onChange={(e) => setParam("status", e.target.value)} style={selStyle}>
          <option value="all">Stato: tutti</option>
          <option value="new">Non contattati</option>
          <option value="contacted">Contattati</option>
          <option value="negotiation">In trattativa</option>
          <option value="converted">Convertiti</option>
          <option value="rejected">Rifiutati</option>
        </select>

        <select value={filters.assignmentFilter} onChange={(e) => setParam("assign", e.target.value)} style={selStyle}>
          <option value="all">Assegnazione: tutti</option>
          <option value="me">Assegnati a me</option>
          <option value="unassigned">Non assegnati</option>
        </select>

        <CategoryDropdown categories={categories} selected={filters.categories} onChange={(cats) => setParam("cat", cats.join(","))} />

        <select value={filters.reviewsFilter} onChange={(e) => setParam("reviews", e.target.value)} style={selStyle}>
          <option value="all">Recensioni: tutte</option>
          <option value="lt50">Meno di 50</option>
          <option value="50_200">50–200</option>
          <option value="200_500">200–500</option>
          <option value="gt500">Più di 500</option>
        </select>

        <select value={filters.ratingFilter} onChange={(e) => setParam("rating", e.target.value)} style={selStyle}>
          <option value="all">Rating: tutti</option>
          <option value="lt35">Meno di 3.5 ★</option>
          <option value="35_42">3.5–4.2 ★</option>
          <option value="gt42">Più di 4.2 ★</option>
        </select>

        {hasActive && (
          <button onClick={() => setSearchParams({}, { replace: true })} style={{ ...selStyle, color: "var(--color-error)", border: "0.5px solid var(--color-error)", background: "transparent" }}>
            ✕ Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, background: "var(--glass-bg)", border: "0.5px solid var(--glass-border)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--sosa-bg)", zIndex: 1 }}>
            <tr>
              <SortTh label="Nome"        {...sortProps("name")} />
              <StaticTh label="Categoria" />
              <StaticTh label="Città" />
              <StaticTh label="Sito" />
              <StaticTh label="Telefono" />
              <SortTh label="Recensioni"  {...sortProps("reviews_count")} />
              <SortTh label="Rating"      {...sortProps("rating")} />
              <SortTh label="Stato"       {...sortProps("outreach_status")} />
              <StaticTh label="Assegnato a" />
              <SortTh label="Aggiunto il" {...sortProps("created_at")} />
              <th style={{ borderBottom: "1px solid var(--glass-border)", width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)" }}>Caricamento...</td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)" }}>Nessun lead trovato con i filtri selezionati.</td></tr>
            )}
            {!loading && leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => navigate(`${prefix}/leadgen/lead/${lead.id}`)}
                style={{ borderBottom: "1px solid var(--glass-border)", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--accent-primary)" }}>{lead.name}</span>
                </td>
                <td style={{ padding: "9px 12px" }}>
                  {lead.category
                    ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)", background: "rgba(255,255,255,0.06)", padding: "2px 6px" }}>{lead.category}</span>
                    : <Dim />}
                </td>
                <td style={{ padding: "9px 12px" }}><Mono>{lead.city ?? "—"}</Mono></td>
                <td style={{ padding: "9px 12px" }} onClick={(e) => e.stopPropagation()}>
                  {lead.website
                    ? <a href={lead.website} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent-primary)", textDecoration: "none" }}>→ Apri</a>
                    : <Dim />}
                </td>
                <td style={{ padding: "9px 12px" }}><Mono>{lead.phone ?? "—"}</Mono></td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}><Mono>{lead.reviews_count != null ? lead.reviews_count.toLocaleString("it-IT") : "—"}</Mono></td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}><Mono>{lead.rating != null ? lead.rating.toFixed(1) : "—"}</Mono></td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: STATUS_COLORS[lead.outreach_status] ?? "var(--text-tertiary)" }}>
                    {STATUS_LABELS[lead.outreach_status] ?? lead.outreach_status}
                  </span>
                </td>
                <td style={{ padding: "9px 12px" }}><Mono>{lead.assigned_to ? (memberMap.get(lead.assigned_to) ?? "—") : "—"}</Mono></td>
                <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}><Mono dim>{fmtDate(lead.created_at)}</Mono></td>
                <td style={{ padding: "4px 8px", width: 40 }} onClick={(e) => e.stopPropagation()}>
                  {currentUserId && !lead.assigned_to && (
                    <button
                      onClick={() => handleTakeLead(lead.id)}
                      disabled={takingLeadId === lead.id}
                      title="Prendi in carico"
                      style={{
                        background: "var(--accent-primary)", border: "none", color: "#000",
                        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
                        padding: "4px 8px", cursor: takingLeadId === lead.id ? "not-allowed" : "pointer",
                        opacity: takingLeadId === lead.id ? 0.5 : 1, whiteSpace: "nowrap",
                      }}
                    >
                      {takingLeadId === lead.id ? "⏳" : "🤙"}
                    </button>
                  )}
                  {lead.assigned_to === currentUserId && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--color-success)", fontWeight: 700 }}>✓</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
            Pagina {filters.page} di {totalPages} · {total.toLocaleString("it-IT")} totali
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={filters.page <= 1} onClick={() => setParam("page", String(filters.page - 1))} style={{ ...selStyle, opacity: filters.page <= 1 ? 0.4 : 1, cursor: filters.page <= 1 ? "not-allowed" : "pointer" }}>← Precedente</button>
            <button disabled={filters.page >= totalPages} onClick={() => setParam("page", String(filters.page + 1))} style={{ ...selStyle, opacity: filters.page >= totalPages ? 0.4 : 1, cursor: filters.page >= totalPages ? "not-allowed" : "pointer" }}>Successiva →</button>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Tiny display helpers ──────────────────────────────────────────────────────
function Mono({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: dim ? "var(--text-tertiary)" : "var(--text-secondary)" }}>{children}</span>;
}
function Dim() {
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>—</span>;
}

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, Globe, Mail, MapPin, Star,
  Instagram, Facebook, Twitter, Linkedin, Loader2, Plus, ExternalLink, Trash2, Pencil, Check, X as XIcon2, Lock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePortalDB } from "@/lib/portalContextDB";
import { STATUS_CONFIG } from "@/components/leadgen/LeadOutreachStatusBadge";
import { useLeadgenLeadNotes } from "@/hooks/leadgen/useLeadgenLeadNotes";
import type { LeadgenLead, LeadgenOutreachEvent, OutreachStatus, OutreachChannel, OutreachDirection } from "@/types/leadgen";
import { broadcastLeadgenUpdate } from "@/lib/leadgenRealtime";
import { useLeadgenMembers, type LeadgenMemberWithProfile } from "@/hooks/leadgen/useLeadgenMembers";

const CHANNELS: { value: OutreachChannel; label: string }[] = [
  { value: "email",        label: "Email" },
  { value: "dm_instagram", label: "DM Instagram" },
  { value: "call",         label: "Telefonata" },
  { value: "pec",          label: "PEC" },
];
const DIRECTIONS: { value: OutreachDirection; label: string }[] = [
  { value: "outbound", label: "Uscente" },
  { value: "inbound",  label: "Entrante" },
];

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i} size={12} strokeWidth={1.5}
          fill={rating >= i ? "#facc15" : "none"}
          color={rating >= i ? "#facc15" : "var(--text-tertiary)"}
        />
      ))}
    </span>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5 }}>
        {children}
      </span>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
  letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 16,
};

function ReassignModal({ lead, teamMembers, onClose, onSaved }: {
  lead: LeadgenLead;
  teamMembers: LeadgenMemberWithProfile[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currentPortalId } = usePortalDB();
  const [selectedUserId, setSelectedUserId] = useState(lead.assigned_to ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!currentPortalId) return;
    setSaving(true);
    const now = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();

    const isRelease = selectedUserId === "";

    const { error } = await supabase.from("leadgen_leads").update({
      assigned_to: isRelease ? null : selectedUserId,
      assigned_at: isRelease ? null : now,
      assigned_by: user?.id ?? null,
      last_activity_at: now,
    }).eq("portal_id", currentPortalId).eq("id", lead.id);

    if (error) { toast.error(error.message); setSaving(false); return; }

    const targetMember = teamMembers.find((m) => m.user_id === selectedUserId);
    await supabase.from("leadgen_outreach_events").insert({
      portal_id: currentPortalId,
      lead_id: lead.id,
      channel: "email" as const,
      direction: "outbound" as const,
      notes: isRelease
        ? "Rilasciato al pool dall'admin"
        : `Riassegnato a ${targetMember?.display_name ?? targetMember?.email ?? selectedUserId}`,
      occurred_at: now,
      user_id: user?.id ?? null,
    });

    broadcastLeadgenUpdate("lead_updated", { leadId: lead.id });
    toast.success(isRelease ? "Lead rilasciato al pool" : "Lead riassegnato");
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}>
      <div style={{ background: "var(--sosa-bg)", border: "1.5px solid var(--glass-border)", width: "100%", maxWidth: 400, padding: 28 }}
        onClick={(e) => e.stopPropagation()}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 6 }}>Riassegnazione</p>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>{lead.name}</h2>

        <div style={{ marginBottom: 24 }}>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", display: "block", marginBottom: 8 }}>
            Assegna a
          </label>
          <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
            className="glass-input" style={{ width: "100%" }}>
            <option value="">— Pool (non assegnato)</option>
            {teamMembers.filter((m) => m.active).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name ?? m.email} ({m.role})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className="btn-glass-ds">Annulla</button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {saving && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeadgenLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { currentPortalId } = usePortalDB();
  const navigate = useNavigate();

  const [lead, setLead] = useState<LeadgenLead | null>(null);
  const [events, setEvents] = useState<LeadgenOutreachEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [channel, setChannel] = useState<OutreachChannel>("email");
  const [direction, setDirection] = useState<OutreachDirection>("outbound");
  const [eventNotes, setEventNotes] = useState("");
  const [addingEvent, setAddingEvent] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);

  const [status, setStatus] = useState<OutreachStatus>("new");
  const [outreachNotes, setOutreachNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState(false);

  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEventDraft, setEditEventDraft] = useState<{ channel: OutreachChannel; direction: OutreachDirection; notes: string }>({ channel: "email", direction: "outbound", notes: "" });
  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteDraft, setEditNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);

  const { notes, addNote, deleteNote, updateNote } = useLeadgenLeadNotes(id);
  const { members: teamMembers, currentMember } = useLeadgenMembers();
  const memberMap = new Map(teamMembers.map((m) => [m.user_id, m.display_name ?? m.user_id]));
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showReassign, setShowReassign] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
  }, []);

  const isLeadgenAdmin = currentMember?.role === "owner" || currentMember?.role === "admin";

  const refetchLead = useCallback(async () => {
    if (!id || !currentPortalId) return;
    const [{ data: leadRow }, { data: eventsRows }] = await Promise.all([
      supabase.from("leadgen_leads").select("*").eq("id", id).eq("portal_id", currentPortalId).single(),
      supabase.from("leadgen_outreach_events").select("*").eq("lead_id", id).eq("portal_id", currentPortalId).order("occurred_at", { ascending: false }),
    ]);
    if (leadRow) {
      const l = leadRow as LeadgenLead;
      setLead(l);
      setStatus(l.outreach_status);
      setOutreachNotes(l.outreach_notes ?? "");
      setAssignedTo(l.assigned_to ?? "");
      setContactName(l.contact_name ?? "");
      setContactRole(l.contact_role ?? "");
      setContactEmail(l.contact_email ?? "");
      setContactPhone(l.contact_phone ?? "");
    }
    setEvents((eventsRows ?? []) as LeadgenOutreachEvent[]);
    setLoading(false);
  }, [id, currentPortalId]);

  useEffect(() => { refetchLead(); }, [refetchLead]);

  const handleSaveContact = async () => {
    if (!lead || !currentPortalId) return;
    setSavingContact(true);
    const { error } = await supabase
      .from("leadgen_leads")
      .update({
        contact_name: contactName.trim() || null,
        contact_role: contactRole.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id).eq("portal_id", currentPortalId);
    setSavingContact(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Contatto aggiornato");
      setLead((prev) => prev ? { ...prev, contact_name: contactName.trim() || null, contact_role: contactRole.trim() || null, contact_email: contactEmail.trim() || null, contact_phone: contactPhone.trim() || null } : prev);
      setEditingContact(false);
    }
  };

  const [assigningSelf, setAssigningSelf] = useState(false);
  const handleAssignSelf = async () => {
    if (!lead || !currentPortalId || !currentUserId) return;
    setAssigningSelf(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("leadgen_leads").update({
      assigned_to: currentUserId,
      assigned_at: now,
      assigned_by: currentUserId,
      last_activity_at: now,
      updated_at: now,
    }).eq("id", lead.id).eq("portal_id", currentPortalId);
    if (error) { toast.error(error.message); setAssigningSelf(false); return; }
    setAssignedTo(currentUserId);
    setLead((prev) => prev ? { ...prev, assigned_to: currentUserId, assigned_at: now } : prev);
    broadcastLeadgenUpdate("lead_updated", { leadId: lead.id });
    toast.success("Lead assegnato a te");
    setAssigningSelf(false);
  };

  const handleSaveMeta = async () => {
    if (!lead || !currentPortalId) return;
    setSavingMeta(true);
    const { error } = await supabase
      .from("leadgen_leads")
      .update({
        outreach_status: status,
        outreach_notes: outreachNotes,
        assigned_to: assignedTo || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id).eq("portal_id", currentPortalId);
    setSavingMeta(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Aggiornato");
      setLead((prev) => prev ? { ...prev, outreach_status: status, outreach_notes: outreachNotes, assigned_to: assignedTo || null } : prev);
      broadcastLeadgenUpdate("lead_updated", { leadId: lead.id });
    }
  };

  const handleAddEvent = async () => {
    if (!lead || !currentPortalId) return;
    setAddingEvent(true);
    const { data: row, error } = await supabase
      .from("leadgen_outreach_events")
      .insert({ portal_id: currentPortalId, lead_id: lead.id, channel, direction, notes: eventNotes || null })
      .select().single();
    setAddingEvent(false);
    if (error) { toast.error(error.message); return; }
    setEvents((prev) => [row as LeadgenOutreachEvent, ...prev]);
    setEventNotes("");
    setShowAddEvent(false);
    toast.success("Evento aggiunto");
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    const { error } = await addNote(newNote.trim());
    setAddingNote(false);
    if (error) toast.error(error);
    else setNewNote("");
  };

  const handleDeleteNote = async (noteId: string) => {
    const { error } = await deleteNote(noteId);
    if (error) toast.error(error);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!currentPortalId) return;
    setDeletingEventId(eventId);
    const { error } = await supabase
      .from("leadgen_outreach_events")
      .delete()
      .eq("id", eventId)
      .eq("portal_id", currentPortalId);
    setDeletingEventId(null);
    if (error) { toast.error(error.message); return; }
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    toast.success("Evento eliminato");
  };

  const handleEditEvent = (ev: LeadgenOutreachEvent) => {
    setEditingEventId(ev.id);
    setEditEventDraft({ channel: ev.channel, direction: ev.direction, notes: ev.notes ?? "" });
  };

  const handleSaveEvent = async (eventId: string) => {
    if (!currentPortalId) return;
    setSavingEventId(eventId);
    const { error } = await supabase
      .from("leadgen_outreach_events")
      .update({ channel: editEventDraft.channel, direction: editEventDraft.direction, notes: editEventDraft.notes || null })
      .eq("id", eventId)
      .eq("portal_id", currentPortalId);
    setSavingEventId(null);
    if (error) { toast.error(error.message); return; }
    setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, ...editEventDraft, notes: editEventDraft.notes || null } : e));
    setEditingEventId(null);
    toast.success("Evento aggiornato");
  };

  const handleEditNote = (noteId: string, content: string) => {
    setEditingNoteId(noteId);
    setEditNoteDraft(content);
  };

  const handleSaveNote = async (noteId: string) => {
    if (!editNoteDraft.trim()) return;
    setSavingNoteId(noteId);
    const { error } = await updateNote(noteId, editNoteDraft.trim());
    setSavingNoteId(null);
    if (error) { toast.error(error); return; }
    setEditingNoteId(null);
    toast.success("Nota aggiornata");
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
      <Loader2 size={18} style={{ animation: "spin 1s linear infinite", marginRight: 10 }} /> Caricamento...
    </div>
  );
  if (!lead) return (
    <div style={{ padding: 32, color: "var(--color-error)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Lead non trovato.</div>
  );

  const isMine = !!lead?.assigned_to && lead.assigned_to === currentUserId;
  const readOnly = !!lead?.assigned_to && !isMine && !isLeadgenAdmin;

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.name + " " + (lead.address ?? ""))}&query_place_id=${lead.place_id}`;
  const linkedinUrl = (lead.social_media?.linkedin as string | undefined)
    ?? `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(lead.name)}`;
  const instagramUrl = (lead.social_media?.instagram as string | undefined)
    ? `https://instagram.com/${(lead.social_media.instagram as string).replace("@", "")}`
    : null;
  const facebookUrl = (lead.social_media?.facebook as string | undefined) ?? null;
  const twitterUrl = (lead.social_media?.twitter as string | undefined)
    ? `https://twitter.com/${(lead.social_media.twitter as string).replace("@", "")}`
    : null;

  const statusCfg = STATUS_CONFIG[status];

  return (
    <div style={{ padding: "20px 28px" }}>
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 11, marginBottom: 20, padding: 0 }}
      >
        <ArrowLeft size={13} /> Indietro
      </button>

      {readOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "color-mix(in srgb, var(--glass-border) 50%, transparent)", border: "0.5px solid var(--glass-border)", marginBottom: 20 }}>
          <Lock size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
            {(() => {
              const owner = teamMembers.find((m) => m.user_id === lead.assigned_to);
              return `Lead di ${owner?.display_name ?? owner?.email ?? "un altro membro"}. Solo lui può modificarne lo stato.`;
            })()}
          </span>
        </div>
      )}

      {/* Hero header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {lead.category && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-tertiary)", display: "block", marginBottom: 6 }}>
              {lead.category}
            </span>
          )}
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
            {lead.name}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {lead.address && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={11} /> {lead.address}
              </span>
            )}
            {lead.rating && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Stars rating={lead.rating} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>{lead.rating.toFixed(1)}</span>
                {lead.reviews_count && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>({lead.reviews_count} rec.)</span>}
              </span>
            )}
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
              padding: "3px 10px", background: `color-mix(in srgb, ${statusCfg.color} 15%, transparent)`,
              border: `1px solid ${statusCfg.color}`, color: statusCfg.color,
            }}>
              {statusCfg.label}
            </span>
            {lead.assigned_to && memberMap.get(lead.assigned_to) && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", padding: "2px 8px" }}>
                → {memberMap.get(lead.assigned_to)}
              </span>
            )}
          </div>
          {isLeadgenAdmin && (
            <button
              onClick={() => setShowReassign(true)}
              className="btn-glass-ds"
              style={{ fontSize: 10, marginTop: 8 }}
            >
              Riassegna
            </button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {lead.phone && (
          <a href={`tel:${lead.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
            <Phone size={13} /> {lead.phone}
          </a>
        )}
        {lead.emails?.[0] && (
          <a href={`mailto:${lead.emails[0]}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
            <Mail size={13} /> {lead.emails[0]}
          </a>
        )}
        {lead.website && (
          <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--accent-primary)", border: "1.5px solid var(--accent-primary)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#000", textDecoration: "none", letterSpacing: "0.04em" }}>
            <Globe size={13} /> Sito web ↗
          </a>
        )}
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
          <MapPin size={13} /> Google Maps ↗
        </a>
        <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
          <Linkedin size={13} /> LinkedIn ↗
        </a>
        {instagramUrl && (
          <a href={instagramUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
            <Instagram size={13} /> Instagram ↗
          </a>
        )}
        {facebookUrl && (
          <a href={facebookUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
            <Facebook size={13} /> Facebook ↗
          </a>
        )}
        {twitterUrl && (
          <a href={twitterUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "var(--glass-bg)", border: "1.5px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", letterSpacing: "0.04em" }}>
            <Twitter size={13} /> Twitter ↗
          </a>
        )}
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24, alignItems: "start" }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Info card */}
          <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", padding: 20 }}>
            <p style={sectionLabel}>Informazioni azienda</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {lead.address    && <InfoRow label="Indirizzo">{lead.address}</InfoRow>}
              {lead.city       && <InfoRow label="Città">{lead.city}{lead.postal_code ? ` — ${lead.postal_code}` : ""}</InfoRow>}
              {lead.phone      && <InfoRow label="Telefono"><a href={`tel:${lead.phone}`} style={{ color: "var(--accent-primary)", textDecoration: "none" }}>{lead.phone}</a></InfoRow>}
              {lead.website    && <InfoRow label="Sito web"><a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)", textDecoration: "none" }}>{lead.website}</a></InfoRow>}
              {lead.emails?.length > 0 && (
                <InfoRow label="Email azienda">
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {lead.emails.map((e) => (
                      <a key={e} href={`mailto:${e}`} style={{ color: "var(--accent-primary)", textDecoration: "none", fontFamily: "var(--font-mono)", fontSize: 12 }}>{e}</a>
                    ))}
                  </div>
                </InfoRow>
              )}
              {lead.rating     && <InfoRow label="Rating"><Stars rating={lead.rating} /> <span style={{ marginLeft: 6 }}>{lead.rating.toFixed(1)} / 5 ({lead.reviews_count ?? 0} rec.)</span></InfoRow>}
              {lead.category   && <InfoRow label="Categoria">{lead.category}</InfoRow>}
              <InfoRow label="Paese">{lead.country_code ?? "—"}</InfoRow>
            </div>
          </div>

          {/* Contatto principale — editable */}
          <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ ...sectionLabel, marginBottom: 0 }}>Contatto principale</p>
              {!editingContact ? (
                <button
                  onClick={() => setEditingContact(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid var(--glass-border)", padding: "4px 10px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", cursor: "pointer", letterSpacing: "0.06em" }}
                >
                  <Pencil size={10} /> Modifica
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setEditingContact(false); setContactName(lead.contact_name ?? ""); setContactRole(lead.contact_role ?? ""); setContactEmail(lead.contact_email ?? ""); setContactPhone(lead.contact_phone ?? ""); }}
                    style={{ background: "none", border: "1px solid var(--glass-border)", cursor: "pointer", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <XIcon2 size={10} /> Annulla
                  </button>
                  <button onClick={handleSaveContact} disabled={savingContact}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--accent-primary)", border: "none", padding: "4px 12px", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "#000", cursor: "pointer", letterSpacing: "0.06em" }}>
                    {savingContact ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={10} />} Salva
                  </button>
                </div>
              )}
            </div>

            {editingContact ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  { label: "Nome titolare", value: contactName, set: setContactName, placeholder: "Mario Rossi" },
                  { label: "Ruolo / Posizione", value: contactRole, set: setContactRole, placeholder: "Proprietario" },
                  { label: "Email personale", value: contactEmail, set: setContactEmail, placeholder: "mario@email.com" },
                  { label: "Telefono personale", value: contactPhone, set: setContactPhone, placeholder: "+39 333 000 0000" },
                ].map(({ label, value, set, placeholder }) => (
                  <div key={label}>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)", display: "block", marginBottom: 5 }}>
                      {label}
                    </label>
                    <input
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      placeholder={placeholder}
                      className="glass-input"
                      style={{ width: "100%", fontSize: 12 }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {lead.contact_name  && <InfoRow label="Nome titolare">{lead.contact_name}</InfoRow>}
                {lead.contact_role  && <InfoRow label="Ruolo">{lead.contact_role}</InfoRow>}
                {lead.contact_email && <InfoRow label="Email personale"><a href={`mailto:${lead.contact_email}`} style={{ color: "var(--accent-primary)", textDecoration: "none" }}>{lead.contact_email}</a></InfoRow>}
                {lead.contact_phone && <InfoRow label="Telefono personale"><a href={`tel:${lead.contact_phone}`} style={{ color: "var(--accent-primary)", textDecoration: "none" }}>{lead.contact_phone}</a></InfoRow>}
                {!lead.contact_name && !lead.contact_email && !lead.contact_phone && (
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)", gridColumn: "span 2" }}>
                    Nessun contatto personale. Clicca Modifica per aggiungere.
                  </p>
                )}
              </div>
            )}
          </div>


          {/* Outreach CRM */}
          <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", padding: 20 }}>
            <p style={sectionLabel}>Gestione outreach</p>

            {currentUserId && lead.assigned_to !== currentUserId && (
              <button
                onClick={handleAssignSelf}
                disabled={assigningSelf || readOnly}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "9px 16px", background: "var(--accent-primary)", border: "none",
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#000",
                  cursor: assigningSelf || readOnly ? "not-allowed" : "pointer",
                  letterSpacing: "0.06em", textTransform: "uppercase", opacity: readOnly ? 0.4 : 1,
                }}
              >
                {assigningSelf ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={12} />}
                Prendi in carico ↗
              </button>
            )}
          </div>

          {/* Notes card */}
          <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", padding: 20 }}>
            <p style={sectionLabel}>Note ({notes.length})</p>

            {/* Add note */}
            <div style={{ marginBottom: 16 }}>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Aggiungi una nota..."
                className="glass-input"
                rows={3}
                style={{ width: "100%", resize: "vertical", marginBottom: 8 }}
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim() || addingNote}
                className="btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
              >
                {addingNote && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
                <Plus size={12} /> Aggiungi nota
              </button>
            </div>

            {/* Notes list */}
            {notes.length === 0 ? (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)", textAlign: "center", padding: "16px 0" }}>
                Nessuna nota. Aggiungi la prima.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {notes.map((note, i) => (
                  <div
                    key={note.id}
                    style={{
                      padding: "12px 0",
                      borderTop: "1px solid var(--glass-border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {new Date(note.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                        {memberMap.get(note.author_id) && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--accent-primary)", fontWeight: 600 }}>
                            {memberMap.get(note.author_id)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => handleEditNote(note.id, note.content)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2, display: "inline-flex", alignItems: "center" }} title="Modifica nota">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => handleDeleteNote(note.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2, display: "inline-flex", alignItems: "center" }} title="Elimina nota">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    {editingNoteId === note.id ? (
                      <>
                        <textarea
                          value={editNoteDraft}
                          onChange={(e) => setEditNoteDraft(e.target.value)}
                          className="glass-input"
                          rows={3}
                          style={{ width: "100%", resize: "vertical", fontSize: 13, marginBottom: 8 }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => handleSaveNote(note.id)} disabled={savingNoteId === note.id} className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "5px 10px" }}>
                            {savingNoteId === note.id ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={11} />} Salva
                          </button>
                          <button onClick={() => setEditingNoteId(null)} style={{ background: "none", border: "1px solid var(--glass-border)", cursor: "pointer", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <XIcon2 size={11} /> Annulla
                          </button>
                        </div>
                      </>
                    ) : (
                      <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {note.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: event log */}
        <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <p style={{ ...sectionLabel, marginBottom: 0 }}>
              Log contatti ({events.length})
            </p>
            <button
              type="button"
              onClick={() => !readOnly && setShowAddEvent((p) => !p)}
              disabled={readOnly}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: showAddEvent ? "var(--accent-primary)" : "transparent", border: `1px solid ${showAddEvent ? "var(--accent-primary)" : "var(--glass-border)"}`, padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: showAddEvent ? "#000" : "var(--text-secondary)", cursor: readOnly ? "not-allowed" : "pointer", letterSpacing: "0.06em", opacity: readOnly ? 0.4 : 1 }}
            >
              <Plus size={11} /> Aggiungi
            </button>
          </div>

          {/* Add event form */}
          {showAddEvent && (
            <div style={{ background: "var(--sosa-bg-2)", border: "1px solid var(--glass-border)", padding: 14, marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary)", display: "block", marginBottom: 4 }}>Canale</label>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as OutreachChannel)} className="glass-input" style={{ width: "100%", fontSize: 11 }}>
                    {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary)", display: "block", marginBottom: 4 }}>Direzione</label>
                  <select value={direction} onChange={(e) => setDirection(e.target.value as OutreachDirection)} className="glass-input" style={{ width: "100%", fontSize: 11 }}>
                    {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
              </div>
              <textarea
                value={eventNotes}
                onChange={(e) => setEventNotes(e.target.value)}
                placeholder="Note sull'evento..."
                className="glass-input"
                rows={2}
                style={{ width: "100%", resize: "none", marginBottom: 10, fontSize: 12 }}
              />
              <button onClick={handleAddEvent} disabled={addingEvent} className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                {addingEvent && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
                Registra evento
              </button>
            </div>
          )}

          {/* Events list */}
          {events.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)" }}>Nessun contatto registrato.</p>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }}>Aggiungi il primo evento sopra.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {events.map((ev, i) => (
                <div
                  key={ev.id}
                  style={{
                    padding: "12px 0",
                    borderBottom: i < events.length - 1 ? "1px solid var(--glass-border)" : "none",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}
                >
                  {editingEventId === ev.id ? (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <select value={editEventDraft.channel} onChange={(e) => setEditEventDraft((d) => ({ ...d, channel: e.target.value as OutreachChannel }))} className="glass-input" style={{ fontSize: 11 }}>
                          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        <select value={editEventDraft.direction} onChange={(e) => setEditEventDraft((d) => ({ ...d, direction: e.target.value as OutreachDirection }))} className="glass-input" style={{ fontSize: 11 }}>
                          {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </div>
                      <textarea
                        value={editEventDraft.notes}
                        onChange={(e) => setEditEventDraft((d) => ({ ...d, notes: e.target.value }))}
                        className="glass-input"
                        rows={2}
                        style={{ width: "100%", resize: "none", fontSize: 12 }}
                        placeholder="Note..."
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => handleSaveEvent(ev.id)} disabled={savingEventId === ev.id} className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "5px 10px" }}>
                          {savingEventId === ev.id ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={11} />} Salva
                        </button>
                        <button onClick={() => setEditingEventId(null)} style={{ background: "none", border: "1px solid var(--glass-border)", cursor: "pointer", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <XIcon2 size={11} /> Annulla
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent-primary)" }}>
                          {CHANNELS.find((c) => c.value === ev.channel)?.label ?? ev.channel}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", background: "var(--sosa-bg-2)", padding: "1px 6px" }}>
                          {ev.direction === "outbound" ? "↗ Uscente" : "↙ Entrante"}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-tertiary)" }}>
                          {new Date(ev.occurred_at).toLocaleDateString("it-IT")} {new Date(ev.occurred_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <button onClick={() => handleEditEvent(ev)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2, display: "inline-flex", alignItems: "center" }} title="Modifica evento">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => handleDeleteEvent(ev.id)} disabled={deletingEventId === ev.id} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2, display: "inline-flex", alignItems: "center", opacity: deletingEventId === ev.id ? 0.4 : 1 }} title="Elimina evento">
                          {deletingEventId === ev.id ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={11} />}
                        </button>
                      </div>
                      {ev.notes && (
                        <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                          {ev.notes}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {showReassign && lead && (
        <ReassignModal
          lead={lead}
          teamMembers={teamMembers}
          onClose={() => setShowReassign(false)}
          onSaved={refetchLead}
        />
      )}
    </div>
  );
}

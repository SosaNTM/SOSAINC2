import { useState, useEffect } from "react";
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLeadgenSettings } from "@/hooks/leadgen/useLeadgenSettings";
import { testConnection } from "@/lib/apifyClient";
import { useLeadgenBlacklist } from "@/hooks/leadgen/useLeadgenBlacklist";
import { usePortalDB } from "@/lib/portalContextDB";
import { supabase } from "@/lib/supabase";
import type { BlacklistRuleType } from "@/types/leadgen";

const COUNTRIES = [
  { code: "IT", label: "IT — Italia" },
  { code: "FR", label: "FR — Francia" },
  { code: "DE", label: "DE — Germania" },
  { code: "ES", label: "ES — Spagna" },
  { code: "GB", label: "GB — Regno Unito" },
  { code: "US", label: "US — Stati Uniti" },
];

const blLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
  letterSpacing: "0.1em", textTransform: "uppercase",
  color: "var(--text-secondary)", display: "block", marginBottom: 8,
};

function BlacklistSection({
  title, help, rules, inputValue, onInputChange, onAdd, onRemove, adding,
}: {
  title: string;
  help: string;
  rules: import("@/types/leadgen").LeadgenBlacklist[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  adding: boolean;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <label style={blLabelStyle}>{title}</label>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", marginBottom: 10 }}>
        {help}
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!adding) onAdd(); } }}
          className="glass-input"
          style={{ flex: 1 }}
          placeholder="Aggiungi regola..."
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !inputValue.trim()}
          className="btn-glass-ds"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}
        >
          {adding ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={12} />}
          Aggiungi
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rules.map((r) => (
          <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)" }}>
            {r.rule_value}
            <button
              type="button"
              onClick={() => onRemove(r.id)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 0, display: "inline-flex" }}
            >
              <Trash2 size={10} />
            </button>
          </span>
        ))}
        {rules.length === 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>
            Nessuna regola
          </span>
        )}
      </div>
    </div>
  );
}

export default function LeadgenSettings() {
  const { data, loading, upsert } = useLeadgenSettings();
  const { currentPortalId } = usePortalDB();
  const [cleanupCount, setCleanupCount] = useState<number | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);

  const handleCountNoContact = async () => {
    if (!currentPortalId) return;
    setCleanupLoading(true);
    const { count } = await supabase
      .from("leadgen_leads")
      .select("id", { count: "exact", head: true })
      .eq("portal_id", currentPortalId)
      .or("phone.is.null,phone.eq.")
      .or("emails.eq.{},emails.is.null");
    setCleanupLoading(false);
    setCleanupCount(count ?? 0);
    setShowCleanupConfirm(true);
  };

  const handleCleanupNoContact = async () => {
    if (!currentPortalId) return;
    setCleanupLoading(true);
    const { error, count } = await supabase
      .from("leadgen_leads")
      .delete({ count: "exact" })
      .eq("portal_id", currentPortalId)
      .or("phone.is.null,phone.eq.")
      .or("emails.eq.{},emails.is.null");
    setCleanupLoading(false);
    setShowCleanupConfirm(false);
    setCleanupCount(null);
    if (error) toast.error(error.message);
    else toast.success(`Eliminati ${count ?? 0} lead senza contatti`);
  };

  const [token, setToken] = useState("");
  const [actorId, setActorId] = useState("compass~crawler-google-places");
  const [showToken, setShowToken] = useState(false);
  const [countryCode, setCountryCode] = useState("IT");
  const [language, setLanguage] = useState("it");
  const [maxPlaces, setMaxPlaces] = useState(50);
  const [scrapeContacts, setScrapeContacts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const { rules, loading: blLoading, addRule, removeRule, seedDefaults, byType } = useLeadgenBlacklist();
  const [newRuleInputs, setNewRuleInputs] = useState<Record<BlacklistRuleType, string>>({
    title_keyword: "",
    website_domain: "",
    category: "",
    min_reviews: "",
  });
  const [addingRule, setAddingRule] = useState<BlacklistRuleType | null>(null);

  useEffect(() => {
    if (data && !hydrated) {
      setToken(data.apify_token ?? "");
      setActorId(data.actor_id ?? "compass~crawler-google-places");
      setCountryCode(data.default_country_code);
      setLanguage(data.default_language);
      setMaxPlaces(data.default_max_places);
      setScrapeContacts(data.scrape_contacts);
      setHydrated(true);
    }
  }, [data, hydrated]);

  // Seed blacklist defaults once on first settings page load when blacklist is empty
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!blLoading && rules.length === 0) {
      seedDefaults();
    }
  }, [blLoading]); // intentionally omitting seedDefaults/rules: runs once after initial load

  useEffect(() => {
    const mr = byType("min_reviews")[0];
    if (mr) setNewRuleInputs((prev) => ({ ...prev, min_reviews: mr.rule_value }));
  }, [rules]); // byType is derived from rules — listing both causes double-trigger

  const handleSave = async () => {
    setSaving(true);
    const { error } = await upsert({
      apify_token: token || null,
      actor_id: actorId || "compass~crawler-google-places",
      default_country_code: countryCode,
      default_language: language,
      default_max_places: maxPlaces,
      scrape_contacts: scrapeContacts,
    });
    setSaving(false);
    if (error) toast.error(error);
    else toast.success("Impostazioni salvate");
  };

  const handleTest = async () => {
    if (!token) { toast.error("Inserisci un token Apify prima di testare"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const { username } = await testConnection(token);
      setTestResult({ ok: true, message: `Connesso come @${username}` });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Connessione fallita" });
    }
    setTesting(false);
  };

  const handleAddRule = async (type: BlacklistRuleType) => {
    const value = newRuleInputs[type].trim();
    if (!value) return;
    setAddingRule(type);
    const { error } = await addRule(type, value);
    setAddingRule(null);
    if (error) toast.error(error);
    else setNewRuleInputs((prev) => ({ ...prev, [type]: "" }));
  };

  const handleMinReviewsSave = async () => {
    const existing = byType("min_reviews")[0];
    const value = newRuleInputs.min_reviews.trim();
    if (existing) {
      const { error: removeErr } = await removeRule(existing.id);
      if (removeErr) { toast.error(removeErr); return; }
    }
    if (value && value !== "0") {
      const { error: addErr } = await addRule("min_reviews", value);
      if (addErr) { toast.error(addErr); return; }
    }
    toast.success("Soglia aggiornata");
  };

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Caricamento...</div>;
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 560 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
        Impostazioni Lead Generation
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-tertiary)", marginBottom: 32 }}>
        Configura token Apify e valori predefiniti per le ricerche.
      </p>

      {/* Token */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Token Apify
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="apify_api_xxxxxxxxxxxxxxxx"
              className="glass-input"
              style={{ width: "100%", paddingRight: 36 }}
            />
            <button
              type="button"
              onClick={() => setShowToken((p) => !p)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 0 }}
            >
              {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !token}
            className="btn-glass-ds"
            style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}
          >
            {testing && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
            Test connessione
          </button>
        </div>
        {testResult && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 12, color: testResult.ok ? "var(--color-success)" : "var(--color-error)" }}>
            {testResult.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {testResult.message}
          </div>
        )}
      </div>

      {/* Actor ID */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Actor ID Apify
        </label>
        <input
          type="text"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          placeholder="username~actor-name"
          className="glass-input"
          style={{ width: "100%" }}
        />
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", marginTop: 6, lineHeight: 1.7 }}>
          Vai su <strong style={{ color: "var(--text-secondary)" }}>apify.com</strong> → cerca "Google Maps Scraper" → copia l'ID dall'URL (es. <code>compass~crawler-google-places</code>). Assicurati di aver cliccato "Try for free" sull'actor.
        </p>
      </div>

      {/* Paese default */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Paese predefinito
        </label>
        <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="glass-input" style={{ width: "100%" }}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </div>

      {/* Language */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Lingua ricerca
        </label>
        <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} className="glass-input" style={{ width: "100%" }} placeholder="it" />
      </div>

      {/* Max places */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Max risultati per ricerca: <span style={{ color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>{maxPlaces}</span>
        </label>
        <input type="range" min={10} max={200} step={10} value={maxPlaces} onChange={(e) => setMaxPlaces(Number(e.target.value))} style={{ width: "100%" }} />
      </div>

      {/* Scrape contacts */}
      <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" id="scrape_contacts" checked={scrapeContacts} onChange={(e) => setScrapeContacts(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
        <label htmlFor="scrape_contacts" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
          Estrai email e contatti (costo extra: ~$2 / 1000 risultati)
        </label>
      </div>

      {/* Pricing info */}
      <div style={{ background: "var(--glass-bg)", border: "0.5px solid var(--glass-border)", borderRadius: "var(--radius-md)", padding: "14px 16px", marginBottom: 32, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.8 }}>
        <strong style={{ color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Prezzi Apify (piano Free)</strong>
        Ricerca risultati: ~$4 / 1000 risultati<br />
        Estrazione contatti: ~$2 / 1000 risultati<br />
        Il piano Free include $5 di credito mensile.
      </div>

      <button type="button" onClick={handleSave} disabled={saving} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {saving && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
        Salva impostazioni
      </button>

      {/* Divider */}
      <div style={{ height: 1, background: "var(--glass-border)", margin: "40px 0 32px" }} />

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
        Blacklist catene
      </h2>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-tertiary)", marginBottom: 28 }}>
        Le attività che corrispondono a queste regole vengono escluse dai risultati e conteggiate separatamente.
      </p>

      {blLoading ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)" }}>Caricamento regole...</div>
      ) : (
        <>
          <BlacklistSection
            title="Parole chiave nei nomi"
            help="Corrisponde se il nome dell'attività contiene la parola (case-insensitive)."
            rules={byType("title_keyword")}
            inputValue={newRuleInputs.title_keyword}
            onInputChange={(v) => setNewRuleInputs((p) => ({ ...p, title_keyword: v }))}
            onAdd={() => handleAddRule("title_keyword")}
            onRemove={removeRule}
            adding={addingRule === "title_keyword"}
          />

          <BlacklistSection
            title="Domini siti web"
            help="Corrisponde se il sito dell'attività contiene il dominio."
            rules={byType("website_domain")}
            inputValue={newRuleInputs.website_domain}
            onInputChange={(v) => setNewRuleInputs((p) => ({ ...p, website_domain: v }))}
            onAdd={() => handleAddRule("website_domain")}
            onRemove={removeRule}
            adding={addingRule === "website_domain"}
          />

          <BlacklistSection
            title="Categorie escluse"
            help="Corrisponde se la categoria Google dell'attività è nella lista."
            rules={byType("category")}
            inputValue={newRuleInputs.category}
            onInputChange={(v) => setNewRuleInputs((p) => ({ ...p, category: v }))}
            onAdd={() => handleAddRule("category")}
            onRemove={removeRule}
            adding={addingRule === "category"}
          />

          {/* Min reviews */}
          <div style={{ marginBottom: 28 }}>
            <label style={blLabelStyle}>Soglia recensioni</label>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", marginBottom: 10 }}>
              Attività con più recensioni di questo numero sono considerate catene ed escluse. Lascia 0 per disattivare.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min={0}
                value={newRuleInputs.min_reviews}
                onChange={(e) => setNewRuleInputs((p) => ({ ...p, min_reviews: e.target.value }))}
                className="glass-input"
                style={{ width: 120 }}
                placeholder="5000"
              />
              <button type="button" onClick={handleMinReviewsSave} className="btn-glass-ds" style={{ fontSize: 11 }}>
                Salva soglia
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cleanup section */}
      <div style={{ height: 1, background: "var(--glass-border)", margin: "40px 0 32px" }} />
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
        Pulizia dati
      </h2>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-tertiary)", marginBottom: 20 }}>
        Rimuovi lead salvati prima che il filtro "senza contatti" fosse attivo.
      </p>

      {!showCleanupConfirm ? (
        <button
          type="button"
          onClick={handleCountNoContact}
          disabled={cleanupLoading}
          className="btn-glass-ds"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-error)", borderColor: "var(--color-error)" }}
        >
          {cleanupLoading && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
          <Trash2 size={13} />
          Pulisci lead senza contatti
        </button>
      ) : (
        <div style={{ background: "color-mix(in srgb, var(--color-error) 8%, transparent)", border: "1px solid var(--color-error)", padding: 16 }}>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)", marginBottom: 12 }}>
            Trovati <strong>{cleanupCount}</strong> lead senza né telefono né email. Eliminarli?
            Questa operazione non è reversibile.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleCleanupNoContact}
              disabled={cleanupLoading}
              style={{ padding: "8px 16px", background: "var(--color-error)", border: "none", color: "#fff", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {cleanupLoading && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
              Elimina {cleanupCount} lead
            </button>
            <button
              type="button"
              onClick={() => { setShowCleanupConfirm(false); setCleanupCount(null); }}
              className="btn-glass-ds"
              style={{ fontSize: 11 }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

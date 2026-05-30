import { useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  BarChart2, TrendingUp, TrendingDown, Minus,
  Plus, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown,
} from "lucide-react";
import { LiquidGlassCard, LiquidGlassFilter } from "@/components/ui/liquid-glass-card";
import {
  useFinanceSummary,
  currentMonthRange,
  lastNMonthsRange,
  lastNDaysRange,
  lastMonthRange,
  lastYearRange,
} from "@/hooks/useFinanceSummary";
import type { DateRange } from "@/hooks/useFinanceSummary";
import { useTransactions } from "@/hooks/useTransactions";
import { useDebounce } from "@/hooks/useDebounce";
import { useNumberFormat } from "@/lib/numberFormat";
import { usePortal } from "@/lib/portalContext";
import { useCategories } from "@/hooks/useCategories";
import { useExpenseCategories } from "@/hooks/settings";
import type { PersonalTransaction } from "@/types/finance";
import { TransactionDrillDownModal } from "@/components/finance/TransactionDrillDownModal";
import { CalendarHeatmap } from "@/components/finance/CalendarHeatmap";
import { AddTransactionModal } from "@/components/finance/AddTransactionModal";

// ── Period types & helpers ────────────────────────────────────────────────────

type Period = "today" | "7days" | "30days" | "month" | "prevmonth" | "3months" | "year" | "prevyear" | "custom";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today",     label: "Oggi"           },
  { value: "7days",     label: "7 giorni"        },
  { value: "30days",    label: "30 giorni"       },
  { value: "month",     label: "Questo mese"     },
  { value: "prevmonth", label: "Mese scorso"     },
  { value: "3months",   label: "3 mesi"          },
  { value: "year",      label: "Anno corrente"   },
  { value: "prevyear",  label: "Anno scorso"     },
  { value: "custom",    label: "Personalizzato"  },
];

function thisYearRange(): DateRange {
  const y     = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${y}-01-01`, to: today };
}

function todayRange(): DateRange {
  const d = new Date().toISOString().slice(0, 10);
  return { from: d, to: d };
}

function getRange(period: Period, customFrom: string, customTo: string): DateRange {
  switch (period) {
    case "today":     return todayRange();
    case "7days":     return lastNDaysRange(7);
    case "30days":    return lastNDaysRange(30);
    case "month":     return currentMonthRange();
    case "prevmonth": return lastMonthRange();
    case "3months":   return lastNMonthsRange(3);
    case "year":      return thisYearRange();
    case "prevyear":  return lastYearRange();
    case "custom":    return { from: customFrom || currentMonthRange().from, to: customTo || currentMonthRange().to };
  }
}

function getPrevRange(range: DateRange): DateRange {
  const from = new Date(range.from);
  const to   = new Date(range.to);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const pTo   = new Date(from); pTo.setDate(pTo.getDate() - 1);
  const pFrom = new Date(pTo);  pFrom.setDate(pFrom.getDate() - days + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(pFrom), to: fmt(pTo) };
}

// ── Shared glass tooltip ──────────────────────────────────────────────────────

type RecapPayloadEntry = { name: string; value: number; color?: string; stroke?: string };
function GlassTip({ active, payload, label, fmt }: { active?: boolean; payload?: RecapPayloadEntry[]; label?: string; fmt?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--glass-bg-elevated)", border: "1px solid var(--glass-border)",
      borderRadius: 10, padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12,
    }}>
      {label && <p style={{ color: "var(--text-tertiary)", margin: "0 0 4px", fontSize: 11 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color ?? p.stroke ?? "var(--text-primary)", margin: "2px 0", fontWeight: 600 }}>
          {p.name}: {fmt ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

type RecapPieTipProps = { active?: boolean; payload?: Array<{ name: string; value: number; payload: { pct: number; fmtAmt: string } }> };
function PieTip({ active, payload }: RecapPieTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "var(--glass-bg-elevated)", border: "1px solid var(--glass-border)",
      borderRadius: 10, padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12,
    }}>
      <p style={{ fontWeight: 700, color: "var(--text-primary)", margin: "0 0 2px" }}>{payload[0].name}</p>
      <p style={{ color: "var(--text-tertiary)", margin: 0, fontSize: 11 }}>
        {d.pct}% · {d.fmtAmt}
      </p>
    </div>
  );
}

// ── Delta badge ───────────────────────────────────────────────────────────────

function DeltaBadge({ delta, inverse = false }: { delta: number | undefined; inverse?: boolean }) {
  if (delta === undefined) return <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>—</span>;
  const good = inverse ? delta < 0 : delta > 0;
  const color = delta === 0 ? "var(--text-tertiary)" : good ? "var(--color-success)" : "var(--color-error)";
  const Icon  = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontFamily: "var(--font-mono)", color }}>
      <Icon style={{ width: 10, height: 10 }} />
      {delta > 0 ? "+" : ""}{delta}%
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ h, r = 10, mb = 0 }: { h: number; r?: number; mb?: number }) {
  return (
    <div style={{
      height: h, borderRadius: r, marginBottom: mb,
      background: "var(--glass-bg)", opacity: 0.6,
      animation: "recap-pulse 1.5s ease-in-out infinite",
    }} />
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
  inverseColor?: boolean;
  color?: string;
  sub?: string;
  loading: boolean;
  onClick?: () => void;
}

function KpiCard({ label, value, delta, inverseColor = false, color, sub, loading, onClick }: KpiCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: "1 1 0", minWidth: 0, padding: "16px 18px",
        background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
        borderRadius: 12, cursor: onClick ? "pointer" : "default",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.background = "var(--glass-bg-elevated)"; }}
      onMouseLeave={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.background = "var(--glass-bg)"; }}
    >
      <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: "0 0 6px" }}>
        {label}
      </p>
      {loading ? (
        <>
          <Skel h={28} r={6} mb={6} />
          <Skel h={14} r={4} />
        </>
      ) : (
        <>
          <p style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text-primary)", margin: "0 0 4px", fontFamily: "var(--font-mono)", letterSpacing: "-0.5px" }}>
            {value}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DeltaBadge delta={delta} inverse={inverseColor} />
            {sub && <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{sub}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Donut chart card ──────────────────────────────────────────────────────────

interface DonutSlice { name: string; value: number; pct: number; color: string; fmtAmt: string }

interface DonutCardProps {
  title: string;
  total: string;
  data: DonutSlice[];
  loading: boolean;
  activeIndex: number | null;
  onSliceClick: (name: string | null, index: number | null) => void;
}

function DonutCard({ title, total, data, loading, activeIndex, onSliceClick }: DonutCardProps) {
  return (
    <LiquidGlassCard accentColor="var(--accent-primary)" hover={false}>
      <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: "0 0 12px" }}>
        {title}
      </p>
      {loading ? (
        <Skel h={200} r={12} />
      ) : data.length === 0 ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text-tertiary)", fontSize: 13, fontFamily: "var(--font-mono)" }}>Nessun dato nel periodo</span>
        </div>
      ) : (
        <>
          <div style={{ position: "relative" }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data} cx="50%" cy="50%"
                  innerRadius={52} outerRadius={82}
                  dataKey="value" nameKey="name" stroke="none"
                  onClick={(_, idx) => {
                    if (activeIndex === idx) onSliceClick(null, null);
                    else onSliceClick(data[idx].name, idx);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {data.map((entry, i) => (
                    <Cell
                      key={i} fill={entry.color}
                      opacity={activeIndex === null || activeIndex === i ? 1 : 0.35}
                      stroke={activeIndex === i ? "#fff" : "none"}
                      strokeWidth={activeIndex === i ? 2 : 0}
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center total */}
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none", textAlign: "center",
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)", margin: 0, letterSpacing: "-0.3px" }}>
                {total}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }}>
            {data.map((d, i) => (
              <div
                key={d.name}
                onClick={() => activeIndex === i ? onSliceClick(null, null) : onSliceClick(d.name, i)}
                style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
              >
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: d.color, flexShrink: 0, opacity: activeIndex === null || activeIndex === i ? 1 : 0.35 }} />
                <span style={{ fontSize: 11, color: activeIndex === i ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                  {d.name} {d.pct}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </LiquidGlassCard>
  );
}

// ── Top list item ─────────────────────────────────────────────────────────────

interface TopItem {
  category: string;
  amount: number;
  pct: number;
  color: string;
  delta?: number;
  budget?: number;  // monthly budget (expense only)
  fmtAmt: string;
}

interface TopListProps {
  title: string;
  items: TopItem[];
  loading: boolean;
  inverseColor?: boolean;
  onItemClick: (item: TopItem) => void;
}

function TopList({ title, items, loading, inverseColor = false, onItemClick }: TopListProps) {
  return (
    <LiquidGlassCard accentColor="var(--accent-primary)" hover={false}>
      <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: "0 0 12px" }}>
        {title}
      </p>
      {loading ? (
        [1,2,3,4,5].map(i => <Skel key={i} h={44} r={8} mb={6} />)
      ) : items.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Nessun dato</p>
      ) : items.map((item, idx) => {
        const progressPct = item.budget && item.budget > 0
          ? Math.min(100, Math.round((item.amount / item.budget) * 100))
          : item.pct;
        const progressColor = item.budget
          ? progressPct >= 100 ? "var(--color-error)" : progressPct >= 80 ? "var(--color-warning)" : "var(--color-success)"
          : item.color;
        return (
          <div
            key={item.category}
            onClick={() => onItemClick(item)}
            style={{
              padding: "10px 12px", marginBottom: 6,
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              borderRadius: 9, cursor: "pointer",
              transition: "background 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--glass-bg-elevated)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--glass-bg)")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", width: 14, textAlign: "right", flexShrink: 0 }}>
                {idx + 1}
              </span>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                {item.category}
              </span>
              <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", flexShrink: 0, marginRight: 6 }}>
                {item.fmtAmt}
              </span>
              <DeltaBadge delta={item.delta} inverse={inverseColor} />
            </div>
            {/* Progress bar */}
            <div style={{ height: 3, background: "var(--glass-border)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, background: progressColor, borderRadius: 2, transition: "width 0.4s ease" }} />
            </div>
            {item.budget && item.budget > 0 && (
              <p style={{ fontSize: 10, color: "var(--text-tertiary)", margin: "3px 0 0", fontFamily: "var(--font-mono)" }}>
                {progressPct}% del budget mensile
              </p>
            )}
          </div>
        );
      })}
    </LiquidGlassCard>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DrillDownPayload {
  title: string;
  totalAmount: number;
  transactions: PersonalTransaction[];
}

export default function Recap() {
  const { portal } = usePortal();
  const { formatCurrency } = useNumberFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: expenseCats } = useExpenseCategories();
  const { categoryColorMap } = useCategories();

  // ── Period state ────────────────────────────────────────────────────────────
  const initialPeriod = (searchParams.get("p") as Period) ?? "month";
  const [period,      setPeriod]      = useState<Period>(initialPeriod);
  const [customFrom,  setCustomFrom]  = useState(searchParams.get("from") ?? currentMonthRange().from);
  const [customTo,    setCustomTo]    = useState(searchParams.get("to")   ?? currentMonthRange().to);
  const [compareOn,   setCompareOn]   = useState(searchParams.get("cmp") === "1");

  const debouncedFrom = useDebounce(customFrom, 400);
  const debouncedTo   = useDebounce(customTo,   400);

  const range     = useMemo(() => getRange(period, debouncedFrom, debouncedTo), [period, debouncedFrom, debouncedTo]);
  const prevRange = useMemo(() => getPrevRange(range), [range]);

  function handlePeriodChange(p: Period) {
    setPeriod(p);
    const params: Record<string, string> = { p };
    if (p === "custom") { params.from = customFrom; params.to = customTo; }
    if (compareOn) params.cmp = "1";
    setSearchParams(params, { replace: true });
    // Reset all interactive filters
    setActiveCatFilter(null);
    setActiveIncomeFilter(null);
    setActivePeriodFilter(null);
    setActiveDateFilter(null);
    setTablePage(0);
  }

  function handleCompareToggle() {
    const next = !compareOn;
    setCompareOn(next);
    const params: Record<string, string> = { p: period };
    if (period === "custom") { params.from = customFrom; params.to = customTo; }
    if (next) params.cmp = "1";
    setSearchParams(params, { replace: true });
  }

  // ── Interactive filter state ────────────────────────────────────────────────
  const [activeCatFilter,    setActiveCatFilter]    = useState<string | null>(null);
  const [activeIncomeFilter, setActiveIncomeFilter] = useState<string | null>(null);
  const [activePeriodFilter, setActivePeriodFilter] = useState<string | null>(null); // "2026-03"
  const [activeDateFilter,   setActiveDateFilter]   = useState<string | null>(null); // "2026-03-15"
  const [typeFilter,         setTypeFilter]         = useState<"all" | "income" | "expense">("all");
  const [searchQuery,        setSearchQuery]        = useState("");

  // ── Table state ─────────────────────────────────────────────────────────────
  const [tablePage,    setTablePage]    = useState(0);
  const [sortField,    setSortField]    = useState<"date" | "amount">("date");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");
  const [expandedRow,  setExpandedRow]  = useState<string | null>(null);
  const [editingTx,    setEditingTx]    = useState<PersonalTransaction | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  // ── Drill-down modal state ──────────────────────────────────────────────────
  const [drillOpen, setDrillOpen]   = useState(false);
  const [drillData, setDrillData]   = useState<DrillDownPayload | null>(null);

  function openDrill(title: string, txs: PersonalTransaction[], total: number) {
    setDrillData({ title, totalAmount: total, transactions: txs });
    setDrillOpen(true);
  }

  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { summary,              isLoading }     = useFinanceSummary(range);
  const { summary: prevSummary, isLoading: prevLoading } = useFinanceSummary(compareOn ? prevRange : range);

  // All transactions in range (for aggregations)
  const { allTransactions, isLoading: txLoading } = useTransactions({
    dateFrom: range.from, dateTo: range.to,
  });

  // Previous period transactions — needed for per-category income delta %
  const { allTransactions: prevAllTransactions } = useTransactions(
    compareOn
      ? { dateFrom: prevRange.from, dateTo: prevRange.to }
      : { dateFrom: range.from, dateTo: range.to },
  );

  // Active filters for the bottom table
  const tableFilters = useMemo(() => {
    const f: Record<string, unknown> = { dateFrom: range.from, dateTo: range.to };
    if (typeFilter !== "all") f.type = typeFilter;
    if (activeCatFilter)      f.category = activeCatFilter;
    else if (activeIncomeFilter) f.category = activeIncomeFilter;
    if (searchQuery)           f.search = searchQuery;
    // If a single-day filter is active, override the date range
    if (activeDateFilter) { f.dateFrom = activeDateFilter; f.dateTo = activeDateFilter; }
    return f;
  }, [range, typeFilter, activeCatFilter, activeIncomeFilter, searchQuery, activeDateFilter]);

  const { transactions: rawTableTxs, isLoading: tableLoading, deleteTransaction, updateTransaction } = useTransactions(tableFilters as TransactionFilters);

  // ── Category color map — DB-backed via useCategories ───────────────────────
  const catColorMap = categoryColorMap;

  // ── Budget map (for top expense progress bars) ──────────────────────────────
  const budgetMap = useMemo(() => {
    const m: Record<string, number> = {};
    expenseCats.forEach(c => { if (c.monthly_budget) m[c.name] = c.monthly_budget; });
    return m;
  }, [expenseCats]);

  // ── Income breakdown ────────────────────────────────────────────────────────
  const incomeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    allTransactions.forEach(tx => { if (tx.type === "income") map[tx.category] = (map[tx.category] ?? 0) + tx.amount; });
    const total = summary.totalIncome || 1;
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, amt]) => ({
        category: cat, amount: amt,
        pct: Math.round((amt / total) * 100),
        color: catColorMap[cat] ?? "#6b7280",
        fmtAmt: formatCurrency(amt),
      }));
  }, [allTransactions, summary.totalIncome, catColorMap, formatCurrency]);

  // ── Prev period maps ────────────────────────────────────────────────────────
  const prevExpenseMap = useMemo(() => {
    const m: Record<string, number> = {};
    prevSummary.categoryBreakdown.forEach(c => { m[c.category] = c.amount; });
    return m;
  }, [prevSummary.categoryBreakdown]);

  const prevIncomeMap = useMemo(() => {
    if (!compareOn) return {};
    const m: Record<string, number> = {};
    prevAllTransactions.forEach(tx => {
      if (tx.type === "income") m[tx.category] = (m[tx.category] ?? 0) + tx.amount;
    });
    return m;
  }, [prevAllTransactions, compareOn]);

  // ── Pie data ────────────────────────────────────────────────────────────────
  const expensePieData: DonutSlice[] = useMemo(() => {
    const top = summary.categoryBreakdown.slice(0, 6);
    const rest = summary.categoryBreakdown.slice(6);
    const result = top.map(c => ({
      name: c.category, value: c.amount,
      pct: c.percentage, color: c.color,
      fmtAmt: formatCurrency(c.amount),
    }));
    if (rest.length > 0) {
      const othTotal = rest.reduce((s, c) => s + c.amount, 0);
      const othPct   = summary.totalExpenses > 0 ? Math.round((othTotal / summary.totalExpenses) * 100) : 0;
      result.push({ name: "Altro", value: othTotal, pct: othPct, color: "#6b7280", fmtAmt: formatCurrency(othTotal) });
    }
    return result;
  }, [summary.categoryBreakdown, summary.totalExpenses, formatCurrency]);

  const incomePieData: DonutSlice[] = useMemo(() => {
    const top = incomeBreakdown.slice(0, 6);
    const rest = incomeBreakdown.slice(6);
    const result = top.map(c => ({
      name: c.category, value: c.amount,
      pct: c.pct, color: c.color, fmtAmt: c.fmtAmt,
    }));
    if (rest.length > 0) {
      const othTotal = rest.reduce((s, c) => s + c.amount, 0);
      const othPct   = summary.totalIncome > 0 ? Math.round((othTotal / summary.totalIncome) * 100) : 0;
      result.push({ name: "Altro", value: othTotal, pct: othPct, color: "#6b7280", fmtAmt: formatCurrency(othTotal) });
    }
    return result;
  }, [incomeBreakdown, summary.totalIncome, formatCurrency]);

  // ── Donut active index state ────────────────────────────────────────────────
  const [expenseActiveIdx, setExpenseActiveIdx] = useState<number | null>(null);
  const [incomeActiveIdx,  setIncomeActiveIdx]  = useState<number | null>(null);

  // ── Daily aggregation (for cashflow + heatmap + granular trend) ─────────────
  const dailyData = useMemo(() => {
    const expMap: Record<string, number> = {};
    const incMap: Record<string, number> = {};
    allTransactions.forEach(tx => {
      if (tx.type === "expense") expMap[tx.date] = (expMap[tx.date] ?? 0) + tx.amount;
      else if (tx.type === "income") incMap[tx.date] = (incMap[tx.date] ?? 0) + tx.amount;
    });
    // Generate full range with zero-fill
    const result: { date: string; income: number; expenses: number }[] = [];
    const cur = new Date(range.from + "T00:00:00");
    const end = new Date(range.to   + "T00:00:00");
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10);
      result.push({ date: d, income: incMap[d] ?? 0, expenses: expMap[d] ?? 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [allTransactions, range]);

  // ── Cashflow cumulative ─────────────────────────────────────────────────────
  const cashflowData = useMemo(() => {
    let running = 0;
    return dailyData.map(d => {
      running += d.income - d.expenses;
      const label = new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
      return { date: d.date, label, net: d.income - d.expenses, cumulative: running };
    });
  }, [dailyData]);

  // ── Heatmap data ────────────────────────────────────────────────────────────
  const heatmapData = useMemo(() =>
    dailyData.map(d => ({ date: d.date, amount: d.expenses })),
  [dailyData]);

  // ── Trend data (daily if ≤31d, monthly otherwise) ──────────────────────────
  const rangeDays = useMemo(() => {
    const from = new Date(range.from);
    const to   = new Date(range.to);
    return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }, [range]);

  // True only when allTransactions actually returned daily data
  const hasDailyData = useMemo(() => dailyData.some(d => d.income > 0 || d.expenses > 0), [dailyData]);

  const trendData = useMemo(() => {
    // Daily mode — only if allTransactions is populated
    if (rangeDays <= 31 && hasDailyData) {
      return dailyData
        .filter(d => d.income > 0 || d.expenses > 0)
        .map(d => ({
          name:         new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
          dateKey:      d.date,
          income:       Math.round(d.income),
          expenses:     Math.round(d.expenses),
          fmt_income:   formatCurrency(d.income),
          fmt_expenses: formatCurrency(d.expenses),
        }));
    }
    // Monthly fallback — always available via useFinanceSummary regardless of allTransactions state
    return summary.monthlyBreakdown.map(m => ({
      name:         m.label,
      dateKey:      m.month,
      income:       Math.round(m.income),
      expenses:     Math.round(m.expenses),
      fmt_income:   formatCurrency(m.income),
      fmt_expenses: formatCurrency(m.expenses),
    }));
  }, [rangeDays, hasDailyData, dailyData, summary.monthlyBreakdown, formatCurrency]);

  // ── Top 5 lists ─────────────────────────────────────────────────────────────
  const top5Expense: TopItem[] = useMemo(() =>
    summary.categoryBreakdown.slice(0, 5).map(c => {
      const prev  = compareOn ? (prevExpenseMap[c.category] ?? 0) : undefined;
      const delta = compareOn && prev !== undefined && prev > 0 ? Math.round(((c.amount - prev) / prev) * 100) : undefined;
      return {
        category: c.category, amount: c.amount, pct: c.percentage,
        color: c.color, delta, fmtAmt: formatCurrency(c.amount),
        budget: budgetMap[c.category],
      };
    }),
  [summary.categoryBreakdown, prevExpenseMap, compareOn, budgetMap, formatCurrency]);

  const top5Income: TopItem[] = useMemo(() => {
    const total = summary.totalIncome || 1;
    return incomeBreakdown.slice(0, 5).map(c => {
      const prev  = compareOn ? (prevIncomeMap[c.category] ?? 0) : undefined;
      const delta = compareOn && prev !== undefined && prev > 0 ? Math.round(((c.amount - prev) / prev) * 100) : undefined;
      return {
        category: c.category, amount: c.amount, pct: Math.round((c.amount / total) * 100),
        color: c.color, delta, fmtAmt: formatCurrency(c.amount),
      };
    });
  }, [incomeBreakdown, summary.totalIncome, prevIncomeMap, compareOn, formatCurrency]);

  // ── KPI deltas ──────────────────────────────────────────────────────────────
  const kpiDelta = useMemo(() => {
    if (!compareOn) return { income: undefined, expense: undefined, net: undefined, savings: undefined };
    const pI = prevSummary.totalIncome;
    const pE = prevSummary.totalExpenses;
    const cI = summary.totalIncome;
    const cE = summary.totalExpenses;
    const cS = cI > 0 ? Math.round(((cI - cE) / cI) * 100) : 0;
    const pS = pI > 0 ? Math.round(((pI - pE) / pI) * 100) : 0;
    return {
      income:  pI > 0 ? Math.round(((cI - pI) / pI) * 100)           : undefined,
      expense: pE > 0 ? Math.round(((cE - pE) / pE) * 100)           : undefined,
      net:     pI > 0 || pE > 0 ? undefined : undefined, // net delta less meaningful
      savings: pS !== 0 ? cS - pS : undefined,
    };
  }, [summary, prevSummary, compareOn]);

  // ── Table sort + client filtering ───────────────────────────────────────────
  const sortedTxs = useMemo(() => {
    const copy = [...rawTableTxs];
    copy.sort((a, b) => {
      if (sortField === "date") {
        const cmp = a.date.localeCompare(b.date);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = a.amount - b.amount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    // client-side period filter (month from trend click)
    if (activePeriodFilter) {
      return copy.filter(tx => tx.date.startsWith(activePeriodFilter));
    }
    return copy;
  }, [rawTableTxs, sortField, sortDir, activePeriodFilter]);

  const TABLE_PAGE_SIZE = 20;
  const paginatedTxs   = sortedTxs.slice(tablePage * TABLE_PAGE_SIZE, (tablePage + 1) * TABLE_PAGE_SIZE);
  const totalPages     = Math.ceil(sortedTxs.length / TABLE_PAGE_SIZE);

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }

  // Active filter banner label
  const activeBannerLabel = activeCatFilter ?? activeIncomeFilter ?? activePeriodFilter ?? activeDateFilter;
  function clearActiveFilter() {
    setActiveCatFilter(null);
    setActiveIncomeFilter(null);
    setActivePeriodFilter(null);
    setActiveDateFilter(null);
  }

  // ── Savings rate ────────────────────────────────────────────────────────────
  const savingsPct = summary.totalIncome > 0
    ? Math.round(((summary.totalIncome - summary.totalExpenses) / summary.totalIncome) * 100)
    : 0;

  const accentColor = portal?.accent ?? "var(--accent-primary)";
  const loading     = isLoading || txLoading;

  // ── Period label ────────────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (period === "custom") return `${range.from} → ${range.to}`;
    return PERIOD_OPTIONS.find(o => o.value === period)?.label ?? "";
  }, [period, range]);

  // ── Mobile check ────────────────────────────────────────────────────────────
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // ── Cashflow gradient ───────────────────────────────────────────────────────
  const maxCumulative = useMemo(() => Math.max(...cashflowData.map(d => Math.abs(d.cumulative)), 1), [cashflowData]);

  return (
    <div style={{ padding: "0 0 64px" }}>
      <LiquidGlassFilter />
      <style>{`
        @keyframes recap-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
        .recap-sort-btn { cursor: pointer; user-select: none; }
        .recap-sort-btn:hover { color: var(--text-primary) !important; }
        @media (max-width: 767px) {
          .recap-grid-2 { grid-template-columns: 1fr !important; }
          .recap-kpi-row { flex-wrap: wrap !important; }
          .recap-kpi-row > div { min-width: calc(50% - 5px) !important; flex: 0 0 calc(50% - 5px) !important; }
          .recap-period-pills { display: none !important; }
          .recap-period-select { display: block !important; }
          .recap-table-method { display: none !important; }
        }
        @media (min-width: 768px) {
          .recap-period-select { display: none !important; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 0, background: accentColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BarChart2 style={{ width: 16, height: 16, color: "#000" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-display)" }}>
              Recap
            </h1>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: 0, fontFamily: "var(--font-mono)" }}>
              {periodLabel}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {/* Period pills */}
          <div className="recap-period-pills" style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => handlePeriodChange(opt.value)} style={{
                padding: "5px 11px", borderRadius: 7, fontSize: 11, fontWeight: 500,
                fontFamily: "var(--font-mono)", cursor: "pointer",
                background: period === opt.value ? accentColor : "var(--glass-bg)",
                border: period === opt.value ? "none" : "1px solid var(--glass-border)",
                color: period === opt.value ? "#000" : "var(--text-secondary)",
                transition: "all 0.13s",
              }}>
                {opt.label}
              </button>
            ))}
          </div>
          {/* Mobile period select */}
          <select
            className="recap-period-select glass-input"
            value={period}
            onChange={e => handlePeriodChange(e.target.value as Period)}
            style={{ display: "none", width: 180 }}
          >
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {/* Compare toggle */}
          <button onClick={handleCompareToggle} style={{
            padding: "4px 12px", borderRadius: 7, fontSize: 11, fontFamily: "var(--font-mono)",
            cursor: "pointer",
            background: compareOn ? "var(--accent-primary-soft)" : "var(--glass-bg)",
            border: `1px solid ${compareOn ? "var(--accent-primary)" : "var(--glass-border)"}`,
            color: compareOn ? "var(--accent-primary)" : "var(--text-tertiary)",
            transition: "all 0.13s",
          }}>
            ⇄ Confronta periodo
          </button>
        </div>
      </motion.div>

      {/* Custom date inputs */}
      {period === "custom" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18 }}
        >
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="glass-input" style={{ width: 160 }} />
          <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>→</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="glass-input" style={{ width: 160 }} />
        </motion.div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <motion.div
        className="recap-kpi-row"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "nowrap" }}
      >
        <KpiCard
          label="Totale Entrate" value={formatCurrency(summary.totalIncome)}
          delta={kpiDelta.income} color="var(--color-success)" loading={loading}
          onClick={() => openDrill("Entrate", allTransactions.filter(t => t.type === "income"), summary.totalIncome)}
        />
        <KpiCard
          label="Totale Uscite" value={formatCurrency(summary.totalExpenses)}
          delta={kpiDelta.expense} inverseColor color="var(--color-error)" loading={loading}
          onClick={() => openDrill("Uscite", allTransactions.filter(t => t.type === "expense"), summary.totalExpenses)}
        />
        <KpiCard
          label="Saldo Netto" value={formatCurrency(summary.netBalance)}
          color={summary.netBalance >= 0 ? "var(--color-success)" : "var(--color-error)"} loading={loading}
          onClick={() => openDrill("Tutte le transazioni", allTransactions, Math.abs(summary.netBalance))}
        />
        <KpiCard
          label="Volume Totale" value={formatCurrency(summary.totalIncome + summary.totalExpenses)}
          sub={`${summary.transactionCount} transazioni`}
          color="var(--text-primary)" loading={loading}
          onClick={() => openDrill("Tutte le transazioni", allTransactions, summary.totalIncome + summary.totalExpenses)}
        />
        <KpiCard
          label="Profit" value={`${savingsPct}%`}
          sub={`${summary.transactionCount} transazioni`}
          color={savingsPct >= 20 ? "var(--color-success)" : savingsPct >= 0 ? "var(--color-warning)" : "var(--color-error)"}
          loading={loading}
        />
      </motion.div>

      {/* ── Row 1: Donut charts ─────────────────────────────────────────────── */}
      <div className="recap-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <DonutCard
            title="Spese per categoria"
            total={formatCurrency(summary.totalExpenses)}
            data={expensePieData}
            loading={loading}
            activeIndex={expenseActiveIdx}
            onSliceClick={(name, idx) => {
              setExpenseActiveIdx(idx);
              setActiveCatFilter(name);
              setActiveIncomeFilter(null);
              setTablePage(0);
              if (name) {
                const top6 = summary.categoryBreakdown.slice(0, 6).map(c => c.category);
                const txs = name === "Altro"
                  ? allTransactions.filter(t => t.type === "expense" && !top6.includes(t.category))
                  : allTransactions.filter(t => t.type === "expense" && t.category === name);
                openDrill(`Spese — ${name}`, txs, txs.reduce((s, t) => s + t.amount, 0));
              }
            }}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
          <DonutCard
            title="Entrate per fonte"
            total={formatCurrency(summary.totalIncome)}
            data={incomePieData}
            loading={loading}
            activeIndex={incomeActiveIdx}
            onSliceClick={(name, idx) => {
              setIncomeActiveIdx(idx);
              setActiveIncomeFilter(name);
              setActiveCatFilter(null);
              setTablePage(0);
              if (name) {
                const top6 = incomeBreakdown.slice(0, 6).map(c => c.category);
                const txs = name === "Altro"
                  ? allTransactions.filter(t => t.type === "income" && !top6.includes(t.category))
                  : allTransactions.filter(t => t.type === "income" && t.category === name);
                openDrill(`Entrate — ${name}`, txs, txs.reduce((s, t) => s + t.amount, 0));
              }
            }}
          />
        </motion.div>
      </div>

      {/* ── Trend area chart ────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.11 }} style={{ marginBottom: 14 }}>
        <LiquidGlassCard accentColor={accentColor} hover={false}>
          <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: "0 0 12px" }}>
            Trend — Entrate vs Uscite {rangeDays <= 31 && hasDailyData ? "(giornaliero)" : "(mensile)"}
          </p>
          {loading ? <Skel h={220} r={10} /> : trendData.length === 0 ? (
            <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "var(--text-tertiary)", fontSize: 13, fontFamily: "var(--font-mono)" }}>Nessun dato nel periodo</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onClick={d => {
                  const pt = d?.activePayload?.[0]?.payload;
                  if (!pt?.dateKey) return;
                  const txs = allTransactions.filter(t => t.date === pt.dateKey || t.date.startsWith(pt.dateKey));
                  if (txs.length === 0) return;
                  const total = txs.reduce((s, t) => s + t.amount, 0);
                  openDrill(`Periodo — ${pt.name}`, txs, total);
                  setTablePage(0);
                }}
              >
                <defs>
                  <linearGradient id="grad-income" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="grad-expense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-error)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--color-error)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}k` : `${v}`} />
                <Tooltip content={<GlassTip fmt={formatCurrency} />} cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", paddingTop: 6 }} />
                <Area type="monotone" dataKey="income"   name="Entrate" stroke="var(--color-success)" strokeWidth={2} fill="url(#grad-income)"  dot={false} />
                <Area type="monotone" dataKey="expenses" name="Uscite"  stroke="var(--color-error)"   strokeWidth={2} fill="url(#grad-expense)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </LiquidGlassCard>
      </motion.div>

      {/* ── Cashflow waveform ───────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.14 }} style={{ marginBottom: 14 }}>
        <LiquidGlassCard accentColor={accentColor} hover={false}>
          <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: "0 0 12px" }}>
            Cashflow cumulativo
          </p>
          {loading || cashflowData.length === 0 ? (
            loading ? <Skel h={180} r={10} /> : (
              <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "var(--text-tertiary)", fontSize: 13, fontFamily: "var(--font-mono)" }}>Nessuna transazione nel periodo</span>
              </div>
            )
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={cashflowData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onClick={d => {
                  const date = d?.activePayload?.[0]?.payload?.date;
                  if (!date) return;
                  const txs = allTransactions.filter(t => t.date === date);
                  if (txs.length === 0) return;
                  const label = new Date(date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
                  openDrill(`Transazioni — ${label}`, txs, txs.reduce((s, t) => s + t.amount, 0));
                  setActiveDateFilter(date);
                  setTablePage(0);
                }}
              >
                <defs>
                  {/* Bicolor gradient: green above 0 midpoint, red below */}
                  <linearGradient id="grad-cashflow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--color-success)" stopOpacity={0.4} />
                    <stop offset="45%"  stopColor="var(--color-success)" stopOpacity={0.1} />
                    <stop offset="55%"  stopColor="var(--color-error)"   stopOpacity={0.1} />
                    <stop offset="100%" stopColor="var(--color-error)"   stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false}
                  interval={Math.max(1, Math.floor(cashflowData.length / 8) - 1)}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}k` : v >= -1000 ? `${v}` : `${Math.round(v/1000)}k`}
                />
                <Tooltip
                  content={({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; net: number; cumulative: number } }> }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: "var(--glass-bg-elevated)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        <p style={{ color: "var(--text-tertiary)", margin: "0 0 4px", fontSize: 10 }}>{d.label}</p>
                        <p style={{ color: d.net >= 0 ? "var(--color-success)" : "var(--color-error)", margin: "2px 0", fontWeight: 600 }}>
                          Giorno: {d.net >= 0 ? "+" : ""}{formatCurrency(d.net)}
                        </p>
                        <p style={{ color: d.cumulative >= 0 ? "var(--color-success)" : "var(--color-error)", margin: "2px 0" }}>
                          Saldo: {formatCurrency(d.cumulative)}
                        </p>
                      </div>
                    );
                  }}
                  cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="cumulative" name="Cashflow"
                  stroke={cashflowData[cashflowData.length - 1]?.cumulative >= 0 ? "var(--color-success)" : "var(--color-error)"}
                  strokeWidth={2} fill="url(#grad-cashflow)" dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </LiquidGlassCard>
      </motion.div>

      {/* ── Top lists ───────────────────────────────────────────────────────── */}
      <div className="recap-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.17 }}>
          <TopList
            title="Top categorie di spesa"
            items={top5Expense}
            loading={loading}
            inverseColor
            onItemClick={item => openDrill(
              `Spese — ${item.category}`,
              allTransactions.filter(t => t.type === "expense" && t.category === item.category),
              item.amount,
            )}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
          <TopList
            title="Top fonti di entrata"
            items={top5Income}
            loading={loading}
            onItemClick={item => openDrill(
              `Entrate — ${item.category}`,
              allTransactions.filter(t => t.type === "income" && t.category === item.category),
              item.amount,
            )}
          />
        </motion.div>
      </div>

      {/* ── Calendar Heatmap ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.23 }} style={{ marginBottom: 14 }}>
        <LiquidGlassCard accentColor={accentColor} hover={false}>
          <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: "0 0 12px" }}>
            Heatmap spese
          </p>
          {loading ? <Skel h={120} r={10} /> : (
            <CalendarHeatmap
              data={heatmapData}
              range={range}
              formatAmount={formatCurrency}
              onDayClick={date => {
                setActiveDateFilter(date);
                setTablePage(0);
                const txs = allTransactions.filter(t => t.date === date && t.type === "expense");
                if (txs.length === 0) return;
                const label = new Date(date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
                openDrill(`Spese — ${label}`, txs, txs.reduce((s, t) => s + t.amount, 0));
              }}
            />
          )}
        </LiquidGlassCard>
      </motion.div>

      {/* ── Transaction table ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.26 }}>
        <LiquidGlassCard accentColor={accentColor} hover={false}>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: 0, marginRight: 4 }}>
              Transazioni
            </p>
            {/* Type filter */}
            {(["all","income","expense"] as const).map(t => (
              <button key={t} onClick={() => { setTypeFilter(t); setTablePage(0); }} style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
                background: typeFilter === t ? "var(--accent-primary-soft)" : "var(--glass-bg)",
                border: `1px solid ${typeFilter === t ? "var(--accent-primary)" : "var(--glass-border)"}`,
                color: typeFilter === t ? "var(--accent-primary)" : "var(--text-tertiary)",
              }}>
                {t === "all" ? "Tutto" : t === "income" ? "Entrate" : "Uscite"}
              </button>
            ))}
            {/* Search */}
            <input
              type="text" placeholder="Cerca..." value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setTablePage(0); }}
              className="glass-input"
              style={{ flex: "1 1 140px", minWidth: 100, fontSize: 12, padding: "5px 10px" }}
            />
            {/* Add transaction */}
            <button onClick={() => setEditingTx({} as PersonalTransaction)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
              background: accentColor, border: "none", color: "#000", display: "flex", alignItems: "center", gap: 4,
            }}>
              <Plus style={{ width: 12, height: 12 }} /> Aggiungi
            </button>
          </div>

          {/* Active filter banner */}
          {activeBannerLabel && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
              padding: "6px 12px", borderRadius: 8,
              background: "var(--accent-primary-soft)", border: "1px solid var(--accent-primary)",
              fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-primary)",
            }}>
              <span>Filtro attivo: <strong>{activeBannerLabel}</strong></span>
              <button onClick={clearActiveFilter} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--accent-primary)", fontSize: 13, lineHeight: 1 }}>×</button>
            </div>
          )}

          {/* Table */}
          {tableLoading ? (
            [1,2,3,4,5].map(i => <Skel key={i} h={48} r={8} mb={6} />)
          ) : paginatedTxs.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <p style={{ color: "var(--text-tertiary)", fontSize: 13, fontFamily: "var(--font-mono)", margin: "0 0 8px" }}>
                {activeBannerLabel || searchQuery || typeFilter !== "all" ? "Nessuna transazione per i filtri selezionati." : "Nessuna transazione nel periodo."}
              </p>
              {activeBannerLabel && (
                <button onClick={clearActiveFilter} style={{ fontSize: 12, color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                  Pulisci filtri
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "90px 60px 1fr 1fr 100px 80px 60px", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--glass-border)", marginBottom: 4 }}>
                {[
                  { label: "Data",    field: "date"   as const },
                  { label: "Tipo",    field: null             },
                  { label: "Categ.",  field: null             },
                  { label: "Titolo",  field: null             },
                  { label: "Importo", field: "amount" as const },
                  { label: "Metodo",  field: null,  cls: "recap-table-method" },
                  { label: "",        field: null             },
                ].map((col, i) => (
                  <div
                    key={i}
                    className={`recap-sort-btn ${col.cls ?? ""}`}
                    onClick={() => col.field && toggleSort(col.field)}
                    style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 3 }}
                  >
                    {col.label}
                    {col.field && sortField === col.field && (
                      sortDir === "asc" ? <ChevronUp style={{ width: 9, height: 9 }} /> : <ChevronDown style={{ width: 9, height: 9 }} />
                    )}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {paginatedTxs.map(tx => (
                <div key={tx.id}>
                  <div
                    onClick={() => setExpandedRow(expandedRow === tx.id ? null : tx.id)}
                    style={{
                      display: "grid", gridTemplateColumns: "90px 60px 1fr 1fr 100px 80px 60px",
                      gap: 8, padding: "10px 10px",
                      borderRadius: 8, cursor: "pointer",
                      background: expandedRow === tx.id ? "var(--glass-bg)" : "transparent",
                      borderBottom: "1px solid var(--glass-border)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (expandedRow !== tx.id) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                    onMouseLeave={e => { if (expandedRow !== tx.id) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                      {new Date(tx.date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                    </span>
                    <span style={{
                      fontSize: 10, fontFamily: "var(--font-mono)", borderRadius: 4, padding: "2px 6px",
                      background: tx.type === "income" ? "rgba(74,222,128,0.1)" : tx.type === "expense" ? "rgba(248,113,113,0.1)" : "rgba(148,163,184,0.1)",
                      color: tx.type === "income" ? "var(--color-success)" : tx.type === "expense" ? "var(--color-error)" : "var(--text-tertiary)",
                      alignSelf: "center", textAlign: "center",
                    }}>
                      {tx.type === "income" ? "↑" : tx.type === "expense" ? "↓" : "⇄"}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "center" }}>
                      {tx.category}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "center" }}>
                      {tx.subcategory ?? tx.description ?? "—"}
                    </span>
                    <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 600, color: tx.type === "income" ? "var(--color-success)" : tx.type === "expense" ? "var(--color-error)" : "var(--text-secondary)", alignSelf: "center" }}>
                      {tx.type === "income" ? "+" : tx.type === "expense" ? "-" : ""}{formatCurrency(tx.amount)}
                    </span>
                    <span className="recap-table-method" style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", alignSelf: "center" }}>
                      {tx.payment_method?.replace("_", " ") ?? "—"}
                    </span>
                    <div style={{ display: "flex", gap: 4, alignSelf: "center", justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                      {deletingId === tx.id ? (
                        <>
                          <button onClick={async () => { await deleteTransaction(tx.id); setDeletingId(null); }} style={{ fontSize: 10, color: "var(--color-error)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", padding: "2px 4px" }}>Sì</button>
                          <button onClick={() => setDeletingId(null)} style={{ fontSize: 10, color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", padding: "2px 4px" }}>No</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditingTx(tx)} title="Modifica" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: "2px", fontSize: 14 }}>✏</button>
                          <button onClick={() => setDeletingId(tx.id)} title="Elimina" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)", padding: "2px", fontSize: 14, opacity: 0.7 }}>🗑</button>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Expanded row */}
                  {expandedRow === tx.id && (
                    <div style={{ padding: "8px 10px 12px", background: "var(--glass-bg)", borderRadius: "0 0 8px 8px", borderBottom: "1px solid var(--glass-border)", marginBottom: 2 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
                        {tx.description && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>📝 {tx.description}</span>}
                        {tx.payment_method && <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>💳 {tx.payment_method.replace("_", " ")}</span>}
                        {tx.tags && tx.tags.length > 0 && (
                          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                            {tx.tags.map(t => (
                              <span key={t} style={{ marginRight: 4, padding: "1px 6px", borderRadius: 4, background: "var(--accent-primary-soft)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>#{t}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, padding: "0 4px" }}>
                  <button disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)} style={{ fontSize: 12, fontFamily: "var(--font-mono)", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 6, padding: "5px 12px", cursor: "pointer", color: tablePage === 0 ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                    ← Prec
                  </button>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                    {tablePage + 1} / {totalPages} · {sortedTxs.length} transazioni
                  </span>
                  <button disabled={tablePage >= totalPages - 1} onClick={() => setTablePage(p => p + 1)} style={{ fontSize: 12, fontFamily: "var(--font-mono)", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 6, padding: "5px 12px", cursor: "pointer", color: tablePage >= totalPages - 1 ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                    Succ →
                  </button>
                </div>
              )}
            </>
          )}
        </LiquidGlassCard>
      </motion.div>

      {/* ── Drill-down modal ─────────────────────────────────────────────────── */}
      <TransactionDrillDownModal
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
        title={drillData?.title ?? ""}
        totalAmount={drillData?.totalAmount ?? 0}
        transactions={drillData?.transactions ?? []}
        isLoading={false}
        formatAmount={formatCurrency}
        range={range}
      />

      {/* ── Edit modal ───────────────────────────────────────────────────────── */}
      {editingTx && (
        <AddTransactionModal
          open={!!editingTx}
          onClose={() => setEditingTx(null)}
          initialData={Object.keys(editingTx).length > 0 ? editingTx : undefined}
          onSave={async (data) => {
            const ok = await updateTransaction(editingTx.id, data);
            if (ok) setEditingTx(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}

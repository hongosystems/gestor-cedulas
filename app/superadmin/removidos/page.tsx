"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pjnScraperSupabase } from "@/lib/pjn-scraper-supabase";
import NotificationBell from "@/app/components/NotificationBell";

const PAGE_SIZE = 50;
const SYNC_METADATA_ID = "00000000-0000-0000-0000-000000000001";

type RemovidoCase = {
  key: string;
  expediente: string | null;
  caratula: string | null;
  dependencia: string | null;
  ult_act: string | null;
  updated_at: string | null;
};

type SortField = "fecha" | "expediente";
type SortDirection = "asc" | "desc";

function formatFechaBaja(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function formatDateTimeBadge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const menuLinkStyle: React.CSSProperties = {
  display: "block",
  padding: "12px 20px",
  color: "var(--text)",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 600,
  transition: "background 0.2s ease",
  borderLeft: "3px solid transparent",
};

export default function SuperadminRemovidosPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastUpdateLabel, setLastUpdateLabel] = useState<string>("—");

  const [items, setItems] = useState<RemovidoCase[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [statsTotal, setStatsTotal] = useState(0);
  const [statsWeek, setStatsWeek] = useState(0);
  const [statsMonth, setStatsMonth] = useState(0);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [search, setSearch] = useState("");

  const [sortField, setSortField] = useState<SortField>("fecha");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    const t = setTimeout(() => document.addEventListener("click", handleClickOutside), 100);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [menuOpen]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFiltersToQuery = useCallback(
    (q: any) => {
      let query = q.eq("removido", true);
      if (desde) {
        query = query.gte("updated_at", `${desde}T00:00:00.000Z`);
      }
      if (hasta) {
        query = query.lte("updated_at", `${hasta}T23:59:59.999Z`);
      }
      const term = search.trim();
      if (term) {
        const pattern = `%${term.replace(/%/g, "\\%")}%`;
        query = query.or(`expediente.ilike.${pattern},caratula.ilike.${pattern}`);
      }
      return query;
    },
    [desde, hasta, search]
  );

  const loadLastUpdate = useCallback(async () => {
    try {
      const { data: meta } = await supabase
        .from("pjn_sync_metadata")
        .select("last_sync_at")
        .eq("id", SYNC_METADATA_ID)
        .maybeSingle();

      if (meta?.last_sync_at) {
        setLastUpdateLabel(formatDateTimeBadge(meta.last_sync_at));
        return;
      }
    } catch {
      /* tabla puede no existir */
    }

    const { data: latest } = await pjnScraperSupabase
      .from("cases")
      .select("updated_at")
      .eq("removido", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.updated_at) {
      setLastUpdateLabel(formatDateTimeBadge(latest.updated_at));
    }
  }, []);

  const loadStats = useCallback(async () => {
    const now = new Date();
    const weekStart = startOfWeekMonday(now).toISOString();
    const monthStart = startOfMonth(now).toISOString();

    const [totalRes, weekRes, monthRes] = await Promise.all([
      pjnScraperSupabase
        .from("cases")
        .select("*", { count: "exact", head: true })
        .eq("removido", true),
      pjnScraperSupabase
        .from("cases")
        .select("*", { count: "exact", head: true })
        .eq("removido", true)
        .gte("updated_at", weekStart),
      pjnScraperSupabase
        .from("cases")
        .select("*", { count: "exact", head: true })
        .eq("removido", true)
        .gte("updated_at", monthStart),
    ]);

    setStatsTotal(totalRes.count ?? 0);
    setStatsWeek(weekRes.count ?? 0);
    setStatsMonth(monthRes.count ?? 0);
  }, []);

  const loadPage = useCallback(async () => {
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = applyFiltersToQuery(
      pjnScraperSupabase.from("cases").select(
        "key, expediente, caratula, dependencia, ult_act, updated_at",
        { count: "exact" }
      )
    );

    query = query.order(sortField === "expediente" ? "expediente" : "updated_at", {
      ascending: sortDirection === "asc",
    });

    const { data, error, count } = await query.range(from, to);

    if (error) {
      setMsg("Error al cargar removidos: " + error.message);
      setItems([]);
      setFilteredTotal(0);
      return;
    }

    setItems((data as RemovidoCase[]) ?? []);
    setFilteredTotal(count ?? 0);
    setMsg("");
  }, [applyFiltersToQuery, page, sortField, sortDirection]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", sess.session.user.id)
        .single();

      if (prof?.must_change_password) {
        window.location.href = "/cambiar-password";
        return;
      }

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_superadmin")
        .eq("user_id", sess.session.user.id)
        .maybeSingle();

      if (roleData?.is_superadmin !== true) {
        window.location.href = "/app";
        return;
      }

      const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
      const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
      if (!pjnUrl || !pjnKey || pjnUrl.includes("placeholder")) {
        setMsg("Falta configurar NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL y ANON_KEY");
        setLoading(false);
        return;
      }

      await loadLastUpdate();
      await loadStats();
      setLoading(false);
    })();
  }, [loadLastUpdate, loadStats]);

  useEffect(() => {
    if (loading) return;
    loadPage();
  }, [loading, loadPage]);

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "fecha" ? "asc" : "asc");
    }
    setPage(1);
  };

  const limpiarFiltros = () => {
    setDesde("");
    setHasta("");
    setSearch("");
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const BATCH = 1000;
      const all: RemovidoCase[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = applyFiltersToQuery(
          pjnScraperSupabase.from("cases").select(
            "key, expediente, caratula, dependencia, ult_act, updated_at"
          )
        );
        query = query.order(sortField === "expediente" ? "expediente" : "updated_at", {
          ascending: sortDirection === "asc",
        });
        const { data, error } = await query.range(offset, offset + BATCH - 1);
        if (error) {
          setMsg("Error al exportar: " + error.message);
          return;
        }
        const batch = (data as RemovidoCase[]) ?? [];
        all.push(...batch);
        hasMore = batch.length === BATCH;
        offset += BATCH;
      }

      const header = ["Expediente", "Carátula", "Juzgado", "Última Actividad", "Fecha de Baja"];
      const rows = all.map((r) => [
        r.expediente || r.key || "",
        r.caratula || "",
        r.dependencia || "",
        r.ult_act || "",
        formatFechaBaja(r.updated_at),
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((c) => escapeCsvCell(String(c))).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `expedientes_removidos_${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const sortIndicator = useMemo(
    () => (field: SortField) => {
      if (sortField !== field) return "↕";
      return sortDirection === "asc" ? "↑" : "↓";
    },
    [sortField, sortDirection]
  );

  if (loading) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text)" }}>
        Cargando expedientes removidos…
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "100%", overflowX: "hidden" }}>
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            style={{
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.16)",
              borderRadius: 8,
              padding: "8px 10px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "center",
            }}
            aria-label="Menú"
          >
            <span style={{ width: 20, height: 2, background: "var(--text)", display: "block" }} />
            <span style={{ width: 20, height: 2, background: "var(--text)", display: "block" }} />
            <span style={{ width: 20, height: 2, background: "var(--text)", display: "block" }} />
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              Expedientes Removidos de Favoritos PJN
            </h1>
            <span
              style={{
                display: "inline-block",
                marginTop: 8,
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: "rgba(96,141,186,.2)",
                border: "1px solid rgba(96,141,186,.35)",
                color: "rgba(234,243,255,.9)",
              }}
            >
              Última actualización: {lastUpdateLabel}
            </span>
          </div>
        </div>
        <NotificationBell />

        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "100%",
              left: 24,
              marginTop: 8,
              background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
              border: "1px solid rgba(255,255,255,.16)",
              borderRadius: 12,
              padding: "12px 0",
              minWidth: 220,
              boxShadow: "0 8px 24px rgba(0,0,0,.4)",
              zIndex: 1000,
            }}
          >
            <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={menuLinkStyle}>
              📊 Dashboard SuperAdmin
            </Link>
            <Link
              href="/superadmin/removidos"
              onClick={() => setMenuOpen(false)}
              style={{ ...menuLinkStyle, borderLeftColor: "var(--brand-blue-2)", background: "rgba(255,255,255,.06)" }}
            >
              📋 Exp. Removidos
            </Link>
            <Link href="/logout" onClick={() => setMenuOpen(false)} style={{ ...menuLinkStyle, color: "var(--brand-red)" }}>
              🚪 Salir
            </Link>
          </div>
        )}
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            borderRadius: 8,
            background: "rgba(231, 76, 60, 0.15)",
            border: "1px solid rgba(231, 76, 60, 0.35)",
            color: "rgba(255, 220, 216, 0.95)",
            fontSize: 13,
          }}
        >
          {msg}
        </div>
      )}

      {/* Estadísticas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Total removidos (histórico)", value: statsTotal },
          { label: "Removidos esta semana", value: statsWeek },
          { label: "Removidos este mes", value: statsMonth },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              padding: "16px 20px",
              borderRadius: 12,
              background: "rgba(100, 0, 0, 0.12)",
              border: "1px solid rgba(231, 76, 60, 0.25)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {card.value.toLocaleString("es-AR")}
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginBottom: 20,
          padding: 16,
          background: "rgba(255,255,255,.02)",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,.06)",
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            Desde
          </label>
          <input
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value);
              setPage(1);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.15)",
              background: "rgba(0,0,0,.2)",
              color: "var(--text)",
              fontSize: 13,
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            Hasta
          </label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              setPage(1);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.15)",
              background: "rgba(0,0,0,.2)",
              color: "var(--text)",
              fontSize: 13,
            }}
          />
        </div>
        <div style={{ flex: "1 1 200px", minWidth: 200 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            Buscar expediente o carátula
          </label>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Texto a buscar…"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.15)",
              background: "rgba(0,0,0,.2)",
              color: "var(--text)",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>
        <button
          type="button"
          onClick={limpiarFiltros}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.2)",
            background: "rgba(255,255,255,.06)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Limpiar filtros
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || filteredTotal === 0}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(46, 204, 113, 0.45)",
            background: exporting ? "rgba(255,255,255,.08)" : "rgba(46, 204, 113, 0.2)",
            color: "rgba(210, 255, 226, 0.95)",
            fontSize: 13,
            fontWeight: 600,
            cursor: exporting || filteredTotal === 0 ? "not-allowed" : "pointer",
            opacity: filteredTotal === 0 ? 0.5 : 1,
          }}
        >
          {exporting ? "Exportando…" : "Exportar CSV"}
        </button>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
        Mostrando{" "}
        <strong style={{ color: "var(--text)" }}>
          {filteredTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
          {Math.min(page * PAGE_SIZE, filteredTotal)}
        </strong>{" "}
        de <strong style={{ color: "var(--text)" }}>{filteredTotal.toLocaleString("es-AR")}</strong>{" "}
        expedientes removidos
        {(desde || hasta || search.trim()) && " (con filtros aplicados)"}
      </p>

      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,.08)" }}>
        <table
          style={{
            width: "100%",
            minWidth: 720,
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "rgba(255,255,255,.04)" }}>
              <th
                style={{
                  padding: "12px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,.1)",
                  whiteSpace: "nowrap",
                }}
                onClick={() => handleSort("expediente")}
                title="Ordenar por expediente"
              >
                Expediente {sortIndicator("expediente")}
              </th>
              <th style={{ padding: "12px 14px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                Carátula
              </th>
              <th style={{ padding: "12px 14px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                Juzgado
              </th>
              <th style={{ padding: "12px 14px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                Última Actividad
              </th>
              <th
                style={{
                  padding: "12px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,.1)",
                  whiteSpace: "nowrap",
                }}
                onClick={() => handleSort("fecha")}
                title="Ordenar por fecha de baja"
              >
                Fecha de Baja {sortIndicator("fecha")}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.key}
                style={{
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                  background: "rgba(100, 0, 0, 0.08)",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(120, 0, 0, 0.18)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(100, 0, 0, 0.08)";
                }}
              >
                <td style={{ padding: "11px 14px", fontWeight: 650, verticalAlign: "top" }}>
                  {row.expediente?.trim() || row.key || "—"}
                </td>
                <td style={{ padding: "11px 14px", verticalAlign: "top", maxWidth: 360 }}>
                  {row.caratula?.trim() ? (
                    <span style={{ lineHeight: 1.45 }}>{row.caratula}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ padding: "11px 14px", verticalAlign: "top" }}>
                  {row.dependencia?.trim() || <span className="muted">—</span>}
                </td>
                <td style={{ padding: "11px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {row.ult_act?.trim() || <span className="muted">—</span>}
                </td>
                <td style={{ padding: "11px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {formatFechaBaja(row.updated_at)}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: "center" }} className="muted">
                  No hay expedientes removidos con los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginTop: 20,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(96,141,186,.4)",
              background: page <= 1 ? "rgba(255,255,255,.05)" : "rgba(96,141,186,.2)",
              color: "var(--text)",
              fontSize: 13,
              cursor: page <= 1 ? "not-allowed" : "pointer",
            }}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(96,141,186,.4)",
              background: page >= totalPages ? "rgba(255,255,255,.05)" : "rgba(96,141,186,.2)",
              color: "var(--text)",
              fontSize: 13,
              cursor: page >= totalPages ? "not-allowed" : "pointer",
            }}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}

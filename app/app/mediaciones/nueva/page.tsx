"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AseguradorasStep from "./_components/AseguradorasStep";

const LETRADO_CARACTER = ["Apoderado", "Patrocinante", "Apoderado y Patrocinante"];
const REQ_CONDICION = ["Conductor", "Asegurado", "Propietario", "Conductor y asegurado", "Otro"];
const LESIONES = ["Sí", "No", "A determinar"];
const OBJETO_RECLAMO = [
  "Accidente de Transito con Lesiones",
  "Accidente de Transito con Lesiones y/o Muerte",
];

function formatDateInput(value: string): string {
  const cleaned = value.replace(/[^\d/]/g, "");
  if (cleaned.length > 10) return cleaned.slice(0, 10);
  let formatted = cleaned.replace(/\//g, "");
  if (formatted.length > 2) formatted = formatted.slice(0, 2) + "/" + formatted.slice(2);
  if (formatted.length > 5) formatted = formatted.slice(0, 5) + "/" + formatted.slice(5);
  return formatted;
}

function ddmmaaaaToISO(ddmmaaaa: string): string | null {
  if (!ddmmaaaa || ddmmaaaa.trim() === "") return null;
  const parts = ddmmaaaa.trim().split("/");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map((p) => parseInt(p, 10));
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) return null;
  return date.toISOString().slice(0, 10);
}

type Requirente = {
  id: string;
  nombre: string;
  dni: string;
  domicilio: string;
  email: string;
  celular: string;
};

type Requerido = {
  id: string;
  nombre: string;
  empresa_nombre_razon_social: string;
  domicilio: string;
  lesiones: string;
};

type AseguradoraItem = {
  requeridoId: string;
  matricula: string;
  denominacion: string;
  cuit: string;
  domicilio?: { direccion?: string; localidad?: string; provincia?: string } | null;
  poliza: string;
  numeroSiniestro: string;
  domicilioManual: boolean;
};

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

const STEP_TITLES = [
  "Datos letrado requirente",
  "Requirente",
  "Requerido/s",
  "Hecho y reclamo",
  "Revisión",
];

const REVIEW_WRAP = {
  overflowX: "hidden" as const,
  wordBreak: "break-word" as const,
  overflowWrap: "break-word" as const,
};

const REVIEW_P: CSSProperties = {
  wordBreak: "break-word",
  overflowWrap: "break-word",
};

export default function NuevaMediacionPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const [letrado_nombre, setLetrado_nombre] = useState("Dr. Gustavo Federico Hisi (APODERADO)");
  const [letrado_caracter, setLetrado_caracter] = useState("Apoderado");
  const [letrado_tomo, setLetrado_tomo] = useState("110");
  const [letrado_folio, setLetrado_folio] = useState("492");
  const [letrado_domicilio, setLetrado_domicilio] = useState("Uruguay 228 piso 1 of 28 CABA");
  const [letrado_telefono, setLetrado_telefono] = useState("1551779201");
  const [letrado_celular, setLetrado_celular] = useState("1551779201");
  const [letrado_email, setLetrado_email] = useState("gfhisi@gmail.com");

  const [requirentes, setRequirentes] = useState<Requirente[]>([
    { id: "1", nombre: "", dni: "", domicilio: "", email: "", celular: "" },
  ]);

  const [requeridos, setRequeridos] = useState<Requerido[]>([
    { id: "1", nombre: "", empresa_nombre_razon_social: "", domicilio: "", lesiones: "" },
  ]);
  const [aseguradoras, setAseguradoras] = useState<AseguradoraItem[]>([]);

  const [objeto_reclamo, setObjeto_reclamo] = useState("");
  const [fecha_hecho, setFecha_hecho] = useState("");
  const [lugar_hecho, setLugar_hecho] = useState("");
  const [vehiculo, setVehiculo] = useState("");
  const [dominio_patente, setDominio_patente] = useState("");
  const [nro_siniestro, setNro_siniestro] = useState("");
  const [nro_poliza, setNro_poliza] = useState("");
  const [mecanica_hecho, setMecanica_hecho] = useState("");
  const [linea_interno, setLinea_interno] = useState("");
  const [articulo, setArticulo] = useState("");
  const [intervino, setIntervino] = useState("");
  const [lesiones_ambos, setLesiones_ambos] = useState("");

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_admin_mediaciones, is_superadmin, is_mediador")
        .eq("user_id", session.user.id)
        .maybeSingle();
      const canCreate =
        roleData?.is_admin_mediaciones === true ||
        roleData?.is_superadmin === true ||
        roleData?.is_mediador === true;
      if (!canCreate) {
        router.replace("/app/mediaciones");
        return;
      }
      setLoading(false);
    })();
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  function addRequirente() {
    setRequirentes((prev) =>
      prev.length >= 3
        ? prev
        : [...prev, { id: crypto.randomUUID(), nombre: "", dni: "", domicilio: "", email: "", celular: "" }]
    );
  }
  function removeRequirente(id: string) {
    setRequirentes((prev) => prev.filter((r) => r.id !== id));
  }
  function updateRequirente(id: string, field: keyof Requirente, value: string) {
    setRequirentes((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addRequerido() {
    setRequeridos((prev) =>
      prev.length >= 3
        ? prev
        : [
            ...prev,
            { id: crypto.randomUUID(), nombre: "", empresa_nombre_razon_social: "", domicilio: "", lesiones: "" },
          ]
    );
  }
  function removeRequerido(id: string) {
    setRequeridos((prev) => prev.filter((r) => r.id !== id));
    setAseguradoras((prev) => prev.filter((a) => a.requeridoId !== id));
  }
  function updateRequerido(id: string, field: keyof Requerido, value: string | boolean) {
    setRequeridos((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function enviarSolicitud() {
    const session = await requireSessionOrRedirect();
    if (!session) return;

    setSaving(true);
    setMsg("");

    const firstReq = requirentes[0];
    const { data: mediacion, error: insErr } = await supabase
      .from("mediaciones")
      .insert({
        user_id: session.user.id,
        estado: "pendiente_rta",
        letrado_nombre: letrado_nombre.trim() || null,
        letrado_caracter: letrado_caracter || null,
        letrado_tomo: letrado_tomo.trim() || null,
        letrado_folio: letrado_folio.trim() || null,
        letrado_domicilio: letrado_domicilio.trim() || null,
        letrado_telefono: letrado_telefono.trim() || null,
        letrado_celular: letrado_celular.trim() || null,
        letrado_email: letrado_email.trim() || null,
        req_nombre: firstReq?.nombre.trim() || null,
        req_dni: firstReq?.dni.trim() || null,
        req_domicilio: firstReq?.domicilio.trim() || null,
        req_email: firstReq?.email.trim() || null,
        req_celular: firstReq?.celular.trim() || null,
        objeto_reclamo: objeto_reclamo || null,
        fecha_hecho: ddmmaaaaToISO(fecha_hecho) || null,
        lugar_hecho: lugar_hecho.trim() || null,
        vehiculo: vehiculo.trim() || null,
        dominio_patente: dominio_patente.trim() || null,
        nro_siniestro: nro_siniestro.trim() || null,
        nro_poliza: nro_poliza.trim() || null,
        mecanica_hecho: mecanica_hecho.trim() || null,
        linea_interno: linea_interno.trim() || null,
        articulo: articulo.trim() || null,
        intervino: intervino.trim() || null,
        lesiones_ambos: lesiones_ambos.trim() || null,
      })
      .select("id")
      .single();

    if (insErr || !mediacion?.id) {
      setMsg(insErr?.message || "Error al crear la mediación");
      setSaving(false);
      return;
    }

    await supabase.from("mediacion_historial").insert({
      mediacion_id: mediacion.id,
      estado_nuevo: "pendiente_rta",
      actor_id: session.user.id,
    });

    const requirenteRows = requirentes.map((r, i) => ({
      mediacion_id: mediacion.id,
      nombre: r.nombre.trim() || "—",
      dni: r.dni.trim() || null,
      domicilio: r.domicilio.trim() || null,
      email: r.email.trim() || null,
      celular: r.celular.trim() || null,
      orden: i,
    }));
    if (requirenteRows.length > 0) {
      await supabase.from("mediacion_requirentes").insert(requirenteRows);
    }

    const reqRows = requeridos.map((r, i) => ({
      mediacion_id: mediacion.id,
      nombre: r.nombre.trim() || "—",
      empresa_nombre_razon_social: r.empresa_nombre_razon_social.trim() || null,
      condicion: null,
      domicilio: r.domicilio.trim() || null,
      lesiones: r.lesiones || null,
      es_aseguradora: false,
      aseguradora_nombre: null,
      aseguradora_domicilio: null,
      orden: i,
    }));
    const aseguradoraRows = aseguradoras
      .filter((a) => (a.denominacion || "").trim() !== "")
      .map((a, i) => {
        const domicilioDireccion = a.domicilio?.direccion?.trim() || "";
        const domicilioLocalidad = a.domicilio?.localidad?.trim() || "";
        const domicilioProvincia = a.domicilio?.provincia?.trim() || "";
        const domicilioParts = [domicilioDireccion, domicilioLocalidad, domicilioProvincia].filter(Boolean);

        return {
          mediacion_id: mediacion.id,
          nombre: "—",
          empresa_nombre_razon_social: null,
          condicion: null,
          domicilio: null,
          lesiones: null,
          es_aseguradora: true,
          aseguradora_nombre: a.denominacion.trim(),
          aseguradora_domicilio: domicilioParts.length > 0 ? domicilioParts.join(", ") : null,
          orden: reqRows.length + i,
        };
      });

    const requeridosToInsert = [...reqRows, ...aseguradoraRows];
    if (requeridosToInsert.length > 0) {
      await supabase.from("mediacion_requeridos").insert(requeridosToInsert);
    }

    setSaving(false);
    router.push("/app/mediaciones");
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const linkStyle = { display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600, transition: "background 0.2s ease", borderLeft: "3px solid transparent" };

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Cargando…</p></div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative" }}>
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "center", minWidth: 40, minHeight: 40 }}>
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
            </button>
            {menuOpen && (
              <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, marginTop: 8, background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: "12px 0", minWidth: 220, boxShadow: "0 8px 24px rgba(0,0,0,.4)", zIndex: 1000 }}>
                <Link href="/app/mediaciones" onClick={() => setMenuOpen(false)} style={linkStyle}>⚖️ Mediaciones</Link>
                <Link href="/app/mediaciones/nueva" onClick={() => setMenuOpen(false)} style={linkStyle}>➕ Nueva mediación</Link>
                <Link href="/app/mediaciones/lotes" onClick={() => setMenuOpen(false)} style={linkStyle}>📦 Lotes</Link>
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={linkStyle}>🏠 Inicio</Link>
                <button onClick={() => { setMenuOpen(false); logout(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 20px", color: "var(--brand-red)", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🚪 Salir</button>
              </div>
            )}
          </div>
          <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginLeft: 12 }} />
          <h1>Nueva mediación</h1>
          <div className="spacer" />
          <Link className="btn" href="/app/mediaciones">Volver</Link>
        </header>

        <div className="page">
          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
            {STEP_TITLES.map((title, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: step === i + 1 ? "var(--brand-blue-2)" : "rgba(255,255,255,.1)",
                    color: step === i + 1 ? "#fff" : "var(--muted)",
                  }}
                >
                  {i + 1}. {title}
                </span>
                {i < STEP_TITLES.length - 1 && <span style={{ color: "var(--muted)" }}>→</span>}
              </div>
            ))}
          </div>

          {msg && <div className="error">{msg}</div>}

          {step === 1 && (
            <div className="form" style={{ maxWidth: 560 }}>
              <h3 style={{ marginBottom: 16 }}>DATOS LETRADO REQUIRENTE</h3>
              <div className="field"><label className="label">Nombre y Apellido</label><input className="input" value={letrado_nombre} onChange={(e) => setLetrado_nombre(e.target.value)} /></div>
              <div className="field"><label className="label">Carácter</label><select className="input" value={letrado_caracter} onChange={(e) => setLetrado_caracter(e.target.value)}><option value="">—</option>{LETRADO_CARACTER.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">Tomo</label><input className="input" value={letrado_tomo} onChange={(e) => setLetrado_tomo(e.target.value)} /></div>
                <div className="field"><label className="label">Folio</label><input className="input" value={letrado_folio} onChange={(e) => setLetrado_folio(e.target.value)} /></div>
              </div>
              <div className="field"><label className="label">Domicilio profesional</label><input className="input" value={letrado_domicilio} onChange={(e) => setLetrado_domicilio(e.target.value)} /></div>
              <div className="field">
                <label className="label">Teléfono Estudio / Celular</label>
                <input
                  className="input"
                  value={letrado_telefono}
                  onChange={(e) => {
                    setLetrado_telefono(e.target.value);
                    setLetrado_celular(e.target.value);
                  }}
                />
              </div>
              <div className="field"><label className="label">Mail</label><input className="input" type="email" value={letrado_email} onChange={(e) => setLetrado_email(e.target.value)} /></div>
            </div>
          )}

          {step === 2 && (
            <div className="form" style={{ maxWidth: 560 }}>
              <h3 style={{ marginBottom: 16 }}>Requirente</h3>
              {requirentes.map((r, idx) => (
                <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="label">Requirente {idx + 1}</span>
                    {idx > 0 && (
                      <button type="button" className="btn danger" onClick={() => removeRequirente(r.id)} style={{ padding: "4px 10px", fontSize: 12 }}>Quitar</button>
                    )}
                  </div>
                  <div className="field"><label className="label">Nombre y apellido</label><input className="input" value={r.nombre} onChange={(e) => updateRequirente(r.id, "nombre", e.target.value)} /></div>
                  <div className="field"><label className="label">DNI</label><input className="input" value={r.dni} onChange={(e) => updateRequirente(r.id, "dni", e.target.value)} /></div>
                  <div className="field"><label className="label">Domicilio real</label><input className="input" value={r.domicilio} onChange={(e) => updateRequirente(r.id, "domicilio", e.target.value)} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="field"><label className="label">Email</label><input className="input" type="email" value={r.email} onChange={(e) => updateRequirente(r.id, "email", e.target.value)} /></div>
                    <div className="field"><label className="label">Celular</label><input className="input" value={r.celular} onChange={(e) => updateRequirente(r.id, "celular", e.target.value)} /></div>
                  </div>
                </div>
              ))}
              <button type="button" className="btn" onClick={addRequirente} disabled={requirentes.length >= 3}>+ Agregar otro requirente</button>
            </div>
          )}

          {step === 3 && (
            <div className="form" style={{ maxWidth: 560 }}>
              <h3 style={{ marginBottom: 16 }}>Requerido/s</h3>
              {requeridos.map((r) => (
                <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="label">Requerido</span>
                    <button type="button" className="btn danger" onClick={() => removeRequerido(r.id)} style={{ padding: "4px 10px", fontSize: 12 }}>Quitar</button>
                  </div>
                  <div className="field"><input className="input" placeholder="Nombre y Apellido" value={r.nombre} onChange={(e) => updateRequerido(r.id, "nombre", e.target.value)} /></div>
                  <div className="field"><input className="input" placeholder="Empresa nombre o razón social" value={r.empresa_nombre_razon_social} onChange={(e) => updateRequerido(r.id, "empresa_nombre_razon_social", e.target.value)} /></div>
                  <div className="field"><input className="input" placeholder="Domicilio" value={r.domicilio} onChange={(e) => updateRequerido(r.id, "domicilio", e.target.value)} /></div>
                  <div className="field"><select className="input" value={r.lesiones} onChange={(e) => updateRequerido(r.id, "lesiones", e.target.value)}><option value="">Lesiones</option>{LESIONES.map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
                  <AseguradorasStep
                    value={aseguradoras as any}
                    onChange={setAseguradoras as any}
                    requeridoId={r.id}
                  />
                </div>
              ))}
              <button type="button" className="btn" onClick={addRequerido} disabled={requeridos.length >= 3}>+ Agregar otro requerido</button>
            </div>
          )}

          {step === 4 && (
            <div className="form" style={{ maxWidth: 560 }}>
              <h3 style={{ marginBottom: 16 }}>Hecho y reclamo</h3>
              <div className="field"><label className="label">Objeto del reclamo</label><select className="input" value={objeto_reclamo} onChange={(e) => setObjeto_reclamo(e.target.value)}><option value="">—</option>{OBJETO_RECLAMO.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
              <div className="field"><label className="label">Fecha del hecho (DD/MM/AAAA)</label><input className="input" value={fecha_hecho} onChange={(e) => setFecha_hecho(formatDateInput(e.target.value))} placeholder="DD/MM/AAAA" /></div>
              <div className="field"><label className="label">Lugar</label><input className="input" value={lugar_hecho} onChange={(e) => setLugar_hecho(e.target.value)} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">Vehículo</label><input className="input" value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} /></div>
                <div className="field"><label className="label">Colectivo — Línea e interno</label><input className="input" value={linea_interno} onChange={(e) => setLinea_interno(e.target.value)} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">Dominio/Patente</label><input className="input" value={dominio_patente} onChange={(e) => setDominio_patente(e.target.value)} /></div>
                <div className="field"><label className="label">Art</label><input className="input" value={articulo} onChange={(e) => setArticulo(e.target.value)} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">N° Siniestro</label><input className="input" value={nro_siniestro} onChange={(e) => setNro_siniestro(e.target.value)} /></div>
                <div className="field"><label className="label">N° Póliza</label><input className="input" value={nro_poliza} onChange={(e) => setNro_poliza(e.target.value)} /></div>
              </div>
              <div className="field"><label className="label">Mecánica del hecho</label><textarea className="input" rows={4} value={mecanica_hecho} onChange={(e) => setMecanica_hecho(e.target.value)} placeholder="Describa brevemente el hecho..." /></div>
              <div className="field"><label className="label">Intervino</label><input className="input" value={intervino} onChange={(e) => setIntervino(e.target.value)} placeholder="Ej: policía, ambulancia, bomberos" /></div>
              <div className="field"><label className="label">Lesiones de ambos</label><textarea className="input" rows={3} value={lesiones_ambos} onChange={(e) => setLesiones_ambos(e.target.value)} /></div>
            </div>
          )}

          {step === 5 && (
            <div className="form" style={{ maxWidth: 640, ...REVIEW_WRAP }}>
              <h3 style={{ marginBottom: 16 }}>Revisión</h3>
              <div
                style={{
                  background: "rgba(0,0,0,.15)",
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 20,
                  ...REVIEW_WRAP,
                }}
              >
                <p style={REVIEW_P}><strong>Letrado:</strong> {letrado_nombre || "—"} {letrado_caracter && `(${letrado_caracter})`}</p>
                <p style={REVIEW_P}><strong>Tomo/Folio:</strong> {letrado_tomo || "—"} / {letrado_folio || "—"}</p>
                <p style={REVIEW_P}><strong>Domicilio profesional:</strong> {letrado_domicilio || "—"}</p>
                <p style={REVIEW_P}><strong>Teléfono Estudio / Celular:</strong> {[letrado_telefono, letrado_celular].filter(Boolean).join(" · ") || "—"}</p>
                <p style={REVIEW_P}><strong>Mail:</strong> {letrado_email || "—"}</p>

                <div style={{ height: 10 }} />

                <p style={REVIEW_P}><strong>Requirente/s:</strong></p>
                <div style={{ marginLeft: 14, ...REVIEW_WRAP }}>
                  {requirentes.map((r) => (
                    <div key={r.id} style={{ marginBottom: 8 }}>
                      <p style={REVIEW_P}><strong>Nombre y Apellido:</strong> {r.nombre.trim() || "Nombre y Apellido"}</p>
                      <p style={REVIEW_P}><strong>DNI:</strong> {r.dni.trim() || "DNI"}</p>
                      <p style={REVIEW_P}><strong>Domicilio real:</strong> {r.domicilio.trim() || "Domicilio"}</p>
                      <p style={REVIEW_P}><strong>Email:</strong> {r.email.trim() || "Email"}</p>
                      <p style={REVIEW_P}><strong>Celular:</strong> {r.celular.trim() || "Celular"}</p>
                    </div>
                  ))}
                </div>

                <div style={{ height: 10 }} />

                <p style={REVIEW_P}><strong>Requeridos:</strong></p>
                <div style={{ marginLeft: 14, ...REVIEW_WRAP }}>
                  {requeridos.map((r) => (
                    <div key={r.id} style={{ marginBottom: 8 }}>
                      <p style={REVIEW_P}><strong>Nombre y Apellido:</strong> {r.nombre.trim() || "Nombre y Apellido"}</p>
                      <p style={REVIEW_P}><strong>Empresa:</strong> {r.empresa_nombre_razon_social.trim() || "Empresa nombre o razón social"}</p>
                      <p style={REVIEW_P}><strong>Domicilio:</strong> {r.domicilio.trim() || "Domicilio"}</p>
                      <p style={REVIEW_P}><strong>Lesiones:</strong> {r.lesiones.trim() || "Lesiones"}</p>
                      {aseguradoras
                        .filter((a) => a.requeridoId === r.id && a.denominacion.trim())
                        .map((a, idx) => (
                          <div key={`${r.id}-${a.matricula}-${a.cuit}-${idx}`} style={{ marginTop: 8, marginLeft: 14 }}>
                            <p style={REVIEW_P}><strong>Aseguradora:</strong> {a.denominacion}</p>
                            <p style={REVIEW_P}><strong>Matrícula SSN:</strong> {a.matricula || "—"}</p>
                            <p style={REVIEW_P}><strong>CUIT:</strong> {a.cuit || "—"}</p>
                            <p style={REVIEW_P}><strong>Domicilio:</strong> {a.domicilio?.direccion || "—"}</p>
                            <p style={REVIEW_P}><strong>Localidad / Provincia:</strong> {a.domicilio?.localidad || "—"} / {a.domicilio?.provincia || "—"}</p>
                            <p style={REVIEW_P}><strong>N° Póliza:</strong> {a.poliza || "—"}</p>
                            <p style={REVIEW_P}><strong>N° Siniestro:</strong> {a.numeroSiniestro || "—"}</p>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>

                <div style={{ height: 10 }} />

                <p style={REVIEW_P}><strong>Hecho y reclamo:</strong></p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Objeto del reclamo:</strong> {objeto_reclamo || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Fecha del hecho:</strong> {fecha_hecho || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Lugar:</strong> {lugar_hecho || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Vehículo:</strong> {vehiculo || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Línea/Interno:</strong> {linea_interno || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Dominio/Patente:</strong> {dominio_patente || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Art:</strong> {articulo || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>N° Siniestro:</strong> {nro_siniestro || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>N° Póliza:</strong> {nro_poliza || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Mecánica del hecho:</strong> {mecanica_hecho || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Intervino:</strong> {intervino || "—"}</p>
                <p style={{ marginLeft: 14, ...REVIEW_P }}><strong>Lesiones de ambos:</strong> {lesiones_ambos || "—"}</p>

              </div>
              <button className="btn primary" onClick={enviarSolicitud} disabled={saving} style={{ padding: "12px 24px", fontSize: 16 }}>{saving ? "Enviando…" : "Enviar solicitud"}</button>
            </div>
          )}

          <div className="actions" style={{ marginTop: 24, display: "flex", gap: 12 }}>
            {step > 1 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Anterior</button>}
            {step < 5 && <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>Siguiente</button>}
          </div>
        </div>
      </section>
    </main>
  );
}

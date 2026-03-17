"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const LETRADO_CARACTER = ["Apoderado", "Patrocinante", "Apoderado y Patrocinante"];
const REQ_CONDICION = ["Conductor", "Asegurado", "Propietario", "Conductor y asegurado", "Otro"];
const LESIONES = ["Sí", "No", "A determinar"];
const OBJETO_RECLAMO = [
  "Accidente de tránsito con lesiones",
  "Acc. tránsito daños materiales",
  "Daños y perjuicios",
  "Mala praxis médica",
  "Incumplimiento contractual",
  "Otro",
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

type Requerido = {
  id: string;
  nombre: string;
  condicion: string;
  domicilio: string;
  lesiones: string;
  es_aseguradora: boolean;
  aseguradora_nombre: string;
  aseguradora_domicilio: string;
};

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

const STEP_TITLES = ["Datos letrado", "Requirente", "Requerido/s", "Hecho y reclamo", "Revisión"];

export default function NuevaMediacionPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const [letrado_nombre, setLetrado_nombre] = useState("");
  const [letrado_caracter, setLetrado_caracter] = useState("");
  const [letrado_tomo, setLetrado_tomo] = useState("");
  const [letrado_folio, setLetrado_folio] = useState("");
  const [letrado_domicilio, setLetrado_domicilio] = useState("");
  const [letrado_telefono, setLetrado_telefono] = useState("");
  const [letrado_celular, setLetrado_celular] = useState("");
  const [letrado_email, setLetrado_email] = useState("");

  const [req_nombre, setReq_nombre] = useState("");
  const [req_dni, setReq_dni] = useState("");
  const [req_domicilio, setReq_domicilio] = useState("");
  const [req_email, setReq_email] = useState("");
  const [req_celular, setReq_celular] = useState("");

  const [requeridos, setRequeridos] = useState<Requerido[]>([
    { id: "1", nombre: "", condicion: "", domicilio: "", lesiones: "", es_aseguradora: false, aseguradora_nombre: "", aseguradora_domicilio: "" },
  ]);

  const [objeto_reclamo, setObjeto_reclamo] = useState("");
  const [fecha_hecho, setFecha_hecho] = useState("");
  const [lugar_hecho, setLugar_hecho] = useState("");
  const [vehiculo, setVehiculo] = useState("");
  const [dominio_patente, setDominio_patente] = useState("");
  const [nro_siniestro, setNro_siniestro] = useState("");
  const [nro_poliza, setNro_poliza] = useState("");
  const [mecanica_hecho, setMecanica_hecho] = useState("");

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  function addRequerido() {
    setRequeridos((prev) => [...prev, { id: crypto.randomUUID(), nombre: "", condicion: "", domicilio: "", lesiones: "", es_aseguradora: false, aseguradora_nombre: "", aseguradora_domicilio: "" }]);
  }
  function removeRequerido(id: string) {
    setRequeridos((prev) => prev.filter((r) => r.id !== id));
  }
  function updateRequerido(id: string, field: keyof Requerido, value: string | boolean) {
    setRequeridos((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function enviarSolicitud() {
    const session = await requireSessionOrRedirect();
    if (!session) return;

    setSaving(true);
    setMsg("");

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
        req_nombre: req_nombre.trim() || null,
        req_dni: req_dni.trim() || null,
        req_domicilio: req_domicilio.trim() || null,
        req_email: req_email.trim() || null,
        req_celular: req_celular.trim() || null,
        objeto_reclamo: objeto_reclamo || null,
        fecha_hecho: ddmmaaaaToISO(fecha_hecho) || null,
        lugar_hecho: lugar_hecho.trim() || null,
        vehiculo: vehiculo.trim() || null,
        dominio_patente: dominio_patente.trim() || null,
        nro_siniestro: nro_siniestro.trim() || null,
        nro_poliza: nro_poliza.trim() || null,
        mecanica_hecho: mecanica_hecho.trim() || null,
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

    const reqRows = requeridos.filter((r) => r.nombre.trim()).map((r, i) => ({
      mediacion_id: mediacion.id,
      nombre: r.nombre.trim(),
      condicion: r.condicion || null,
      domicilio: r.domicilio.trim() || null,
      lesiones: r.lesiones || null,
      es_aseguradora: r.es_aseguradora,
      aseguradora_nombre: r.aseguradora_nombre.trim() || null,
      aseguradora_domicilio: r.aseguradora_domicilio.trim() || null,
      orden: i,
    }));
    if (reqRows.length > 0) {
      await supabase.from("mediacion_requeridos").insert(reqRows);
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
              <h3 style={{ marginBottom: 16 }}>Datos del letrado</h3>
              <div className="field"><label className="label">Nombre</label><input className="input" value={letrado_nombre} onChange={(e) => setLetrado_nombre(e.target.value)} /></div>
              <div className="field"><label className="label">Carácter</label><select className="input" value={letrado_caracter} onChange={(e) => setLetrado_caracter(e.target.value)}><option value="">—</option>{LETRADO_CARACTER.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">Tomo</label><input className="input" value={letrado_tomo} onChange={(e) => setLetrado_tomo(e.target.value)} /></div>
                <div className="field"><label className="label">Folio</label><input className="input" value={letrado_folio} onChange={(e) => setLetrado_folio(e.target.value)} /></div>
              </div>
              <div className="field"><label className="label">Domicilio profesional</label><input className="input" value={letrado_domicilio} onChange={(e) => setLetrado_domicilio(e.target.value)} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">Teléfono</label><input className="input" value={letrado_telefono} onChange={(e) => setLetrado_telefono(e.target.value)} /></div>
                <div className="field"><label className="label">Celular</label><input className="input" value={letrado_celular} onChange={(e) => setLetrado_celular(e.target.value)} /></div>
              </div>
              <div className="field"><label className="label">Email</label><input className="input" type="email" value={letrado_email} onChange={(e) => setLetrado_email(e.target.value)} /></div>
            </div>
          )}

          {step === 2 && (
            <div className="form" style={{ maxWidth: 560 }}>
              <h3 style={{ marginBottom: 16 }}>Requirente</h3>
              <div className="field"><label className="label">Nombre y apellido</label><input className="input" value={req_nombre} onChange={(e) => setReq_nombre(e.target.value)} /></div>
              <div className="field"><label className="label">DNI</label><input className="input" value={req_dni} onChange={(e) => setReq_dni(e.target.value)} /></div>
              <div className="field"><label className="label">Domicilio real</label><input className="input" value={req_domicilio} onChange={(e) => setReq_domicilio(e.target.value)} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">Email</label><input className="input" type="email" value={req_email} onChange={(e) => setReq_email(e.target.value)} /></div>
                <div className="field"><label className="label">Celular</label><input className="input" value={req_celular} onChange={(e) => setReq_celular(e.target.value)} /></div>
              </div>
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
                  <div className="field"><input className="input" placeholder="Nombre o razón social" value={r.nombre} onChange={(e) => updateRequerido(r.id, "nombre", e.target.value)} /></div>
                  <div className="field"><select className="input" value={r.condicion} onChange={(e) => updateRequerido(r.id, "condicion", e.target.value)}><option value="">Condición</option>{REQ_CONDICION.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div className="field"><input className="input" placeholder="Domicilio" value={r.domicilio} onChange={(e) => updateRequerido(r.id, "domicilio", e.target.value)} /></div>
                  <div className="field"><select className="input" value={r.lesiones} onChange={(e) => updateRequerido(r.id, "lesiones", e.target.value)}><option value="">Lesiones</option>{LESIONES.map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={r.es_aseguradora} onChange={(e) => updateRequerido(r.id, "es_aseguradora", e.target.checked)} />
                    <span>Aseguradora</span>
                  </label>
                  {r.es_aseguradora && (
                    <>
                      <div className="field" style={{ marginTop: 8 }}><input className="input" placeholder="Nombre aseguradora" value={r.aseguradora_nombre} onChange={(e) => updateRequerido(r.id, "aseguradora_nombre", e.target.value)} /></div>
                      <div className="field"><input className="input" placeholder="Domicilio aseguradora" value={r.aseguradora_domicilio} onChange={(e) => updateRequerido(r.id, "aseguradora_domicilio", e.target.value)} /></div>
                    </>
                  )}
                </div>
              ))}
              <button type="button" className="btn" onClick={addRequerido}>+ Agregar otro requerido</button>
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
                <div className="field"><label className="label">Dominio/Patente</label><input className="input" value={dominio_patente} onChange={(e) => setDominio_patente(e.target.value)} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="label">N° Siniestro</label><input className="input" value={nro_siniestro} onChange={(e) => setNro_siniestro(e.target.value)} /></div>
                <div className="field"><label className="label">N° Póliza</label><input className="input" value={nro_poliza} onChange={(e) => setNro_poliza(e.target.value)} /></div>
              </div>
              <div className="field"><label className="label">Mecánica del hecho</label><textarea className="input" rows={4} value={mecanica_hecho} onChange={(e) => setMecanica_hecho(e.target.value)} placeholder="Describa brevemente el hecho..." /></div>
            </div>
          )}

          {step === 5 && (
            <div className="form" style={{ maxWidth: 640 }}>
              <h3 style={{ marginBottom: 16 }}>Revisión</h3>
              <div style={{ background: "rgba(0,0,0,.15)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <p><strong>Letrado:</strong> {letrado_nombre || "—"} {letrado_caracter && `(${letrado_caracter})`}</p>
                <p><strong>Requirente:</strong> {req_nombre || "—"} {req_dni && `DNI ${req_dni}`}</p>
                <p><strong>Requeridos:</strong> {requeridos.filter((r) => r.nombre.trim()).map((r) => r.nombre).join(", ") || "—"}</p>
                <p><strong>Objeto:</strong> {objeto_reclamo || "—"}</p>
                <p><strong>Fecha hecho:</strong> {fecha_hecho || "—"}</p>
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

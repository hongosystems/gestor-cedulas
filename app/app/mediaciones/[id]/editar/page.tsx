"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const LETRADO_CARACTER = ["Apoderado", "Patrocinante", "Apoderado y Patrocinante"];
const REQ_CONDICION = ["Conductor", "Asegurado", "Propietario", "Conductor y asegurado", "Otro"];
const LESIONES = ["Sí", "No", "A determinar"];
const ESTADOS = ["borrador", "pendiente_rta", "devuelto", "reenviado", "aceptado", "doc_generado", "enviado"];

function formatDateInput(value: string): string {
  const cleaned = value.replace(/[^\d/]/g, "");
  if (cleaned.length > 10) return cleaned.slice(0, 10);
  let formatted = cleaned.replace(/\//g, "");
  if (formatted.length > 2) formatted = formatted.slice(0, 2) + "/" + formatted.slice(2);
  if (formatted.length > 5) formatted = formatted.slice(0, 5) + "/" + formatted.slice(5);
  return formatted;
}

function isoToDDMMAAAA(iso: string | null): string {
  if (!iso) return "";
  const d = iso.substring(0, 10);
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
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
  empresa_nombre_razon_social: string;
  domicilio: string;
  lesiones: string;
};

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

export default function EditarMediacionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const [estado, setEstado] = useState("borrador");
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
  const [requeridos, setRequeridos] = useState<Requerido[]>([]);

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const res = await fetch(`/api/mediaciones/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.data) {
        setMsg(json.error || "Mediación no encontrada");
        setLoading(false);
        return;
      }
      const m = json.data;
      setEstado(m.estado || "borrador");
      setLetrado_nombre(m.letrado_nombre || "");
      setLetrado_caracter(m.letrado_caracter || "");
      setLetrado_tomo(m.letrado_tomo || "");
      setLetrado_folio(m.letrado_folio || "");
      setLetrado_domicilio(m.letrado_domicilio || "");
      setLetrado_telefono(m.letrado_telefono || "");
      setLetrado_celular(m.letrado_celular || "");
      setLetrado_email(m.letrado_email || "");
      setReq_nombre(m.req_nombre || "");
      setReq_dni(m.req_dni || "");
      setReq_domicilio(m.req_domicilio || "");
      setReq_email(m.req_email || "");
      setReq_celular(m.req_celular || "");
      setObjeto_reclamo(m.objeto_reclamo || "");
      setFecha_hecho(isoToDDMMAAAA(m.fecha_hecho));
      setLugar_hecho(m.lugar_hecho || "");
      setVehiculo(m.vehiculo || "");
      setDominio_patente(m.dominio_patente || "");
      setNro_siniestro(m.nro_siniestro || "");
      setNro_poliza(m.nro_poliza || "");
      setMecanica_hecho(m.mecanica_hecho || "");
      setLinea_interno(m.linea_interno || "");
      setArticulo(m.articulo || "");
      setIntervino(m.intervino || "");
      setLesiones_ambos(m.lesiones_ambos || "");
      setRequeridos(
        (m.requeridos || []).length > 0
          ? (m.requeridos || []).map((r: any, i: number) => ({
              id: r.id || String(i),
              nombre: r.nombre || "",
              empresa_nombre_razon_social: r.empresa_nombre_razon_social || "",
              domicilio: r.domicilio || "",
              lesiones: r.lesiones || "",
            }))
          : [{ id: "1", nombre: "", empresa_nombre_razon_social: "", domicilio: "", lesiones: "" }]
      );
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

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
  function removeRequerido(rid: string) {
    setRequeridos((prev) => prev.filter((r) => r.id !== rid));
  }
  function updateRequerido(rid: string, field: keyof Requerido, value: string | boolean) {
    setRequeridos((prev) => prev.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const session = await requireSessionOrRedirect();
    if (!session) return;

    setSaving(true);
    setMsg("");

    const payload = {
      estado,
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
      objeto_reclamo: objeto_reclamo.trim() || null,
      fecha_hecho: ddmmaaaaToISO(fecha_hecho) || null,
      lugar_hecho: lugar_hecho.trim() || null,
      vehiculo: vehiculo.trim() || null,
      linea_interno: linea_interno.trim() || null,
      dominio_patente: dominio_patente.trim() || null,
      nro_siniestro: nro_siniestro.trim() || null,
      nro_poliza: nro_poliza.trim() || null,
      articulo: articulo.trim() || null,
      mecanica_hecho: mecanica_hecho.trim() || null,
      intervino: intervino.trim() || null,
      lesiones_ambos: lesiones_ambos.trim() || null,
      requeridos: requeridos
        .filter((r) => r.nombre.trim() || r.empresa_nombre_razon_social.trim())
        .map((r, i) => ({
          nombre: r.nombre.trim() || "—",
          empresa_nombre_razon_social: r.empresa_nombre_razon_social.trim() || null,
          domicilio: r.domicilio.trim() || null,
          lesiones: r.lesiones || null,
          orden: i,
        })),
    };

    const res = await fetch(`/api/mediaciones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg(json.error || "Error al guardar");
      return;
    }
    router.push(`/app/mediaciones/${id}`);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

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
                <Link href="/app/mediaciones" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>📋 Mediaciones</Link>
                <Link href="/app/mediaciones/nueva" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>➕ Nueva mediación</Link>
                <Link href={`/app/mediaciones/${id}`} onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>Ver detalle</Link>
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>🏠 Inicio</Link>
                <button onClick={() => { setMenuOpen(false); logout(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 20px", color: "var(--brand-red)", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🚪 Salir</button>
              </div>
            )}
          </div>
          <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginLeft: 12 }} />
          <h1>Editar mediación</h1>
          <div className="spacer" />
          <Link className="btn" href={`/app/mediaciones/${id}`}>Volver</Link>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}

          <form onSubmit={handleSubmit} className="form" style={{ maxWidth: 720 }}>
            <div className="field">
              <label className="label">Estado</label>
              <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)}>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>

            <h3 style={{ marginTop: 24, marginBottom: 12 }}>Letrado</h3>
            <div className="field"><label className="label">Nombre</label><input className="input" value={letrado_nombre} onChange={(e) => setLetrado_nombre(e.target.value)} /></div>
            <div className="field"><label className="label">Carácter</label><select className="input" value={letrado_caracter} onChange={(e) => setLetrado_caracter(e.target.value)}><option value="">—</option>{LETRADO_CARACTER.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label className="label">Tomo</label><input className="input" value={letrado_tomo} onChange={(e) => setLetrado_tomo(e.target.value)} /></div>
              <div className="field"><label className="label">Folio</label><input className="input" value={letrado_folio} onChange={(e) => setLetrado_folio(e.target.value)} /></div>
            </div>
            <div className="field"><label className="label">Domicilio</label><input className="input" value={letrado_domicilio} onChange={(e) => setLetrado_domicilio(e.target.value)} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label className="label">Teléfono</label><input className="input" value={letrado_telefono} onChange={(e) => setLetrado_telefono(e.target.value)} /></div>
              <div className="field"><label className="label">Celular</label><input className="input" value={letrado_celular} onChange={(e) => setLetrado_celular(e.target.value)} /></div>
            </div>
            <div className="field"><label className="label">Email</label><input className="input" type="email" value={letrado_email} onChange={(e) => setLetrado_email(e.target.value)} /></div>

            <h3 style={{ marginTop: 24, marginBottom: 12 }}>Requirente</h3>
            <div className="field"><label className="label">Nombre</label><input className="input" value={req_nombre} onChange={(e) => setReq_nombre(e.target.value)} /></div>
            <div className="field"><label className="label">DNI</label><input className="input" value={req_dni} onChange={(e) => setReq_dni(e.target.value)} /></div>
            <div className="field"><label className="label">Domicilio</label><input className="input" value={req_domicilio} onChange={(e) => setReq_domicilio(e.target.value)} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label className="label">Email</label><input className="input" type="email" value={req_email} onChange={(e) => setReq_email(e.target.value)} /></div>
              <div className="field"><label className="label">Celular</label><input className="input" value={req_celular} onChange={(e) => setReq_celular(e.target.value)} /></div>
            </div>

            <h3 style={{ marginTop: 24, marginBottom: 12 }}>Hecho</h3>
            <div className="field"><label className="label">Objeto del reclamo</label><textarea className="input" rows={3} value={objeto_reclamo} onChange={(e) => setObjeto_reclamo(e.target.value)} /></div>
            <div className="field"><label className="label">Fecha hecho (DD/MM/AAAA)</label><input className="input" value={fecha_hecho} onChange={(e) => setFecha_hecho(formatDateInput(e.target.value))} placeholder="DD/MM/AAAA" /></div>
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
              <div className="field"><label className="label">Nº Siniestro</label><input className="input" value={nro_siniestro} onChange={(e) => setNro_siniestro(e.target.value)} /></div>
              <div className="field"><label className="label">Nº Póliza</label><input className="input" value={nro_poliza} onChange={(e) => setNro_poliza(e.target.value)} /></div>
            </div>
            <div className="field"><label className="label">Mecánica del hecho</label><textarea className="input" rows={2} value={mecanica_hecho} onChange={(e) => setMecanica_hecho(e.target.value)} /></div>
            <div className="field"><label className="label">Intervino</label><input className="input" value={intervino} onChange={(e) => setIntervino(e.target.value)} placeholder="Ej: policía, ambulancia, bomberos" /></div>
            <div className="field"><label className="label">Lesiones de ambos</label><textarea className="input" rows={3} value={lesiones_ambos} onChange={(e) => setLesiones_ambos(e.target.value)} /></div>

            <h3 style={{ marginTop: 24, marginBottom: 12 }}>Requeridos</h3>
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
              </div>
            ))}
            <button type="button" className="btn" onClick={addRequerido} disabled={requeridos.length >= 3}>+ Agregar requerido</button>

            <div className="actions" style={{ marginTop: 24 }}>
              <button type="submit" className="btn primary" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
              <Link className="btn" href={`/app/mediaciones/${id}`}>Cancelar</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
